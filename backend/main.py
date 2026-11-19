"""Curator API - FastAPI backend for the Curator website.

Run (from the backend folder):   uvicorn main:app --reload --port 8001
Interactive docs:                http://localhost:8001/docs

No accounts and nothing stored about visitors: the browser sends the movies it picked,
the server answers. TMDB answers (posters, where-to-watch) are cached in backend/cache.db.

The ML part (see hybrid.py, user_cf.py, content.py, mf.py, popularity.py):
  * /api/curator/similar     5 picks from all the selected titles (co-watch + content + hybrid model)
  * /api/curator/similar-to  movies like one title (co-watch + content)
"""
import pickle
import re

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import DATASET, MODELS_DIR
from hybrid import scale_0_1
from tmdb_client import TMDBClient
from user_cf import row_normalise

# ---------------------------------------------------------------- load models once at start-up
MODEL_PATH = MODELS_DIR / f"{DATASET}.pkl"
if not MODEL_PATH.exists():
    raise SystemExit(f"{MODEL_PATH} not found - run data_pipeline.py and train_models.py first")
with open(MODEL_PATH, "rb") as f:
    MODELS = pickle.load(f)
HYBRID = MODELS["hybrid"]
MOVIES = MODELS["movies"].reset_index(drop=True)


# MovieLens writes "Usual Suspects, The" so lists sort nicely. For display we move the
# article back to the front: "The Usual Suspects", "Two Women (La Ciociara)".
_ARTICLE = re.compile(r"^(.+), (The|A|An|Les|La|Le|L'|Il|El|Lo|Los|Las|Das|Der|Die|Den|Det|Un|Une|Una)$")
_PARTS = re.compile(r"^(.*?)((?: \([^()]*\))*)$")      # main title + trailing "(alt title)" parts


def _front_article(s: str) -> str:
    m = _ARTICLE.match(s.strip())
    if not m:
        return s
    body, art = m.groups()
    return f"{art}{body}" if art.endswith("'") else f"{art} {body}"


def display_title(title: str) -> str:
    main, rest = _PARTS.match(title).groups()
    rest = re.sub(r"\(([^()]*)\)", lambda m: f"({_front_article(m.group(1))})", rest)
    return _front_article(main) + rest


MOVIES["display_title"] = MOVIES["clean_title"].map(display_title)
POP_COUNTS = MODELS["popularity"].counts            # number of ratings per movie (same order as MOVIES)
MOVIE_POS = {m: i for i, m in enumerate(MOVIES["movieId"])}
# movie-to-movie similarity from "who watched what" (people who watched X also watched Y)
ITEM_VECS = row_normalise(MODELS["user_cf"].M.T.tocsr())
tmdb = TMDBClient()


# ---------------------------------------------------------------- helpers
def movie_card(i):
    row = MOVIES.iloc[i]
    return {"movieId": int(row["movieId"]), "title": row["display_title"],
            "year": None if pd.isna(row["year"]) else int(row["year"]),
            "genres": row["genres"],
            "tmdbId": None if pd.isna(row["tmdbId"]) else int(row["tmdbId"])}


# ---------------------------------------------------------------- "Because you liked X"
def similar_to(movie_id, exclude, allowed=None, n=10):
    """60% "people who watched it also watched" + 40% "similar genres/tags/era" (content model)."""
    seed = MOVIE_POS[movie_id]
    co_watch = np.asarray((ITEM_VECS @ ITEM_VECS[seed].T).todense()).ravel()
    content = HYBRID.content.similarity(np.arange(len(MOVIES)), [seed]).ravel()
    sims = 0.6 * co_watch / max(co_watch.max(), 1e-9) + 0.4 * content
    series = HYBRID.series()
    sims[series == series[seed]] = -1                  # skip sequels of the movie itself
    sims[POP_COUNTS < 5] = -1
    for m in exclude:
        if m in MOVIE_POS:
            sims[MOVIE_POS[m]] = -1
    if allowed is not None:
        sims[~np.isin(MOVIES["movieId"].values, list(allowed))] = -1
    picked, seen_series = [], set()
    for i in np.argsort(-sims):
        if sims[i] <= 0 or len(picked) == n:
            break
        if series[i] in seen_series:                    # one film per franchise
            continue
        seen_series.add(series[i])
        picked.append(movie_card(i))
    return picked


def explain(cards, ratings):
    """Add 'because': the title of the user's liked movie most similar to each recommendation."""
    liked = [m for m, r in ratings.items() if r >= 4 and m in MOVIE_POS]
    if not liked or not cards:
        return cards
    S = (ITEM_VECS[[MOVIE_POS[c["movieId"]] for c in cards]] @ ITEM_VECS[[MOVIE_POS[m] for m in liked]].T).toarray()
    for c, row in zip(cards, S):
        if row.max() > 0.05:
            c["because"] = MOVIES.at[MOVIE_POS[liked[int(row.argmax())]], "display_title"]
    return cards


app = FastAPI(title="Curator API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"status": "ok", "dataset": DATASET, "movies": len(MOVIES)}


@app.get("/api/search")
def search(q: str, limit: int = 8, region: str = "US"):
    q = q.strip()
    match = (MOVIES["title"].str.contains(q, case=False, regex=False)            # "lion king"
             | MOVIES["display_title"].str.contains(q, case=False, regex=False))  # "the lion king"
    hits = np.where(match.values)[0]
    hits = hits[np.argsort(-POP_COUNTS[hits])][:limit]      # most-rated matches first
    return tmdb.enrich([movie_card(i) for i in hits], region)


# =============================================================================================
# Curator: "which streaming service has the movies I want?" + ML recommendations
# =============================================================================================
CURATOR_TYPES = ("Subscription", "Free", "Free with ads")       # ways to watch without buying
# "Netflix basic with Ads", "Paramount Plus Apple TV Channel" -> one entry per real service
_PLAN_SUFFIX = re.compile(r"\s+((basic|standard|premium)\s+)?with ads$|\s+(amazon|apple tv|roku premium)\s+channel$",
                          re.IGNORECASE)


class DiscoverIn(BaseModel):
    genres: list[str] = Field(default_factory=list, max_length=20)
    shuffle: bool = False
    exclude: list[int] = Field(default_factory=list, max_length=2000)
    region: str = "US"
    n: int = Field(default=10, ge=1, le=30)


class CuratorIn(BaseModel):
    movieIds: list[int] = Field(default_factory=list, max_length=50)
    region: str = "US"
    genre: str | None = None                        # only suggest movies of this genre
    exclude: list[int] = Field(default_factory=list, max_length=200)   # already shown (for Shuffle)
    n: int = Field(default=5, ge=1, le=12)


def service_name(provider_name):
    return _PLAN_SUFFIX.sub("", provider_name.strip()).strip()


@app.get("/api/curator/genres")
def curator_genres():
    counts = MOVIES["genres"].fillna("").str.split("|").explode().value_counts()
    return [g for g in counts.index if g and g != "IMAX"]


@app.post("/api/curator/discover")
def curator_discover(body: DiscoverIn):
    """'Search by genre': well-known movies in the chosen genres, one card at a time on the page."""
    mask = POP_COUNTS >= 10
    if body.genres:
        wanted = set(body.genres)
        mask &= HYBRID.genre_lists.apply(lambda gs: bool(wanted.intersection(gs))).values
    for m in body.exclude:
        if m in MOVIE_POS:
            mask[MOVIE_POS[m]] = False
    cand = np.where(mask)[0]
    if body.shuffle:
        cand = np.random.default_rng().permutation(cand)
    else:
        cand = cand[np.argsort(-POP_COUNTS[cand])]              # most-watched first
    return tmdb.enrich([movie_card(i) for i in cand[:body.n]], body.region)


@app.get("/api/curator/similar-to/{movie_id}")
def curator_similar_to(movie_id: int, region: str = "US", n: int = 10):
    """The 'similar' button on one movie: co-watch + content similarity (same as 'Because you liked')."""
    if movie_id not in MOVIE_POS:
        raise HTTPException(404, "Unknown movieId")
    return tmdb.enrich(similar_to(movie_id, exclude=[], n=n), region)


@app.post("/api/curator/options")
def curator_options(body: CuratorIn):
    """Rank streaming services by how many of the picked movies they have in this region."""
    ids = [m for m in dict.fromkeys(body.movieIds) if m in MOVIE_POS]
    titles = tmdb.enrich([movie_card(MOVIE_POS[m]) for m in ids], body.region, workers=16)
    services, nowhere = {}, []
    for t in titles:
        short = {k: t.get(k) for k in ("movieId", "title", "year", "poster", "runtime", "tmdb_rating")}
        found = False
        for offer in CURATOR_TYPES:
            for p in (t.get("providers") or {}).get(offer, []):
                name = service_name(p["name"])
                s = services.setdefault(name, {"name": name, "logo": p["logo"], "types": set(), "titles": {}})
                s["types"].add(offer)
                s["titles"].setdefault(t["movieId"], {**short, "offer": offer, "link": p["link"]})
                found = True
        if not found:
            nowhere.append({**short, "watch_link": t.get("watch_link")})

    result = []
    for s in services.values():
        have = list(s["titles"].values())
        rated = [h["tmdb_rating"] for h in have if h.get("tmdb_rating")]
        result.append({
            "name": s["name"], "logo": s["logo"], "types": sorted(s["types"], key=CURATOR_TYPES.index),
            "count": len(have),
            "hours": round(sum(h.get("runtime") or 0 for h in have) / 60, 1),
            "rating": round(float(np.mean(rated)), 1) if rated else None,
            "titles": have,
            "missing": [{"movieId": t["movieId"], "title": t["title"]} for t in titles
                        if t["movieId"] not in s["titles"]],
        })
    result.sort(key=lambda s: (-s["count"], -s["hours"], s["name"]))
    return {"region": body.region.upper(), "total": len(titles), "services": result, "nowhere": nowhere}


@app.post("/api/curator/similar")
def curator_similar(body: CuratorIn):
    """The ML part: 5 movies like the ones the visitor picked.

    score = 0.4 * co-watch similarity   (people who watched the picks also watched it - collaborative)
          + 0.4 * content similarity    (genres, tags, decade - content-based)
          + 0.2 * hybrid model score    (picks treated as 5-star ratings: MF + UserCF + content + popularity)
    Then MMR re-ranking keeps the 5 varied, with at most one film per franchise.
    """
    picked = {m: 5.0 for m in dict.fromkeys(body.movieIds) if m in MOVIE_POS}
    if not picked:
        return []
    pos = [MOVIE_POS[m] for m in picked]
    co_watch = np.asarray((ITEM_VECS @ ITEM_VECS[pos].T).todense()).mean(axis=1).ravel()
    content = HYBRID.content.similarity(np.arange(len(MOVIES)), pos).mean(axis=1).ravel()
    hybrid = HYBRID.scores(picked)                     # -inf for picked and very obscure movies
    ok = np.isfinite(hybrid)
    hybrid_01 = np.zeros_like(hybrid)
    hybrid_01[ok] = scale_0_1(hybrid[ok])
    scores = 0.4 * scale_0_1(co_watch) + 0.4 * scale_0_1(content) + 0.2 * hybrid_01

    series = HYBRID.series()
    mask = ok & ~np.isin(series, list({series[p] for p in pos}))     # no sequels of what they picked
    if body.genre:
        mask &= HYBRID.genre_lists.apply(lambda gs: body.genre in gs).values
    for m in body.exclude:                             # Shuffle: skip what was already suggested
        if m in MOVIE_POS:
            mask[MOVIE_POS[m]] = False
    cand = np.where(mask)[0]
    if len(cand) == 0:
        return []
    cand = cand[np.argsort(-scores[cand])][:60]
    picks = HYBRID._mmr(cand, scores, body.n, diversity=0.5)
    cards = explain([movie_card(i) for i in picks], picked)
    return tmdb.enrich(cards, body.region)
