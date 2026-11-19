# Curator

**Which streaming service actually has the movies you want to watch?**

Curator lets you pick the movies you want to see, checks which streaming services carry them in your
country, and ranks the services by how many of your movies they have. A machine-learning recommender
then suggests five more films you are likely to enjoy.

Built for ASU CSE 575 (Statistical Machine Learning).

---

## Contents

1. [What it does](#what-it-does)
2. [The machine-learning part](#the-machine-learning-part)
3. [Project layout](#project-layout)
4. [Download and run it: every step](#download-and-run-it-every-step)
5. [Running it again later](#running-it-again-later)
6. [Optional: re-tune and evaluate the models](#optional-re-tune-and-evaluate-the-models)
7. [Troubleshooting](#troubleshooting)
8. [Credits](#credits)

---

## What it does

1. Choose your region.
2. Add movies by name, or browse by genre one card at a time (✕ skip, ✓ add).
3. Click **get recommendation** to see:
   * **Your options:** streaming services ranked by number of titles, total hours or average rating.
   * **Picked for you:** 5 films chosen by the recommender from everything you selected.

Every movie also has a **similar** button that shows movies like it.

## The machine-learning part

Trained on the [MovieLens ml-latest-small](https://grouplens.org/datasets/movielens/latest/) dataset
(100,836 ratings, 9,742 movies, 610 users).

| Model | File | Idea |
|---|---|---|
| Popularity baseline | `popularity.py` | global mean + damped user/item biases |
| User-based collaborative filtering | `user_cf.py` | mean-centred cosine k-NN (ratings) + one-class k-NN (who watched what) |
| Content-based | `content.py` | genre multi-hot + TF-IDF of user tags + release decade |
| Matrix factorization | `mf.py` | biased SVD-style model trained with mini-batch SGD and early stopping |
| Hybrid | `hybrid.py` | blends the above; weights shift from popularity to CF as a user adds more titles |

**Picked for you** = 0.4 × co-watch similarity + 0.4 × content similarity + 0.2 × hybrid score,
then re-ranked with Maximal Marginal Relevance so the five picks are varied (one film per franchise).

Posters, runtimes, ratings and where-to-watch data come from the [TMDB API](https://www.themoviedb.org/)
(streaming data by JustWatch).

## Project layout

```
curator/
├── backend/               FastAPI server + all ML code
│   ├── config.py              shared settings (paths, random seed, metrics settings)
│   ├── data_pipeline.py       clean MovieLens + per-user 70/10/20 train/val/test split
│   ├── eda.py                 dataset charts -> results/eda.png
│   ├── popularity.py          model 1
│   ├── user_cf.py             model 2
│   ├── content.py             model 3
│   ├── mf.py                  model 4
│   ├── hybrid.py              model 5 (final model) + diversity re-ranking
│   ├── metrics.py             RMSE, MAE, Precision@K, Recall@K, NDCG@K
│   ├── tune.py                pick settings on the validation set -> results/best_params.json
│   ├── train_models.py        train everything -> models/ml-latest-small.pkl
│   ├── evaluate.py            test-set results + charts -> results/
│   ├── tmdb_client.py         posters + where-to-watch from TMDB (cached 24 h)
│   ├── main.py                the API the website calls
│   ├── requirements.txt       Python packages
│   └── .env.example           template for your TMDB token
├── frontend/              React + Vite website
├── results/               tuned settings, metrics and charts
├── data/raw/              MovieLens files      (you download these; not on GitHub)
└── models/                trained models       (created by train_models.py; not on GitHub)
```

---

## Download and run it: every step

Every step has a **Windows** version (PowerShell) and a **Mac** version (Terminal). Follow only the one
for your computer. The first time takes about **20–30 minutes**, most of it installing software.

### Step 1: Install the tools (skip any you already have)

| Tool | Why | Download |
|---|---|---|
| **Python 3.10 or newer** | runs the backend and trains the models | https://www.python.org/downloads/ |
| **Node.js 18 or newer** (LTS) | runs the website | https://nodejs.org/ |
| **Git** | downloads this project | https://git-scm.com/downloads |
| **VS Code** (recommended) | editor with a built-in terminal | https://code.visualstudio.com/ |

**Windows**
* When installing **Python**, tick **"Add python.exe to PATH"** on the first screen.
* For Node.js and Git, the default options are fine. Keep clicking **Next**.

**Mac**
* Install **Python** and **Node.js** with the macOS installers from the links above (the `.pkg` files).
* **Git:** open **Terminal** (press **Cmd + Space**, type *Terminal*, press Enter) and run `git --version`.
  If Git is missing, macOS offers to install the *Command Line Developer Tools*. Click **Install** and wait.
* **VS Code:** download it, unzip, and drag **Visual Studio Code** into your **Applications** folder.
* *(If you use Homebrew you can instead run `brew install python node git`.)*

After installing, **close and reopen** any terminal windows so they see the new tools.

**Check they work.** Each line should print a version number:

**Windows:** open **PowerShell** (Start menu → type "PowerShell"):
```powershell
python --version
node --version
npm --version
git --version
```

**Mac:** open **Terminal**:
```bash
python3 --version
node --version
npm --version
git --version
```

If one says *"not recognized"* / *"command not found"*, reinstall that tool. On Windows, also make sure
"Add to PATH" was ticked for Python.

### Step 2: Download the project

**Windows (PowerShell)**
```powershell
cd $HOME\Downloads
git clone https://github.com/Hemanth2334/curator.git
cd curator
```

**Mac (Terminal)**
```bash
cd ~/Downloads
git clone https://github.com/Hemanth2334/curator.git
cd curator
```

You now have a folder `Downloads/curator`.

> No Git? On the GitHub page click the green **Code** button → **Download ZIP**, unzip it into
> `Downloads`, and rename the folder to `curator`. (Windows: right-click → **Extract All…**.
> Mac: double-click the zip.)

### Step 3: Open it in VS Code

Open VS Code, then **File → Open Folder…** (Mac: **File → Open…**) → **Downloads → curator** → **Open**.
If VS Code asks *"Do you trust the authors?"*, click **Yes**.

Open the built-in terminal with **Ctrl + `** (the backtick key, under Esc). This works on Mac too:
use **Control**, not Command. The terminal should already be inside the `curator` folder:

* Windows shows `PS C:\Users\<you>\Downloads\curator>`
* Mac shows something like `<you>@MacBook curator %`

**Run every remaining command in this VS Code terminal.**

### Step 4: Download the MovieLens dataset

The dataset isn't stored on GitHub, so you download it yourself (about 1 MB):

1. Go to **https://grouplens.org/datasets/movielens/latest/**
2. Under *"Small"*, click **ml-latest-small.zip** to download it.
3. Put it into the project:

**Windows**
```powershell
Expand-Archive -Path "$HOME\Downloads\ml-latest-small.zip" -DestinationPath "data\raw" -Force
Test-Path "data\raw\ml-latest-small\ratings.csv"
```
The second line must print **True**.

**Mac**

Safari usually unzips downloads automatically, so you may already have a folder `Downloads/ml-latest-small`.
Run **one** of these:
```bash
# if you have the FOLDER ~/Downloads/ml-latest-small  (Safari unzipped it)
mkdir -p data/raw && cp -R ~/Downloads/ml-latest-small data/raw/

# if you have the ZIP ~/Downloads/ml-latest-small.zip  (Chrome / Firefox)
mkdir -p data/raw && unzip -o ~/Downloads/ml-latest-small.zip -d data/raw
```
Then check. It must list the file, not say "No such file":
```bash
ls data/raw/ml-latest-small/ratings.csv
```

The folder must look like this:

```
data/raw/ml-latest-small/
    links.csv   movies.csv   ratings.csv   tags.csv   README.txt
```

### Step 5: Get a free TMDB token (for posters and where-to-watch)

1. Create a free account at **https://www.themoviedb.org/signup** and verify your email.
2. Go to **https://www.themoviedb.org/settings/api** and click **Create** / **Request an API key**.
   Choose **Developer**, accept the terms, and fill in the form (for a class project you can use
   "Personal / educational project" and any website, e.g. your GitHub page).
3. On the same API page, copy the long **API Read Access Token** (it starts with `eyJ...`).
   You want the long token, not the short "API Key".

Create your settings file from the template and open it:

**Windows**
```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

**Mac**
```bash
cp backend/.env.example backend/.env
open -e backend/.env
```

Replace `paste_your_API_Read_Access_Token_here` with your token so the line looks like
`TMDB_READ_TOKEN=eyJhbGciOi...` (no spaces, no quotes). **Save** (Windows: Ctrl + S, Mac: Cmd + S)
and close the editor.

> **Never upload `backend/.env` or share your token.** It's already listed in `.gitignore`, so Git ignores it.
> Mac note: files starting with a dot are hidden in Finder (press **Cmd + Shift + .** to show them).

### Step 6: Create the Python environment and install packages

**Windows**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```
If you get *"running scripts is disabled on this system"*, run this once, type **Y**, and then repeat
the `Activate.ps1` line:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**Mac**
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

* After activating, the prompt starts with **`(.venv)`**. That means the environment is active.
* `pip install` takes 2–5 minutes.
* While `(.venv)` is active, plain `python` works on Mac too (no need for `python3`).

### Step 7: Prepare the data and train the models

Same on Windows and Mac:
```bash
cd backend
python data_pipeline.py
python train_models.py
```

* `data_pipeline.py` cleans the ratings and splits them into train/validation/test (a few seconds).
* `train_models.py` trains all five models and saves them to `models/ml-latest-small.pkl`
  (about 1–3 minutes). It uses the tuned settings already saved in `results/best_params.json`.
* It's done when you see **`Saved all models to ...`**.

### Step 8: Start the backend (API)

Still in the `backend` folder, with `(.venv)` showing (same on Windows and Mac):
```bash
uvicorn main:app --reload --port 8001
```

Wait for **`Application startup complete.`** **Leave this terminal running.**

Quick check: open **http://localhost:8001/api/health** in your browser. It should show
`{"status":"ok", ...}`. Interactive API docs are at **http://localhost:8001/docs**.

### Step 9: Start the website

Open a **second terminal**: click the **+** at the top-right of the VS Code terminal panel.
It opens in the `curator` folder. Then run (same on Windows and Mac):
```bash
cd frontend
npm install
npm run dev
```

* `npm install` is only needed the first time (about 1 minute).
* When it shows `Local: http://localhost:5174/`, open that link (**Ctrl + click** on Windows,
  **Cmd + click** on Mac), or type **http://localhost:5174** into your browser.

### Step 10: Use Curator

1. Pick your region and click **continue**.
2. Click **search by name**, type a movie (e.g. *Inception*), press Enter and click **add to list**.
   Add a few more, or try **search by genre**.
3. Click **get recommendation →** to see your streaming options and your 5 personalised picks.

---

## Running it again later

You don't need to repeat the installs. Open the `curator` folder in VS Code, then:

**Terminal 1 (backend)**

Windows:
```powershell
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn main:app --reload --port 8001
```
Mac:
```bash
source .venv/bin/activate
cd backend
uvicorn main:app --reload --port 8001
```

**Terminal 2 (website)**, same on both:
```bash
cd frontend
npm run dev
```

Open **http://localhost:5174**. To stop either one, click in its terminal and press **Ctrl + C**
(on Mac too: Control, not Command).

---

## Optional: re-tune and evaluate the models

Run these from the `backend` folder with `(.venv)` active (same on Windows and Mac):

| Command | What it does | Output |
|---|---|---|
| `python eda.py` | charts about the dataset | `results/eda.png` |
| `python tune.py` | grid search on the validation set (slow: 10–30 min) | `results/best_params.json`, `results/tuning_log.csv` |
| `python train_models.py` | retrain with the newest settings | `models/ml-latest-small.pkl` |
| `python evaluate.py` | RMSE, MAE, Precision@10, Recall@10, NDCG@10 on the test set, plus cold-start test | `results/test_results.md`, charts |

Restart the backend after retraining so it loads the new models.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `python` / `node` / `git` *is not recognized* (Windows) | Install it (Step 1), then close and reopen VS Code / PowerShell. |
| `command not found: python` (Mac) | Use `python3` until the environment is active (Step 6). After `source .venv/bin/activate`, `python` works. |
| Mac asks to install *Command Line Developer Tools* | Click **Install**; it provides Git. Then run the command again. |
| *running scripts is disabled on this system* (Windows) | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, then activate again. |
| `models/ml-latest-small.pkl not found` | You skipped Step 7. Run `python data_pipeline.py` then `python train_models.py` in `backend`. |
| `FileNotFoundError ... ratings.csv` | The dataset is in the wrong folder. It must be `data/raw/ml-latest-small/ratings.csv` (Step 4). |
| `No module named 'fastapi'` (or another package) | The environment isn't active (no `(.venv)`). Activate it (Step 6), then `pip install -r backend/requirements.txt` from the project folder. |
| `Could not import module "main"` | You're in the wrong folder. `cd backend` first. |
| `npm error ... package.json` not found | You're in the wrong folder. `cd frontend` first. |
| Website says *"Couldn't reach the server"* | The backend isn't running. Start it (Step 8) and wait for `Application startup complete.` |
| No posters / no streaming services | The TMDB token is missing or wrong. Check `backend/.env` (Step 5), then restart the backend. |
| *Address already in use* / port 8001 or 5174 busy | Another copy is already running. Close the other terminal, or press Ctrl + C there. |
| A movie can't be found | The catalogue is MovieLens: about 9,700 movies released up to 2018, and no TV shows. |

---

## Credits

* Movie ratings: F. Maxwell Harper and Joseph A. Konstan. 2015. *The MovieLens Datasets: History and
  Context.* ACM Transactions on Interactive Intelligent Systems 5(4). GroupLens Research.
* Posters, metadata and watch providers: [TMDB](https://www.themoviedb.org/). Streaming availability by JustWatch.
* This product uses the TMDB API but is not endorsed or certified by TMDB.
