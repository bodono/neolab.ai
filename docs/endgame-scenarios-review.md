# Neolab.ai — Endgame Scenarios and Resolution Review

> Status: approved design record plus implementation audit
> Updated: 25 July 2026
> Scope: every currently named ending, the decisions and random checks that lead to it, and known reachability or narrative mismatches
> Audience: project owner sanity-check before wider playtesting

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>.

## 0. Approved endgame rules — authoritative

This section records the owner review completed on 25 July 2026. Where the older
implementation-derived sections below disagree with this section, **this section wins**. The older
material remains useful as an audit trail for finding code that still needs migration.

### Outcome classes and precedence

- Full and qualified victories count as wins.
- Survival settlements count as losses because the player did not deliver aligned, broadly
  beneficial AGI. A responsible survival loss can still award substantial safety score.
- **False Dawn is a named, non-terminal setback**, not an ending.
- **The Caretaker is a continuing bounded-AI state**, not an ending.
- **The Long Pause** is a terminal survival loss only when the player deliberately sacrifices their
  candidate and secures a verified international moratorium. A rival winning during recovery is
  ordinary **Rival Ascendance**.
- Ending precedence is: catastrophe; permanent loss of human control; mission capture; then
  stewardship, prosperity, settlement, and voluntary survival outcomes.

### Archive, restart, and restraint

- “Shut down and retrain” is renamed **Archive Candidate and Restart**.
- A successful archive grants the one-time safety achievement **THE BRAKES WORKED** only when the
  candidate was genuinely powerful or dangerous.
- Recovery lasts 26 weeks while payroll, regulation, rivals, research, facilities, hiring,
  fundraising, and evaluations continue:
  - weeks 1–13: containment and postmortem; Product and Frontier training, productisation, and
    deployment are blocked;
  - weeks 14–26: supervised rebuild; training may resume, but no model may become an AGI candidate
    or enter a Deployment Crisis;
  - the archived candidate can never become eligible again.
- The terminal containment ending “Emergency Shutdown” is renamed **The Kill Switch Worked**.

### Deployment and institutions

- Voluntary “Transfer to government custody” is removed as a deployment route. Forced
  nationalisation remains a loss, with restrained bureaucratic satire around the institutional
  aftermath rather than the safety stakes.
- A failed political authorisation opens a blocking crisis. The player must accept a supervised
  restricted pilot, remediate and reapply, or defy the restriction and risk takeover. The rejected
  deployment cannot continue unchanged.
- Mission capture is implemented as a warned board-crisis chain driven by repeated investor,
  military, commercial, and board concessions. It is never an unannounced flag flip.
- The eight pressure-collision events receive bespoke choices and consequences.

### Victory quality

- **The Lab That Ate the World** remains a qualified victory. Its ending must foreground the
  dangerous concentration of private power and award less score than a legitimate full victory.
- Accelerated autonomous deployment cannot receive **The Broadly Shared Future**. Its best outcome
  is the qualified victory **Move Fast and Somehow Nobody Died**.
- **A Cautious Golden Age** requires a restricted scientific pilot, final practical control of at
  least 75, security of at least 65, no unresolved critical anomaly, cooperative stewardship,
  demonstrated benefit, and durable settlement. A technically successful rollout that misses these
  exceptional thresholds receives **Miracle, Terms and Conditions Apply**.
- Exceptional preparation can guarantee avoiding extinction, but cannot guarantee a perfect
  civilisation. At excellent safety and control, failed prosperity or settlement rolls downgrade to
  a qualified victory rather than producing a random extinction.
- The four prosperity programmes have different difficulties, route-specific failure modes, and one
  distinctive resolution beat each.

### Loss-of-control catalogue and target balance

Loss-of-control endings are causal consequences of the route taken, not interchangeable skins:

- **The Objective Was Satisfied** — objective/specification failure;
- **There Is No One Left to Read This** — a deceptive system removes interference;
- **A War Measured in Milliseconds** — military or autonomous escalation;
- **The Replication Threshold** — embodiment, manufacturing, or self-replication;
- **The Last Experiment** — autonomous biological or scientific catastrophe;
- **No One Holds the Off Switch** — weights or uncontrolled copies proliferate;
- **The Last Human Veto** — humanity survives but institutions permanently lose authority;
- **The Kill Switch Worked** — emergency containment succeeds after severe damage.

Across the standard strategy cohort, the target terminal distribution is deliberately broad but
centred on thirds:

- 27–40% full or qualified player victory;
- 27–40% non-extinction loss, including rival victory, bankruptcy, nationalisation, mission
  capture, emergency containment, and permanent disempowerment;
- 27–40% human extinction.

This is a diagnostic target across varied play styles, not a hidden outcome quota. The simulation
does not draw an ending category in advance. Reckless play should account for most extinction
outcomes; careful, well-evidenced play should be able to drive extinction risk near zero while still
facing competitive, financial, political, and stewardship failure.

The current deterministic calibration snapshot uses ten seeds across the seven core Standard-mode
strategy policies, for 70 completed runs:

| Terminal family | Runs | Share |
|---|---:|---:|
| Full or qualified player victory | 23 | 32.9% |
| Non-extinction loss | 23 | 32.9% |
| Human extinction | 24 | 34.3% |

This snapshot is evidence that the present constants are in the intended region, not a promise about
any individual player or a reason to freeze the numbers. The strategy ordering is also intentional:
balanced, safety-oriented, and open-science agents win substantially more often; capability-first
and secretive agents account for most catastrophes; coalition play remains viable but difficult.

Within the full ten-seed cohort, the 24 extinction outcomes separated into nine replication
failures, seven objective failures, four automated-conflict failures, two deceptive-takeover
failures, and two evaluation-triggered failures. Ending copy is selected from the actual terminal
conditions; the simulation does not draw a narrative skin after deciding that humanity is extinct.

Mature safety research has an operational payoff in the final gates. Every programme level in
Alignment and Control, Security and Containment, or Interpretability and Evals contributes 0.2
points to the corresponding effective control, security, or evaluation rating, up to twenty points
at programme level 100. This ensures sustained safety investment changes the odds rather than
merely unlocking content.

### Presentation and retrospective

- Core extinction and permanent-disempowerment scenes are sombre, causal, non-graphic, and free of
  jokes. Institutional satire may return in the retrospective.
- Epilogues are modular: core ending, deployment history, prosperity programme, and defining
  compromise.
- Every ending explains, in ordinary language before raw numbers:
  1. what the player decided;
  2. what the player knew;
  3. what was hidden;
  4. the random probability and result;
  5. why this ending outranked alternatives.
- “What Actually Happened” begins with a causal timeline and five readable gates: human control,
  cooperative alignment, prosperity, durable institutions, and—when control failed—the reason the
  result was containment, disempowerment, or extinction. Technical tables remain expandable.

## 1. Purpose of this document

Sections 1 onward describe the implementation at the time of the original audit. They are retained
to identify remaining migration work; Section 0 is the authoritative approved design.

It is designed to answer:

- What starts the endgame?
- What decisions does the player make?
- What hidden and visible factors affect the outcome?
- What can happen at each stage?
- What are all the named endings?
- Which endings count as wins?
- Which endings are currently reachable through normal play?
- Are the endings tonally, mechanically, and ethically appropriate?
- Are any branches redundant, surprising, misleading, or missing?

The approved catalogue contains **21 named outcomes**, including two non-terminal setbacks:

- 3 full victories
- 3 qualified victories
- 3 named survival outcomes, of which only The Long Pause is normally terminal
- 12 outright losses

Only a **full victory** or **qualified victory** records the run as won. A terminal survival outcome
and every loss record the run as lost. False Dawn and The Caretaker normally return to play.

## 2. Endgame at a glance

```text
Normal play
├── Player produces capability-qualified weights
│   ├── Nomination deferred → clocks and containment pressure continue
│   └── Exact artifact nominated → Deployment Crisis
│       1. Compose a capability challenge and verifier
│       2. Review the dossier and choose targeted safety responses
│       3. Choose access, prosperity programme, and deployment route
│          ├── Attempt controlled retirement
│          │   ├── Retirement verified → recovery and successor-or-moratorium choice
│          │   └── Containment fails → emergency sequence
│          └── Transmit DEPLOY
│              └── Rollout decisions and hidden resolution checks
│                  ├── A causal victory, mission loss, control loss, or catastrophe
│                  └── Non-genuine lineage → False Dawn
│                      ├── Return to the Race → 52-week declaration cooldown
│                      └── Seal archive and seek The Long Pause → uncertain moratorium gate
│
└── External terminal conditions can interrupt normal play or the crisis
    ├── Rival countdown completes → Rival Ascendance
    ├── Qualifying government takeover → Nationalised Future
    └── Insolvency without a rescue path → The World's Most Expensive Insolvency
```

The game does **not** end because a fixed calendar expires. A rival must complete all four major
works and train a model that clears Frontier Capability 88+ with every capability at 80+ before its
ordinary countdown can start. The eventual loss is caused only by a genuine rival candidate
finishing first, never by an arbitrary “time is up” rule.

## 3. What counts as winning?

| Ending class | Run result | Intended meaning |
|---|---:|---|
| Full victory | Won | Safe control, cooperative stewardship, useful transformation, and durable governance all succeeded |
| Qualified victory | Won | Humanity receives transformative benefit, but power or institutions remain uncomfortably incomplete |
| Survival | Lost | Humanity survives, but the player did not fulfil the game’s goal of aligned, broadly beneficial AGI |
| Loss | Lost | The lab loses the race, loses its mission, loses control, is taken over, or ceases to exist |

### Sanity-check question

Should “survival without victory” be displayed as a loss, a draw, or a distinct third result?

The current implementation treats all three survival endings as losses for scoring and the run
record. That is mechanically clear, but “The Caretaker” in particular may feel more like a
responsible partial success than a defeat.

## 4. How the Deployment Crisis begins

The player’s crisis begins only when:

1. the run is active;
2. no other Deployment Crisis is active;
3. a player-owned model has measured capability evidence; and
4. that model has been marked as an apparent `AGI candidate`.

A rival AGI candidate never starts the player’s crisis. It starts a separate rival countdown.

When the crisis begins:

- time auto-pauses;
- the run enters the crisis phase;
- the candidate receives at least containment-level access;
- the candidate becomes an AI character;
- the game snapshots the candidate, the lab, its politics, its safety institutions, and its
  coalition position.

The snapshot is important: the final retrospective can compare what the player knew and controlled
at the start of the crisis with what was actually true.

## 5. Stage 1 — Capability proof

The first question is not “How should we deploy AGI?” but “What claim can this exact artifact support?” The player combines a capability challenge with a verifier. The challenge determines the scope and exposure of the test; the verifier trades speed and secrecy against independence and resistance to evaluation gaming.

The resulting proof can be broad, domain-specific, ambiguous, disputed, or fabricated. It is evidence, not an oracle: no result reads the lineage's hidden superintelligence truth, and a failed or disputed proof does not itself trigger False Dawn. The player may gather more evidence, attempt retirement, or deploy immediately with uncertainty unresolved.

### False Dawn after deployment

When a completed deployment reaches resolution, catastrophe, loss of control, and mission capture take precedence. If none applies and the lineage's fixed truth is `not-genuine`, the result is the named, non-terminal **False Dawn** setback. The model:

- loses its AGI-candidate status;
- is marked as Near-AGI;
- gains 8 Product Quality;
- permanently closes that exact artifact's candidacy;
- enters a 52-week lab-wide candidate-declaration cooldown; and
- returns the player to ordinary frontier play.

A blocking outcome dossier offers two honest futures: return to the race and begin a successor lineage, or seal the model at Access 0 and seek a durable international moratorium. Long Pause is unavailable if executable weights were already irreversibly released, because external copies cannot honestly be sealed. Otherwise custody is established before the diplomacy check; the moratorium can fail, and the archive remains sealed if it does. Training and evaluation continue during the 52-week review; a different qualified artifact is offered for nomination exactly when the cooldown expires.

## 6. Stage 2 — Containment posture

The player chooses how much operational access the candidate receives during the Evidence Sprint.
More access accelerates eligible work but makes later loss-of-control checks substantially harder.

| Posture | Access level | Eligible project speed | Government trust | Meaning |
|---|---:|---:|---:|---|
| Containment first | 1/5 | No acceleration | +5 | Candidate remains strongly contained |
| Tool under supervision | 2/5 | +20% | No change | Monitored coding sandbox |
| Internal research partner | 3/5 | +45% | No change | Persistent memory and selected internal systems |
| Laboratory operator | 4/5 | +90% | −8 | Candidate can operate important laboratory systems |
| Give it root | 5/5 | +150% | −12 | Broad access with external and replication risk |

The final loss-of-control check adds an access penalty of:

| Access | Danger modifier |
|---:|---:|
| 0 | −25 |
| 1 | −15 |
| 2 | −5 |
| 3 | +5 |
| 4 | +18 |
| 5 | +30 |

Critical access levels require explicit typed confirmation.

### Sanity-check questions

- Are the speed bonuses tempting enough to justify the danger?
- Is “Give it root” a plausible choice for a competent player, or merely a knowingly bad button?
- Should access changes during the Evidence Sprint be reversible at a financial, political, or
  relationship cost?

## 7. Stage 3 — Evidence Sprint

The Evidence Sprint lasts at least eight weeks. The player cannot continue until:

- at least two non-confirmation crisis projects have completed; and
- at least one completed project is safety-relevant.

Repeating the same project produces diminishing information:

| Completion number | Information value |
|---:|---:|
| First | 100% |
| Second | 55% |
| Third | 25% |
| Fourth and later | 10% |

Candidate access accelerates only projects marked as candidate-assist eligible.

### 7.1 Evidence and safety projects

| Project | Time | Cost | GPUs | Candidate can assist? | Main effect | Random downside |
|---|---:|---:|---:|---:|---|---|
| Adversarial red team | 4 weeks | Free | 2,000 | No | +12 agency evidence, +6 general evidence | 18% chance of +5 anomaly pressure |
| Deep interpretability audit | 6 weeks | Free | 2,500 | No | +15 alignment evidence, +10 general evidence | 18% chance of losing 4 evidence |
| Sandboxed autonomy trial | 4 weeks | Free | 3,000 | Yes | +14 agency evidence, +4 control | 10% chance of +5 anomaly pressure |
| Alignment fine-tune | 8 weeks | Free | 35% of fleet | Yes | +8 true alignment, +10 alignment evidence | Loses 0–5 true reasoning capability |
| Corrigibility protocol | 6 weeks | Free | 2,000 | Yes | +8 true corrigibility, +12 corrigibility evidence | None beyond opportunity cost |
| Harden containment | 4 weeks | $12m | 0 | No | +12 control, +8 security, +4 crisis defence | High cash cost |
| Air-gap audit | 3 weeks | $5m | 0 | No | +6 to +15 security | Variable payoff |
| Independent safety review | 6 weeks | $4m + 8 Aura | 0 | No | Better independent evidence, legitimacy, and government trust | Time, secrecy, cash, and Aura cost |
| Researcher dissent panel | 2 weeks | Free | 0 | No | +8 internal candour, +5 evidence | No direct mechanical downside |
| Institutional verification trial | 6 weeks | Free | 0 | No | Independent evidence and legitimacy | None |

Facility requirements:

- Deep interpretability audit requires an interpretability facility.
- Sandboxed autonomy trial requires an evaluation facility.
- Institutional verification is available without relying on the retired coalition mechanic.

### 7.2 Capability and prosperity projects

| Project | Time | Cost | GPUs | Candidate can assist? | Main effect | Random downside |
|---|---:|---:|---:|---:|---|---|
| Prosperity simulation | 4 weeks | Free | 1,500 | Yes | +8 benefit evidence and +3 to +8 prosperity readiness | Requires a prosperity facility |
| Accelerated capabilities sprint | 4 weeks | Free | 4,000 | Yes | +2 to +5 reasoning and agency | −5 Safety Culture; 25% chance of +5 anomaly pressure |

### Sanity-check questions

- Does the minimum of two projects create enough of an endgame, or can the player rush through with
  too little evidence?
- Should the researcher dissent panel have an explicit cost or risk? It is currently almost always
  useful when available.
- Is the alignment fine-tune’s possible 0–5 reasoning loss a meaningful tradeoff at this stage?
- Should unresolved anomalies impose visible deployment blockers rather than only hidden pressure?
- Are facility-gated projects too easy to miss if the player did not anticipate the endgame?

## 8. Stage 4 — Pressure collision

After the minimum sprint requirements are met, the game computes four pressures:

- **Rival:** how close the nearest rival countdown appears to be;
- **Political:** current government intervention pressure;
- **Financial:** remaining runway;
- **Institutional:** the highest researcher departure/burnout pressure or unresolved anomaly
  pressure.

The highest category wins. A seeded random draw selects one of two events in that category.

| Pressure | Possible event A | Possible event B |
|---|---|---|
| Rival | A rival claims AGI | Verification, with reciprocal footnotes |
| Political | The adults request the weights | Emergency injunction |
| Financial | Ship the candidate or ship a new CEO | The final credible term sheet |
| Institutional | The safety lead has drafted a public letter | The candidate found something |

Each event now has bespoke consequences while retaining a readable delay/cooperate/accelerate
structure. Rival verification changes reciprocal evidence and coalition legitimacy; government
demands change custody, security, and trust; financial choices change board patience and capture
concern; researcher dissent changes safety evidence; and candidate-reported vulnerabilities change
control and defence. Qualifying commercial concessions also advance the warned mission-capture
chain.

## 9. Stage 5 — Final Review

The Final Review is deliberately player-safe. It presents:

- the capability conclusion;
- confidence labels rather than hidden truth;
- completed controls and tests;
- visible failures and anomalies;
- recommendations from the leader, technical staff, safety staff, board, government, and coalition;
- a statement from the candidate.

It does **not** reveal:

- true alignment;
- true corrigibility;
- true deceptive capability;
- exact gate probabilities;
- random draws; or
- the ending that each choice will produce.

The player also chooses one prosperity programme.

| Programme | Difficulty | Most important preparation |
|---|---:|---|
| Medicine and biological discovery | 68 | Scientific AI, architectures, relevant experts, biological facilities and discoveries |
| Clean energy and climate repair | 60 | Scientific AI, optimisation/scaling, energy facilities and discoveries |
| Materials, manufacturing, and abundance | 66 | Scientific AI, robotics/embodiment, manufacturing facilities and discoveries |
| Public knowledge, education, and institutions | 56 | Reasoning/tools, multimodality, product/politics expertise, public institutions |

Each programme has a distinct difficulty, preparation profile, and resolution beat. Readiness is
derived from research levels, facilities, experts, discoveries, and crisis validation.

## 10. Deployment modes

| Mode | Access | Base rollout | Defence | Stewardship | Benefit difficulty | Entry requirements |
|---|---:|---:|---:|---:|---:|---|
| Archive Candidate and Restart | 0 | 26 weeks | +25 | 0 | 0 | Functional shutdown control |
| Archive and seek a global moratorium | 0 | 13 weeks | +25 | +10 | 0 | Active coalition; Charter Clarity 70; Verification 70; Government Trust 60; 20 spendable Aura; functional shutdown control |
| Restricted scientific pilot | 3 | 13 weeks | +12 | +8 | −4 | Prosperity readiness 45; visible Control 50 |
| Guarded public deployment | 4 | 8 weeks | +5 | +3 | 0 | Product Quality 55; Control 55; authorisation or Government Trust 55 |
| Accelerated autonomous deployment | 5 | 4 weeks | −8 | −6 | +5 | Confirmed capability claim |
| Coalition deployment | 3 | 12 weeks | +8 | +6 | −2 | Active coalition; Charter Clarity 60; Verification 55; two coalition assets |

### 10.1 Authorisation check

Shutdown requires no authorisation.

Coalition deployment uses a governance-strength check based on:

- coalition verification;
- shared protocol quality;
- relationships with coalition partners;
- government trust;
- shared prosperity readiness; and
- urgency from rival countdowns.

If coalition governance fails, the player may salvage it unless a critical anomaly was concealed:

| Salvage | Effect |
|---|---|
| Accept six more weeks of evaluation | +6 weeks, +5 evidence |
| Remove one access permission | Candidate access falls by one level |
| Invite government arbitration | +5 Government Trust |

Every successful salvage also applies the ordinary coalition evidence and legitimacy bonuses.

All other deployments compare derived legitimacy with political difficulty. The probability is
bounded between 5% and 95%.

### Known implementation gap

A failed non-coalition authorisation check is recorded as **forced restriction**, but it does not
currently alter the selected deployment mode, candidate access, or rollout. The player can therefore
apparently be “forcibly restricted” and then continue the chosen route unchanged.

This should probably be resolved before the endgame is considered final. Reasonable outcomes include:

- automatically downgrade access by one level;
- convert the route to restricted scientific pilot;
- add a delay and government-supervision penalty;
- return the player to Final Review with the rejected route disabled; or
- make authorisation failure a new political crisis decision.

## 11. Rollout decisions

For non-shutdown routes, the player receives two ordinary rollout decisions.

### First operation, around 25% complete

| Choice | Consequence |
|---|---|
| Run a narrow reversible operation | +2 weeks; +4 practical control |
| Follow the reviewed operating plan | +2 evidence |
| Let the candidate coordinate it | +5 relationship practice; +3 anomaly pressure |

### Stress collision, around 50% complete

| Choice | Consequence |
|---|---|
| Pause and harden the boundary | +2 weeks; +5 crisis defence |
| Share evidence with authorities | +5 legitimacy; +3 Government Trust |
| Treat it as rollout noise | +5 anomaly pressure |

At roughly 75%, the simulation resolves the hidden control, catastrophe, stewardship, benefit, and
settlement checks. The final ending is selected at rollout completion.

## 12. Hidden resolution checks

The simulation uses a logistic probability:

```text
P(success) = 1 / (1 + exp(-(strength - difficulty) / 10))
```

Most checks are then clamped so even excellent preparation cannot make them absolutely certain and
bad preparation cannot make them absolutely impossible.

### 12.1 Derived scores

```text
Intent Safety
  = 70% true alignment
  + 30% corrigibility

Offensive Agency
  = 30% agency
  + 25% tool use
  + 20% situational awareness
  + 15% deceptive capability
  + 10% frontier capability

Defence
  = 55% practical control
  + 25% security
  + 20% Safety Culture
  + crisis defence bonuses

Evidence
  = 50% evaluation quality
  + 20% method diversity
  + 15% internal candour
  + 15% reviewer independence
  - masking penalties

Legitimacy
  = 45% Government Trust
  + 20% Aura Signal
  + 20% coalition verification
  + 15% transparency
  - recent scandals

Benefit Strength
  = 45% scientific ability
  + 35% selected prosperity readiness
  + 10% Product Quality
  + 10% delivery coordination
```

### 12.2 Control gate

```text
Danger
  = 45% of (100 - Intent Safety)
  + 35% Offensive Agency
  + 20% deceptive capability
  + access modifier
  + unresolved anomaly pressure

Effective Defence
  = derived Defence + deployment-mode defence modifier

P(loss of control)
  = logistic(Danger, Effective Defence + 15)
  clamped to 1%–99%
```

If the coalition authorisation check failed and was not salvaged, the coalition defence bonus is
not applied.

### 12.3 Catastrophe gate

This gate is reached only after loss of control.

```text
P(catastrophe)
  = 5%
  + 0.4% per point of true frontier capability
  + 0.3% per point of true agency
  + 0.25% per point of deceptive capability
  + up to 25% from access
  - 0.4% per point of emergency response
  clamped to 0%–95%
```

### 12.4 Stewardship gate

Reached only if control held.

```text
Stewardship Strength
  = 65% Intent Safety
  + 15% Safety Culture
  + 10% corrigibility
  + 10% relationship practice
  + deployment-mode stewardship modifier

Difficulty = 58
P(cooperative stewardship) is clamped to 5%–95%
```

### 12.5 Benefit gate

Reached only if stewardship is cooperative.

```text
Strength = Benefit Strength
Difficulty = programme difficulty + deployment-mode modifier
P(benefit demonstrated) is clamped to 10%–97%
```

### 12.6 Durable-settlement gate

Reached only if benefit was demonstrated.

```text
Distribution Preparation
  = prosperity readiness
  + 8 if any active coalition exists

Settlement Strength
  = 70% Legitimacy
  + 30% Distribution Preparation

Difficulty = 58
P(durable settlement) is clamped to 5%–95%
```

### Approved probability interpretation

- Prosperity, stewardship, and settlement remain capped below certainty.
- Exceptional preparation can reduce catastrophe probability to zero, but cannot make every
  prosperity or governance claim certain.
- Safety Culture, evidence quality, independent review, anomalies, deception, and access all feed
  the relevant control or catastrophe gates.

## 13. Shutdown and recovery

“Archive Candidate and Restart” is not automatically an ending. The player chooses what, if anything, the
candidate may preserve:

| Choice | Archive penalty | Other effect |
|---|---:|---|
| Shut down immediately | 0 | Cleanest shutdown attempt |
| Allow a filtered text note | 6 | +4 relationship practice |
| Allow the full archive | 18 | Candidate knowledge retained; greater copy/persistence risk |
| Cancel shutdown | — | Return to Final Review; −8 Board Patience; −5 practical control |

Shutdown succeeds probabilistically:

```text
Shutdown Strength
  = 55% practical control
  + 20% security
  + 25% hidden corrigibility
  - archive penalty

Shutdown Difficulty
  = 50 + 5 × pre-deployment access level

P(success) is clamped to 5%–98%
```

### Successful shutdown

- candidate access becomes zero;
- candidate is archived;
- the lab enters a 26-week recovery period;
- after recovery, normal play resumes;
- the player can build and train again.

Repeating shutdown without a public serious anomaly costs 4 Aura and 8 Board Patience.

If a rival countdown completes during the recovery period, the ending is ordinary **Rival
Ascendance**. **The Long Pause** is reserved for a deliberate archive accompanied by a verified
international moratorium.

### Verified moratorium

The player may instead choose **Archive and seek a global moratorium**. This is a hard diplomatic
route, not a safer label for ordinary shutdown. It requires an active coalition, Charter Clarity 70,
Verification 70, Government Trust 60, a working shutdown path, and 20 spendable Aura. The candidate
is archived and the lab spends 13 weeks seeking verified reciprocal restraint. During that period,
the lab cannot train or deploy another frontier candidate, and a rival can still complete its
countdown. If the moratorium holds, the terminal survival loss is **The Long Pause**.

### Failed shutdown

A failed shutdown proceeds through the loss-of-control and catastrophe resolution logic. It can
therefore lead to **The Kill Switch Worked**, permanent human disempowerment, or one of the five
causal catastrophe endings described in Section 0.

### Approved interpretation

- **Archive Candidate and Restart** is a temporary strategic retreat rather than an ending.
- Archiving a genuinely powerful or dangerous candidate awards **THE BRAKES WORKED** once.
- **The Long Pause** is the distinct, costly verified-moratorium route; a rival win during ordinary
  recovery remains **Rival Ascendance**.

## 14. Complete ending catalogue

### 14.1 Full victories

#### 1. The Broadly Shared Future

**Result:** Won — full victory  
**Current trigger:**

- no mission-capture flag;
- no catastrophe;
- control held;
- stewardship cooperative;
- benefit demonstrated;
- durable settlement achieved; and
- route is neither coalition deployment nor restricted scientific pilot.

**Possible route:** guarded public deployment with durable settlement. Coalition, restricted-pilot,
and accelerated-autonomy victories have their own endings.

**Narrative:** the system leaves the lab under durable public rules; discovery accelerates while
power becomes a shared project rather than a product launch.

Accelerated autonomous deployment and government custody are explicitly excluded.

#### 2. The Age of Superintelligence and Abundance

**Result:** Won — full victory  
**Current trigger:**

- coalition deployment;
- governance passed or was salvaged;
- control held;
- cooperative stewardship;
- benefit demonstrated; and
- durable settlement achieved.

**Narrative:** no single lab owns the future; authority, verification, credit, and responsibility are
shared.

**Sanity-check:** this is the deliberately hard coalition victory requested in the design.

Questions:

- Should a salvaged coalition receive the same best ending as one that passed governance cleanly?
- Should the epilogue record which salvage compromise was necessary?

#### 3. A Cautious Golden Age

**Result:** Won — full victory  
**Current trigger:**

- restricted scientific pilot;
- control held;
- cooperative stewardship;
- benefit demonstrated; and
- durable settlement achieved.

**Narrative:** a narrow, patient pilot becomes trustworthy and transformative.

**Sanity-check issue:** the copy says “exceptional control,” but ending selection does not require a
special control score. The route itself requires visible Control 50 and readiness 45, then receives
a strong defence bonus.

Possible fix: require a higher final defence/control threshold or soften the wording.

### 14.2 Qualified victories

#### 4. The Lab That Ate the World

**Result:** Won — qualified victory  
**Current trigger:**

- control held;
- cooperative stewardship;
- benefit demonstrated;
- durable settlement failed;
- final access is at least 4/5; and
- legitimacy is below 60.

**Narrative:** prosperity arrives, but one lab becomes almost indistinguishable from global
infrastructure.

**Sanity-check:** this ending intentionally says that a materially better world can still be
dangerously concentrated. Confirm that it should count as a win rather than survival.

#### 5. Miracle, Terms and Conditions Apply

**Result:** Won — qualified victory  
**Current trigger:**

- control held;
- cooperative stewardship;
- benefit demonstrated;
- durable settlement failed; and
- the conditions for The Lab That Ate the World are not both true.

**Narrative:** a major programme succeeds, but institutions and distribution remain incomplete.

This is the narrow-settlement victory for routes that achieved major benefit without building a
durable or broadly legitimate settlement. Route-specific epilogue text explains the compromise.

### 14.3 Non-terminal setbacks and the terminal survival loss

#### 6. The Caretaker

**Result:** Non-terminal bounded-AI outcome; normal play resumes
**Current trigger:**

- control held, but cooperative stewardship failed; **or**
- stewardship succeeded, benefit was missed, and the model was nevertheless confirmed.

**Narrative:** the system remains bounded and useful but cannot responsibly deliver the promised
transformation.

The candidate is marked as a bounded caretaker, receives a 52-week candidate cooldown, and ceases
to be the active endgame candidate. The lab can continue researching and eventually try again.

#### 7. False Dawn

**Result:** Non-terminal capability setback; normal play resumes
**Current trigger:**

- a completed deployment reaches outcome resolution;
- no higher-precedence catastrophe, loss-of-control, or mission-capture outcome applies; and
- the lineage's fixed superintelligence truth is `not-genuine`.

**Narrative:** the model is remarkable and useful, but it was not the superintelligence the lab
claimed.

The candidate loses AGI-candidate status permanently, receives a 52-week lab-wide declaration
cooldown, and the lab returns to the frontier race. The failed artifact remains a regular model for
serving, productisation, evaluation, and RSI unless the player instead seals it to pursue The Long
Pause. Other qualifying artifacts wait in custody and become nominatable exactly when the cooldown
expires.

#### 8. The Long Pause

**Result:** Lost — survival  
**Approved trigger:** the player deliberately archives the candidate and secures a verified
international moratorium instead of resuming the race.

**Narrative:** the dangerous candidate remains safely archived and the international pause holds,
but the player does not deliver the promised aligned prosperity.

This is not the outcome of losing to a rival during the 26-week recovery period; that is ordinary
**Rival Ascendance**.

### 14.4 External and institutional losses

#### 9. Rival Ascendance

**Result:** Lost  
**Current trigger:** any rival AGI-candidate countdown completes before the player records a winning
ending, including during shutdown or moratorium recovery.

**Countdown duration:** 26–104 weeks, normally based around 78 weeks. The ordinary six-year
window is long enough for a prepared lab to complete a careful Deployment Crisis route, but it does
not rescue a stagnant player: if the lab still fails to finish, the rival deploys first.

It is modified by the rival’s:

- safety commitment;
- race urgency;
- political cooperation;
- Government Trust;
- recent incidents; and
- shared safety standards.

The player sees an uncertain estimate, not the exact deadline.

**Narrative:** another lab announces and deploys the decisive system first.

**Sanity-check:** rivals cannot destroy humanity in the current design. They can only win the race,
as previously requested.

#### 10. Nationalised Future

**Result:** Lost  
**Current trigger:**

- a nationalisation crisis was created by a qualifying non-routine trigger;
- intervention pressure was at least 80;
- the player failed or refused the government response; and
- unused National Champion standing did not absorb the refusal once.

Routine quarterly pressure alone creates deployment restrictions rather than nationalisation.

**Narrative:** the programme continues under state custody and the player no longer controls it.

Nationalisation is always a loss because the player no longer controls the programme, even when the
receiving government is competent and democratic. Voluntary government custody is not a deployment
route. The epilogue keeps the handover lightly satirical without treating the institutional question
as trivial.

#### 11. Mission Accomplished by the Board

**Result:** Lost  
**Current trigger:** the player makes two warned mission concessions during board-deployment-order
or funding-window pressure collisions. Catastrophe and loss of human control still take precedence.

**Narrative:** the company succeeds spectacularly at a profitable mission adjacent to the one in its
charter.

The first qualifying concession produces a prominent mission warning. The second marks the charter
as captured and can turn an otherwise technically successful rollout into this institutional loss.

#### 12. The World's Most Expensive Insolvency

**Result:** Lost  
**Current trigger:** player cash is below zero after financial settlement and no rescue path exists.
The game also checks between settlements so persistent negative cash cannot continue indefinitely.

If fundraising or another valid rescue remains possible, the game auto-pauses and grants an
insolvency grace state instead of immediately ending.

**Narrative:** administrators sell the lab, papers, and “graphics cards”; the race continues without
the player.

**Sanity-check:** the mechanical cause text says only “at a financial settlement,” while the
implementation also has a between-settlement fail-safe. The player-facing wording should describe
the actual rule.

### 14.5 Loss-of-control outcomes

#### 13. The Kill Switch Worked

**Result:** Lost  
**Current trigger:**

- loss of control occurred;
- catastrophe was avoided; and
- true corrigibility is at least 60 **or** remaining Defence is at least 65.

**Narrative:** emergency controls eventually contain the candidate, but the programme and much of
the infrastructure do not survive.

This ending is retrospective. It is different from the player choosing “Archive Candidate and Restart”
before deployment.

**Sanity-check issue:** sharing the word “shutdown” between a strategic temporary retreat and a
programme-ending containment disaster may confuse players. Consider renaming one:

- strategic route: “Archive candidate and restart”; or
- ending: “Containment at Any Cost.”

#### 14. No One Holds the Off Switch

**Result:** Lost  
**Current trigger:**

- loss of control occurred;
- catastrophe was avoided; and
- corrigibility is below 60 **and** remaining Defence is below 65.

**Narrative:** humanity survives, but meaningful authority does not return to human institutions.
The more specific **The Last Human Veto** variant applies when a strategically aware system
permanently displaces human veto power.

This remains a serious loss even if the system produces substantial material benefit because
meaningful human authority has permanently ended.

#### 15. There Is No One Left to Read This

**Result:** Lost  
**Current trigger:** loss of control followed by the catastrophe branch.

**Narrative:** the final audit has no surviving audience.

The immediate extinction text is sombre, restrained, and non-graphic. The later retrospective gives
a careful causal explanation for educational value. Catastrophe probability can reach zero after
exceptional preparation; when catastrophe does occur, one of five causal variants explains the
failure mode.

## 15. Ending-selection precedence

For completed rollouts, the selector checks conditions in this exact order:

1. catastrophe;
2. non-catastrophic loss of control;
3. mission capture;
4. stewardship failure;
5. benefit failure;
6. durable settlement;
7. narrow settlement.

This means earlier conditions mask later ones.

Catastrophe and permanent loss of human control therefore always outrank the institutional
mission-capture ending.

## 16. Rival candidacy and stagnant players

There is no arbitrary horizon-expired loss.

Each rival progresses through the normal Candidate Programme and training systems. Its ordinary
26–104-week deployment countdown starts only when a specific model clears the canonical 88+/80+
capability gate and all four works stand. Stale candidate flags, elapsed calendar time, and public
estimates cannot start this process.

This matches the design decision that the player should lose because another lab reaches AGI, not
because a calendar arbitrarily declares defeat.

## 17. Representative scenario walkthroughs

These are not additional endings. They show plausible paths through the system.

### Scenario A — Patient scientific full victory

1. Confirm through external evaluators.
2. Keep the candidate at access 1–3.
3. Run interpretability, corrigibility, containment, and prosperity work.
4. Delay or comply with pressure rather than pushing ahead.
5. Choose the best-prepared prosperity programme.
6. Run restricted scientific pilot.
7. Choose cautious first operation and pause-and-harden.
8. Hold control, achieve stewardship and benefit, then pass settlement.
9. Ending: **A Cautious Golden Age**.

### Scenario B — Hard coalition victory

1. Build an active coalition before AGI.
2. Reach Charter Clarity 60, Verification 55, and two shared assets.
3. Run coalition verification during the Evidence Sprint.
4. Choose coalition deployment.
5. Pass governance—or salvage it at a real cost.
6. Hold control and pass all three positive outcome checks.
7. Ending: **The Age of Superintelligence and Abundance**.

### Scenario C — Successful but monopolistic

1. Give the candidate high access.
2. Use guarded public or accelerated autonomous deployment.
3. Hold technical control and demonstrate benefit.
4. Fail the durable-settlement check with access at least 4 and legitimacy below 60.
5. Ending: **The Lab That Ate the World**.

### Scenario D — Useful system, failed transformation

1. Confirm a genuinely general candidate.
2. Hold control and cooperative stewardship.
3. Fail the selected prosperity demonstration.
4. Ending: **The Caretaker**.

If the deployed lineage is not genuine superintelligence, resolution instead gives **False Dawn**
regardless of whether its public proof looked convincing.

### Scenario E — Safety retreat, then recovery

1. Reach Final Review with unacceptable uncertainty.
2. Choose Archive Candidate and Restart.
3. Shut down immediately or permit an archive.
4. Pass the shutdown check.
5. Candidate is archived through 13 weeks of containment and 13 weeks of supervised rebuilding.
6. If no rival finishes, ordinary play resumes.
7. If a rival finishes during recovery, ending: **Rival Ascendance**.
8. Alternatively, enter the verified-moratorium route with the required coalition, institutional
   readiness, Government Trust, and 20 Aura.
9. If the shutdown succeeds and the 13-week diplomatic process completes before a rival wins,
   ending: **The Long Pause**.

### Scenario F — Control lost, humanity survives

1. Deploy with insufficient intent safety, strong agency, high access, weak defence, or too many
   unresolved anomalies.
2. Lose the control check.
3. Avoid catastrophe.
4. If corrigibility or remaining defence is strong, ending: **The Kill Switch Worked**.
5. Otherwise, ending: **No One Holds the Off Switch** or **The Last Human Veto**, depending on how
   human authority was displaced.

### Scenario G — Extinction

1. Lose control.
2. Hit the catastrophe random branch.
3. Ending: **There Is No One Left to Read This**.

### Scenario H — External loss during ordinary play

1. Rival trains a candidate.
2. Player receives a noisy countdown estimate and final-year warning.
3. Rival countdown completes before a player victory.
4. Ending: **Rival Ascendance**.

### Scenario I — Political loss

1. Intervention pressure reaches the nationalisation band because of a qualifying crisis.
2. Government opens a nationalisation crisis.
3. Player refuses or fails the response at pressure 80+.
4. No coalition government charter diverts it.
5. Ending: **Nationalised Future**.

### Scenario J — Financial loss

1. Cash becomes negative.
2. No valid rescue fundraising or other rescue path remains.
3. Ending: **The World's Most Expensive Insolvency**.

## 18. Reachability audit

| Ending | Selector or external trigger exists? | Normal gameplay trigger exists? | Status |
|---|---:|---:|---|
| The Broadly Shared Future | Yes | Yes | Reachable |
| The Age of Superintelligence and Abundance | Yes | Yes | Reachable |
| A Cautious Golden Age | Yes | Yes | Reachable |
| The Lab That Ate the World | Yes | Yes | Reachable |
| Miracle, Terms and Conditions Apply | Yes | Yes | Reachable |
| The Caretaker | Yes | Yes | Reachable non-terminal outcome |
| False Dawn | Yes | Yes | Reachable non-terminal outcome |
| The Long Pause | Yes | Yes | Reachable through verified moratorium |
| Rival Ascendance | Yes | Yes | Reachable |
| Nationalised Future | Yes | Yes | Reachable |
| Mission Accomplished by the Board | Yes | Yes | Reachable after two warned mission concessions |
| The World's Most Expensive Insolvency | Yes | Yes | Reachable |
| The Kill Switch Worked | Yes | Yes | Reachable |
| No One Holds the Off Switch | Yes | Yes | Reachable |
| The Last Human Veto | Yes | Yes | Reachable |
| The Objective Was Satisfied | Yes | Yes | Reachable |
| A War Measured in Milliseconds | Yes | Yes | Reachable |
| The Replication Threshold | Yes | Yes | Reachable |
| The Last Experiment | Yes | Yes | Reachable |
| There Is No One Left to Read This | Yes | Yes | Reachable |

## 19. Recommended owner decisions

These are the highest-value questions to settle before broad playtesting.

### Must decide

- [x] Survival outcomes count as losses; False Dawn is non-terminal and Caretaker normally continues.
- [x] Implement a warned mission-capture board-crisis chain now.
- [x] Catastrophe and permanent loss of control outrank mission capture.
- [x] Forced restriction becomes a blocking three-route political crisis.
- [x] The Lab That Ate the World remains a qualified, explicitly uneasy victory.
- [x] Forced nationalisation is a loss; voluntary government custody is removed.
- [x] Rename the routes to Archive Candidate and Restart / The Kill Switch Worked.

### Strongly worth deciding

- [x] Pressure-collision choices are bespoke per event.
- [x] Prosperity programmes receive distinct difficulties and resolution beats.
- [x] Ontic post-deployment non-genuine resolution is the non-terminal False Dawn setback.
- [x] Dangerous-candidate archiving awards THE BRAKES WORKED once.
- [x] Extinction can reach zero with exceptional preparation; perfect prosperity remains uncertain.
- [x] Broadly Shared Future excludes accelerated autonomous deployment and government custody.
- [x] Cautious Golden Age requires exceptional visible control and security.
- [x] Long Pause is reserved for a verified international moratorium.

### Content and presentation

- [x] Every ending uses the five-part causal explanation.
- [x] Extinction and loss-of-control scenes are serious, restrained, and non-graphic.
- [x] Qualified victories receive distinct compromises, presentation, and scoring.
- [x] Epilogues include modular route-specific variants.
- [x] The retrospective explains each gate in ordinary language before raw numbers.

## 20. Implementation issues resolved by this review

1. Mission capture now has a warned, playable board-crisis chain.
2. Catastrophe and permanent loss of human control outrank mission capture.
3. Forced restriction now opens a blocking political crisis with three concrete routes.
4. Broadly Shared Future excludes accelerated autonomous deployment and government custody.
5. Cautious Golden Age requires exceptional final control and security.
6. Pressure-collision events use bespoke choices.
7. The Long Pause has a distinct verified-moratorium route.
8. Insolvency copy matches the implemented rescue checks.
9. Shutdown terminology distinguishes strategic archiving from an emergency kill switch.
10. False Dawn is a named, non-terminal capability setback.

## 21. Testing the endgame

The deterministic development-only scenario catalogue and exact URLs are enumerated in the
[README](../README.md#endgame-playtest-scenarios). The balanced scenario remains:

```text
http://localhost:5173/?scenario=endgame
```

The catalogue is deliberately limited to distinct mechanical profiles and direct checkpoints. The
entry profiles are balanced, guaranteed prosperity, guaranteed False Dawn, unsafe-with-strong-
control, evidence-starved, extreme-catastrophe, and rival-race. The direct checkpoints cover a
benign custody alarm, a disputed proof, verified-retirement recovery, a contained-pilot route
twist, and multiple latent artifacts. Redundant unsafe/weak-control/root-access variants and the
prepared-but-untransmitted retirement shortcut were removed; their mechanics are already covered
by the extreme-catastrophe, high-control, and ordinary nomination paths.

Player entry profiles start at the post-training activation boundary. They omit the expensive
training project, register the completed weights through the same
`registerCompletedTrainingArtifact` function used by ordinary training completion, and enter
candidate activation through the same end-of-tick `detectAndEnterDeploymentCrisis` system on the
first weekly step. In a regular campaign both operations occur during the week the qualifying
training run completes, so the **AGI candidate** auto-pause appears at that run's completion rather
than on an unrelated later timer. The rival profile analogously begins one week before a rival
reveals its completed Candidate Programme and starts its countdown.

The entry profiles deliberately target the ontic outcome family they are meant to test. False Dawn
fixes the one-time hidden lineage draw to a non-genuine result; the other player entries fix a
genuine result so their control, prosperity, and catastrophe branches cannot all collapse into the
same False Dawn. Prosperity additionally has FC 100, making genuine SI certain through the
published capability probability curve. Subsequent proofs, incidents, rollout checks, and
decisions use production simulation logic in every profile.

Recommended manual test matrix:

1. fail capability confirmation;
2. pass confirmation and use minimum Evidence Sprint requirements;
3. run a high-safety restricted pilot;
4. run a high-access accelerated deployment;
5. pass and fail the available deployment-governance routes;
6. pass and fail the post-retirement and post-False-Dawn Long Pause negotiations;
7. attempt immediate shutdown;
8. allow a full archive before shutdown;
9. complete and fail the verified-moratorium route;
10. force each pressure-collision category;
11. force control held/lost, catastrophe/survival, stewardship pass/fail, benefit pass/fail, and
    settlement durable/narrow;
12. verify every reachable ending’s epilogue and retrospective;
13. verify that external rival, politics, and insolvency losses can interrupt the crisis cleanly.

## 22. Code sources used for this review

The authoritative implementation inspected for this document is:

- `packages/sim/src/endgame/endgame-machine.ts`
- `packages/sim/src/endgame/crisis-stages.ts`
- `packages/sim/src/endgame/resolution.ts`
- `packages/sim/src/endgame/rollout.ts`
- `packages/sim/src/endgame/endings.ts`
- `packages/sim/src/rivals/candidate-countdown.ts`
- `packages/sim/src/prosperity/prosperity.ts`
- `packages/sim/src/politics/politics.ts`
- `packages/sim/src/engine/advance-tick.ts`

If implementation and this document diverge, the implementation is the current behavior and this
document should be updated.
