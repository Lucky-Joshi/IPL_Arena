# Deployment guide — Vercel + Render

T20 Dynasty runs as three independent services:

| Service | Folder | Platform | Public URL |
|---|---|---|---|
| Frontend (Next.js) | `frontend/` | **Vercel** | `https://t20-dynasty.indevs.in/` · `https://t20-dynasty.vercel.app/` |
| Backend (authoritative Node engine) | `backend/` | **Render** Web Service | `https://t20-dynasty-backend.onrender.com` |
| AI (stateless Python valuation) | `ai/` | **Render** Web Service | `https://t20-dynasty-ai.onrender.com` |

The browser talks **only** to the backend; the backend talks to the AI. Both Render services send permissive
CORS headers, so the Vercel origin is accepted without extra configuration.

> Replace the `onrender.com` hostnames below if you choose different Render service names. The names above
> are what `render.yaml` creates.

---

## 1. Deploy the AI service first

### Option A — Blueprint (deploys both Render services)

1. Push this repo to GitHub (already done: `Lucky-Joshi/IPL_Arena`, branch `main`).
2. Render Dashboard → **New** → **Blueprint** → connect the repo.
3. Name the stack anything you like. Render reads `render.yaml` at the repo root and creates:
   - `t20-dynasty-ai` (free plan)
   - `t20-dynasty-backend` (paid plan, persistent disk)
4. Confirm the paid instance for the backend when prompted, then **Apply**.

Skip to **step 3** if you use the blueprint.

### Option B — Manual web service

1. Render Dashboard → **New** → **Web Service** → connect the repo.
2. Settings:

   | Field | Value |
   |---|---|
   | Name | `t20-dynasty-ai` |
   | Region | any (same region as backend recommended) |
   | Branch | `main` |
   | Root Directory | `ai` |
   | Runtime | `Python 3` |
   | Build Command | `echo "No third-party Python dependencies"` |
   | Start Command | `python server.py` |
   | Plan | Free is fine (AI is stateless) |
   | Health Check Path | `/health` |

3. **Environment** → add (Render also injects its own `PORT`, which the service now reads first):

   | Key | Value | Why |
   |---|---|---|
   | `PORT` | _leave unset_ | Render sets this automatically; the service prefers it over `AI_PORT`. |
   | `PYTHONDONTWRITEBYTECODE` | `1` | Optional: keeps the read-only filesystem tidy. |

4. Create the service and wait for **Live**. Verify:

   ```text
   https://t20-dynasty-ai.onrender.com/health
   ```

   Expected body: `{"ok": true, "version": 1, "service": "t20-dynasty-ai"}`

---

## 2. Deploy the backend with persistent state

The entire auction is one JSON file. Render's free tier has an **ephemeral filesystem**: every deploy or
instance restart wipes it. For durable saves you need a **paid web service with a persistent disk**.

### Manual setup

1. Render Dashboard → **New** → **Web Service** → connect the repo.
2. Settings:

   | Field | Value |
   |---|---|
   | Name | `t20-dynasty-backend` |
   | Region | same region as AI |
   | Branch | `main` |
   | Root Directory | `backend` |
   | Runtime | `Node` |
   | Build Command | `npm install` (no third-party dependencies, but harmless) |
   | Start Command | `npm start` |
   | Plan | **Starter** or higher (required for a disk) |
   | Health Check Path | `/api/health` |

3. Add a **disk** under the service's **Disks** tab:

   | Field | Value |
   |---|---|
   | Name | `t20-dynasty-state` |
   | Mount Path | `/var/data` |
   | Size | 1 GB is plenty |

4. **Environment**:

   | Key | Value | Why |
   |---|---|---|
   | `AI_URL` | `https://t20-dynasty-ai.onrender.com` | Backend → AI base URL, no trailing slash. |
   | `SAVE_FILE` | `/var/data/auction-state.json` | Must be inside the mounted disk. |
   | `PORT` | _leave unset_ | Render injects it; backend already reads `process.env.PORT`. |

   > The backend does **not** load `.env` files. Real values live in the Render Dashboard. The
   > `backend/.env.example` file is documentation only.

5. Create the service. A service with a disk runs **one instance** and deploys with a brief stop/start.

### Verify

```text
https://t20-dynasty-backend.onrender.com/api/health
```

Expected:

```json
{ "ok": true, "ai": { "ok": true }, "hasSave": false }
```

`hasSave` is `false` until the first auction is created. If `ai.ok` is `false`:

- confirm `/health` on the AI service responds;
- confirm `AI_URL` is correct with no trailing slash;
- cold starts: a free Render web service sleeps after ~15 minutes of inactivity and the first request
  can take ~30–60 seconds. The backend's AI client times out after 2.5 s, so hit the AI health URL once
  to warm it up, then retry. Consider a paid AI plan for always-on behaviour.

---

## 3. Point Vercel at the backend

The frontend reads `NEXT_PUBLIC_API_URL` from `frontend/lib/api.js`. **`NEXT_PUBLIC_*` variables are
inlined at build time**, so changing the value requires a new deploy.

1. Vercel → your frontend project → **Settings** → **Environment Variables**.
2. Add / update:

   | Name | Value | Environments |
   |---|---|---|
   | `NEXT_PUBLIC_API_URL` | `https://t20-dynasty-backend.onrender.com` | Production, Preview, Development |

   No trailing slash. If you keep the custom domain, this variable is independent of it.

3. **Deployments** → **Redeploy** the latest production deployment with **Use existing Build Cache**
   unchecked (a clean build guarantees the new value is inlined).
4. Verify the custom domain and the `vercel.app` domain both load, then create an auction in the UI and
   watch the backend's `hasSave` flip to `true`.

---

## 4. Environment variable reference

| File | Variable | Local default | Render / Vercel value | Loaded automatically? |
|---|---|---|---|---|
| `frontend/.env.example` | `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | `https://t20-dynasty-backend.onrender.com` | Only Vercel dashboard / `.env.local`; inlined at build |
| `backend/.env.example` | `PORT` | `4000` | injected by Render | Render injects; Node does not read `.env` |
| `backend/.env.example` | `AI_URL` | `http://localhost:5000` | `https://t20-dynasty-ai.onrender.com` | Render dashboard only |
| `backend/.env.example` | `SAVE_FILE` | `./data/auction-state.json` | `/var/data/auction-state.json` | Render dashboard only |
| `ai/.env.example` | `PORT` | `5000` | injected by Render | Render injects; Python does not read `.env` |
| `ai/.env.example` | `AI_PORT` | — | leave unset | legacy local fallback only |

`.env.example` files are committed templates. Real `.env`, `.env.local` and `.env.*` files are ignored by
Git via `.gitignore`.

---

## 5. Verification checklist

- [ ] `https://t20-dynasty-ai.onrender.com/health` → `{ ok: true, ... }`
- [ ] `https://t20-dynasty-backend.onrender.com/api/health` → `{ ok: true, ai: { ok: true }, ... }`
- [ ] Vercel redeploy completed **after** setting `NEXT_PUBLIC_API_URL`
- [ ] `https://t20-dynasty.indevs.in/` loads and can create an auction
- [ ] Create auction, place a bid, reload page → state survives (persistent disk working)
- [ ] Backend logs show no `ECONNREFUSED` against the AI URL

---

## 6. Operational notes

- **Persistence:** the single JSON state file is the source of truth. Back up `/var/data/auction-state.json`
  periodically (Render's disk is not automatically snapshotted). Never scale the backend beyond one instance.
- **Cold starts:** both Render services may sleep on free plans. The first request after idle is slow; warm
  both URLs before a live auction. The backend falls back to a local heuristic if the AI is briefly down,
  so bidding never deadlocks.
- **CORS:** backend and AI both return `Access-Control-Allow-Origin: *`. The AI is only called server-side
  by the backend.
- **Security:** no secrets are required by the app today. If you later add an admin token, store it only in
  the platform dashboards, never in `render.yaml` or the repo.
- **Local development:** copy the templates to `.env.local` (frontend) or export them in your shell
  (backend/AI), then run `cmd /c run-all.cmd`. The defaults in the templates target localhost.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Frontend says "Cannot reach the auction server at http://localhost:4000" | `NEXT_PUBLIC_API_URL` was not set on Vercel, or the deploy happened before the change. Set it and redeploy. |
| Backend health `ai.ok: false` | AI sleeping, wrong `AI_URL`, or AI bound to `127.0.0.1` instead of `0.0.0.0`. The patched `server.py` binds `0.0.0.0` and reads `PORT`. |
| State resets after redeploy | No persistent disk, or `SAVE_FILE` points outside `/var/data`. Attach a disk on a paid plan and set `SAVE_FILE=/var/data/auction-state.json`. |
| Render build fails for AI | Make sure **Root Directory** is `ai` and the build command does not run `pip install -r requirements.txt` (there is no requirements file; zero dependencies). |
| Backend fails to boot | Root Directory must be `backend`, start command `npm start`, and Render must inject `PORT`. |
