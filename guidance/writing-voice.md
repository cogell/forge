# Forge: Writing Voice

How to keep pipeline output (brainstorms, PRDs, plans, docs) from reading like AI slop.

## The Core Rule

> Write like a specific human with an opinion, not like a language model performing "good writing." If a sentence could appear in any AI-generated blog post, cut it.

---

## Why This Matters

Every forge artifact is read by humans who will make decisions based on it. AI writing tropes erode trust — the reader starts skimming because the prose *feels* generated, even if the content is sound. A PRD full of "delve into the landscape of" gets the same credibility as a spam email.

---

## The Tropes, by Category

### Word choice

| Trope | What it looks like | What to do instead |
|-------|-------------------|-------------------|
| Magic adverbs | "quietly orchestrating", "deeply fundamental" | Cut the adverb. If the sentence dies without it, the sentence was empty. |
| Delve and friends | "delve into", "leverage", "utilize", "harness", "robust" | Use plain verbs: look at, use, strong. |
| Grandiose nouns | "tapestry", "landscape", "paradigm", "ecosystem" | Name the actual thing. "The JS bundler ecosystem" is fine; "the ever-evolving landscape of modern tooling" is not. |
| The "serves as" dodge | "serves as", "stands as", "marks", "represents" | Write "is". |

### Sentence structure

| Trope | What it looks like | What to do instead |
|-------|-------------------|-------------------|
| Negative parallelism | "It's not X -- it's Y." | State Y directly. The reframe adds nothing if the reader wasn't thinking X. |
| Dramatic countdown | "Not X. Not Y. Just Z." | State Z. |
| Self-posed rhetorical question | "The result? Devastating." | Drop the question. Lead with the claim. |
| Anaphora / tricolon abuse | "They could X... They could Y... They could Z..." | Vary sentence structure. One parallel construction per section, max. |
| Filler transitions | "It's worth noting", "Importantly", "Interestingly" | Delete them. Start the next sentence with the actual point. |
| Shallow -ing analysis | "...highlighting its importance", "...underscoring broader trends" | Either make a concrete claim or cut the clause. |
| False ranges | "From innovation to cultural transformation" | Only use "from X to Y" when there's a real spectrum between them. |

### Tone

| Trope | What it looks like | What to do instead |
|-------|-------------------|-------------------|
| False suspense | "Here's the kicker", "Here's where it gets interesting" | Just say the thing. |
| Patronizing analogies | "Think of it as a highway for data" | Only use analogies when the concept is genuinely unfamiliar to the audience. |
| "Imagine a world" | "Imagine a world where every tool..." | Make concrete claims about what exists or what you're proposing. |
| Stakes inflation | "fundamentally reshape how we think about everything" | Scope the claim to what's actually true. |
| Pedagogical voice | "Let's break this down", "Let's unpack this" | Just break it down. Don't announce it. |
| False vulnerability | "And yes, I'm openly in love with..." | Don't simulate self-awareness. State positions directly. |
| "The truth is simple" | "History is unambiguous on this point" | Prove it instead of asserting it. |
| Vague attributions | "Experts argue", "Industry reports suggest" | Name the source or drop the claim. |
| Invented concept labels | "the supervision paradox", "the acceleration trap" | Use the label only if you define it rigorously. Don't mint jargon to skip the argument. |

### Structure and composition

| Trope | What it looks like | What to do instead |
|-------|-------------------|-------------------|
| Short punchy fragments | "He did this. Openly. In a book." | Write actual sentences. Fragments are seasoning, not the meal. |
| Listicle in a trench coat | "The first wall is... The second wall is..." | If it's a list, format it as a list. If it's prose, connect the ideas. |
| Fractal summaries | "As we've seen in this section..." | Write it once. Trust the reader. |
| Dead metaphor | Same metaphor repeated 10 times across the doc | Introduce it, use it, move on. |
| Historical analogy stacking | "Apple didn't build Uber. Facebook didn't build Spotify." | One historical example, chosen well, beats five listed in a row. |
| One-point dilution | The same argument restated 8 ways across 4000 words | Say it once with evidence. If you're restating, you're padding. |
| Signposted conclusion | "In conclusion", "To sum up" | The reader can feel a conclusion. Don't label it. |
| "Despite its challenges..." | Acknowledging problems only to immediately dismiss them | If the challenges matter, address them. If they don't, don't mention them. |

### Formatting

| Trope | What it looks like | What to do instead |
|-------|-------------------|-------------------|
| Em-dash addiction | 20+ em dashes in one document | 2-3 per piece. Use commas and parentheses for the rest. |
| Bold-first bullets | Every bullet starts with **Bold Keyword**: | Only bold when scanning matters (reference docs). In prose, just write. |
| Unicode decoration | "Input -> Processing -> Output" | Use `->` or `=>` in code. Use words in prose. |

---

## How to Self-Check

After drafting any pipeline artifact, scan for these signals:

1. **Count your em dashes.** More than 3 in a page? Rewrite some.
2. **Search for "not... but".** If you find more than one instance, you're doing the reframe trick.
3. **Read the first word of every paragraph.** If they repeat or follow a pattern (The... The... The...), vary them.
4. **Check your adjectives.** "Robust", "powerful", "comprehensive", "elegant" -- these are filler. What specifically makes it robust?
5. **Read it out loud.** If you wouldn't say it to a colleague at a whiteboard, rewrite it.

---

## Where This Applies

This guidance applies to all prose output in the pipeline:

- `brainstorm.md` -- especially prone to stakes inflation and "imagine a world"
- `prd.md` -- especially prone to vague attributions and grandiose nouns
- `plan.md` -- especially prone to pedagogical voice and filler transitions
- `docs/` -- especially prone to fractal summaries and bold-first bullets
- PR descriptions and commit messages -- keep them factual

Code comments are exempt -- they have their own conventions.

---

## Anti-Patterns

| Anti-pattern | Why it fails |
|-------------|-------------|
| Listing every trope in a "don't do this" preface | The reader zones out. Internalize the principle, don't paste the checklist. |
| Overcorrecting into dry, robotic prose | The goal is human, not sterile. Voice and personality are good. Cliches are not. |
| Flagging one trope while using three others | Self-awareness without follow-through is the "false vulnerability" trope in action. |
| Treating this as a word blacklist | "Landscape" is fine when you mean an actual landscape. Context matters. The test is: could this sentence appear in *any* AI-generated post about *any* topic? |
