# SYNC-REQUESTS — append-only cross-agent request log

Format: `[from]→[to]: what & why` (one line each). Check this file at every checkpoint.

---

[stepB-1]→[stepA-2]: `toggleSelected` must emit the CONTRACTS §3 toast "אפשר לבחור רק קלפים של קבוצה" when an in-play neutral/assassin tile is rejected; it currently returns silently. Board UI has an ownership-safe toast fallback for direct tile activation.
