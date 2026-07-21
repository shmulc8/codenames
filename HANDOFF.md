# HANDOFF — mobile spy mode (feature/ui)

## State
- **Done**: Spy feature built by two parallel Codex (tara) agents and committed as `a379729`:
  - `spy.py` — Flask blueprint `POST /api/spy/scan`. OpenAI vision (`gpt-4o` via stdlib urllib, key from gitignored `.env`). Without `words`: extracts 25 Hebrew words from a board photo. With `words[25]`: returns `covered: [{word, color}]`.
  - `frontend/src/spy/` — `SpyFlow.tsx` (capture → verify/edit grid → confirm → optional 60s monitoring via getUserMedia, manual-rescan fallback), `image.ts` (client downscale to ≤1280px JPEG), `spy.css`.
  - `frontend/src/App.tsx` — mobile gate `(pointer: coarse) and (max-width: 820px)`: choice screen לשחק / מצב מרגל. Desktop untouched.
- **Done**: merged `origin/feature/ui` (teammates' repo reorg + new `ui/` Step A scaffold — disjoint from our files, clean merge `95d8cc7`), pushed `feature/ui` and `frontend-revamp` with upstreams.
- **Verified independently**: backend validation 400s; one live OpenAI call through the endpoint (auth+model+JSON pipeline confirmed); `npm run build/lint/hex-lint` pass post-merge; desktop UI renders clean in preview browser.
- **Running now**: Flask on :7860 (scratch venv with flask+numpy only — fasttext models absent locally, spy mode doesn't need them) and vite on :5173 with `--host` (LAN: http://10.113.68.205:5173). Launch configs in `.claude/launch.json` (repo parent dir).
- **In progress**: Opus subagent reviewing commit `a379729` for first-test-breaking bugs (React effects, RTL word order, contract mismatches).

## Decisions
- Spy lives in old `frontend/`, not teammates' new `ui/` scaffold — user asked for it on top of what we had. Revisit if the team standardizes on `ui/`.
- Stage 0 (code sign-in pairing with desktop) intentionally skipped per user.
- OpenAI key in `.env` (gitignored), read via env-or-.env in spy.py. Key was pasted in chat/agent logs — **rotate after hackathon**.
- Monitoring uses getUserMedia; on plain-HTTP LAN it will be blocked → built-in fallback to manual "סרקו שוב" file-capture button. Expected behavior, not a bug.

## Next step
Wait for the Opus review; apply any confirmed fixes; then user tests from phone at http://10.113.68.205:5173 (choose מצב מרגל, photograph a real Hebrew board).

## Open questions
- Should the spy feature migrate into the new `ui/` app?
- Real-photo extraction accuracy is untested (needs an actual board photo).

## Files/branch
Branch `feature/ui` (= origin). Clean tree. Key files: spy.py, app.py (+2 lines), frontend/src/spy/*, frontend/src/App.tsx, frontend/src/api/{client,types}.ts.
