import { useEffect, useMemo, useState } from "react";

// ============================================================ settings
const REGION_CODES = [
  "AR", "AT", "AU", "BE", "BR", "CA", "CH", "CL", "CO", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR",
  "HK", "IE", "IN", "IT", "JP", "KR", "MX", "MY", "NL", "NO", "NZ", "PH", "PL", "PT", "SE", "SG", "TH",
  "TR", "TW", "US", "ZA",
];
const regionName = (() => {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return (code) => dn.of(code) || code;
  } catch {
    return (code) => code;
  }
})();
const REGIONS = REGION_CODES.map((c) => [c, regionName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
const MAX_TITLES = 50;
const SAVE_KEY = "curator_v1";

// ============================================================ helpers
async function api(path, body) {
  const res = await fetch("/api" + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  if (!res.ok) throw new Error(`Server said ${res.status}`);
  return res.json();
}

function load() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}

function save(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private window: don't save */ }
}

const slim = (m) => ({
  movieId: m.movieId, title: m.title, year: m.year, poster: m.poster,
  overview: m.overview, genres: m.genres,
});

// ============================================================ small pieces
function Poster({ m, className = "result-poster" }) {
  return m.poster
    ? <img className={className} src={m.poster} alt={m.title} loading="lazy" />
    : <div className={className + " poster-empty"}>no poster</div>;
}

function Overview({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 170;
  return (
    <>
      <p className="overview">{open || !long ? text : text.slice(0, 170).trimEnd() + "..."}</p>
      {long && (
        <button type="button" className="btn-overview-toggle" onClick={() => setOpen(!open)}>
          {open ? "show less" : "show more"}
        </button>
      )}
    </>
  );
}

function Stars({ rating }) {
  if (!rating) return null;
  const five = Math.round(rating) / 2;               // TMDB 0-10 -> 0-5 in half stars
  return (
    <div className="stars" aria-label={`${five} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={"star" + (five >= i ? " full" : five >= i - 0.5 ? " half" : "")}>★</span>
      ))}
    </div>
  );
}

// One movie in a vertical list (search results, selected titles, similar pop-up)
function ResultItem({ m, picked, onAdd, onRemove, onSimilar, full }) {
  const added = picked.some((p) => p.movieId === m.movieId);
  return (
    <div className="result-item">
      <div className="result-left">
        <Poster m={m} />
        {onRemove ? (
          <button type="button" className="btn-remove" onClick={() => onRemove(m.movieId)}>remove</button>
        ) : (
          <button type="button" disabled={added || full} onClick={() => onAdd(m)}>
            {added ? "added" : "add to list"}
          </button>
        )}
        {onSimilar && <button type="button" className="btn-similar" onClick={() => onSimilar(m)}>similar</button>}
      </div>
      <div className="result-right">
        <h3 className="result-title">{m.title}</h3>
        <p className="result-year">{m.year || "Unknown year"}</p>
        {m.because && <p className="because">because you added {m.because}</p>}
        <Overview text={m.overview} />
      </div>
    </div>
  );
}

// ============================================================ screens
function HomeScreen({ region, setRegion, onContinue }) {
  return (
    <section className="screen">
      <h2>About this project</h2>
      <p>
        Curator is here to rescue you from scrolling five different apps and paying for
        subscriptions you barely use.
      </p>
      <p>
        Tell it the movies you <em>actually</em> want to watch and it works out which streaming service
        has the most of them where you live. A machine-learning recommender then picks five more films
        you are likely to enjoy.
      </p>
      <p>Built as a CSE 575 (Statistical Machine Learning) project on the MovieLens dataset.</p>

      <h2>How it works</h2>
      <ol className="how">
        <li>Add movies that you want to watch.</li>
        <li>We check which services stream them in your region.</li>
        <li>You see a ranked list of services, plus five films picked for you by our model.</li>
      </ol>

      <h2>Select your region</h2>
      <div className="control-row">
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
          <option value="">Select your region</option>
          {REGIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <button type="button" disabled={!region} onClick={onContinue}>continue →</button>
      </div>
    </section>
  );
}

function ChooseScreen({ go }) {
  return (
    <section className="screen">
      <h2>How do you want to search for titles?</h2>
      <p>If you have a specific movie in mind, you can add it directly to your selection.</p>
      <button type="button" className="wide" onClick={() => go("name")}>search by name</button>
      <p>If you don't have anything specific in mind, you can browse by genre.</p>
      <button type="button" className="wide" onClick={() => go("genre")}>search by genre</button>
    </section>
  );
}

function NameScreen({ region, picked, onAdd, onSimilar, full }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);

  function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    api(`/search?q=${encodeURIComponent(q.trim())}&limit=15&region=${region}`)
      .then(setHits)
      .catch(() => setHits([]))
      .finally(() => setBusy(false));
  }

  return (
    <section className="screen">
      <h2>Search by name</h2>
      <form className="control-row" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a title and press Enter" aria-label="Movie title" />
        <button type="submit" disabled={busy}>{busy ? "searching..." : "search"}</button>
      </form>
      {hits && hits.length === 0 && <p className="note">No movies found. Our catalogue has about 9,700 movies released up to 2018.</p>}
      {hits && hits.length > 0 && (
        <div className="results-list">
          {hits.map((m) => (
            <ResultItem key={m.movieId} m={m} picked={picked} onAdd={onAdd} onSimilar={onSimilar} full={full} />
          ))}
        </div>
      )}
    </section>
  );
}

function GenreScreen({ region, genres, picked, onAdd, full }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [shuffle, setShuffle] = useState(false);
  const [applied, setApplied] = useState({ genres: [], shuffle: false });
  const [queue, setQueue] = useState([]);
  const [seen, setSeen] = useState([]);
  const [busy, setBusy] = useState(false);

  function fetchMore(filters, alreadySeen) {
    setBusy(true);
    return api("/curator/discover", {
      genres: filters.genres, shuffle: filters.shuffle, region, n: 10,
      exclude: [...alreadySeen, ...picked.map((p) => p.movieId)],
    })
      .then((batch) => setQueue((q) => [...q, ...batch]))
      .catch(() => {})
      .finally(() => setBusy(false));
  }

  useEffect(() => { fetchMore(applied, []); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() {
    const f = { genres: chosen, shuffle };
    setApplied(f);
    setQueue([]);
    setSeen([]);
    setOpen(false);
    fetchMore(f, []);
  }

  function next(add) {
    const card = queue[0];
    if (!card) return;
    if (add) onAdd(card);
    const nowSeen = [...seen, card.movieId];
    setSeen(nowSeen);
    const rest = queue.slice(1);
    setQueue(rest);
    if (rest.length < 3 && !busy) fetchMore(applied, [...nowSeen, ...rest.map((m) => m.movieId)]);
  }

  const card = queue[0];
  return (
    <section className="screen">
      <h2>Search by genre</h2>

      <div className="filters">
        <button type="button" className="filters-header" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>Search Filters</span><span className="caret">{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="filters-body">
            <div className="filter-row">
              <span className="filter-label">Type</span>
              <label className="check"><input type="radio" checked readOnly /> Movies</label>
            </div>
            <div className="filter-row">
              <span className="filter-label">Genre</span>
              <div className="genre-checks">
                {genres.map((g) => (
                  <label key={g} className="check">
                    <input
                      type="checkbox"
                      checked={chosen.includes(g)}
                      onChange={() => setChosen((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g]))}
                    /> {g}
                  </label>
                ))}
              </div>
            </div>
            <hr className="filter-divider" />
            <div className="filter-footer">
              <label className="check"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Shuffle Results</label>
              <button type="button" className="btn-apply" onClick={applyFilters}>filter</button>
            </div>
          </div>
        )}
      </div>

      {card ? (
        <div className="swipe-card">
          <div className="swipe-left">
            <Poster m={card} className="swipe-poster" />
            <div className="swipe-controls">
              <button type="button" onClick={() => next(false)} aria-label="Skip">✕</button>
              <button type="button" onClick={() => next(true)} disabled={full} aria-label="Add to list">✓</button>
            </div>
          </div>
          <div className="swipe-right">
            <h3>{card.title}</h3>
            <p className="result-year">{card.year || "Unknown year"}</p>
            <div className="tags">
              {(card.genres || "").split("|").filter(Boolean).map((g) => <span key={g}>{g}</span>)}
            </div>
            <Overview key={card.movieId} text={card.overview} />
          </div>
        </div>
      ) : (
        <p className="note">{busy ? "Loading movies..." : "No more movies for these filters. Try other genres."}</p>
      )}
    </section>
  );
}

function SelectedScreen({ picked, onRemove, onSimilar }) {
  return (
    <section className="screen">
      <h2>Selected titles</h2>
      <p>You must add at least 1 title for us to generate a recommendation. You can add up to {MAX_TITLES} titles total.</p>
      <div className="results-list">
        {picked.map((m) => (
          <ResultItem key={m.movieId} m={m} picked={picked} onRemove={onRemove} onSimilar={onSimilar} />
        ))}
      </div>
    </section>
  );
}

function ResultCard({ m, unavailable }) {
  return (
    <div className={"result-card" + (unavailable ? " unavailable" : "")}>
      {m.link
        ? <a href={m.link} target="_blank" rel="noreferrer"><Poster m={m} className="card-poster" /></a>
        : <Poster m={m} className="card-poster" />}
      <h4 className="card-title">{m.title}</h4>
      {unavailable ? <p className="card-meta">{m.year || "Unknown year"}</p> : (
        <>
          <Stars rating={m.tmdb_rating} />
          {m.runtime ? <p className="card-meta">{m.runtime} min</p> : null}
        </>
      )}
    </div>
  );
}

function ResultsScreen({ options, busy, error, sortBy, picks, picksBusy, picked, onAdd, onShuffle, full }) {
  const services = useMemo(() => {
    if (!options) return [];
    const key = {
      hours: (s) => [s.hours, s.count],
      titles: (s) => [s.count, s.hours],
      rating: (s) => [s.rating ?? 0, s.count],
    }[sortBy];
    return [...options.services].sort((a, b) => {
      const [a1, a2] = key(a), [b1, b2] = key(b);
      return b1 - a1 || b2 - a2 || a.name.localeCompare(b.name);
    });
  }, [options, sortBy]);

  return (
    <section className="screen results">
      <h2 className="center">Your options</h2>
      {error && <p className="note center error">{error}</p>}
      {busy && !options && <p className="note center">Checking which services stream your titles...</p>}

      {options && services.length === 0 && (
        <p className="note center">None of your titles are on a streaming service in this region.</p>
      )}
      <div className={busy ? "dim" : ""}>
        {services.map((s, i) => (
          <div key={s.name} className="result-service">
            <h3 className="service-name">
              {s.logo && <img src={s.logo} alt="" className="service-logo" />}
              {i + 1}. {s.name} — {Math.round(s.hours)}h
            </h3>
            <div className="card-row">
              {s.titles.map((t) => <ResultCard key={t.movieId} m={t} />)}
            </div>
          </div>
        ))}
        {options && options.nowhere.length > 0 && (
          <div className="result-service">
            <h3 className="service-name">Not available for streaming</h3>
            <div className="card-row">
              {options.nowhere.map((t) => <ResultCard key={t.movieId} m={t} unavailable />)}
            </div>
          </div>
        )}
      </div>

      <div className="picks">
        <div className="picks-head">
          <h2>Picked for you</h2>
          <button type="button" className="btn-similar" onClick={onShuffle} disabled={picksBusy}>shuffle ↻</button>
        </div>
        <p className="note">
          Five more films chosen by our recommender from the {picked.length} {picked.length === 1 ? "title" : "titles"} you
          added: people who watched them also watched these, and they share genres, tags and era.
        </p>
        {picksBusy && !picks.length && <p className="note">Finding films like yours...</p>}
        <div className={"results-list" + (picksBusy ? " dim" : "")}>
          {picks.map((m) => <ResultItem key={m.movieId} m={m} picked={picked} onAdd={onAdd} full={full} />)}
        </div>
      </div>
    </section>
  );
}

function SimilarModal({ movie, region, picked, onAdd, onClose, full }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    setList(null);
    api(`/curator/similar-to/${movie.movieId}?region=${region}`).then(setList).catch(() => setList([]));
  }, [movie.movieId, region]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Similar to ${movie.title}`}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content">
        <div className="modal-head">
          <h2>Similar to {movie.title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!list && <p className="note">Loading...</p>}
        {list && list.length === 0 && <p className="note">No similar movies found.</p>}
        <div className="results-list">
          {list?.map((m) => <ResultItem key={m.movieId} m={m} picked={picked} onAdd={onAdd} full={full} />)}
        </div>
      </div>
    </div>
  );
}

// ============================================================ the app
export default function App() {
  const saved = useMemo(load, []);
  const [region, setRegion] = useState(saved.region || "");
  const [screen, setScreen] = useState(saved.region ? (saved.screen || "choose") : "home");
  const [picked, setPicked] = useState(saved.picked || []);
  const [genres, setGenres] = useState([]);
  const [similarOf, setSimilarOf] = useState(null);

  const [sortBy, setSortBy] = useState("titles");
  const [options, setOptions] = useState(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [error, setError] = useState("");
  const [picks, setPicks] = useState([]);
  const [picksBusy, setPicksBusy] = useState(false);
  const [picksSeen, setPicksSeen] = useState([]);

  const full = picked.length >= MAX_TITLES;
  const idsKey = picked.map((p) => p.movieId).join(",");

  useEffect(() => { save({ region, picked, screen: screen === "home" ? "choose" : screen }); }, [region, picked, screen]);
  useEffect(() => { api("/curator/genres").then(setGenres).catch(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);
  useEffect(() => { if (screen === "results" && !picked.length) setScreen("selected"); }, [screen, picked.length]);

  // results: rank the services + get the 5 ML picks
  useEffect(() => {
    if (screen !== "results" || !picked.length) return undefined;
    let live = true;
    const ids = picked.map((p) => p.movieId);
    setOptionsBusy(true);
    setError("");
    api("/curator/options", { movieIds: ids, region })
      .then((r) => { if (live) setOptions(r); })
      .catch(() => { if (live) setError("Couldn't reach the server. Is the backend running on port 8001?"); })
      .finally(() => { if (live) setOptionsBusy(false); });
    loadPicks([]);
    return () => { live = false; };
  }, [screen, idsKey, region]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadPicks(exclude) {
    setPicksBusy(true);
    api("/curator/similar", { movieIds: picked.map((p) => p.movieId), region, exclude, n: 5 })
      .then((r) => { setPicks(r); setPicksSeen([...exclude, ...r.map((m) => m.movieId)]); })
      .catch(() => setPicks([]))
      .finally(() => setPicksBusy(false));
  }

  const addTitle = (m) => setPicked((p) => (p.some((x) => x.movieId === m.movieId) || p.length >= MAX_TITLES ? p : [...p, slim(m)]));
  const removeTitle = (id) => setPicked((p) => p.filter((x) => x.movieId !== id));

  function startOver() {
    setPicked([]); setOptions(null); setPicks([]); setPicksSeen([]); setSortBy("titles"); setScreen("home");
  }

  const navBtn = (name, label) => (
    <button type="button" className={screen === name ? "nav-active" : ""} onClick={() => setScreen(name)}>{label}</button>
  );

  return (
    <div id="app">
      <header>
        <h1 id="site-title" onClick={() => setScreen(region ? "choose" : "home")}>Curator</h1>
        <p id="attribution">powered by <span className="tmdb">the movie db</span></p>
      </header>

      {["name", "genre", "selected"].includes(screen) && (
        <nav className="nav control-row">
          {navBtn("selected", `☰ selected titles (${picked.length})`)}
          <span className="nav-split" />
          {navBtn("name", "search by name")}
          {navBtn("genre", "search by genre")}
          <span className="nav-split" />
          <button type="button" disabled={!picked.length} onClick={() => setScreen("results")}>get recommendation →</button>
        </nav>
      )}

      {screen === "results" && (
        <nav className="nav nav-wide control-row">
          <button type="button" onClick={() => setScreen("selected")}>← back to discovery</button>
          <span className="nav-split" />
          {[["hours", "sort by hours"], ["titles", "sort by titles"], ["rating", "sort by rating"]].map(([k, label]) => (
            <button key={k} type="button" className={sortBy === k ? "" : "nav-active"} onClick={() => setSortBy(k)}>{label}</button>
          ))}
          <span className="nav-split" />
          <button type="button" onClick={startOver}>start over ↻</button>
        </nav>
      )}

      {screen === "home" && <HomeScreen region={region} setRegion={setRegion} onContinue={() => setScreen("choose")} />}
      {screen === "choose" && <ChooseScreen go={setScreen} />}
      {screen === "name" && <NameScreen region={region} picked={picked} onAdd={addTitle} onSimilar={setSimilarOf} full={full} />}
      {screen === "genre" && <GenreScreen region={region} genres={genres} picked={picked} onAdd={addTitle} full={full} />}
      {screen === "selected" && <SelectedScreen picked={picked} onRemove={removeTitle} onSimilar={setSimilarOf} />}
      {screen === "results" && (
        <ResultsScreen
          options={options} busy={optionsBusy} error={error} sortBy={sortBy}
          picks={picks} picksBusy={picksBusy} picked={picked} onAdd={addTitle} full={full}
          onShuffle={() => loadPicks(picksSeen.length > 40 ? [] : picksSeen)}
        />
      )}

      {similarOf && (
        <SimilarModal movie={similarOf} region={region} picked={picked} onAdd={addTitle} full={full}
                      onClose={() => setSimilarOf(null)} />
      )}

      <footer>
        <p>Curator is a student project for ASU CSE 575. Movie data: MovieLens (GroupLens Research).</p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data by JustWatch.</p>
        {region && screen !== "home" && (
          <p>Region: {regionName(region)} · <button type="button" className="link" onClick={() => setScreen("home")}>change</button></p>
        )}
      </footer>
    </div>
  );
}
