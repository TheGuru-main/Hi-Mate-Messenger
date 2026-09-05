# Hi-Mate Frontend

Plain HTML/CSS/JS — no build step, no framework, no npm install needed.
Talks directly to the live backend at
`https://hi-mate-messenger-apiv1-0-0-1r.onrender.com`.

## Running it

Since this uses ES modules (`<script type="module">`), it needs to be
served over `http://` — opening `index.html` directly via `file://`
will fail (browsers block module imports from the filesystem).

**Easiest option — Python's built-in server** (already available in
Termux if you installed Python earlier):
```bash
cd himate-frontend
python3 -m http.server 8080
```
Then open `http://localhost:8080` on your phone's browser.

**Or deploy it properly** — since it's just static files, this can go
on Render as a Static Site, GitHub Pages, Netlify, or Vercel (Vercel is
completely fine for THIS part — it's only the WebSocket backend that
needed a different host, not static frontend files).

## What's implemented

- Splash → Signup (with country-code phone entry) → OTP verify → Login
- Home shell: Feed / Search / Live Matches / Kliques, bottom nav
- Feed: create posts (category required), view feed, react
- Search: username, phone, free-text content search (lexico engine), Klique suggestions
- Chat: Klique list, 1:1 chat rooms with live WebSocket message delivery
- Live matches: scoreboard list, match room with a separate stats FOLD
  (collapsible, distinct from chat) and a banter chat stream, live goal
  events pushed via WebSocket
- Settings: menu rendered from the backend's locked structure, logout

## What's NOT built yet (intentionally, matches backend scope)

- Group chat creation UI (backend supports it, no screen yet)
- Voice/video calls (signaling exists backend-side, no call UI)
- Media upload UI (backend endpoint exists, no picker/preview built)
- RECCORD DB, Privacy, Help & Support, About screens (menu items show
  "screen not built yet" when tapped)
- The GSP multi-language keyboard (separate project, not integrated)
- Talent/Scout/Byflint UI (backend deliberately parked, so is this)

## Architecture notes

- `js/api.js` — every backend call goes through here; also where the
  access token lives in `localStorage` (this is the legitimate
  session-cache use case — NOT where media files live, that's the
  backend's cloud storage)
- `js/socket.js` — one persistent WebSocket connection, auto-reconnects
  on drop (handles Render free-tier idle disconnects + mobile network flakiness)
- Each screen's logic is its own file (`feed.js`, `chat.js`, `matches.js`,
  etc.) — `app.js` just wires them together and handles the boot sequence
