# Researcher attribution and biography accuracy — work plan

Neolab.ai is meant to teach. The papers are real and marked as such, the GPU
generations are real, and the researchers are affectionate parodies of real
people. But the biographies currently anonymise the very facts that carry the
education, and the game never tells the player who anyone is inspired by.

This plan fixes both. It is written to be executed by someone who did not write
the current content.

**The single rule that outranks everything else here: never invent a fact about
a real person.** Every name, employer, institution, award and date you write
must be verifiable from a source cited on that researcher. Filling in "a major
search company" with "Google" when it was actually Meta is *worse* than the
placeholder — it converts a vague evasion into a confident falsehood about a
named living person, published in their honour. Where you cannot verify, cut
the claim or keep it honestly general (§2.4).

---

## 0. What already exists

Do not rebuild any of this. It is authored, schema-validated and in the bundle.

| field | where | state |
|---|---|---|
| `inspirationName` | researchers + leaders | **populated for all 108 + all 5**, accurate |
| `sources` | researchers | required, `min(1)`; 1–6 URLs each, 83 have exactly 2 |
| `sourceNotes` | leaders | populated |
| `portrayal.legalStatus` | researchers | `legal-review-needed` — **out of scope, do not touch (§5.1)** |
| `editorialReview` | researchers | present on all 108 — **out of scope (§5.1)** |
| `biography`, `epithet`, `rosterCardSummary`, `role` | researchers | populated |

`inspirationName` is currently referenced **nowhere outside tests**. Surfacing
it is a display change, not a content project.

The `historicity` marker on papers (`REAL PAPER` / `FICTIONAL FUTURE`, rendered
in `research-workspace.tsx`) is the established pattern for separating fact from
fiction in this game. Follow it rather than inventing a new convention.

---

## 1. Surface the inspiration

**1.1 Show `inspirationName` above the biography**, on the researcher dossier
and the roster card, and on the leader select screen.

**1.2 The line must flatter through specifics, not adjectives.** A uniform wall
of "brilliant" and "legendary" across 108 people carries no information, reads
as nervous legal insurance rather than warmth, and is faintly patronising when
applied to an early-career researcher. Name the achievement instead — it is both
more flattering and more educational:

> Inspired by **Demis Hassabis** — chess prodigy, games programmer and
> neuroscientist, who co-founded DeepMind and shared the 2024 Nobel Prize in
> Chemistry for protein-structure prediction.

not

> Dennis Hassabi is inspired by the brilliant Demis Hassabis.

**1.3 Every line must be true and sourced**, under the rule at the top of this
document. The achievement you name is a factual claim about a living person.

**1.4 Tense must match the person.** Some of the roster are deceased. Check
before writing, and write about them in the past tense with the same warmth.

**Check:** every researcher and leader renders an inspiration line; no line
contains a bare evaluative adjective as its only content; every factual claim in
the line traces to that researcher's `sources`.

---

## 2. De-anonymise the biographies

**49 of 108 researchers contain anonymised references, 85 instances in total.**
The pattern is a bio contorting itself to avoid a proper noun, which usually
destroys the fact worth knowing.

Nick Carlino is the clearest case:

> "His interest in computer security began as an undergraduate at MIT and
> deepened during a doctorate at UC Berkeley **under a security researcher**,
> where he developed an adversarial attack, now widely known simply by **his and
> a collaborator's names**"

The advisor is David Wagner. The attack is the Carlini–Wagner attack. The
anonymisation hides the one name that makes the sentence mean anything, and the
result teaches the player nothing while reading like a redaction.

Timo Brooks:

> "camera-quality machine learning at **a major search company** and on video
> generation at **a leading GPU manufacturer**"

**2.1 Replace anonymised proper nouns with the real ones**, where verifiable.
Institutions, employers, advisors, collaborators, labs, awards, named methods.

**2.2 Name the method when the person's name is in it.** Carlini–Wagner,
LeNet, Hopfield network, Boltzmann machine, and so on. These are the highest-value
educational facts in the whole roster and several are currently obscured.

**2.3 Name the entity, glossed — genuine false positives are rare.**

An earlier draft of this plan listed three survey hits as "legitimately generic".
**Two of the three were wrong**, which is instructive: a vague phrase reads as
generic precisely because the specific thing has been removed, so the reviewer's
instinct to wave it through is exactly the instinct that created it.

| hit | verdict |
|---|---|
| "against **a large dictionary of human-labelled visual concepts**" (David Baux) | **Name it.** That is Broden, the concept dataset behind Network Dissection. It was also mis-annotated as ImageNet — it is not. |
| "finish the paper in time for **a major conference deadline**" (Aidan Gomes) | **Name it.** The transformer paper's NIPS deadline is one of the best-known stories in the field, and the anonymisation throws the story away. |
| "latent topics running through **a large text corpus**" (David Bley) | **Keep.** LDA operates on any corpus; no specific one is being hidden. This is genuinely descriptive. |

The test remains whether a *specific real entity* is being avoided — but assume
it is until you have checked. Do not trust an annotation, including the ones
above; verify against the sources.

**2.3.1 Name and gloss in the same breath.** Naming alone loses the education;
glossing alone loses the fact. Do both, in whichever order reads better:

> against **Broden**, a large dictionary of human-labelled visual concepts

This is also length-neutral or shorter than the evasion, because "a large
dictionary of human-labelled visual concepts" was already paying for the words
it takes to avoid saying "Broden" (§2.7).

**2.4 When you cannot verify, generalise honestly rather than guess.** "during
his doctorate at UC Berkeley" is fine and true. "under David Wagner" is better
*if sourced*. "under a security researcher" is the failure mode: it is neither
specific nor natural. Never close the gap with a plausible guess.

**2.5 Add sources for anything new.** 83 researchers have exactly two URLs,
typically a homepage and one paper. A full career history needs more than that
to stand up. Extend `sources` as you extend claims — the schema takes an array.

**2.6 Sweep `rosterCardSummary`, `epithet` and `role` too**, not just
`biography`. The survey covered all four; the fix must too.

**2.7 The bios must not get longer. This is a hard constraint.**

The owner is happy with the current length. Every task in this plan pushes the
other way — attribution lines, real names, papers, citations — so without a
budget the roster inflates by a third and the dossier stops being readable.

Current distribution, which is the budget:

| | words |
|---|---|
| shortest | 118 |
| median | **153** |
| p75 | 167 |
| longest | 215 |
| `rosterCardSummary` median | 24 (max 32) |

**2.7.1 No biography may exceed 215 words**, the current maximum, and the median
must not move materially from 153. Check the distribution after the pass, not
just individual entries.

**2.7.2 De-anonymising should usually *shorten*.** "under a security researcher"
→ "under David Wagner" is four words shorter and infinitely more useful.
Evasions are verbose by construction; naming things reclaims the space.

**2.7.3 Spend the reclaimed words, do not add to the total.** Where a bio needs
room for a real citation or a named method, cut the sentence that was carrying
the least — usually a generic assessment of the person's qualities ("combined
unusual conceptual clarity with the patience to…") which says nothing specific
and survives only because nobody has had to justify its cost.

**2.7.4 The inspiration line (§1) and paper links (§5.4) are separate fields and
sit outside this budget.** Do not fold them into `biography` — they render as
their own elements, which is what keeps the factual layer distinguishable (§4).

**Check:** re-run the survey (§6) and confirm every remaining hit is a
deliberate §2.3 keep. For each de-anonymisation, name which source supports it.
Re-measure the length distribution against §2.7 and report it — a pass that
fixes every placeholder but adds 40 words a bio has failed.

---

## 3. Keep the flattery honest

**3.1 Accurate and flattering, in that order.** Where the two conflict, accuracy
wins and the flattery is achieved by choosing *which* true thing to highlight —
not by overstating it.

**3.2 No invented praise.** "Widely regarded as" and "considered by many to be"
are unsourceable filler. Name the actual prize, the actual citation count, the
actual result.

**3.3 Check the epithets under the same standard.** Some may read as backhanded
once attached to an explicitly named real person. "The Adversarial Attacker" is
fine and affectionate; audit the set for any that are not.

---

## 4. Separate the factual layer from the fictional one

This is a **requirement**, not a nicety, and it is the thing that makes explicit
attribution safe as well as educational.

Once the game says "this character is based on Geoffrey Hinton," the biography
becomes an assertion of fact about a named living person — while everything the
character *does in play* (scandals, burnout, breached promises, incidents,
being fired) remains invented. The player must be able to tell which is which.

**4.1 Mark the biography as factual in the UI**, using the same visual grammar
as `REAL PAPER` on the papers screen.

**4.2 Amend `DISCLAIMER.md`.** It currently says resemblance to real people
"should not be understood as a factual claim about them" — which becomes partly
untrue the moment the bios are explicitly attributed. Split it: biographies are
accurate and sourced; traits, dialogue, mechanics, events and outcomes are
invented, and nothing a character does in play reflects the real person.

**4.3 Do not touch the removal policy** in `DISCLAIMER.md#removal-requests`
other than to keep it consistent. It is the mitigation that carries all of this.

---

## 5. Also worth doing in this pass

**5.1 Ignore `portrayal.legalStatus` and `editorialReview` entirely.**

Leave both fields exactly as you find them. Do not advance
`legal-review-needed`, do not set `lastReviewed`, and do not treat the
compiler's "review gaps" line as work to be closed.

It is an advisory tracker in `release-validation.ts` that flags all 247
definitions and blocks nothing (`releaseBlocking: 0`). The owner has decided it
is out of scope. The count not moving is the expected outcome of this pass, not
a sign you missed something.

`sources` is a different field and **is** in scope — see §2.5.

**5.2 Naming convention — DECIDED: keep the names exactly as they are.**

The owner has decided. **Do not rename anyone.** Do not "tidy" a name that looks
close to the real one, and do not raise this again — it was measured, considered
and settled. `displayName` and `id` are both frozen for this pass.

The rest of this section records why, so the decision is not re-litigated later.

Measured as Levenshtein distance between `displayName` and `inspirationName`
across all 108 researchers and 5 leaders:

| distance | count | examples |
|---|---|---|
| **1** | **65** | Sarah Hooker ← Sara Hooker · Shane Legge ← Shane Legg · Zubin Ghahramani ← Zoubin Ghahramani · Elon Tusk ← Elon Musk |
| 2 | 17 | Geoffrey Hintoff ← Geoffrey Hinton · Andrey Carpathy ← Andrej Karpathy |
| 3+ | 31 | Yann LeNet ← Yann LeCun · Ilya Suchkeeper ← Ilya Sutskever |

**The one-letter shift is the house convention, not a set of outliers.** 65 of
113 use it and 82 sit at distance ≤2. The heavily-disguised names people notice
(LeNet, Suchkeeper) are the *exception*. "Make the close ones more different"
therefore means renaming roughly 60% of the cast, not a handful.

The cost is not only writing. `id` is derived from the display name
(`base:researcher.aidan-gomes`), `definitionId` is persisted in saves, and the
ids appear in tests and `design/art-direction/manifest.yaml`. A mass rename
breaks every existing save unless it ships with a migration.

**Consider that §1 removes the reason for renaming.** The worry is that a
one-letter name reads as a typo or is mistaken for the real person. Once the
dossier says "Sarah Hooker — inspired by **Sara Hooker**", neither is possible:
the joke becomes legible precisely because the real name sits next to it. The
attribution does the work the renaming was meant to do, at a fraction of the
cost and without breaking saves.

So the concern that motivated a rename is carried by **§1 (attribution)** and
**§4.1 (the "fictional character" marker)** instead — at a fraction of the cost,
with no save migration, and with a better result: the joke only becomes legible
*because* the real name sits beside it.

**What this means for your work:** the naming is not a defect to be fixed, and
a close name is not a bug report. If you believe a specific name is genuinely
misleading even with the inspiration line and the fictional marker both visible,
raise it with the owner as a single named case — do not change it yourself, and
do not batch it with anything else.

**5.3 Fix `design/art-direction/manifest.yaml`.** It maps characters to
inspirations but is stale: it lists "Thomas Hassabi", "Ian LeMon", "Geoff
Hintoff" against a roster that now reads "Dennis Hassabi", "Yann LeNet",
"Geoffrey Hintoff". It is a public file describing the fictionalisation process
and should be correct. Consider deriving it from `inspirationName` instead of
maintaining it by hand.

**5.4 Give each researcher their real, cited papers. Mostly computable.**

This is the highest educational return in the plan, and the data is already
authored. Paper definitions carry **real author names** and citations:

- 108 of 134 papers are `historicity: real`
- **all 108 have a source URL** in `editorialReview.sourceNotes`
- 71 also carry an `arxiv` id

Joining `researcher.inspirationName` to `paper.authors` on
(first name, surname), **62 of 108 researchers match at least one paper they
actually wrote**. Alec Broadford ← Alec Radford matches 8 (CLIP, Codex, GPT-2…);
Alex Krizhensky ← Alex Krizhevsky matches AlexNet and Dropout.

**5.4.1 Derive the links, do not hand-author them.** A join keeps itself correct
as papers are added and cannot drift from the roster. Hand-typed lists will rot.

**5.4.2 Show the real citation, not just the in-game paper.** The player should
be able to go and read it: real title, real authors, and the arXiv link or
`sourceNotes` URL. This is the payoff of the whole educational premise — a
player meets Hintoff, learns he is Geoffrey Hinton, and leaves with the actual
backpropagation paper.

**5.4.3 Link both ways.** From the dossier to the papers, and from a paper in
the research graph to the researchers who wrote it.

**5.4.4 Handle the 46 non-matching researchers honestly.** Some wrote nothing in
the game's paper set; some fail the join on name form (initials, diacritics,
transliteration, name changes). Fix the join where it is a matching bug; leave
the section absent where the person genuinely has no in-game paper. Never
attribute a paper to someone who did not write it — that is the §0 rule, and
authorship is exactly the kind of claim people care about being wrong.

**5.4.5 Watch the alternate-history problem.** In-game papers can be discovered
by a *fictional* lab on a timeline that never happened. The citation shown must
always be the real-world one, clearly marked as fact, and must not imply the
real authors participated in the game's invented history.

**5.5 Leaders first.** Five of them, most visible, most identifiable, seen on
the new-game screen before anything else. Do them as a complete vertical slice —
inspiration line, bio, UI, sources — get it reviewed, then scale to the 108.

---

## 6. How to verify

Re-run the anonymisation survey and diff the count against the 49/108 and 85
instances recorded here:

```bash
python3 - <<'PY'
import json,re
b=json.load(open('packages/content/generated/content.bundle.json'))
rs=b['researchers']['definitions']
pats=[r"\ba (?:major|leading|large|prominent|well-known|big|top)\b[^.,;]{0,45}",
      r"\ban? (?:unnamed|anonymous|certain)\b[^.,;]{0,40}", r"\bunder a\b[^.,;]{0,40}",
      r"\ba (?:search|technology|social|chip|hardware|graphics|software) (?:company|giant|firm|manufacturer|lab|laboratory)\b",
      r"\bone of the (?:major|leading|big)\b[^.,;]{0,40}",
      r"\ba (?:famous|noted|senior|distinguished|renowned) (?:researcher|scientist|professor|advisor)\b"]
hits={}
for v in rs.values():
    t=" ".join(str(v.get(f) or "") for f in ("biography","rosterCardSummary","epithet","role"))
    f=[m.group(0).strip() for p in pats for m in re.finditer(p,t,re.I)]
    if f: hits[v['displayName']]=f
print(f"{len(hits)}/{len(rs)} researchers, {sum(len(v) for v in hits.values())} instances")
for n in sorted(hits): print(f"  {n}: {'; '.join(hits[n])[:90]}")
PY
```

Then:

- `pnpm content:build` — the compiler validates `sources` as real URLs
- `pnpm exec vitest run packages/sim` — content-shape tests
- Add a test asserting every researcher and leader renders a non-empty
  inspiration line, so a future roster addition cannot ship without one

**What does not count as verification:** that the bundle compiles, or that tests
pass. Neither checks whether a biographical claim is true. The only check that
matters is reading the cited source and confirming it says what the bio says.

---

## Scope summary

| task | size |
|---|---|
| §1 surface `inspirationName` | small — field exists and is populated |
| §2 de-anonymise | **the bulk** — 49 researchers, 85 instances, each needing a source |
| §3 flattery audit | medium — 108 epithets and bios |
| §2.7 length budget | a constraint on all of the above, not a task |
| §4 layer separation | small — one UI marker, one disclaimer edit |
| §5.4 real cited papers | medium — the join is computable, 62/108 covered |
| §5 other extras | 5.5 first; 5.1 is a do-not-touch |
| §5.2 renaming | **none — decided, names are frozen** |
