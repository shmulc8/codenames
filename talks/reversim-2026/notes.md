# Speaker notes: 15 s per slide (~40 words)

1. (38 words) Hi, I'm Shmulik. I build with LLMs all day. So for a side project I did something odd: I built an AI that plays Hebrew Codenames better than I do, and there isn't a single LLM inside it.

2. (36 words) Take out your phone and scan this. It's live and it's free, and it runs on a plain CPU. Keep it open. By the end of the five minutes I want you trying to beat it.

3. (46 words) Quick reminder of the rules. The spymaster knows which cards belong to which team. They say one word and a number, and their team guesses. If you touch the other team's card, you've helped them. If you touch the black card, you lose on the spot.

4. (32 words) It's 2026, and every problem gets an LLM bolted on. I wanted to try the opposite. How far can classic NLP get me, with some honest geometry and no billions of parameters?

5. (41 words) This is the whole trick. A model like fastText turns every word into a point in space. Words that appear in similar contexts end up close together. Train, ship and helicopter sit in one corner. Dog and cat sit over there.

6. (45 words) So a clue is just a point. I want it close to my cards, far from the other team's cards, and very, very far from the assassin. That gives me a scoring function. I score every word in the vocabulary and keep the best one.

7. (28 words) Your turn. You're blue. Look at the board, and watch out, the black card is "peace". You have fifteen seconds. Shout out your clue if you've got one.

8. (37 words) "Temple", four. It gets Jerusalem, the church, the mosque and the Western Wall in a single word, and it stays clear of peace. It took a few milliseconds on a CPU. How many of you got four?

9. (41 words) Here's a board for engineers, and the assassin is "robot". The clue is "hardware". On balanced it says two. On bold it says four and adds keyboard and code. Same clue, different bet, and you decide how much risk to take.

10. (33 words) This one's a trap. Shark, whale and dolphin are ours, and "sea" is the assassin. Every human says "ocean", and you lose. The copilot says "fin", three. It's safety first and cleverness second.

11. (40 words) Then I tested it against a real Hebrew LLM, DictaLM, at 12 billion parameters. Blending fastText with the ConceptNet knowledge graph made clues twenty percent better and kept them safe. The LLM kept breaking the rules and making up words.

12. (35 words) I'm not claiming the small model won. My point is that scale isn't the bottleneck here. Codenames is a semantic-similarity problem disguised as a board game, and similarity is exactly what vectors are built for.

13. (26 words) Here's the first surprise. The model wasn't what moved quality the most. The biggest gain came from the list of words it was allowed to say.

14. (34 words) Give it the most frequent words and you get "of", "also", word fragments. It's garbage. Narrow it to medium-frequency nouns and adjectives and clean out the slurs, and the clues got dramatically better overnight.

15. (33 words) The second surprise: the best feature is the copilot saying no. When every candidate drifts toward the assassin, it tells you there's no safe clue. That saves more games than any clever pun.

16. (47 words) Now for Hebrew. The rule says a clue can't share a root with any card on the board. In English you'd just compare strings. In Hebrew, fear, scary and coward all share one root, and the word for puppy has the whole word for dog inside it.

17. (44 words) None of the Hebrew NLP tools I tried gave me a reliable root. So I built the check in layers: a root lexicon taken from Wiktionary, a containment check for words like puppy, and a similarity gate on top. It's all deterministic and offline.

18. (42 words) Here one word has three meanings: leaf, went up, and cost. I feed the target cards into a small contextual encoder together, and attention picks the right meaning. "Leaf" moves toward tree and away from money, and there's still no LLM involved.

19. (43 words) It still breaks, and here's how. For lion and wolf it says "Ayal". In Hebrew those are all first names, so geometry sees a list of names. For kidney, liver and gold it says "dollar". That's an association, but not one you want.

20. (38 words) So: no billions of parameters. A clean vocabulary, safety first, and real morphology. It's live right now. Try to beat it, and when it gives you a bad clue, hit thumbs-down, because that's my training data. Thank you!
