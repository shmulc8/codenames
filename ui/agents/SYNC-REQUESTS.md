# SYNC-REQUESTS — append-only cross-agent request log

Format: `[from]→[to]: what & why` (one line each). Check this file at every checkpoint.

---
spy feature added at ui/src/features/spy behind a mobile gate; /api/spy/* is served by the LOCAL Flask app (not the deployed Space); deploying spy needs the Space image to include spy.py + OPENAI_API_KEY.
