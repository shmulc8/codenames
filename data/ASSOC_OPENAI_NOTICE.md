# OpenAI-generated association supplement

`assoc_he_openai.jsonl` is a machine-generated candidate supplement created by
`data/extend_assoc_openai.py` using the OpenAI API. It is **not human gold
data** and must not be merged silently into `assoc_he.tsv` or described as an
independent human evaluation set.

Each record includes the model, category, batch, timestamp, and
`source=openai_generated` for filtering and auditability. The intended uses are:

- vocabulary and coverage exploration;
- a candidate pool for Hebrew-speaker review;
- stress-testing encoder behavior on broader association types.

The original `assoc_he.tsv` remains the translated WordSim-353 Relatedness
subset and is kept unchanged.
