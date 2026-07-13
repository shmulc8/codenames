---
title: Hebrew Codenames Co-pilot
emoji: 🕵️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: LLM-free Hebrew Codenames clue-giver (fastText)
---

# קופיילוט · שם קוד — Hebrew Codenames Co-pilot

An **LLM-free** co-pilot for the Hebrew word game *Codenames* (שם קוד). It plays both
seats — gives the spymaster clues and ranks the guesser's picks — using **fastText word
vectors + geometry**, with no generative model in the loop.

- **Engine:** static fastText (Hebrew, compressed ~20× loss-free) + DETECT-style tiered
  scoring + DictaBERT lemma legality. Fully offline, CPU-only, instant.
- **Risk dial:** cautious / balanced / bold — trades coverage against safety.
- **Semantic map:** classical MDS projection showing the clue at the centroid of its targets.

The clue-giving engine beat both EmbeddingGemma and Qwen3-Embedding in a head-to-head, and
a 12B LLM, on this task. Built by [@shmulc](https://huggingface.co/shmulc).
