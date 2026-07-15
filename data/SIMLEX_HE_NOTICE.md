# Hebrew SimLex-999 notice

`simlex_he.tsv` is a normalized copy of the Hebrew SimLex-999 human-rated
word-similarity dataset distributed in the Attract-Repel repository:

<https://raw.githubusercontent.com/nmrksic/attract-repel/master/evaluation/simlex-hebrew.txt>

The benchmark is described with the Hebrew and Croatian SimLex datasets in:

> Mrksic, Nikola, Ivan Vulic, Diarmuid O Seaghdha, Ira Leviant, Roi Reichart,
> Milica Gasic, Anna Korhonen, and Steve Young. 2017. *Semantic Specialisation
> of Distributional Word Vector Spaces using Monolingual and Cross-Lingual
> Constraints.* Transactions of the Association for Computational Linguistics 5,
> 309–324. <https://aclanthology.org/Q17-1022/>

It contains 999 Hebrew word pairs. Scores are human similarity judgments on the
source's native 0–6 scale (higher means more semantically similar), stored as
floating-point values. `build_simlex_he.py` downloads the source and converts
only its header names and score formatting; Hebrew words and ratings are not
otherwise altered.

License: the source repository declares the Apache License, Version 2.0. See
<https://github.com/nmrksic/attract-repel/blob/master/LICENSE>. Retain this
notice and the source attribution when redistributing this derived TSV.
