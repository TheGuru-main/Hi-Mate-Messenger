# Hi-Mate API (backend)

FastAPI + PostgreSQL. Deploys to Render.

## Local setup (in Termux or anywhere with Python 3.11+)

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env — set DATABASE_URL to a real local/dev Postgres instance
uvicorn app.main:app --reload
```

Visit `http://localhost:8000` — should return `{"status": "ok", ...}`.
Interactive API docs auto-generated at `http://localhost:8000/docs`.

## What's implemented so far

- **Auth**: signup → OTP verify → JWT issuance, login, persistent tokens
- **Placement**: GSP formula (`app/services/placement.py`) — computed server-side always
- **Messaging**: 1:1 + group, REST create/fetch, WebSocket push (`app/sockets/`)
- **Klique/Follow/Fan/Block**
- **Feed & posts**: category-required posts, reactions (locked emoji set), comments
- **Search**: username/phone lookup, Klique suggestions, nearby — all powered by
  the relationship-grid crawler (`app/services/crawler.py`), which implements the
  **exact locked forward/backward perturbation formula**:
  forward D=5 (one jump per step k), backward D=1 but 5 steps per 1 forward step,
  shared K=250, strict tiered filter (nearest → category → role hierarchy → sibling-field)

## What's NOT implemented yet (deliberately, per current scope)

- Talent/Scout/Byflint/Sandclock ecosystem (parked, see project notes)
- Elastic Cloud radius search is defined (`elastic_cloud()` in placement.py) but
  not yet wired into a live search endpoint
- File/media upload handling — routes accept a `media_ref` string, assuming
  media is uploaded to object storage (e.g. S3/Cloudflare R2) separately and
  only the reference is stored here
- Alembic migrations — `Base.metadata.create_all()` runs on startup for now,
  fine for early development, switch to real migrations before production data exists
- Rate limiting, input sanitization hardening, refresh-token rotation

## Deploying to Render

1. Push this repo to GitHub (already done: `TheGuru-main/Hi-Mate-Messenger`)
2. On Render: New → Blueprint → connect the repo → Render reads `render.yaml`
   automatically and provisions both the web service and the Postgres database
3. Set `AT_USERNAME` / `AT_API_KEY` in the Render dashboard's Environment tab
   (left blank, OTP falls back to console-logging for dev/testing)
4. Deploy — Render builds and starts automatically on every push to `main`

## Project structure

```
app/
  main.py           - FastAPI app, router wiring, startup
  config.py         - settings (env vars)
  database.py       - SQLAlchemy engine/session
  dependencies.py   - get_current_user (JWT auth dependency)
  models/           - SQLAlchemy ORM models (one file per entity group)
  schemas/          - Pydantic request/response models
  services/
    placement.py    - GSP formula (L/S/C/start_row), Elastic Cloud
    crawler.py       - relationship-grid crawler (the locked walk + filters)
    auth.py          - password hashing, JWT
    sms.py            - OTP delivery via Africa's Talking
  routes/           - one file per resource (auth, users, messages, klique, posts, search)
  sockets/          - WebSocket connection manager + route
```
