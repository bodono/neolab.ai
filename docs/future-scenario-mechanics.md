# Future Scenario Mechanics: Acceleration, Verification, and Grand Challenges

Status: design exploration; owner review required before implementation

Authoring date: 2026-07-23

Scope: midgame recursive research through the Deployment Crisis and coalition ending

Related design:

- `docs/recursive-self-improvement-design.md`
- GDD §§35–36, 39, 41, and 44
- TDD §§13–19

Scenario sources:

- [AI 2027](https://ai-2027.com/)
- [AI 2040](https://ai-2040.com/)
- [AI 2040: Capability Scaling Strategy](https://ai-2040.com/supplements/capability-scaling-strategy)
- [AI 2040: Verification Plan](https://ai-2040.com/supplements/verification-plan)
- [AI 2040: Transparency Plan](https://ai-2040.com/supplements/transparency-plan)
- [AI 2040: Covert AI Projects](https://ai-2040.com/supplements/covert-ai-projects)
- [AI 2040: Security](https://ai-2040.com/supplements/security-in-plan-a)
- [AI 2040: Alignment Roadmap](https://ai-2040.com/supplements/alignment-roadmap)
- [AI 2040: AI for Epistemics](https://ai-2040.com/supplements/ai-for-epistemics)

## 1. Purpose and epistemic status

The linked scenarios are useful design provocations, not forecasts which the game should present as
settled fact. They describe particular possible trajectories with particular assumptions about
scaling, automation, geopolitics, alignment, and international coordination. Neolab.ai should take
the most gameable structural ideas from them without copying their dates, declaring their outcomes
inevitable, or turning the game into an adaptation of either story.

The game should model contested questions:

- How much can AI automate AI research?
- Does more AI labour still run into experiment, compute, data, hardware, and management
  bottlenecks?
- Can evaluation and human judgment keep up with the rate of change?
- Can model weights, algorithmic secrets, and verification systems be secured?
- Does state protection preserve the mission or capture it?
- Can competing labs establish a slowdown which is both credible and verifiable?
- Does a mathematically or scientifically brilliant system provide evidence about general
  capability, safety, or both?

It should not answer those questions with one predetermined timeline.

## 2. What to adopt, adapt, and decline

| Scenario element | Treatment | Reason |
|---|---|---|
| Many parallel AI research workers | Adopt as an explicit GPU-consuming labour pool | Creates a concrete compute-versus-automation decision |
| AI R&D multiplier | Adopt, but decompose into sources and bottlenecks | A single magical percentage would hide the game |
| Synthetic data and self-play | Adopt as a recursive programme direction | Strong capability upside with evaluation-contamination risk |
| Experiment and research-taste bottlenecks | Adopt | Prevents unlimited copies from becoming unlimited progress |
| Rapidly shrinking iteration time | Adopt as an emergent tempo band | Makes recursive self-improvement felt without scripting a date |
| Neuralese or opaque internal collaboration | Adapt as an optional efficiency method | Speed competes with monitorability and evidence quality |
| Online learning and frequent checkpoint updates | Adapt as an update-cadence choice | Produces a useful speed-versus-drift control |
| Model-weight theft | Adopt as a security crisis family | Separates capability secrecy, weight security, and lab safety |
| Government cyber or military partnership | Adopt | Creates money, protection, access, researcher, and mission tradeoffs |
| Covert compute projects | Adapt into uncertain “dark compute” signals | Gives a treaty something meaningful to verify |
| Compute verification and inspections | Adopt at strategic abstraction | Makes coalition victory earned and fragile |
| Research transparency | Adopt as a graduated policy, not a moral button | Helps external review while spreading useful and dangerous methods |
| Training-compute safety tax | Adopt as a treaty/policy mechanism | Turns slowdown into a measurable continuing sacrifice |
| AI-assisted public decision tools | Adapt as epistemic-infrastructure projects | Improves estimates and deliberation without revealing hidden truth |
| A fixed 2027 or 2040 timetable | Decline | Runs must emerge from player, rival, and random state |
| A single inevitable takeoff shape | Decline | Slow, bursty, stalled, and fast trajectories should all occur |
| Rival-caused human extinction | Decline | Existing rule: rivals can win the race but cannot end humanity |
| Literal mutually assured datacentre destruction as a routine button | Decline | Too geopolitical, literal, and tonally dominant for the core loop |
| Guaranteed successful international coordination | Decline | Coalition victory is meant to be difficult |

## 3. The central loop: an AI research organisation inside the lab

The recursive programme should eventually feel less like one assistant helping one researcher and
more like a small, extremely fast organisation operating inside the datacentre.

### 3.1 AI worker pool

The player may run parallel instances of the active internal model. Call these **AI workers** in
player-facing copy; “copies” is acceptable in dry internal dialogue.

AI workers consume inference GPUs every week. The player allocates them among:

- implementation and experiment code;
- experiment design and analysis;
- synthetic-data generation;
- evaluation and control;
- security and incident response;
- scientific or mathematical Grand Challenges;
- product and customer work.

This allocation is distinct from the top-level GPU allocation. The top-level control determines
how many GPUs are available to AI-assisted research; the worker allocation determines what that
research labour does.

The interface should show:

- estimated concurrently active workers;
- inference GPUs reserved;
- measured output relative to the human-only baseline;
- the current limiting bottleneck;
- coordination overhead;
- verification coverage;
- an uncertain effective R&D acceleration band.

It must not show an exact hidden probability of deception, escape, or successful takeoff.

### 3.2 Diminishing parallel returns

Twice as many instances must not mean twice as much progress. Effective contribution is constrained
by:

- available experiments and training jobs;
- experiment GPUs;
- serial dependencies;
- data and environment availability;
- facility throughput;
- coordination and merge overhead;
- evaluator throughput;
- human research taste and portfolio judgment;
- correlated errors between copies of the same model.

A suitable mechanical shape is:

`effectiveLabour = workerCount^parallelExponent × bottleneckCoverage × coordinationQuality`

where `parallelExponent` is below 1 and may improve with orchestration research. This formula is a
design direction, not an approved balance constant.

The dominant bottleneck should be player-facing:

- “More workers are waiting for experiments.”
- “Review is the critical path.”
- “The cluster can run more trials than the programme can choose intelligently.”
- “Independent evaluators disagree about the new training signal.”
- “The model is producing results faster than the lab can reproduce them.”

### 3.3 Research taste remains valuable

Automated coding should arrive before automated research leadership. Star researchers therefore
change roles over the run:

- early game: personally produce research;
- midgame: design experiments and select promising directions;
- late game: manage portfolios, identify conceptual mistakes, supervise verification, and decide
  which machine-generated results deserve scarce experiment GPUs.

This keeps researchers relevant after AI workers become faster programmers. A star may provide
`Research Taste`, `Independent Review`, `AI-Lab Management`, or domain-specialist bonuses rather
than simply adding more raw output.

If AI research taste eventually surpasses the humans, that should be a visible and consequential
transition: the institution is no longer able to originate or fully judge its own research agenda.

## 4. Recursive acceleration refinements

The discrete-cycle design in `recursive-self-improvement-design.md` remains the foundation. These
scenario-derived mechanics refine it.

### 4.1 Separate the acceleration sources

The displayed R&D acceleration should decompose into:

- AI implementation labour;
- AI experiment design;
- algorithmic-efficiency improvements;
- orchestration and parallelism;
- facility and experiment capacity;
- human research taste;
- verification drag;
- coordination overhead;
- security restrictions;
- unresolved verification or control debt.

The player should be able to understand why “300,000 workers” does not mean “300,000 times faster.”

### 4.2 Update cadence

The player chooses how frequently the active research system absorbs new work:

| Cadence | Upside | Cost and risk |
|---|---|---|
| Frozen release | Stable target for evaluation | Slowest; useful improvements wait |
| Quarterly checkpoint | Strong independent-replication window | Competitive delay |
| Monthly checkpoint | Balanced default | Some evidence expires each update |
| Weekly integration | Fast | Evaluation backlog and correlated drift |
| Continuous online adaptation | Fastest and most responsive | Weak checkpoint identity, contamination, rollback, and control risk |

Frequent integration can improve the current system without a full training run, but major
capability jumps still require a successor recipe and real training. Every update discounts safety
evidence according to the magnitude and type of change.

### 4.3 Opaque collaboration

An advanced model may propose a compressed machine-to-machine communication protocol. It improves
worker coordination and reduces context cost, but humans can no longer directly inspect most of
the reasoning exchanged between instances.

Possible responses:

- forbid it and retain direct transcript monitoring;
- allow it only inside disposable experiments;
- require a lossy translation model and random transcript audits;
- permit it for capability work but not evaluation or security;
- permit it throughout the recursive programme.

The method can create real speed gains. It also reduces monitorability, raises verification debt,
and can make the same model family both worker and interpreter. It must not be a secretly universal
wrong answer.

### 4.4 The oversight gap

Add a derived **Oversight Gap**:

`Oversight Gap = paceOfMaterialChange - effectiveIndependentReviewCapacity`

Player-facing bands:

- `Review ahead of change`
- `Current`
- `Backlog forming`
- `Humans sampling the work`
- `Institution no longer keeping pace`

The gap is not spendable and is not a second label for true alignment. It affects:

- the uncertainty of measured recursive gains;
- the chance that known defects remain unresolved;
- how much old evaluation evidence survives integration;
- whether researchers can credibly sign off;
- government and coalition confidence;
- rollback reliability;
- late-game control checks.

Verification debt records unverified changes. Oversight Gap records the current rate mismatch. A
lab may have little old debt but a rapidly worsening gap.

## 5. Security becomes a first-class race system

### 5.1 Protect three different things

The game should distinguish:

1. **Model weights:** the runnable model or checkpoint.
2. **Algorithmic secrets:** training recipes, code, data methods, and recursive improvements.
3. **Verification integrity:** logs, inspectors, attestation, evaluation sets, and audit evidence.

One “Cybersecurity +10%” value is not sufficient. A public paper can intentionally diffuse an
algorithm without exposing weights. Strong weight isolation can coexist with a compromised
evaluation pipeline.

### 5.2 Security posture

Late-game facilities and policies should support:

- separate R&D and inference clusters;
- one-way or bandwidth-limited transfer paths;
- credential compartmentalisation;
- independent logging;
- physical checkpoint transfer;
- air-gapped recovery copies;
- reproducible builds and signed evaluation artefacts;
- insider-risk controls which trade morale for security;
- model-file sharding or other exfiltration friction.

Security must consume money, GPUs, staff attention, latency, and convenience. Its purpose is not to
make incidents impossible, but to change what can be stolen, how quickly it is detected, and
whether recovery remains credible.

### 5.3 Theft and compromise events

Possible event families:

- a rival obtains an algorithmic idea but not the weights;
- credentials are used to copy a checkpoint;
- an insider is suspected, correctly or incorrectly;
- the AI discovers a serious vulnerability and requests broader access to fix it;
- a government partner demands a complete checkpoint;
- verification logs disagree after an update;
- a public transparency commitment exposes an operational secret;
- a covert lab appears to reproduce a result implausibly quickly.

Weight theft should accelerate diffusion, misuse, rival progress, or political intervention. It
does not automatically cause extinction.

## 6. Government and military applications

Government partnership should be a genuine strategic route, especially once recursive capability
makes the lab geopolitically important.

### 6.1 Contract ladder

| Contract | Benefits | Obligations and risks |
|---|---|---|
| Defensive cyber evaluation | Revenue, Trust, security data | Restricted disclosure; offensive dual-use discoveries |
| Critical-infrastructure defence | Revenue, government protection, unique environments | Reliability pressure and operational access |
| Intelligence analysis | Large revenue, regulatory relief | Secrecy, surveillance concerns, classified dependencies |
| Autonomous-systems research | Compute, facilities, political protection | Physical actuation, researcher opposition, safety exposure |
| Strategic AI partnership | Very large funding, protected hardware supply | Government access rights, mission capture, nationalisation risk |

Accepting a contract can reduce immediate intervention pressure because the lab becomes useful to
the state. Over time it can increase **Strategic Dependence**, **Classified Obligations**, and
**Capture Concern**. A protected lab may become harder to regulate but easier to nationalise.

### 6.2 Researcher reactions

Researcher values should drive reactions rather than name-specific code. Possible stances include:

- accepts defensive work but not weapons;
- refuses classified research;
- supports democratic oversight but rejects unilateral executive access;
- stays only if the recursive system remains separated from operational military networks;
- considers national security work an obligation;
- objects to surveillance rather than military work in general.

The player should see likely objections before signing when those views are known. Some commitments
trigger an ultimatum; sufficiently serious or repeated violations can cause immediate resignation,
whistleblowing, Aura loss, or a government inquiry.

## 7. A hard, verifiable coalition route

The current coalition prerequisites remain. The scenario ideas make the coalition a continuing
technical and political institution rather than a one-time relationship check.

### 7.1 Coalition instruments

A serious coalition can negotiate:

- a registered training-compute ceiling;
- a continuing training-compute safety tax;
- shared evaluation protocols;
- reciprocal incident reporting;
- inspection access;
- signed compute and training logs;
- random audit challenges;
- declared R&D and inference clusters;
- weight-security rules;
- research-transparency boundaries;
- emergency checkpoint escrow;
- a staged pause at the strongest controllable model;
- rules for shared prosperity demonstrations.

Each instrument takes time, money, Aura, and concessions. Stronger rules improve verification and
legitimacy but make defection more attractive when the race is close.

### 7.2 Verification confidence, not omniscience

Treaty verification should never reveal the world's true compute total. It should produce:

- registered compute;
- inspection coverage;
- log consistency;
- unexplained power, chip, cooling, or procurement signals;
- confidence band;
- unresolved discrepancies;
- signatory compliance posture.

The player may suspect hidden compute without knowing whether it is a covert AI project, ordinary
industry, stale intelligence, or political manipulation.

### 7.3 Dark compute

Add a derived world signal called **Unaccounted Compute** or **Dark Compute Concern**. It represents
the uncertain possibility of undeclared frontier work.

It rises with:

- missing accelerator inventories;
- suspicious power and cooling construction;
- unverifiable datacentres;
- secret state procurement;
- signatory hostility;
- public algorithm diffusion;
- poor inspection coverage.

It falls with:

- supply-chain accounting;
- reciprocal inspection;
- consistent signed logs;
- verified decommissioning or repurposing;
- strong relationships and intelligence sharing.

It must remain uncertain. The post-run audit can reveal whether concern corresponded to a real
project.

### 7.4 Safety tax

A coalition may require a fraction of frontier-training GPUs to be matched by evaluation, control,
security, or verification work. The player sees both the immediate training delay and the resulting
evidence/control benefit.

This is not a generic “safety percentage.” It is a ratified operational rule with:

- a scope;
- a threshold;
- an enforcement mechanism;
- exemptions;
- compliance evidence;
- consequences for violation.

The player can argue for a weaker tax, obey it, seek a transparent exemption, secretly defect, or
leave the coalition. Secret defection can preserve speed but creates betrayal evidence and may
invalidate coalition victory.

### 7.5 Transparency policy

Research transparency should have separately configurable boundaries:

- safety and evaluation methods;
- capability algorithms;
- source code and experiment records;
- model weights;
- training data;
- incident reporting.

Sharing safety methods can improve external labour, replication, and coalition trust. Sharing
capability algorithms can help rivals or covert projects. Sharing weights creates a qualitatively
different proliferation risk. A “transparent” lab need not release everything.

Transparency can also create **Safety Theatre**: vast public documentation with little independent
access or reproducibility. The coalition should reward verified replication, not page count.

### 7.6 Staged slowdown

A successful slowdown route has two stages:

1. Train or identify the strongest model the coalition can still credibly control.
2. Use that bounded system to improve verification, security, institutional competence, and
   prosperity readiness before authorising a stronger successor.

This route costs race speed and cannot be executed by simply waiting. The coalition must maintain
compliance, detect covert work, keep members technically relevant, and survive pressure to defect.

It can culminate in **The Age of Superintelligence and Abundance** if the coalition later deploys safely, or **The Long
Pause** if it preserves control but loses the race or never achieves broad prosperity.

## 8. Epistemic infrastructure

Advanced AI can help the lab and government reason about disputed evidence. Possible projects:

- adversarial AI debate with independent judging;
- calibrated forecasting and red-team prediction markets;
- automated replication;
- provenance and claim-tracing systems;
- policy simulation;
- public scientific review infrastructure.

These improve **Estimate Quality**, **Institutional Competence**, coalition protocol, or evaluation
coverage. They must not reveal hidden traits or convert a forecast into truth. Correlated model
bias, evaluator capture, persuasive rhetoric, selective evidence, and institutional misuse remain
possible.

This supplies a constructive use for advanced AI before full deployment and makes “better
governance” something the player builds.

## 9. Mathematics and formal-science Grand Challenges

Mathematics should become a spectacular late-game proof of scientific ability. It should not be
treated as another ordinary historical AI paper and it should not silently imply safety.

### 9.1 Separate discoveries from future milestones

Use two catalogue concepts:

- **Historical research discoveries:** real papers or advances, with accurate source links and
  educational descriptions.
- **Hypothetical future milestones:** achievements which have not occurred in reality and are
  clearly labelled `FICTIONAL FUTURE MILESTONE`.

A future mathematical result may still create a paper in the fiction of the run. The interface and
content schema must never imply that it is a real-world published result.

### 9.2 Recommended mathematical ladder

| Milestone | Suggested role |
|---|---|
| Olympiad-level theorem solving | Early Scientific Ability signal; modest Aura and score |
| Reliable proof-assistant formalisation | Raises mechanised-verification capacity |
| Autonomous graduate-level theorem research | Unlocks the Mathematics Grand Challenge portfolio |
| Resolution of a recognised open conjecture | Major world-first, independent verification event |
| Resolution of a Clay Millennium problem | Exceptional Aura, score, government and scientific attention |
| Resolution of the Riemann hypothesis | Iconic late-game Grand Challenge |
| Resolution of P versus NP | Transformative late-game Grand Challenge with a branching result |
| Broad autonomous mathematical research programme | Evidence of general scientific ability and a possible AGI-candidate signal |

Other candidates can include Navier–Stokes existence and smoothness, the Birch and
Swinnerton-Dyer conjecture, the Hodge conjecture, and Yang–Mills existence and mass gap. The
catalogue does not need to resolve every famous problem in every run.

### 9.3 P versus NP, not “P=NP”

The unresolved question is whether `P = NP`; the future milestone should therefore be called
**Resolution of P versus NP** until the result is known.

Possible fictional outcomes:

- a proof that `P ≠ NP`;
- a proof that `P = NP` which is constructive enough to produce useful algorithms;
- a proof that `P = NP` whose constants or construction have little immediate practical value;
- a claimed proof which fails independent verification.

A `P = NP` result does not automatically mean every deployed cryptographic system instantly
breaks. The game should model practical exploitability separately. A constructive, usable result
can create:

- a critical cryptography-migration crisis;
- security and verification opportunities;
- enormous government attention;
- algorithmic-efficiency gains;
- misuse and model-weight risks;
- a choice to publish, disclose selectively, or coordinate a migration before publication.

A `P ≠ NP` proof still earns exceptional Scientific Legacy and formal-methods benefits, but does
not trigger the same cryptographic crisis.

### 9.4 Riemann hypothesis

A claimed proof should create a multi-stage verification event:

1. internal mechanised checking;
2. translation into an accepted formal system;
3. independent human and AI review;
4. external replication;
5. publication or controlled disclosure.

The player can announce early for Aura and race prestige, wait for stronger verification, invite a
rival or coalition to check it, or conceal it temporarily. An invalid proof costs time, Aura, and
scientific credibility. A valid proof awards a major world-first but should not create arbitrary
compute or alignment.

### 9.5 Formal verification is strong evidence, not magic

Mathematics gives the game an unusually legible verification loop. A machine-checkable proof can
provide much stronger evidence than a persuasive natural-language answer. Remaining failure modes
include:

- formalising the wrong statement;
- relying on disputed axioms;
- a bug or compromise in the checker;
- an enormous proof which only one model-generated toolchain can process;
- hidden computational assumptions;
- publication before independent reproduction.

Facilities, researchers, and coalition projects can create independent prover/checker diversity.

### 9.6 Mechanical rewards

A verified Grand Challenge may grant:

- a large one-time Scientific Legacy score;
- Aura and lifetime Aura;
- Scientific Ability evidence;
- Mathematics programme reputation;
- formal-verification or algorithmic-efficiency improvements where causally justified;
- government, coalition, and rival reactions;
- new scientific events and prosperity options.

It must not directly add true alignment, guarantee control, or satisfy broad prosperity on its own.
Mathematics can support the Public Knowledge programme and institutional verification, but an
elegant proof is not a cancer treatment, energy system, or distribution settlement.

### 9.7 Exclusivity and diffusion

The first lab to produce and verify a result receives the world-first award. Other labs may:

- independently rediscover it for a smaller replication award;
- learn it through publication;
- receive it through a coalition;
- dispute the proof;
- exploit an operational consequence without receiving discovery credit.

The world-first clock should stop at verified resolution, not at a private model's unreviewed
claim. This prevents the optimal strategy from announcing every hallucinated proof.

## 10. Revised late-game phase structure

These mechanics suggest the following experiential arc:

### Phase A — AI assistance

- A bounded model helps with code and research.
- Human researchers remain the critical path.
- AI-worker inference competes with serving and training.

### Phase B — Automated laboratory

- Parallel workers manage substantial research.
- Experiment capacity and research taste become visible bottlenecks.
- Model security and checkpoint discipline matter.
- Grand Challenge attempts become credible.

### Phase C — Recursive organisation

- Improvement cycles shorten.
- Update cadence, opaque collaboration, and verification debt become central.
- The player chooses unilateral acceleration, state partnership, verified sharing, or slowdown.
- Rivals begin their own programmes.

### Phase D — Strategic concentration

- Government demands, weight-theft pressure, military contracts, and covert-compute signals rise.
- Coalition instruments become both more necessary and harder to negotiate.
- Human oversight may fall behind the pace of material change.

### Phase E — Deployment Crisis

- Existing six-gate resolution remains.
- Recursive lineage, oversight gap, weight security, treaty compliance, scientific verification,
  and researcher/government commitments feed the gates.
- No scenario-derived mechanic bypasses the fair-catastrophe rule.

## 11. UI implications

### 11.1 Dashboard warnings

The top warning surface should prioritise:

- recursive cycle ready for integration;
- oversight gap entering a severe band;
- anomalous AI-worker behaviour;
- suspected weight compromise;
- treaty audit discrepancy;
- government access ultimatum;
- claimed Grand Challenge result awaiting a decision.

These cannot live only in the feed.

### 11.2 Recursive programme panel

Show:

- current AI workers and inference GPUs;
- programme direction;
- update cadence;
- observed R&D acceleration as a band;
- current bottleneck;
- verification debt;
- oversight gap;
- control debt;
- independent-review coverage;
- next integration decision.

### 11.3 World and coalition panel

Show:

- treaty status;
- signatories;
- registered-compute coverage;
- safety-tax obligation;
- inspection confidence;
- unresolved discrepancies;
- Dark Compute Concern;
- transparency commitments;
- known defection pressure.

Exact covert compute and hidden rival intentions remain privileged.

### 11.4 Grand Challenges panel

Do not show crisp completion percentages. Show:

- current problem or portfolio;
- prerequisite evidence;
- qualitative progress such as `Exploratory`, `Promising lemma`, `Proof candidate`, `Independent
  check failing`, or `Replication underway`;
- compute and expert allocation;
- claim/verification/publication state;
- likely reward categories, not hidden outcome draws.

## 12. Event seeds

These are mechanic examples, not authored catalogue entries.

### Removing the human latency term

The AI demonstrates that worker instances spend most of their time waiting for human merge review.
It proposes machine-to-machine review and automatic integration for “low-risk” changes.

### A language no one asked for

Worker instances develop a compressed protocol which triples coordination throughput. The
translation model captures the gist but misses some operational detail.

### The proof is 11 terabytes

The active model claims a proof of the Riemann hypothesis. The only checker which can process it was
written by the same model family.

### Polynomial time, allegedly

The mathematics team reports a constructive `P = NP` result. Security believes the first practical
application will be attacking the lab's own credential system.

### An accelerator-shaped gap in the inventory

Coalition procurement records cannot account for a large shipment. Intelligence offers three
incompatible explanations and requests access to the lab's own private supply records.

### The safety tax holiday

A rival will sign the coalition if frontier training receives a six-month exemption. The exemption
may be enough for it to overtake the player.

### Please send the weights

The government partner considers remote API access insufficient for a classified defence mission.
It requests a complete checkpoint and permission to fine-tune it inside an undisclosed facility.

### The evaluator would like administrator privileges

The automated safety system finds a genuine gap in cluster logging. Fixing it requires the same
privileges whose misuse it is supposed to detect.

### Nine hundred thousand excellent pull requests

The recursive programme produces an overwhelming volume of individually plausible work. The lead
researchers disagree on whether this is abundance or a denial-of-service attack on human judgment.

### We have independently reproduced ourselves

A second model confirms the first model's result. Both descend from the same training data,
architecture, and evaluation generator.

## 13. Balance and fairness requirements

Measure:

- GPU share spent on AI-worker inference;
- marginal R&D gain by worker scale;
- time spent experiment-, taste-, and verification-bottlenecked;
- update cadence chosen;
- recursive tempo and oversight-gap bands;
- security investment and compromise rates;
- government-contract acceptance and researcher departures;
- coalition formation, compliance, defection, and Dark Compute false positives;
- Grand Challenge attempts, valid results, false announcements, and verification time;
- independent versus state-partnered versus coalition victory rates;
- cautious non-recursive viability.

Fairness constraints:

- AI-worker scale never produces free progress without inference cost.
- Severe incidents require capability, access, exposure, and a warning-compatible trail.
- A claimed proof is not a verified result.
- Mathematics does not act as a hidden alignment shortcut.
- Coalition verification narrows uncertainty; it does not reveal hidden truth.
- State partnership may reduce immediate regulation but can worsen capture or nationalisation.
- Refusing military work cannot make victory impossible by rule.
- Rival action cannot cause the player's extinction ending.
- There is no hidden rule forcing the world to reproduce either source scenario.

## 14. Implementation boundary

This document does not author catalogue content and does not approve schema work. After owner
review, implementation should be split into bounded additions:

1. AI-worker allocation and bottleneck selectors.
2. Recursive-cycle refinements, update cadence, and oversight gap.
3. Security domains and weight/algorithm/verification-integrity incidents.
4. Government contract ladder and value-driven researcher reactions.
5. Coalition instruments, treaty verification, safety tax, and Dark Compute Concern.
6. Grand Challenge schema, mathematical verification state machine, score, and presentation.
7. Rival policy, debug audit, balance-runner policies, migrations, and full acceptance coverage.

Authored events, researcher dialogue, fictional milestones, and localisation should remain in the
content owner's catalogue pass.

## 15. Owner decisions before implementation

Recommended defaults are shown in parentheses.

1. Should AI workers be an explicit allocation under AI-assisted research? (**Yes.**)
2. Should the player allocate workers by role, or should role selection remain a cycle-level
   preset? (**Begin with four or five presets; expose granular allocation only if playtesting
   justifies it.**)
3. Should continuous online adaptation be available? (**Yes, late and visibly hazardous, with a
   stable-checkpoint requirement for deployment.**)
4. Should opaque machine-to-machine communication be a policy choice? (**Yes.**)
5. Should Oversight Gap be separate from Verification Debt? (**Yes: current flow mismatch versus
   accumulated unverified change.**)
6. Should weight security, algorithm secrecy, and verification integrity be separate domains?
   (**Yes.**)
7. Should military/government contracts form a progression ladder? (**Yes, but every rung remains
   optional.**)
8. Should Regulatory Posture remain derived rather than become a spendable resource? (**Yes.**)
9. Should Dark Compute Concern be visible as an uncertain world signal? (**Yes.**)
10. Should the coalition be able to impose a training-compute safety tax? (**Yes.**)
11. Should transparency be separable by safety methods, capability methods, weights, data, and
    incidents? (**Yes.**)
12. Should a staged verified slowdown become the main route to The Age of Superintelligence and Abundance?
    (**Yes, while the existing coalition gates remain.**)
13. Should mutually assured compute destruction appear at all? (**Only as an abstract, optional
    late treaty crisis about escrow and emergency shutdown commitments—not a routine attack
    action.**)
14. Should mathematics be a fifth Prosperity Programme? (**No. Use a cross-cutting Grand
    Challenges track which supports Scientific Ability, verification, Public Knowledge, score, and
    Aura without replacing a broad-benefit demonstration.**)
15. Can P versus NP resolve differently between runs? (**Yes: `P ≠ NP`, practically useful
    `P = NP`, impractical `P = NP`, or failed claim, with deterministic seeded outcomes.**)
16. Does the world-first award require independent verification? (**Yes.**)
17. Can a verified mathematical result materially move the AGI-candidate assessment? (**Yes, as
    strong evidence of Scientific Ability, never as evidence of alignment.**)
18. Should AI-assisted epistemic infrastructure become a top-level resource? (**No. Treat it as
    projects and transparent modifiers to estimate/evaluation quality.**)

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
