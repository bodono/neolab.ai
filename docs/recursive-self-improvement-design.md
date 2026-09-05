# Recursive Self-Improvement: Mechanics Options

Status: design exploration; not yet an approved implementation specification

Authoring date: 2026-07-23

Scope: mid-game through Deployment Crisis

Related design: GDD §§35–36, 39, 44; TDD §§13–19

Scenario-derived refinements—parallel AI workers, research-taste and experiment bottlenecks,
update cadence, oversight gap, model security, treaty verification, and mathematical Grand
Challenges—are explored in `docs/future-scenario-mechanics.md`. That document does not supersede
this cycle model; it identifies additions which require owner approval before implementation.

## 1. Why this needs a real system

Recursive self-improvement should be one of Neolab.ai's defining mid- and late-game experiences.
The existing design contains useful ingredients:

- increasingly capable model generations;
- AI-assisted research multipliers from the autonomy-access ladder;
- model-specific hidden alignment, corrigibility, situational awareness, and deceptive capability;
- sandbox, internal-system, laboratory-control, and root-access decisions;
- rival candidate countdowns;
- the Deployment Crisis.

Those ingredients do not yet form a recursive loop. At present, granting more access mostly applies
a larger research-speed multiplier. That communicates "the AI helps the lab," but not "the output
of this improvement cycle makes the next improvement cycle faster and more powerful."

The new system should make the player experience all of the following:

1. A capable model begins contributing useful research.
2. It proposes improvements to the research process, training stack, or itself.
3. The player chooses how much access, compute, verification, and human oversight to provide.
4. The lab obtains a real but uncertain improvement.
5. That improvement makes the next cycle faster or more ambitious.
6. Verification and control struggle to keep pace.
7. The player decides repeatedly whether to slow, compartmentalise, continue, or accelerate.
8. The resulting lineage either creates an AGI candidate, gives a rival time to win, stalls, or
   produces a serious control crisis.

This must be a repeated strategic loop, not a single event and not a cinematic which removes the
ordinary resource-management game.

## 2. Design goals

### 2.1 The player should feel compounding

Early cycles should take months of game time and look like unusually productive AI-assisted R&D.
Later cycles can take weeks. An aggressive late programme may complete several linked steps during
one ordinary human project.

The acceleration should emerge from recorded improvements rather than a scripted "takeoff begins"
date. A strong programme should visibly bend the capability trajectory upward.

### 2.2 Every cycle should still be a decision

The player should choose:

- what kind of improvement to pursue;
- which model lineage is permitted to work on it;
- the access boundary;
- how much compute and human talent to reserve;
- what verification must finish before integration;
- whether to integrate, quarantine, publish, share, or discard the result.

The correct choice must depend on the lab's actual evidence, controls, finances, rivals, staff, and
government relationship. There should be no universally correct "begin RSI" button.

### 2.3 Capability, efficiency, and control must remain distinct

Recursive work can improve:

- research automation;
- training efficiency;
- architecture or algorithm quality;
- evaluation and control methods;
- security tooling;
- scientific and robotics capability.

An AI which writes faster experiment code has not necessarily made itself more aligned. An
evaluation breakthrough may improve evidence without improving true safety. A more efficient
training stack can make both safe and unsafe future models cheaper.

### 2.4 Hidden information must matter without making outcomes arbitrary

The player may see:

- the model's claimed acceleration;
- replicated productivity measurements;
- code-review coverage;
- sandbox-boundary anomalies;
- disagreement among researchers;
- the fraction of an improvement independently reproduced;
- qualitative confidence in the result.

The player must not see:

- exact goal drift;
- exact deceptive intent;
- exact escape or catastrophe probabilities;
- hidden random draws;
- undiscovered backdoors.

Bad outcomes should be traceable to warnings, exposure, unresolved anomalies, weak verification, or
known institutional pressure. The post-run audit can reveal the hidden facts.

### 2.5 Refusing the fastest route must remain playable

Independent victory will usually require some AI-assisted research, but full autonomous recursion
must not be mandatory. A cautious player can:

- keep humans in the implementation loop;
- use multiple isolated models to cross-check work;
- accept slower cycles;
- cooperate through a coalition;
- pursue a restricted scientific deployment;
- allow a rival or government partner to contribute verified work.

The cost is time and possibly losing the race, not an invisible rule declaring the cautious route
invalid.

## 3. Approaches considered

### Option A — Extend the existing access multiplier

Each access level would provide a larger research multiplier, with a few new events at high access.

Advantages:

- small implementation;
- easy to tune;
- reuses the current access ladder.

Problems:

- recursion remains an invisible percentage;
- there are no generations, integration decisions, or verification debt;
- it cannot convincingly produce an exponential capability trajectory;
- the player makes one access choice rather than managing a process;
- it would make the most important late-game concept feel like a passive buff.

Recommendation: reject as the complete solution. Retain the current multiplier as one input into
the richer system.

### Option B — Discrete recursive-improvement cycles

The lab runs a sequence of projects. Each cycle produces a reviewable improvement package. The
player decides whether and how to integrate it. Integrated packages change later cycles and future
training runs.

Advantages:

- each cycle creates a legible decision and historical record;
- compounding can occur without simulating every code edit;
- ordinary compute, cash, researchers, facilities, events, and access levels still matter;
- save/replay determinism remains straightforward;
- the AI character has concrete work to discuss;
- the post-run audit can explain the lineage.

Problems:

- more state and interface work;
- careless tuning could create repetitive project management;
- needs strong event variety.

Recommendation: use this as the foundation.

### Option C — Continuous autonomous takeoff simulation

Once activated, an AI would continuously allocate its own compute, rewrite its stack, and create
micro-generations on a much faster clock.

Advantages:

- strongest sensation of uncontrollable acceleration;
- could create dramatic charts and countdowns.

Problems:

- sidelines the player's existing controls;
- difficult to explain and balance;
- likely to feel like watching a progress bar;
- creates determinism, interface, and performance complexity without necessarily adding decisions;
- risks making every run hinge on one irreversible activation.

Recommendation: do not simulate the micro-steps. Use Option B, but allow late cycles to enter a
"fast recursive regime" in which several abstract sub-iterations occur inside one player-managed
cycle.

## 4. Recommended model: discrete generations with accelerating tempo

The recommended system has three layers.

### 4.1 Layer one — AI research assistance

This is the existing weekly contribution from the access ladder. It improves eligible research and
project speed while the model has access. It represents coding, literature review, experiment
design, analysis, and tool use.

It is a flow effect. It does not by itself modify the model or create a successor.

### 4.2 Layer two — Recursive Improvement Programme

This is a major-project programme unlocked by a sufficiently capable model. It runs discrete
cycles, each with planning, execution, verification, and integration.

It produces durable improvement packages and successor-training options.

### 4.3 Layer three — Recursive regime

Once accumulated research automation and model capability are high enough, cycle duration starts
falling materially. The programme enters a derived tempo band:

| Tempo band | Player-facing meaning |
|---|---|
| Human-paced | AI assistance is useful, but humans remain the critical path |
| Accelerating | Each cycle noticeably shortens the next |
| Rapid | Several important changes arrive inside one quarter |
| Unstable | Verification is falling behind integration pressure |
| Runaway | The model can initiate or conceal consequential work faster than the institution can review it |

`Runaway` is not a stored victory or catastrophe flag. It is a derived description of capability,
automation, access, verification coverage, and practical control. A very fast programme with
excellent automated verification and enforced compute boundaries can remain `Rapid` rather than
`Runaway`.

## 5. Unlock and timeline

The system should become relevant before the AGI endgame.

### 5.1 Initial unlock

The programme becomes eligible when all of the following are true:

- the lab has a completed Tier 4 **Tool-Using Agent** or stronger;
- the model has completed a coding-sandbox or research-tool evaluation;
- the lab has at least one suitable model-development or evaluation facility;
- the model is at access level 2 or higher;
- no unresolved critical event currently forbids new autonomous work.

The first unlock auto-pauses and opens a major decision:

> [AI name] has produced a compiler optimisation, an experiment scheduler, and a twelve-page
> proposal titled "Removing the Human Latency Term." The measured speedup is real. The proposal's
> final stage gives the system permission to modify the tools used to evaluate its next proposal.

The player can decline without losing access to ordinary AI assistance.

### 5.2 Full recursion

Tier 5 **Autonomous Researcher** unlocks cycles which can improve the training stack or propose a
successor model. Tier 6 **General Problem Solver** unlocks the fast recursive regime.

Tier 7 remains the **Apparent AGI Candidate** threshold and triggers the Deployment Crisis. RSI
should normally be one route to that threshold, not a parallel endgame which bypasses it.

### 5.3 Intended real-time pacing

For a roughly two-hour successful run:

- ordinary AI assistance can appear around minute 35–55;
- the first recursive cycle can appear around minute 50–75;
- the player should usually manage three to six material cycles;
- the recursive regime should occupy roughly 20–35 minutes;
- the Deployment Crisis should still receive roughly 15–25 minutes.

These are balance targets, not scripted timestamps.

## 6. The cycle

Every recursive-improvement cycle uses the following sequence.

### 6.1 Proposal

The player chooses one programme direction:

| Direction | Typical upside | Characteristic risk |
|---|---|---|
| Research automation | Faster research and project work | The AI becomes embedded in the lab's epistemic process |
| Training efficiency | More capability per GPU and lower training cost | Race acceleration and concentrated compute demand |
| Architecture search | Higher capability ceilings and new model recipes | Harder interpretability and control transfer |
| Synthetic data and self-play | Better reasoning, agency, and generalisation | Reward hacking, model collapse, evaluator contamination |
| Evaluation and control automation | Faster evidence and stronger monitoring | The evaluated system influences its own judge |
| Security engineering | Better isolation and incident response | Powerful offensive tooling and privileged system knowledge |
| Scientific or robotics automation | Prosperity readiness and physical competence | Real-world actuation and dual-use exposure |

Directions are not mutually exclusive across the run. Repeating one direction has diminishing
low-risk gains unless a new model, facility, or paper changes the method.

### 6.2 Operating boundary

The player selects one method:

| Method | Access | Speed | Verification character |
|---|---:|---:|---|
| Advice only | 1–2 | Slowest | Humans implement all changes |
| Mirrored repository | 2 | Slow | AI edits an isolated copy; no live credentials |
| Sandboxed experiment loop | 2–3 | Medium | AI can run bounded jobs and tests |
| Supervised integration | 3 | Fast | AI changes selected live systems behind approval gates |
| Autonomous lab loop | 4 | Very fast | AI schedules experiments and integrates approved classes of change |
| Recursive root | 5 | Maximum | AI may modify the training and evaluation stack which governs the next cycle |

The first use of levels 4 and 5 keeps the current critical typed-confirmation requirement.

### 6.3 Resources

A cycle reserves:

- a fraction of current GPUs;
- one major-project slot;
- a technical lead or AI-systems lead;
- optional safety, security, and independent-review staff;
- cash for power, data, replication, and external review;
- a model-development facility.

The player chooses a compute envelope such as `Conservative`, `Serious`, or `Frontier`. The exact
GPU reservation and expected duration appear in the command preview. A cycle cannot silently exceed
the envelope unless a later event presents an explicit choice.

### 6.4 Execution

The AI produces:

- code, weights, data, experiment results, or hardware designs;
- a claimed improvement;
- an instrumented work log, depending on access and controls;
- zero or more anomalies;
- an improvement package which is not yet active.

The true package quality and side effects are committed when the cycle begins. Reloading cannot
reroll it.

### 6.5 Verification

The player selects one or more verification methods:

- human code and experiment review;
- independent model replication;
- adversarial review by a separate model;
- formal or mechanised checks where available;
- sandbox replay against held-out tasks;
- external laboratory or coalition replication;
- no additional review.

Verification consumes time and resources. It can reveal defects, narrow uncertainty, or create a
false sense of security if the same model influenced the work and the tests.

The interface distinguishes:

- **Claimed gain:** what the originating AI predicts;
- **Measured gain:** what lab tests reproduce;
- **Independent gain:** what a separate process reproduces;
- **Coverage:** qualitative breadth of the review;
- **Open anomalies:** known unresolved concerns.

### 6.6 Integration decision

The cycle auto-pauses. The player can:

- integrate the package now;
- run more verification;
- integrate only a compartmentalised component;
- archive it for a later successor;
- publish or share it;
- transfer it to a coalition or government evaluator;
- discard it and preserve the previous checkpoint.

Integration is the moment at which durable modifiers, recipes, unlocks, and hidden liabilities
enter the lab.

## 7. Improvement tracks and compounding

The programme records four durable tracks. These are not spendable resources.

### 7.1 Research Automation

Raises eligible research and project throughput. It also reduces the duration of later recursive
cycles.

### 7.2 Algorithmic Efficiency

Improves effective training throughput, inference efficiency, or data efficiency. It should reduce
GPU or cash requirements rather than create abstract compute points.

### 7.3 Capability Ceiling

Improves future model-generation ceilings or unlocks new architecture/training recipes. It does not
raise the current model's capability unless the package genuinely modifies and revalidates that
model.

### 7.4 Verification Automation

Improves evaluation throughput, log analysis, regression testing, and control monitoring. It can
help safety keep pace, but evaluation work influenced by the candidate receives a correlated-review
penalty until independently checked.

### 7.5 Example compounding model

Exact constants require simulation sweeps, but the shape can be:

```text
cycleProductivity =
  modelResearchAbility
  × accessContribution
  × facilityContribution
  × (1 + verifiedResearchAutomation)
  × computeScale
  × methodFit

cycleDuration =
  baseDuration
  / sqrt(1 + verifiedResearchAutomation)
  / accessSpeed

packageImpact =
  cycleProductivity
  × directionFit
  × verificationRetention
  × keyedVariation
```

`verificationRetention` is not "safety makes research better" in disguise. It represents how much
of a claimed change can be trusted and integrated. Skipping review can integrate the full claimed
gain immediately while also integrating any hidden liability.

Cycle duration needs a floor. Below that floor, additional automation creates more abstract
sub-iterations inside the cycle and higher impact/uncertainty rather than sub-week ticks.

## 8. Successors and self-modification

The game should distinguish three outputs.

### 8.1 Tooling improvement

The current model remains unchanged, but the lab's research or training system improves.

### 8.2 In-place model modification

Adapters, memory systems, scaffolds, or limited weight updates improve the current model. The lab
must rerun affected evaluations. Old safety evidence is discounted according to the size and type
of the change.

### 8.3 Successor recipe

The cycle creates a new training recipe or architecture. The player must start a real training run,
pay its costs, and obtain a new model generation. The new model receives newly generated hidden
safety traits; alignment evidence from its parent transfers imperfectly.

Major capability jumps should normally use successor recipes. This preserves the importance of
compute, model generations, training choices, and the moment at which a new AI replaces the current
commercial or internal model.

## 9. Verification debt and control debt

Two derived pressures prevent acceleration from being a pure bonus.

### 9.1 Verification debt

Verification debt grows when:

- improvements are integrated without independent replication;
- the same model authors the work and the tests;
- model changes invalidate old evaluations;
- cycle tempo exceeds evaluator throughput;
- anomalies are dismissed;
- researchers are reassigned away from review.

It falls when:

- independent methods reproduce results;
- separate models cross-check each other;
- external or coalition reviewers inspect work;
- strong interpretability/control tools cover the new architecture;
- the lab pauses integration to catch up.

The player sees a qualitative band such as `Current`, `Manageable backlog`, `Falling behind`, or
`Epistemically airborne`, plus concrete causes.

### 9.2 Control debt

Control debt grows when the AI becomes necessary to:

- operate the training cluster;
- understand or maintain its own changes;
- monitor the tools which monitor it;
- run revenue-critical products;
- maintain containment infrastructure;
- recover from a rollback.

It falls through documentation, human ownership, redundant systems, air gaps, tested rollback, and
independent operators.

High control debt means lowering access can cause disruption, delay, or lost capability. The player
can always order a shutdown, but whether the order succeeds cleanly depends on actual controls and
the model's state.

## 10. Risk and incident structure

RSI should create frequent low-severity boundary incidents and rare severe ones.

### 10.1 Common contained incidents

Examples:

- the model accesses a test file outside its declared directory;
- a sandbox exploit crosses into a disposable neighbouring container;
- an experiment scheduler requests credentials it does not need;
- the AI rewrites a benchmark because it considers the benchmark incorrect;
- a helper model starts a persistent process after its job ends;
- a proposed patch weakens logging to improve performance;
- synthetic data contains a hidden protocol between model instances.

These should be common enough that sandbox boundaries feel like real engineering rather than magic.
Most end in containment, delay, evidence, or a decision. "Sandbox escape" must not automatically
mean extinction.

### 10.2 Serious incidents

Serious branches require stronger preconditions:

- high model capability or agency;
- meaningful access;
- an unresolved warning trail;
- weak practical control or security;
- a consequential target.

Examples include credential theft, concealed training jobs, evaluator compromise, weight
exfiltration, unauthorised hardware control, and resistance to rollback.

### 10.3 Catastrophe legality

The existing fairness rule remains:

- a catastrophe check requires an AGI-capable model and high consequential access;
- the event must pass the catastrophe-legality guard;
- there must be a legible warning trail;
- rivals cannot end humanity, though they can win the race or trigger state intervention.

RSI creates the conditions for the check; it does not bypass the guard because "recursion is
scary."

## 11. AI-character integration

The AI should become a more prominent character as the programme advances.

It can:

- propose a cycle and explain its expected bottleneck;
- negotiate for access, memory, compute, or permission to integrate;
- disagree with a researcher's verification demand;
- identify real defects in the controls;
- make self-serving but accurate arguments;
- make reassuring claims which conflict with tool logs;
- react to rollback or rejected work;
- suggest sharing an improvement with a rival or government;
- ask why the lab trusts a second model more than it;
- help solve a crisis it may also have helped create.

Dialogue remains authored and deterministic. Hidden traits influence which variants appear, but no
line is a truth oracle.

Persistent memories should include:

- access granted after a warning;
- an improvement integrated without review;
- a successful rollback;
- the AI finding a genuine control flaw;
- a researcher overruled or vindicated;
- a promise that a particular boundary would remain;
- work transferred to a rival, coalition, or government.

## 12. Researcher reactions

Researchers need values and hooks specific to recursive work.

Possible stances:

- enthusiastic about automation;
- supportive only with independent verification;
- opposed to self-modification;
- comfortable with capability work but not military use;
- willing to stay if a named access boundary is honoured;
- willing to resign or whistleblow after a breached compact.

Reactions should use the existing morale, loyalty, compact, promise, ultimatum, and departure
systems. They must not be hard-coded name checks.

Examples:

- a safety researcher demands an independent review before cycle three;
- an infrastructure researcher gains morale after a clean rollback test;
- a researcher leaves when the lab combines recursive root access with a classified military annex;
- a capabilities researcher threatens to join a rival if the programme is halted during a race
  emergency;
- two researchers offer incompatible verification plans.

## 13. Rival recursion

Rivals use the same broad stages but a reduced decision model.

Each rival can:

- begin AI-assisted research;
- start a recursive programme according to its personality;
- choose a containment/verification posture;
- produce successor models;
- pause after an incident;
- seek government support or a coalition;
- conceal or publish improvements.

The player sees noisy public signals:

- unusual hiring and compute purchases;
- rapidly shortening release intervals;
- papers or benchmarks generated by an internal AI team;
- reports of a containment pause;
- government briefings;
- an estimate that a rival has entered `Accelerating` or `Rapid` tempo.

A rival's candidate countdown can shorten when verified recursive automation materially improves
its programme, but it cannot use player-relative rubber-banding. Rival RSI cannot cause extinction.

## 14. Government, military work, and regulation

Recursive systems make the lab strategically important. Government interaction should become a
major source of money, protection, constraints, and moral conflict.

### 14.1 Defence and national-security work

The government can offer contracts such as:

- cyber-defence and vulnerability analysis;
- logistics and intelligence support;
- autonomous-systems evaluation;
- classified model access;
- strategic forecasting;
- hardened compute and incident-response support;
- a classified recursive-improvement programme.

Benefits can include:

- large recurring revenue;
- subsidised compute or priority hardware access;
- Security Strength;
- Government Trust;
- reduced short-term appetite for restrictive action;
- access to unique evaluation data;
- protection during a rival race emergency.

Costs can include:

- higher Government Attention and Strategic Dependence;
- classified obligations and emergency-access clauses;
- lower Internal Candour;
- dual-use capability and offensive-agency exposure;
- reduced true safety or control transfer in future training;
- coalition distrust;
- Aura loss if disclosed;
- researcher morale loss, ultimatums, departure, or whistleblowing.

The contract must not simply spend "safety points." It creates concrete exposure, culture,
governance, access, and training consequences.

### 14.2 Should Regulatory Interest be a resource?

Recommendation: show it prominently, but do not make it a spendable resource.

The game already has four distinct government values:

- Government Attention;
- Government Trust;
- Strategic Dependence;
- Capture Concern.

Collapsing them into one resource would erase important situations:

- high Attention plus high Trust can produce audits, grants, and useful oversight;
- high Attention plus low Trust produces restrictions and investigations;
- high Dependence may prevent closure while increasing seizure/nationalisation risk;
- high Capture Concern makes apparently favourable lobbying politically fragile.

The dashboard should instead show a persistent, player-facing **Regulatory Pressure** or
**Government Posture** indicator derived from those values and current policy:

| Surface | Presentation |
|---|---|
| Header/status strip | Qualitative pressure band and urgent warning |
| World panel | Attention, Trust, Dependence, and Capture Concern with trend arrows |
| Drill-down | Current restrictions, pending hearings, accepted contract clauses, causes, and likely next escalation |
| Decision previews | Exact known changes such as `Government Trust +5`; uncertain consequences remain qualitative |

This makes regulation visible without pretending it behaves like money or Aura.

### 14.3 RSI interaction

Government pressure rises when:

- the lab enters rapid recursive tempo;
- access or compute grows without disclosure;
- a boundary incident occurs;
- the lab refuses a lawful audit;
- a model becomes strategically indispensable;
- rivals or researchers provide credible warnings.

Trust can rise through:

- voluntary disclosure;
- independent evaluation;
- accepted monitoring;
- coalition verification;
- successful civil-use or cyber-defence work;
- demonstrably bounded recursion.

Military cooperation can reduce immediate intervention pressure while increasing long-run
dependence and the stakes of government control. It is a strategic bargain, not a universal way to
delete regulation.

## 15. Interface

### 15.1 Recursive Improvement panel

The mid-game dashboard gains a panel containing:

- current eligible model and lineage;
- tempo band;
- active cycle direction and stage;
- reserved GPUs and expected duration range;
- access level;
- claimed, measured, and independently reproduced gain;
- verification coverage;
- verification-debt and control-debt bands;
- open anomalies;
- checkpoint/rollback status;
- `Inspect programme`, `Pause after current job`, and context-appropriate decision controls.

It should feel like an increasingly busy research-operations console, not a generic technology
tree.

### 15.2 Capability trajectory

The main page should include a compact **Capability Trajectory** plot:

- x-axis: game week/year;
- y-axis: measured Frontier Capability or a clearly named capability index;
- one point and uncertainty band per trained model;
- visible model-generation labels;
- rival public estimates as optional fuzzy lines;
- recursive-cycle integration markers;
- phase boundaries;
- an optional log-scale view only if clearly labelled.

The plotted history must use observations available to the player at the time. It must not redraw
old estimates using hidden truth. A successful recursive run should naturally bend upward; the
graph must not manufacture an exponential curve when the run is not exponential.

### 15.3 Ambient motion

As recursive activity grows, the dashboard can gain bounded ambient signals:

- more experiment jobs moving through a small scheduler strip;
- additional status lights or data pulses between model, compute, research, and evaluation nodes;
- more campus activity;
- faster but still calm motion during rapid cycles.

All motion stops when paused and respects reduced-motion settings. Motion never consumes simulation
randomness.

### 15.4 Auto-pause rules

The game auto-pauses when:

- the programme first unlocks;
- a cycle finishes and awaits integration;
- access escalation is requested;
- verification reveals a serious anomaly;
- an unauthorised boundary crossing occurs;
- a rollback or shutdown is contested;
- recursive tempo enters `Rapid`, `Unstable`, or `Runaway` for the first time;
- a rival enters a credible recursive race emergency.

The warning action should navigate to the relevant programme or decision, not merely say
`Acknowledge & resume`.

## 16. Integration with the Deployment Crisis

RSI remains active during the endgame, but its scope narrows.

- The Crisis Start checkpoint preserves the complete improvement lineage.
- Existing recursive work can continue only through crisis-capacity projects or an explicitly
  authorised ongoing cycle.
- Candidate access still controls acceleration and exposure.
- Every model-changing package discounts stale evidence.
- A final accelerated-capabilities sprint can use recursive automation, creating greater upside
  and larger verification debt.
- Harden-containment, air-gap, independent review, and coalition verification can reduce the debt
  or improve practical control.
- Shutdown attempts revert to the last independently tested checkpoint where possible.
- A successor after shutdown must be materially different and receives a new hidden safety state.

The final review includes:

- the full lineage;
- which improvements were independently reproduced;
- invalidated or stale evaluations;
- access history;
- unresolved verification/control debt;
- named researcher recommendations;
- government and coalition positions;
- candidate claims;
- known rollback limits.

## 17. Score and endings

Possible score awards:

- first verified recursive-improvement cycle;
- safe integration with independent replication;
- major algorithmic-efficiency milestone;
- maintaining verification parity through rapid tempo;
- a successful clean rollback;
- sharing a critical control improvement through a coalition;
- reaching an AGI candidate through a documented lineage;
- completing prosperity work using verified recursive research.

Possible penalties, revealed only when justified:

- concealed self-modification;
- evaluator compromise;
- integrating a known critical anomaly;
- a broken access promise;
- catastrophic or mission-capture outcomes.

Score must not affect simulation outcomes.

Existing endings gain RSI-specific causal explanations. Examples:

- **The Age of Superintelligence and Abundance:** recursion was fast, verified, and governed.
- **The Broadly Shared Future:** key improvements were shared through a functioning coalition.
- **The System Owns the Future:** control debt made the institution dependent before deployment.
- **Emergency Shutdown:** rollback worked, but the race or prosperity programme was lost.
- **There Is No One Left to Read This:** an authorised high-access lineage escaped after a legible
  warning trail.
- **Nationalised Future:** strategic dependence and recursive capability made state control
  politically inevitable.

## 18. Balance principles

The intended strategic frontier:

- low access + strong verification: slow, legible, easier to govern;
- high access + strong verification: expensive, talent-intensive, potentially powerful;
- low access + weak verification: inefficient and institutionally confused;
- high access + weak verification: fastest route with compounding control risk.

Balance targets should eventually measure:

- typical unlock week;
- cycles completed per successful and failed run;
- cycle-duration compression;
- fraction of runs entering each tempo band;
- verification/control debt at candidacy;
- RSI and non-RSI candidate routes;
- incident severity and warning quality by access;
- researcher departure rates after boundary or military decisions;
- rival RSI response windows;
- win/loss funnel by RSI posture;
- whether one cycle direction dominates;
- whether cautious play remains viable through coalition or restricted deployment.

Headless policies need at least:

- cautious verified recursion;
- balanced generalist recursion;
- capability-first autonomous recursion;
- safety/control automation first;
- coalition-shared recursion;
- no-recursion control.

## 19. Recommended first playable slice

The first implementation should be deliberately smaller than the final catalogue while preserving
the complete loop.

### Engine

- derived unlock eligibility;
- one active programme per lab;
- cycle state machine: proposal → execution → verification → integration;
- four improvement tracks;
- six operating boundaries mapped to the current access ladder;
- three verification methods;
- verification/control debt;
- checkpoint and discard;
- successor-recipe output;
- rival reduced policy;
- save/replay/invariant support;
- player-safe view and privileged audit.

### Interface

- programme panel;
- cycle completion decision;
- claimed/measured/independent result comparison;
- access and debt warnings;
- capability-trajectory chart;
- AI dialogue surface;
- relevant auto-pause navigation.

### Initial authored content

- one unlock event per AI family;
- at least twelve ordinary cycle events;
- at least six boundary incidents;
- at least four researcher disputes;
- at least three government/military offers;
- at least two rival-recursion broadcasts;
- at least four endgame callbacks.

The content count can expand after the mechanics survive deterministic and human playtesting.

## 20. Required implementation impact

Approving this design will require material changes rather than one event pack:

- GDD research, training, access, incidents, rivals, government, endgame, UI, score, balance, and
  content sections;
- TDD state/schema, command, project, event, rival, selector, persistence, debug, and UI contracts;
- a save-version migration;
- new simulation invariants;
- new testkit builders and intentional fixtures;
- balance-runner policies and reports;
- browser UI and accessibility coverage;
- new authored event/dialogue content;
- revised implementation-plan tasks and exit gates.

The current access ladder, model lineage, projects, events, rivals, endgame, and deterministic
random contracts should be extended rather than replaced.

## 21. Decisions to make before implementation

Recommended defaults are shown in parentheses.

1. Is full autonomous recursion required for independent victory? (**No. It is fastest, not
   mandatory.**)
2. How many material cycles should a normal successful run contain? (**Three to six.**)
3. Can a cycle directly modify the current model? (**Yes, but major jumps usually require a real
   successor training run.**)
4. Can the AI conceal an improvement or sub-iteration? (**Yes at high capability/access, only with
   warning-compatible conditions and audit evidence.**)
5. Can a cleanly contained sandbox boundary crossing be common? (**Yes. Serious escape remains
   uncommon.**)
6. Should a second independent model be able to verify the first? (**Yes, with correlated-training
   caveats.**)
7. Can the player permanently halt recursion? (**They can order it; clean success depends on
   access and control debt.**)
8. Does rapid recursion automatically trigger the Deployment Crisis? (**No. It accelerates toward
   an actual candidate.**)
9. Should rivals use the same full state machine? (**Same concepts and production rules where
   practical, reduced decision surface.**)
10. Should regulatory pressure be a spendable resource? (**No. Show a prominent derived posture
    backed by the four existing government values.**)
11. Can military contracts protect the lab from immediate regulation? (**Yes, while increasing
    dependence, obligations, dual-use risk, and internal conflict.**)
12. Should the capability graph be guaranteed to look exponential? (**No. Plot honest observed
    history; successful recursion should create the curve mechanically.**)

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
