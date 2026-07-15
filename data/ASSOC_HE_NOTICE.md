# Hebrew WordSim-353 Relatedness notice

`assoc_he.tsv` is a translated copy of the WordSim-353 Relatedness gold standard dataset:

<https://web.archive.org/web/20201112022046id_/http://alfonseca.org/pubs/ws353simrel.tar.gz>

The dataset is described in:

> Agirre, Eneko, Enrique Alfonseca, Keith Hall, Jana Kravalova, Marius Pasca, and
> Aitor Soroa. 2009. *A Study on Similarity and Relatedness Using Distributional and
> WordNet-based Similarity Measures.* In Proceedings of NAACL-HLT 2009.

It contains 252 word pairs with human relatedness scores (on a 0-10 scale). The English
words have been translated into contextual Hebrew equivalents suitable for Codenames evaluation.
`build_assoc_he.py` downloads the source dataset and translates the English words to Hebrew.
The human relatedness scores have been preserved exactly.
