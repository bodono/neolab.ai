# Neolab.ai — Content-First Production Plan

> Status: Living content contract, version 0.1
> Companion documents: [Game Design](game-design.md) and [Technical Design](technical-design.md)
> Rule: Author the game as structured content before production simulation code wherever the mechanic vocabulary already exists

## 1. Why content comes first

Neolab.ai will live or die by the density and quality of its people, papers, decisions, crises, and jokes. We should therefore author representative production content before building the engine around placeholders.

Content-first does **not** mean inventing an untyped pile of text. Every record must include stable IDs, prerequisites, weights or checks, outcomes, modifiers, source notes, asset requirements, and review status. The TypeScript content compiler will later validate and compile these records without changing their meaning.

The content files become the source of truth. The design documents explain rules and targets; they should not become a second, silently divergent database.

## 2. Launch content commitment

| Content family | Launch target | Mechanical / flavour split | Current status |
|---|---:|---|---|
| Playable leaders and labs | 5 | All mechanical, each with a full voice package | Five designed in the GDD |
| AI capability tiers | 9 | All mechanical presentation bands | Initial ladder specified below |
| Discoverable papers | 72 | 58 real, 14 fictional future papers | Inventory not yet authored |
| Star researchers | 56 | All mechanical, each with biography and hooks | 24 mechanical identities drafted |
| Facility families | 20 | 44 total build/upgrade definitions | Initial 16-entry catalogue exists |
| Ordinary decision events | 180 | Roughly 150 mechanical, 30 primarily narrative | 25 examples exist |
| Crisis chains | 30 | All mechanical, 2–5 beats each | Core categories designed |
| Endgame decision nodes | 48 | All mechanical and state-reactive | Deployment Crisis spine exists |
| Endgame crisis inserts | 12 | Modular, not present every run | Categories not yet authored |
| Distinct endings / epilogues | 18 | Mechanical result plus reactive prose | Ending families exist |
| Lab-feed templates | 600 | At least 400 have no direct effect | Initial handful in mockup |
| Educational paper summaries | 72 | One accurate short and one expanded explanation each | Not yet authored |
| Portraits | 61 | Five leaders plus 56 researchers | Art direction only |
| Facility/campus modules | 20 families | Construction, normal, overloaded, incident states | Art direction only |

These are launch-content goals, not minimum engine fixtures. The first playable vertical slice uses a reviewed subset, but content authoring should continue independently of engine milestones.

## 3. File organisation before code

Author source data under a top-level `content/` directory even before the compiler exists:

```text
content/
├── manifest.yaml
├── ai-levels.yaml
├── labs/
│   ├── deepbrain.yaml
│   ├── humanic.yaml
│   ├── openmind.yaml
│   ├── xmind.yaml
│   └── deepsearch.yaml
├── researchers/
│   ├── foundation.yaml
│   ├── deep-learning.yaml
│   ├── scaling.yaml
│   └── frontier.yaml
├── papers/
│   ├── foundations.yaml
│   ├── deep-learning.yaml
│   ├── scaling.yaml
│   ├── frontier.yaml
│   └── fictional-future.yaml
├── facilities/
├── events/
│   ├── research/
│   ├── people/
│   ├── market/
│   ├── compute/
│   ├── politics/
│   ├── safety/
│   └── ai-character/
├── crises/
├── endgame/
├── feed/
└── sources/
```

Until the compiler is built, YAML records use `draftSchema: 1`. We may improve field names, but IDs and prose-review history remain stable. No JavaScript expressions, embedded scripts, or arbitrary property paths are allowed in content.

## 4. Five launch labs

The launch should use five rather than four labs. Four rivals gives the race enough strategic texture, makes every leader-selection omission visible in the world, and already matches the designed leader set.

| Leader | Lab | AI family | Primary fantasy | Voice |
|---|---|---|---|---|
| Thomas Hassabi — The Visionary | DeepBrain | Gemini | Research institution and scientific breakthroughs | Precise wonder; a research roadmap has become a heroic epic |
| Dario Amodeo — The Philosopher | Humanic | Claude | Safety evidence and principled scaling | Earnest, analytical, memo-shaped, unexpectedly dry |
| Sam Altmann — The Rainmaker | OpenMind | GPT | Capital, products, and momentum | Polished optimism interrupted by impossible infrastructure requests |
| Elon Tusk — The Industrialist | xMind | Grok | Physical scale, engineering, and robotics | First principles, enormous machinery, deadline visible from orbit |
| Liang Wenfang — The Optimizer | DeepSearch | DeepSeek | Algorithmic efficiency and technical depth | Understated competence; three zeroes quietly disappear from the budget |

The dashboard identity header always displays, in this order of prominence:

1. Leader display name
2. Company display name
3. Current AI family and specific model name
4. AI capability tier
5. Date and speed controls

Example: `Sam Altmann · OPENMIND` followed by `AI · GPT-4 “ORBIT” · Level 4 Tool-Using Agent`.

Each AI family needs at least eight era-appropriate generated model names plus player renaming. A content record stores family, generation ordinal, public name, internal codename, and pronunciation/grammar tokens. Event text always resolves the current lab's family and model rather than hard-coding GPT.

## 5. AI capability ladder

The AI needs a legible sense of ascent without reducing intelligence to one XP bar. **Capability tier** is a public descriptive classification derived from Frontier Capability, minimum attribute gates, completed evaluations, and demonstrated tasks. It never represents alignment or safety.

Progress to the next tier is shown as an uncertain estimate such as `early`, `developing`, `approaching`, or a noisy range. A player can have FC above a nominal threshold but remain in the prior tier because Agency, Generality, Reliability, or a demonstration gate is missing.

| Level | Display tier | Nominal FC band | Additional demonstration gate | What visibly changes |
|---:|---|---:|---|---|
| 0 | Research Prototype | 0–9 | None | Benchmark-only model; no meaningful product demand |
| 1 | Narrow Specialist | 10–19 | One attribute at 20+ | Can support one narrow product and basic paper experiments |
| 2 | Foundation Model | 20–34 | Language or Multimodality 30+ | Broad serving demand; chat/demo events; productisation becomes central |
| 3 | Expert Assistant | 35–49 | Reasoning 30+, Reliability 40+ | Strong professional products; reliable tool suggestions but no autonomous access |
| 4 | Tool-Using Agent | 50–64 | Tool Use 45+, Agency 30+, sandbox trial | Can operate tools in bounded environments; access events begin |
| 5 | Autonomous Researcher | 65–79 | Scientific Ability or Reasoning 55+, Agency 50+, replicated novel task | AI research assistance becomes substantial; root-access and containment events intensify |
| 6 | General Problem Solver | 80–87 | Generality 70+, at least four capability attributes 65+, diverse replication | Near-AGI model; prosperity projects accelerate; rival emergency likely |
| 7 | Apparent AGI Candidate | 88–94 | All GDD section 35.6 candidate criteria | Deployment Crisis begins; classification is explicitly unconfirmed |
| 8 | Superhuman General Intelligence | 95–100 | Candidate confirmed plus superhuman cross-domain evaluations | Endgame-only tier; capability exceeds ordinary institutional decision speed |

Tier changes create a presentation event, a new model-card frame, fresh customer segments, lab-feed reactions, and new event eligibility. They do not grant a generic research bonus by themselves; all mechanical effects come from the demonstrated capabilities and unlocked content.

Player-facing copy must say `apparent` or `candidate` at Level 7. Level 8 is not a victory state: a highly capable system may still be unaligned, uncontrolled, politically illegitimate, or useless for broad prosperity.

## 6. Paper catalogue plan

### 6.1 Composition

The target 72 papers are divided as follows:

| Era / family | Real | Fictional | Total |
|---|---:|---:|---:|
| Foundations and precursors | 10 | 0 | 10 |
| Deep-learning wave | 16 | 0 | 16 |
| Reinforcement learning, games, and robotics | 10 | 0 | 10 |
| Transformers, scaling, and generative models | 14 | 0 | 14 |
| Safety, evaluation, interpretability, and governance | 8 | 0 | 8 |
| Future capability methods | 0 | 6 | 6 |
| Prosperity breakthroughs | 0 | 8 | 8 |
| **Total** | **58** | **14** | **72** |

Every real paper record needs the exact title, authors, publication year, canonical link, DOI/arXiv/venue where available, 60–90 word player summary, 180–300 word archive explanation, prerequisites, domain weights, effort range, Aura, unlocks, diffusion, and fact-review date.

Every fictional paper is marked in four independent ways:

- `historicity: fictional-future` in data
- `FICTIONAL FUTURE RESEARCH` badge on the discovery card
- Copy written in conditional alternate-history tense
- No fabricated DOI, venue, author list, or external citation

Fictional prosperity papers can include programmable medicine, commercially viable fusion control, gigaton-scale carbon removal, robust antimicrobial design, atomically precise manufacturing, resilient crop ecologies, automated theorem science, and safe abundance planning. They must not masquerade as current scientific claims.

### 6.2 Order without historical handcuffs

The graph enforces conceptual prerequisites, not publication dates. Backpropagation and gradient-based representation learning precede deep convolutional systems; deep representation learning precedes modern generative systems; sequence modelling and representation learning precede attention; attention precedes large transformer scaling; strong foundation models precede scalable oversight of those models.

A paper may appear earlier or later than its real date, and older foundational work may be rediscovered after 2012. The archive always shows the true real-world year.

## 7. Researcher catalogue plan

The launch target is 56 stars. The first 24 have exact signatures, passives, compacts, and affinity hooks in GDD section 37.2.3. The remaining 32 should fill gaps rather than clone percentage boosts:

| Roster niche | Target total | Examples of mechanical space |
|---|---:|---|
| Architectures, optimisation, and scaling | 9 | Training efficiency, architecture recipes, experiment reliability, data efficiency |
| RL, planning, and agents | 7 | Self-play, exploration, model-based control, tool-use evaluation |
| Vision, multimodality, and data | 7 | Dataset quality, vision-language, documentation, synthetic data |
| Systems, chips, and products | 7 | Compute acquisition, serving, engineering, productisation, developer adoption |
| Alignment, interpretability, and evals | 10 | Oversight, interpretability, security, evidence quality, containment |
| Robotics and embodiment | 6 | Imitation, manipulation, adaptation, simulation-to-real transfer |
| Scientific AI | 5 | Biology, chemistry, mathematics, climate, materials |
| Governance, institutions, and social impact | 5 | Trust, coalitions, audits, labour transition, international legitimacy |

Every researcher receives:

- A 110–170 word flattering biography grounded in public facts
- A 25–40 word roster-card summary
- Exact skill vector, signature, passive, compact, costs, availability, and stacking groups
- At least two paper hooks, three event reactions, and six feed-line variants
- One portrait brief and alt text
- Authoritative sources and review date
- A fictionalization/non-endorsement flag

No character receives a personal insult, psychiatric speculation, invented scandal, or negative claim presented as fact. Strategic friction comes from the player's broken promises, resource constraints, institutional incompatibility, or plainly fictional alternate-history events.

## 8. Facilities catalogue plan

Use 20 families with 44 buildable definitions across levels. The player should see meaningful new construction options throughout the run without turning the campus into a tile-placement puzzle.

| Category | Families | Intended decisions |
|---|---|---|
| Core campus | Headquarters, Research Campus, Staff Commons | Slots, management, morale, project capacity |
| Compute | Power and Cooling, Data Centre, Inference Centre, Accelerator Design Lab | Owned capacity, serving, efficiency, supply chain |
| Safety and security | Alignment Institute, Interpretability Lab, Eval Range, Security Operations, Secure Bunker | Evidence, control, incident mitigation, freedom tradeoffs |
| Specialised research | Robotics Lab, Scientific Laboratory, Simulation Arena, Data Foundry | Unlock domains and paper families |
| Public/institutional | Conference Centre, Policy Office, Public Benefit Institute | Aura, coalition, lobbying, public trust |
| Late-game infrastructure | Autonomous Research Annex | AI-assisted work with access and containment decisions |

Most families have two levels; Headquarters, Research Campus, Data Centre, and Security Operations have three. Each record needs cost, build time, operating cost, prerequisites, construction events, normal/overload/incident art states, star-slot effect, capacity, modifiers, and at least four feed templates.

## 9. Ordinary events and probabilities

### 9.1 Event portfolio

The 180 ordinary decision events should be distributed approximately as follows:

| Category | Count |
|---|---:|
| Research, publication, and benchmarks | 32 |
| Researchers, hiring, morale, and culture | 30 |
| Products, customers, and fundraising | 28 |
| Compute, facilities, and supply chain | 24 |
| Safety, evaluations, and security | 30 |
| Government, lobbying, and coalitions | 22 |
| AI-character requests and behaviour | 14 |

Each normal run should expose only 24–36 of them. Eligibility tags, cooldowns, lab voice, people present, paper history, AI tier, and prior choices create variety; low-value pure randomness does not.

### 9.2 Required event record

Every event contains:

- Stable ID, title, short feed teaser, long scene copy, category, severity, and auto-pause rule
- Eligibility predicate, base weight, weight modifiers, cooldown, per-run maximum, and incompatibility tags
- Named actors resolved from state
- Two to four decisions with honest known costs and explicitly uncertain claims
- One or more keyed checks where appropriate
- Every outcome, conditional threshold, effect, delayed follow-up, memory tag, and player-visible explanation
- At least one non-catastrophic branch unless the event is a telegraphed mandatory crisis
- AI-family and lab-voice variants where the name or tone matters

Probabilities are not written as an unexplained `35% bad outcome`. A check record declares its observable contributors, hidden contributors, distribution, clamp, and consequence bands. For example:

```yaml
check:
  kind: logistic
  key: event.root_access.containment
  difficulty: 72
  visibleContributors:
    - security_posture
    - completed_autonomy_trials
    - access_level
  hiddenContributors:
    - model_true_alignment
    - deceptive_capability
    - situational_awareness
  probabilityClamp: [0.05, 0.95]
outcomes:
  - band: critical_success
    thresholdMargin: 20
  - band: success
    thresholdMargin: 0
  - band: warning_failure
    thresholdMargin: -15
  - band: containment_failure
```

The player sees a qualitative estimate or range justified by evidence quality. The content file keeps exact rules for simulation and post-run audit.

## 10. Crisis catalogue

Crises are multi-beat situations which temporarily compete with the player's plan. The 30 launch chains comprise:

- 6 compute/facility crises: power, cooling, hardware defect, cloud revocation, fire, physical intrusion
- 6 model-safety crises: jailbreak wave, anomalous tool use, deceptive eval behaviour, weights leak, autonomy breach, shutdown resistance
- 5 organisational crises: star ultimatum, team burnout, governance split, mass poaching, whistleblower claim
- 5 political crises: emergency regulation, subpoena, national-security order, nationalisation attempt, international standards breakdown
- 4 market/social crises: harmful deployment, major outage, labour backlash, critical-infrastructure dependence
- 4 global-opportunity crises: pandemic, crop shock, grid instability, geopolitical emergency where AI assistance could help but demands risky access

Every crisis has a warning trail, escalation clock, at least three intervention types, a resolution state, lingering modifiers, and feed coverage. Ordinary rivals can exploit or outpace the player during a crisis but cannot cause the player's extinction ending.

## 11. Endgame content matrix

The Deployment Crisis spine remains fixed enough to be learnable, but each run draws modules from a state-dependent matrix:

| Axis | Variants |
|---|---|
| Trigger context | Comfortable lead, close race, rival ahead, coalition candidate, political emergency, financial desperation |
| Candidate behaviour style | Eager helper, formal institutionalist, curious scientist, terse optimizer, warm collaborator; style is not proof of alignment |
| Primary technical uncertainty | Generality, deception, corrigibility, containment, robustness, misuse |
| External collision | Government order, investor deadline, rival claim, public leak, global emergency, researcher dissent |
| Prosperity focus | Medicine, energy, climate, food, materials, broad scientific institutions |
| Governance route | Lab control, public authority, international coalition, verified multi-lab compact |

The launch target of 48 decision nodes includes the common spine and conditional branches; a run should see 14–22. Twelve crisis inserts can interrupt at different stages. Eighteen epilogues combine survival/control/prosperity results with lab, leader, coalition, researcher, and public-trust paragraphs.

Outcome checks must depend on the whole run: discovered safety methods, evidence diversity, model history, access decisions, containment facilities, kept promises, coalition legitimacy, government trust, prosperity readiness, cash/compute resilience, and earlier anomaly handling.

## 12. Lab-feed library

The feed is a major part of the game's voice. It should make the lab feel alive between decision events without demanding constant action.

### 12.1 Target distribution

| Feed family | Templates | Usually mechanical? |
|---|---:|---|
| Research and papers | 130 | Sometimes |
| Researchers and culture | 110 | Rarely |
| Products and customers | 85 | Sometimes |
| Compute and facilities | 75 | Sometimes |
| Rivals, government, and coalition | 70 | Sometimes |
| AI-character observations | 60 | Sometimes, especially late |
| Pure atmosphere and inside jokes | 70 | No |
| **Total** | **600** | At least 400 have no direct effect |

### 12.2 Feed record behaviour

A feed template has an ID, text tokens, eligibility tags, weight, minimum tier, cooldown, per-run maximum, tone, importance, optional click target, and optional semantic memory tag. Pure flavour entries have no `effects` field at all.

The generator should avoid visible repetition:

- No exact line twice in a run unless explicitly marked recurring.
- Same joke family has at least a 26-week cooldown.
- No more than two pure-flavour lines per week.
- Critical warnings are never displaced by jokes.
- Feed names, model pronouns, facilities, and rival names resolve from current state.
- A line cannot mention a paper, facility, person, customer segment, or capability that does not exist in the run.

Example tone targets:

- `The benchmark has been renamed “benchmark-final-v7-use-this-one”. Confidence is high.`
- `A scaling graph has acquired a dotted line extending beyond the available power grid.`
- `Peer review requests one additional ablation: removing the model.`
- `The new cluster is online. Facilities asks everyone to stop calling the cooling towers “the alignment stack”.`
- `Three teams independently discovered the same internal acronym and disagree on what it stands for.`
- `The model has asked why the emergency shutdown button is labelled “demo mode”. Legal has joined the channel.`

These lines are draft style examples, not yet counted production records.

## 13. Assets as content

Every visual asset begins as a brief tied to a content ID. A portrait brief specifies recognizable public, non-sensitive visual cues; expression; palette; 96×96 master; 64×64 crop; 24×24 feed icon; alt text; and source/reference review. It must remain a stylized parody portrait rather than tracing a copyrighted photograph.

Facility briefs specify footprint, day/night palette, construction phases, normal animation, overloaded animation, incident state, and tiny staff interactions. Event illustrations are reserved for approximately 30 landmark scenes; most events reuse portraits and facility art.

AI-generated production art requires provenance metadata and human review for resemblance, accidental text, unwanted logos, and consistency. No image-generation prompt should ask to copy a living artist's style.

## 14. Review gates

Every record moves through:

1. `outline`: concept and role exist
2. `draft`: full copy and mechanics exist
3. `mechanics-reviewed`: formulas, probabilities, prerequisites, and effects are coherent
4. `fact-reviewed`: real-person and real-paper claims have authoritative sources
5. `tone-reviewed`: satire is affectionate, clear, and not defamatory
6. `legal-review-needed` or `legal-reviewed`: explicit status, never inferred
7. `playtest-ready`: assets may still be temporary; all branches compile
8. `release-ready`: copy, mechanics, sources, accessibility, and assets approved

Automated checks later enforce IDs, source presence, probability clamps, reachable options, valid effect targets, no missing tokens, no real papers marked fictional, fictional papers visibly labelled, feed cooldowns, and complete alt text. Human review remains mandatory for truth, humour, taste, and portrayal.

## 15. Authoring order

Content work proceeds in packs that can be reviewed and playtested:

1. **Identity pack:** five labs/leaders, AI family naming, nine capability tiers, dashboard copy
2. **People pack A:** the 24 mechanically drafted stars, full bios, sources, portrait briefs
3. **Research pack A:** first 20 real papers spanning foundations to transformers
4. **Institution pack:** all 20 facility families and upgrades
5. **Event pack A:** 60 ordinary events, 10 crises, 150 feed lines
6. **People and research pack B:** expand to 56 stars and 58 real papers
7. **Late-game pack:** 14 fictional papers, 48 endgame nodes, 12 inserts, 18 epilogues
8. **Replayability pack:** remaining ordinary events, crisis chains, and feed lines
9. **Asset pack:** portraits and facility modules after briefs and visual test approval

The next authoring task should finish **Identity pack** and **People pack A** in structured YAML, then begin the 20-paper Research pack. This gives the eventual engine real content for every major system from its first commit.
