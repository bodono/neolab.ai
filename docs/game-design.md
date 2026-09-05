# Neolab.ai — Game Design Document

> Status: Living design document, version 0.7<br>
> Phase: Pre-production / concept design<br>
> Current target: A desktop-first browser strategy game lasting roughly 90–120 minutes

## Document map

- **Part I — Experience and direction:** sections 1–27 define the premise, tone, resources, broad systems, interface, art, technology, and production scope.
- **Part II — Implementation rules:** sections 28–49 define the normative simulation and acceptance criteria.
  - [28–31: terminology, setup, time, and state](#28-rules-terminology-and-design-contract)
  - [32–34: compute, economy, and research](#32-compute-allocation-and-capacity)
  - [35–36: models and safety](#35-model-training-evaluation-and-deployment)
  - [37–41: people, facilities, politics, rivals, losses, and victory](#37-researchers-staffing-and-facilities)
  - [42–43: randomness and events](#42-randomness-and-probability-contract)
  - [44: complete Deployment Crisis](#44-the-deployment-crisis-endgame)
  - [45–46: example events and content targets](#45-example-event-catalogue)
  - [47: how to play](#47-how-to-play)
  - [48–49: balance and implementation acceptance](#48-balance-plan-and-quantitative-targets)

## 1. High concept

**Neolab.ai** is a pausable real-time strategy and resource-management game about running a frontier AI laboratory in an alternate, compressed history of modern AI.

The player must build better models, earn revenue, recruit famous researchers, publish landmark papers, manage governments and investors, and stay ahead of rival laboratories. Capabilities research creates enormous commercial and strategic advantages, but increasingly capable systems also create risks that cannot be measured perfectly. Safety work consumes the same scarce compute, money, time, and talent needed to win the race.

The ideal victory is not merely reaching AGI first. The player must create an aligned, safe AGI and use it successfully enough to begin an era of broad prosperity.

The game should be funny—especially to people familiar with AI research and industry culture—without treating its central tradeoffs as a joke. Its tone is a **credible simulation with dry, slightly absurd satire**.

## 2. Player fantasy

The player is the effective leader of a frontier AI lab. They make decisions at the level of a founder, CEO, or research director rather than controlling individual researchers minute by minute.

The fantasy has four parts:

1. **Build the lab:** Turn a precarious research organisation into the world's leading AI institution.
2. **Shape AI history:** Be first to discoveries based on real, influential AI papers.
3. **Survive the race:** Balance commercial pressure, research ambition, safety, politics, and rivals.
4. **Face the thing you built:** During the endgame, the lab's AI becomes a character with requests, advice, apparent preferences, and uncertain motives.

## 3. Design pillars

### 3.1 Every resource has a tempting alternative use

Compute can train new models, run safety evaluations, or serve paying customers. Researchers can improve products, pursue uncertain research, conduct safety work, or advise government. Aura can attract exceptional people, secure funding, influence politics, or repair public trust after an incident.

There should rarely be a choice that is simply correct in all circumstances.

### 3.2 Safety is important but not perfectly measurable

The player should never know a precise amount of safety research that is “enough.” They receive warning signs, audit results, incidents, researcher opinions, and uncertain estimates. Better safety institutions make this evidence more informative, but never omniscient.

### 3.3 Real AI history is playable and educational

Important discoveries are based on real papers. Each discovery teaches the player what the work introduced, why it mattered, and what it enabled. The game uses a counterfactual timeline, but must clearly distinguish the game's discovery date from the real publication date.

### 3.4 The race creates pressure without dictating the answer

Rivals are a credible and visible threat. They can recruit talent, win papers, dominate markets, and reach AGI before the player. However, the game should let the player pursue several viable strategies rather than forcing maximum-risk acceleration every time.

### 3.5 Satire rewards insider knowledge without excluding newcomers

AI researchers should notice jokes about benchmarks, scaling graphs, eval contamination, conference culture, GPU shortages, safety arguments, product demos, corporate governance, and suspiciously round fundraising valuations. Newcomers should still understand the underlying situation from context.

## 4. Setting and timeline

The game begins in **2012** in an alternate world where many foundational AI discoveries have not yet occurred. The subsequent history is compressed into a single 90–120 minute playthrough.

Research follows **conceptual prerequisites**, not real-world publication dates. Discoveries should occur in a broadly credible intellectual order even when their game dates differ radically from history.

Example chains include:

- Backpropagation → AlexNet-style vision systems → very deep networks → residual networks
- Backpropagation → word embeddings and recurrent networks → sequence-to-sequence learning → attention → Transformers → GPT/BERT-style models
- Deep neural networks + reinforcement learning → DQN → AlphaGo-style systems
- Representation learning + generative modelling → increasingly capable image, audio, and multimodal systems
- Protein representation and structure research → AlphaFold-style biological modelling

Some discoveries can have alternative prerequisites or rare “moonshot” routes. A player might reach an idea unusually early through exceptional talent and heavy investment, but should not produce a Transformer before learning any method for training neural networks.

### 4.1 Discovery cards

Every real-paper discovery card should contain:

- Paper title
- Authors
- Real publication year
- Game discovery date and discovering lab
- A short, accurate explanation of the central contribution
- Why the paper was influential
- Technologies or research directions it unlocks
- A link to the original paper or an authoritative source
- Optional short historical note where priority or attribution is complicated

Historical accuracy must be reviewed carefully. Ideas such as backpropagation developed across multiple pieces of work and should not be falsely presented as one uncontested moment of invention.

## 5. Tone and presentation

The default voice is informed, understated, and absurd in the way real institutional life can be absurd. The game can make jokes about people, incentives, and organisational behaviour while treating extinction risk, misuse, labour displacement, whistleblowing, and political conflict with appropriate weight.

Suggested tonal rule:

> The interface may be funny about the meeting. It should not be glib about the catastrophe.

Humour should appear through:

- Event writing and choice text
- Researcher traits and rival-lab behaviour
- Product names and benchmark results
- Board, investor, and government demands
- Tooltips and achievement names
- The contrast between world-changing stakes and banal organisational problems

Inside jokes should have a surface-level interpretation so they do not block comprehension.

## 6. Game structure and pacing

### 6.1 Proposed format

The format is **pausable real time** with Pause, 1×, 2×, and 4× speeds. Major events and important discoveries auto-pause by default. The player can inspect and queue allocations while paused; changes take effect on the next weekly tick.

Clock speeds remain balance constants to test, but the game is designed around simultaneous pressures rather than a turn-based action economy.

### 6.2 Intended arc

1. **Scrappy lab:** Scarce money, limited compute, early recruitment, fragile research bets.
2. **Commercialisation:** The lab begins serving models and must choose between revenue and reinvestment.
3. **Frontier competition:** Rivalry, paper races, talent poaching, scaling, lobbying, and safety institutions become important.
4. **Acceleration:** Models help with research; progress speeds up; signals become harder to interpret.
5. **Deployment crisis:** A short, climactic endgame forces decisions under time pressure and uncertainty.

The target breakdown for a two-hour run is approximately:

- Early game: 20–25 minutes
- Midgame: 40–50 minutes
- Late-game acceleration: 20–30 minutes
- Deployment crisis: 15–25 minutes

## 7. Core gameplay loop

1. Allocate compute between model serving, capabilities research, safety work, and evaluations.
2. Assign researchers and choose research domains.
3. Earn money from customers and funding rounds.
4. Improve model capability and unlock new products, demand, and research possibilities.
5. Observe noisy evidence about safety, security, morale, government attention, and rivals.
6. Respond to events and make institutional choices.
7. Spend or commit money and aura to expand compute, recruit talent, lobby, fundraise, and recover from setbacks.
8. Race for major discoveries while preparing the organisation for increasingly capable systems.

This loop accelerates as AI begins contributing to AI research.

## 8. Core resources and state

### 8.1 Money

Money pays for:

- Compute purchases or leases
- Researcher compensation
- Facilities and security
- Product infrastructure
- Safety and evaluation programmes
- Lobbying, legal work, and public relations
- Emergency responses

Revenue comes from serving models, enterprise contracts, government contracts, licensing, and fundraising. The player must manage both cash balance and burn rate. Reaching zero cash without a credible rescue causes bankruptcy.

The persistent finance display shows four distinct values:

- **Current balance:** Cash presently available
- **Monthly income:** Model serving, contracts, licensing, grants, and other incoming cash
- **Monthly outgoings:** Salaries, compute, facilities, power, security, lobbying, and other recurring costs
- **Net cashflow:** Income minus outgoings, used to estimate runway

Fundraising is an explicit player action rather than an automatic cash injection. Funding options appear as buttons and may include venture rounds, government compute grants, enterprise prepayments, strategic partnerships, and debt. Each converts some Aura into capital and adds different obligations such as board pressure, reserved inference capacity, government access, interest, or research restrictions. Funding sources have cooldowns or can be used only once per stage of the game.

### 8.2 Compute

Compute is the central allocation resource. Capacity is divided continuously among:

- Customer inference
- Capabilities experiments
- Training frontier models
- Safety and interpretability research
- Evaluations and red-teaming
- AI-assisted research during the late game

Compute may have different generations or efficiency levels so that old hardware remains useful for inference but becomes less competitive for frontier training.

Compute allocation should be granular and hierarchical rather than limited to three strategy presets:

1. A top-level slider divides the available physical GPU fleet between customer serving and R&D; it shows both the percentage and GPUs/week.
2. A second slider divides R&D capacity between capabilities and safety.
3. A third slider divides safety capacity between evaluations and alignment/control research.
4. Within those budgets, the player uses programme weights or discrete project choices to direct particular research domains.

The interface shows the exact compute allocation and immediate estimated effects on revenue and research throughput. It does **not** show the exact effect on true alignment or catastrophic risk. This preserves precise resource control without turning safety into a solved percentage threshold.

Compute acquisition is also a discrete action. The player can buy hardware, lease a cloud cluster, reserve a future delivery, expand a data center, or accept subsidised government compute. Buttons show the purchase price, delivery delay, added operating cost, and capacity gained before confirmation.

### 8.3 Researchers

Researchers are named special characters based on real people rather than generic worker units. Each has expertise, traits, salary expectations, relationships, values, and preferences.

Researchers can affect:

- Particular research domains
- Research quality or experiment cost
- Safety and evaluation effectiveness
- Recruitment of other researchers
- Aura and fundraising
- Productisation
- Government relationships
- Organisational morale or conflict

The strongest researchers should not be unambiguously best. A brilliant hire might command exceptional compensation, need scarce compute, insist on publication or review rights, require a specialised facility, prefer a narrow research programme, or be a poor fit for the lab's current strategy. These are fictional institutional tradeoffs, not claims about a real person's temperament or private conduct.

Only a rotating subset of researchers is available. Rivals can hire or poach them. Researchers may resign over strategy, governance, safety, compensation, or leadership decisions.

### 8.3.1 Star-researcher slots

Named researchers occupy a small number of **star-researcher slots**. The lab begins with approximately three unlocked slots. Headquarters upgrades and specialised facilities unlock more, with a hard maximum of eight. A successful run will typically end with five to eight active stars.

The slot limit keeps every named hire important and prevents the game from turning into roster administration. Ordinary research teams, engineers, commercial staff, and support staff are hired as aggregate cohorts; the named stars lead and modify those teams.

The persistent UI shows:

- Every unlocked slot
- A pixel portrait, name, specialities, and current assignment for each active researcher
- Vacant slots with a recruitment action
- Locked slots and the facility or upgrade required to unlock them
- Current occupied and maximum slot counts

The talent market presents a rotating selection from the larger roster of several dozen real-person characters. Recruitment costs salary, signing money, and usually Aura. Researchers may require promises concerning research direction, publication, safety, compute access, or governance.

The player can remove a researcher at any time, subject to confirmation. Removal may incur severance, morale damage, lost Aura, relationship consequences, or a risk that the researcher joins a rival. A researcher can also resign or be poached, turning a filled slot vacant immediately.

### 8.4 Aura

Aura represents prestige, attention, credibility, and social momentum. It is deliberately called **Aura** in the interface.

Aura is earned through:

- Landmark discoveries
- Highly regarded products
- Customer satisfaction
- Successful public demonstrations
- Safety wins and responsible handling of incidents
- Prestigious hires
- Beating rivals to visible milestones

Aura can be spent or committed to:

- Persuade elite researchers to join
- Improve the terms of a fundraising round
- Attract major customers
- Lobby or influence public debate
- Form coalitions
- Survive a scandal or failed demonstration

Available Aura is consumable because it represents current momentum that can be converted into action. The game may separately track **Lifetime Aura** for scoring, unlocks, and historical reputation.

Spendable Aura must remain a prominent top-level resource alongside money and compute. Any recruitment, fundraising, lobbying, or coalition action that spends Aura shows its cost on the action button before confirmation.

### 8.5 Model capability and demand

Capability is multidimensional rather than a single universal score. Candidate dimensions include:

- Language
- Reasoning
- Agency
- Tool use, including coding
- Vision, audio, and multimodality
- Scientific ability
- Embodiment

Commercial products depend on different combinations of these dimensions. Customers prefer stronger models, but also care about price, reliability, latency, safety, and reputation. Higher capability creates demand, which consumes more inference compute and can starve research unless capacity expands.

### 8.6 Political and regulatory state

The player sees:

- Government attention
- Government trust
- Strategic dependence
- Concern about regulatory capture
- Current policies and restrictions
- Relationships with rivals, government, and relevant institutions

These are influenced by capability, incidents, lobbying, public positions, government contracts, whistleblowers, and rival behaviour.

### 8.7 Facilities and campus

The lab grows as a physical campus. Facilities require an up-front investment, construction time, ongoing operating costs, and sometimes specialised researchers. They provide mechanical bonuses and appear visually in the pixel-art campus strip.

Initial facility candidates include:

- **Headquarters:** Adds a major-project slot, recruitment reach, and maximum researcher headcount.
- **Data center:** Adds owned compute capacity but increases power, cooling, maintenance, and security costs.
- **Inference center:** Improves customer reliability, serving efficiency, and enterprise-contract capacity.
- **Alignment institute:** Improves alignment/control research and helps retain safety-focused researchers.
- **Evaluation range:** Increases evaluation throughput, red-team quality, and the reliability of safety evidence.
- **Secure training bunker:** Improves containment and security for highly capable models at a high financial and political cost.
- **Robotics laboratory:** Unlocks embodied-AI research, robotics demonstrations, and later physical scientific automation.
- **Scientific laboratory:** Enables biological, chemical, materials, and energy applications needed for some prosperity endings.
- **Power and cooling plant:** Supports larger compute installations and reduces data-center operating costs.

Facilities may have several upgrade levels and mutually exclusive specialisations. For example, an ordinary data center can be expanded for maximum training throughput or hardened for containment and security.

Facilities are purchased through explicit buttons showing their up-front cost, build time, ongoing cost, benefits, and any star-researcher slot they unlock. The campus displays planned sites, construction states, completed buildings, and upgrades.

The campus view is primarily atmospheric feedback, not a tile-placement minigame. Buildings occupy predefined expansion sites. Small researcher sprites walk between them; construction, new hires, demonstrations, outages, alarms, and security incidents create simple visual changes. Facility management remains accessible through normal buttons and panels.

## 9. Hidden information

The game should hide enough information that safety cannot be solved as a fixed percentage allocation.

Potential hidden variables include:

- True alignment or goal robustness
- Situational awareness
- Deceptive capability
- Propensity to seek autonomy
- Security vulnerabilities
- Evaluation contamination
- Organisational willingness to report bad news
- Exact rival progress

The player instead sees evidence:

- Evaluation scores with error bars or confidence ratings
- Concerning model outputs
- Red-team reports
- Interpretability results
- Researcher warnings and disagreements
- Security incidents
- Unexpected capability jumps
- Changes in the AI character's behaviour

Safety investment does two different things:

1. It can make systems genuinely safer.
2. It can improve the lab's ability to measure whether systems are safe.

Confusing these two is an intentional strategic danger. A lab with excellent evaluations but weak interventions may understand that it is in trouble without being able to fix it. A lab with promising alignment techniques but weak evaluations may become dangerously overconfident.

After a run ends, a post-game report should reveal important hidden variables and explain which decisions affected the outcome. This preserves uncertainty during play while making success and failure learnable.

## 10. Research system

### 10.1 Research domains

The player funds broad domains rather than selecting a famous paper directly. Initial domain candidates are:

- Architectures and representation learning
- Scaling, optimisation, and infrastructure
- Reinforcement learning and agents
- Multimodal and generative modelling
- Scientific AI
- Alignment and control
- Interpretability and evaluations
- Security and containment

Part II expands the first five ideas into seven capability domains and implements the last three as safety programmes and operational controls. Representation learning belongs with the architecture, reasoning, or multimodality programme that actually uses it rather than in a catch-all “Data” domain. A smaller vertical slice may omit content, but must preserve the distinction between making a model safer and measuring whether it is safe.

### 10.2 How discoveries occur

A discovery's chance and speed depend on:

- Prerequisite ideas
- Accumulated research effort in relevant domains
- Assigned researcher expertise and synergy
- Compute allocated to experiments
- Facility and tooling bonuses
- Current model capability
- A bounded random component
- Whether another lab is already close

Progress is not fully deterministic, but it should not feel like an arbitrary lottery. The interface can show promising directions, stalled programmes, partial results, and rumours without displaying an exact completion timer.

### 10.3 First discovery and publication

Each landmark paper has only one first discoverer. That lab immediately receives:

- The paper's listed local scientific effects
- The opportunity to exchange exclusivity for Aura and Scientific Legacy score
- The global discovery announcement

Publication makes the paper public knowledge immediately: every lab receives its listed
scientific effects and the paper satisfies prerequisites globally. Secrecy preserves the
discoverer's exclusive effects until another lab independently reproduces the work. Losing a
paper race should hurt without permanently blocking the rest of the technology tree.

The world-first lab makes one sharp choice between publication and secrecy, as specified in section 34.6.

## 11. Commercial model market

Customers create a continuous source of revenue and pressure. Demand depends primarily on capability, price, service quality, and Aura.

The canonical customer segments are:

- Researchers
- Start-ups and developers
- Enterprise
- Consumers
- Government

Each segment offers different revenue, compute demand, political exposure, risk tolerance, and reputation effects. Scientific and medical work occurs through research, enterprise contracts, and Prosperity Programmes. Defence and high-risk uses appear as explicit contracts or events rather than a permanently labelled customer population. The player can set prices, reserve capacity, reject sectors, or offer multiple model tiers.

Serving a highly capable model may reveal safety failures or misuse. Restricting access can protect the lab but sacrifice money and market share.

## 12. Rival labs

The game is single-player. Rival labs are computer-controlled and should be implemented with a lightweight simulation rather than playing the entire game under the same rules as the player.

Each rival needs:

- A strategic archetype
- Capability and safety priorities
- Research-domain preferences
- Compute growth rate
- Talent and Aura strength
- Risk tolerance
- A few signature events and leader modifiers

Rivals can:

- Discover papers first
- Recruit or poach researchers
- Take customers
- Raise funding
- influence regulation
- Trigger race pressure through public milestones
- Enter, reject, or defect from a proposed safety coalition
- Reach AGI and win the race

**Hard rule:** A rival cannot end humanity and cause the player to lose through a rival-created catastrophe. Rival AGI is an ordinary race-loss condition. Catastrophic alignment outcomes are consequences of the player's own systems and choices.

Rival progress estimates should be imperfect. Industry rumours, benchmark releases, staff movement, publications, espionage, and government briefings can improve the estimate.

Rivals track a lightweight relationship state with the player: trust, strategic fear, dependence, and perceived honesty. These values matter little to ordinary market competition but become crucial if the player later attempts a coalition victory. A rival that has been repeatedly deceived, poached, publicly attacked, or subjected to industrial espionage should not accept a last-minute promise of cooperation merely because the player clicks the right dialogue option.

## 13. Real people and organisations

Researchers and leaders are intended to be recognisable portrayals of real AI figures, not wholly fictional composites. Labs may likewise be recognisable parodies or alternate-history counterparts of real organisations.

The exact naming policy remains to be settled: real names, lightly altered parody names, or a mixture.

Design guardrails should include:

- Base professional traits on public work, public statements, and well-established positions.
- Do not invent criminality, private misconduct, mental illness, or other damaging factual claims.
- Keep catastrophic actions attributable to the player's institutional decisions or fictional AI systems, not allegations about a real individual.
- Make the alternate-history and satirical nature explicit.
- Include a clear statement that portrayals are fictionalised and not endorsed by the people depicted.
- Obtain appropriate legal review before public release. Free distribution does not by itself eliminate defamation, publicity, or trademark concerns.

These constraints still leave substantial room for affectionate, pointed industry satire.

## 14. Politics, governance, and lobbying

Government should be a strategic actor, not merely a random game-over meter.

Possible actions include:

- Lobby for permissive or restrictive regulation
- Offer voluntary safety commitments
- Accept government evaluation or monitoring
- Pursue defence and national-security contracts
- Testify at hearings
- Cooperate with rivals on standards
- Support or undermine compute controls
- Report a rival's dangerous behaviour
- Build an international scientific coalition

Political strategies should have tradeoffs. Government contracts bring money and protection but increase scrutiny and obligations. Lobbying can buy time but damage trust. Strong voluntary commitments may slow the lab while reducing the chance of harsher intervention later.

Regulation should usually arrive as escalating constraints—reporting requirements, deployment limits, audits, compute caps, board intervention—before nationalisation becomes possible. This gives the player warning and opportunities to respond.

### 14.1 Coalition groundwork

A credible AGI coalition must be built over time. Before the endgame, the player can:

- Establish shared evaluation standards
- Exchange safety findings
- Create incident-reporting agreements
- Support third-party compute monitoring
- Negotiate mutual limits on dangerous training runs
- Invite government or scientific observers
- Build personal trust with rival leaders

These actions cost time, Aura, secrecy, and sometimes technical advantage. They may also expose the player to defection: a rival can learn from shared safety work while continuing capabilities research privately. Good verification institutions reduce this risk but cannot remove it completely.

## 15. Events and incidents

Events are the primary vehicle for character, satire, and qualitative decisions. Categories include:

- Research breakthroughs and failures
- Benchmark drama
- GPU supply shocks
- Staff disputes and resignations
- Leaks and whistleblowers
- Model misuse
- Security breaches
- Unexpected capabilities
- Investor demands
- Product failures
- Regulatory hearings
- Rival announcements
- AI-generated strategic advice

Events should depend on game state wherever possible. A safety incident caused by chronic underinvestment is more meaningful than an unrelated random penalty.

Choices should often create delayed consequences. A player who suppresses an uncomfortable evaluation may preserve Aura today while damaging safety culture and increasing the severity of a later leak.

### 15.1 Decision events

Important events appear as focused pop-ups and automatically pause the game. Each event contains:

- The triggering situation
- What the lab currently knows
- Important uncertainty or disagreement
- Two to four actionable choices
- Immediate visible costs and benefits
- Hidden or delayed consequences recorded in the run state

Choices should not reveal exact catastrophe probabilities. They can describe observable tradeoffs such as “maximum research acceleration,” “requires three weeks of security work,” or “government attention will increase.” Outcomes may create follow-up events much later.

Example:

> **[AI name] says it can accelerate AI research.** It requests root access to the lab's internal code, experiment scheduler, and compute cluster. Coding evaluations are strong, but autonomous-behaviour evaluations have coverage gaps. The acceleration estimate comes from the AI itself.

Possible choices:

1. Grant full root access for maximum acceleration.
2. Provide sandboxed research tools with monitoring and lower acceleration.
3. Deny the request.
4. Delay while commissioning an expensive independent evaluation, if the relevant team and compute are available.

The full-access option should not be an automatic death roll. Its consequences depend on actual hidden alignment, situational awareness, security architecture, prior evaluations, researcher warnings, and how much control infrastructure the player built earlier.

### 15.2 Lab-specific AI names

Dynamic event text uses the flagship model family associated with the selected lab. Model versions can advance during the game while the family name remains recognisable.

| Real-world lab inspiration | Model family in event text |
|---|---|
| OpenAI | GBT ([inspired by GPT](https://developers.openai.com/api/docs/models/all)) |
| Google DeepMind | Aquarius ([inspired by Gemini](https://deepmind.google/models/gemini/)) |
| Anthropic | Maude ([inspired by Claude](https://www.anthropic.com/claude/api)) |
| xAI | Gronk ([inspired by Grok](https://docs.x.ai/grok/overview)) |
| DeepSeek | [DeepSeek](https://www.deepseek.com/en/transparency/) |

Historical one-off systems such as AlphaGo and AlphaFold remain paper discoveries or specialised systems. The late-game AI character uses the lab's flagship general-model family. Exact version numbers should be stored as content data so they can change with game progression rather than being hard-coded into every event.

## 16. Loss conditions

The player loses if:

- A rival lab reaches and successfully deploys AGI first.
- The player's unaligned AGI escapes or causes catastrophe.
- The lab becomes insolvent and cannot secure rescue funding.
- Government intervention removes the player through regulation, forced control, or nationalisation.

Most loss conditions should have precursor states and warning signs. Sudden loss is acceptable only where the player knowingly accepted a severe risk.

## 17. Victory conditions

There are two full victory routes.

### 17.1 Independent victory

- Develop an AGI-capable system before a rival wins.
- Achieve sufficient real alignment, not merely strong-looking evaluations.
- Navigate deployment without losing control.
- Establish enough technical, organisational, and political capacity to translate AGI into credible broad prosperity.

### 17.2 Coalition victory

- Build a credible coalition with at least one genuine frontier rival before unilateral deployment occurs.
- Establish enforceable shared evaluations, monitoring, decision rights, and deployment rules.
- Jointly develop or govern an aligned AGI-capable system.
- Prevent coalition members from defecting during the final race.
- Navigate shared deployment and establish a credible path to broad prosperity.

Coalition victory is a real victory, not a consolation ending. It should be substantially harder to arrange than merely requesting cooperation during the finale. It trades some speed and unilateral control for stronger safety evidence, pooled expertise, and political legitimacy.

Simply training the strongest model is not victory under either route.

## 18. Endgame overview: The Deployment Crisis

The endgame is a 15–25 minute multi-stage crisis in which previous investments determine the player's options and the reliability of available evidence. This section gives the conceptual overview; section 44 is the authoritative rules specification.

### 18.1 Trigger

The Deployment Crisis begins when the player trains an apparent AGI candidate. Credible evidence that a rival is close instead creates a Race Emergency and a rival-progress countdown; the estimate remains imprecise.

The world does not pause. Investors want deployment, governments demand access or oversight, researchers disagree, customers anticipate a product, and rivals continue advancing.

### 18.2 The AI becomes a character

The candidate system gains a persistent communication panel. It can:

- Explain evaluation results
- Propose experiments
- Accelerate research
- Identify apparent safety flaws
- Request tools, data, network access, more compute, or permission to copy itself
- Comment on staff and strategic decisions
- Warn that a rival will win if the player delays

Its advice may be correct, mistaken, strategically selective, or deceptive depending on hidden state. The player should never be asked to detect deception from prose vibes alone; earlier technical and institutional investments determine what can be verified.

### 18.3 Access ladder

The player chooses the AI's operating permissions. Example levels are:

0. Air-gapped inference and curated dialogue
1. Fixed evaluation sandbox
2. Sandboxed coding and research tools
3. Selected internal lab systems and data
4. Laboratory, robotics, or scientific control
5. Root access and the external network, creating replication opportunities

More access creates enormous research and commercial acceleration while increasing the consequences of error.

### 18.4 Crisis actions

During a limited number of crisis windows, the player chooses among actions such as:

- Run a costly evaluation suite
- Commission an independent red team
- Perform interpretability work
- Retrain or modify the candidate
- Strengthen containment
- Replace or empower the safety lead
- Disclose evidence to government or rivals
- Negotiate a temporary race pause
- Attempt a merger or shared deployment
- Release a limited product
- Delay deployment
- Grant additional autonomy
- Begin full deployment

Options are unlocked, strengthened, or made cheaper by earlier choices. A world-class safety team cannot be hired instantly during the final ten minutes. Political trust cannot be manufactured from nothing. A culture that punished bad news will receive less reliable internal reporting.

### 18.5 Coalition route

> **Status: disabled pending redesign (2026-07-26).** The mechanic below is
> unwired, not deleted: the three coalition commands are refused, the board is
> hidden, and the tick step is inert. The current design is hard to read and
> plays as paperwork — nine opaque eligibility checks and three near-identical
> projects — so `verified-moratorium`, `coalition-deployment`, and the
> *Stewardship Compact* ending are unreachable for now. A redesign should give
> the route a legible fantasy, real decisions with visible stakes, and reasons
> to both defect and stay honest. Search `coalition-redesign` in the codebase
> for every seam; flip `COALITION_MECHANIC_ENABLED` to restore it.

The player may attempt to convert the Deployment Crisis into a joint programme, but only if substantial groundwork already exists.

A credible coalition generally requires:

- The player and at least one true frontier rival
- Enough combined frontier compute and talent to matter strategically
- High mutual trust or strong third-party verification
- Shared safety evaluations and disclosure of concerning evidence
- Agreed compute monitoring and limits on unilateral training
- A joint deployment authority with real power
- Costly concessions over intellectual property, governance, revenue, and credit

Not every lab must join. Non-members continue racing, which means coalition negotiation consumes time while the external countdown advances. A broad coalition can use government support, compute controls, and industry coordination to slow outsiders, but doing so risks political backlash.

Coalition formation should be a multi-stage negotiation with several opportunities for failure or defection. A partner's demands depend on its relative strength and history with the player. A leading rival may demand equal control; a weaker rival may seek compute access, protection, or public credit. Concealing evidence or secretly training during negotiations can create a short-term advantage but may collapse the agreement at the worst possible moment.

If successful, coalition members pool selected safety research, evaluation capacity, and political legitimacy. This improves the quality of evidence and creates additional containment options, but coordination overhead slows some decisions. Coalition victory therefore changes the final risk profile rather than simply providing an easier ending.

### 18.6 Resolution gates

The finale should resolve through several interacting tests rather than one visible percentage roll:

1. **Capability:** Is the system actually capable enough to deliver the promised transformation?
2. **Alignment:** Are its learned objectives and behaviour robust outside the evaluation setting?
3. **Control:** Can the lab contain or correct the system if the alignment assessment is wrong?
4. **Institutional execution:** Will staff, infrastructure, security, and governance handle deployment competently?
5. **Political legitimacy:** Can deployment proceed without destabilising intervention or conflict?
6. **Prosperity pathway:** Has the player prepared applications and institutions that turn capability into broad benefit rather than merely possessing AGI?

Strong performance throughout the run improves these gates and creates recovery paths. It should never guarantee success with perfect numerical certainty, but a well-run lab must have visibly better evidence, more options, and a much higher chance of victory than a reckless one.

### 18.7 Possible endings

This overview uses the canonical ending names and categories from section 44.16. That later
catalogue is the source of truth for triggers, variants, and production IDs.

- **Full victories:** The Broadly Shared Future, The Age of Superintelligence and Abundance, and A Cautious Golden Age.
- **Qualified victories:** The Lab That Ate the World and Miracle, Terms and Conditions Apply.
- **Terminal survival without victory:** The Long Pause.
- **Non-terminal setbacks:** The Caretaker and False Dawn return the player to the frontier race.
- **Losses:** Rival Ascendance, Nationalised Future, Mission Accomplished by the Board, The World's Most Expensive Insolvency, The Kill Switch Worked, No One Holds the Off Switch, The Last Human Veto, and the five causal human-extinction endings.

Do not create separate Part I aliases for these endings. Earlier working names such as “The Long
Boom,” “The Careful Dawn,” “Someone Else's Future,” “Paperclip Adjacent,” and “The Adults Have
Entered the Building” are retired and must not appear in content data or UI copy.

The end screen should score independent and coalition victories across separate dimensions—prosperity, safety, scientific legacy, institutional legitimacy, and lab influence—rather than declaring one route universally superior.

### 18.8 Target win rate

The broad standard-difficulty target is approximately **one third player victory, one third
non-extinction player loss, and one third human extinction** across a varied suite of competent,
reckless, cautious, and commercially aggressive strategies. This is a population-level tuning
target, not a per-run quota. A well-run cautious lab should outperform a reckless one, and no
outcome should be secretly selected to repair a recent statistical imbalance.

Difficulty can change rival speed, financial tolerance, incident severity, and the quality of safety evidence. It should not simply add a flat hidden failure chance.

### 18.9 Run score

Every run has a permanent **Score**, separate from cash and Aura. Score is never spent and never
changes the simulation; it records what the lab accomplished. Famous papers, well-run safety work,
prosperity milestones, facilities, research institutions, race progress, and the ending all award
points. Reckless access does not award points merely for being risky, and severe unresolved safety
failures can subtract points.

The dashboard shows the current total. The ending screen explains every award and penalty across
six categories: Scientific Legacy, Safe Stewardship, Prosperity and Impact, Institution Building,
Race and Operations, and Endgame. Section 41.5 and `content/scoring.yaml` are canonical.

The launch build stores local high scores. A future online leaderboard ranks winning runs only and
must verify a deterministic replay before accepting a score; the static GitHub Pages build cannot
securely validate a global leaderboard by itself.

## 19. Interface concept

The main screen is a management dashboard with five persistent regions:

- **Top bar:** Money, runway, compute, Aura, date, speed controls, and major warnings
- **Lab panel:** Compute allocation, active models, products, research programmes, and facilities
- **People panel:** Researchers, recruitment, morale, disagreements, and assignments
- **World panel:** Rival race, market demand, publications, government, and public trust
- **Event/feed panel:** Discoveries, news, incidents, messages, and later the AI character

The UI should make opportunity cost visible. Moving compute into a training run should immediately show the inference revenue and customer demand that will go unserved.

The interface should avoid looking like a spreadsheet despite presenting substantial information. Strong visual hierarchy, readable charts, character portraits, news cards, and occasional full-screen moments should punctuate the dashboard.

## 20. Initial scope

### 20.1 Systems prototype

The first prototype should test only the central economic loop:

- One playable lab
- Four lightweight rivals
- Money, compute, researchers, Aura, capability, and safety signals
- Three or four research domains
- Approximately 10 paper discoveries
- A simple model market
- One rough version of the deployment crisis

Art and content breadth are not priorities for this prototype.

### 20.2 First complete playable version

Launch-content target:

- Five selectable labs with distinct bonuses
- Four rivals in each run
- At least 100 landmark works; the current catalogue contains 111: 88 real and 23 clearly
  marked fictional future discoveries
- 56 real-person-inspired star researchers with flattering sourced biographies
- Eight capability research domains plus three safety programmes
- 180 ordinary decision events and 30 multi-beat crisis chains, of which a normal run sees roughly 24–36 ordinary events plus crises and the endgame
- 600 lab-feed templates, at least 400 of them non-mechanical atmosphere or humour
- 20 facility families represented by 44 construction/upgrade definitions
- Nine public AI capability tiers which remain separate from alignment
- Several customer segments
- Lobbying and regulatory escalation
- One modular Deployment Crisis with 48 authored decision nodes, 12 crisis inserts, and 18 ending/epilogue families
- 90–120 minute runs

### 20.3 Later expansion target

- More papers and researchers after the launch catalogue proves manageable
- More labs and leaders
- Richer diplomacy and coordination
- Additional research domains and products
- More endgame crises and prosperity paths
- Challenge scenarios and seeded daily runs

## 21. Decisions made

- Start date: 2012
- Timeline: Alternate, compressed history
- Research order: Broadly constrained by real conceptual dependencies, not publication dates
- Tone: Credible simulation with dry, slightly absurd satire and insider jokes
- People: Based on real AI figures rather than generic fictional composites
- Time model: Pausable real time using one-week simulation ticks and Pause/1×/2×/4× controls
- Information: Significant hidden state, especially around safety and alignment
- Research: Probabilistic domain investment rather than deterministic paper selection
- Rivals: Computer-simulated; can win the race but cannot destroy humanity
- Aura: Retained as the name for spendable prestige and social momentum
- Politics: Active system including lobbying and escalating regulation
- Victory routes: Both independent and hard-won coalition deployment can achieve full victory
- Scope: Begin small and expand after validating the core loop
- Research policy: World-first discoveries can be published, controlled, kept secret, or fully released
- Safety model: Alignment Science, Eval Quality, Control Strength, Security Strength, culture, and candour remain distinct
- Endgame: A staged Deployment Crisis with confirmation, access, evidence, external pressure, review, rollout, and several resolution gates
- Randomness: Seeded, state-dependent, bounded, reproducible, and revealed in the post-run audit
- Difficulty: Four selectable settings; Standard is the balance target and there is no adaptive hidden failure bonus
- Prosperity: A prepared medicine, energy/climate, materials/abundance, or public-knowledge programme is required for full victory
- Opening choice: Five leader panels—Dennis Hassabi/DeepBrain, Mario Amodeo/Humanic, Stan Altmann/ClopenAI, Elon Tusk/xMind, and Liang Wenfang/DeepSearch AI—with distinct positive leader bonuses and lab-level tradeoffs

## 22. Open design questions

The core rules are specified in Part II. Remaining questions are primarily content, tone, and legal/editorial decisions:

1. The current draft uses obvious parody names for real labs and people. Should legal review preserve that policy, require exact names, or recommend a mixture?
2. Which two star researchers form each lab's opening roster, and what eight-or-more generation names follow each AI family?
3. Which additions or removals improve the current 88-work real research graph, and which disputed priority claims need special historical notes?
4. Which additional 32 people join the 24-person drafted researcher set to reach 56 without leaving domain or demographic blind spots?
5. How explicit should military use, state competition, labour displacement, and misuse become on screen?
6. Which exact fictional future discoveries belong to each Prosperity Programme, and how scientifically conservative should their descriptions be?
7. Do user tests support the specified week length and clock speeds, or do only those balance constants need adjustment?
8. Which lab-specific jokes and AI-character voices remain funny after repeated play without becoming personal attacks?

## 23. Immediate next design tasks

Before production game code, the design should next complete the content specification:

1. The five opening star-researcher rosters and leader/lab reaction copy
2. The precise capability/safety research domain graph
3. Editorial and mechanical review of the complete landmark catalogue, including its safety canon
4. Structured YAML records and biographies for the 24 mechanically drafted star researchers
5. Lab-specific event, leader, and AI-family voice guides
6. Complete facility-upgrade and generic-advance catalogues
7. The remaining event records needed to meet section 46 targets
8. A content and legal review policy for real people, labs, papers, and marks
9. A clickable UI flow covering one normal cycle and the complete Deployment Crisis
10. A balance workbook or headless model using the constants in Part II

The authoritative quotas, file organisation, AI capability ladder, and pack order are in the [Content-First Production Plan](content-production-plan.md).

## 24. Proposed technical implementation

This section is a recommendation rather than a final decision. The project should optimise for a small team, rapid iteration, easy browser distribution, and a dashboard-heavy interface rather than for action-game features.

### 24.1 Platform

Build the first version as a **desktop-first browser game**. It should run in current Chrome, Firefox, Safari, and Edge without installation.

Target laptops and desktop monitors first. The interface should adapt to smaller laptop screens, but a phone version is outside the first release scope. Dense resource allocation, research trees, event text, and rival information will be difficult to make enjoyable on a narrow phone screen without redesigning the entire interface.

The finished static build can be hosted on a normal web host and uploaded to itch.io as an HTML5 game. No account system or backend server is required for the initial version.

### 24.2 Language and main tools

Recommended stack:

- **TypeScript:** The programming language for game rules and interface logic
- **React:** Reusable interface components such as resource bars, researcher cards, event windows, charts, and research panels
- **HTML and CSS:** The actual dashboard layout, typography, menus, tooltips, and responsive behaviour
- **SVG:** Research-tree lines, charts, icons, and diagrams that must remain sharp at different sizes
- **Vite:** Local development server and production build tool
- **Zustand:** A small state-management library for connecting the simulation to the interface
- **Vitest:** Automated tests for the economy, research outcomes, saves, and deterministic simulations

Do not begin with Unity, Unreal, or a full browser game engine. Neolab.ai is primarily an information-rich management game, not a physics, platforming, or 3D game. Normal browser interface technology will handle text, charts, buttons, panels, accessibility, and different screen sizes more naturally.

### 24.3 Optional visual renderer

Most of the game should remain ordinary React/HTML UI. If the lab-floor scene later needs many animated sprites, particles, or visual effects, add **PixiJS** only for that bounded visual layer.

PixiJS should not own the game rules or the dashboard. It would render decorative scenes while React continues to control menus, events, research, and resource allocation. The first prototype does not need PixiJS at all; simple images, CSS animation, and SVG may be sufficient.

### 24.4 Application architecture

Keep four layers separate:

1. **Content data:** Papers, researchers, labs, events, products, upgrades, and text stored in structured data files.
2. **Simulation engine:** Pure TypeScript rules that advance time and calculate money, compute, research, demand, rivals, and hidden safety state.
3. **Game state and saves:** The current run, random seed, settings, event history, and save-version migrations.
4. **Presentation:** React components, CSS, pixel art, sound, animation, and input handling.

The simulation engine should not depend on React. Given the same starting state, random seed, and player actions, it should produce the same result. This makes balancing, automated testing, replays, and debugging much easier.

Conceptual flow:

```text
Player action → game command → simulation update → new state → UI redraw
                                      ↓
                              event log / autosave
```

All important content should have stable identifiers. For example, the Attention paper might be `paper_attention_2017` even though its title, description, and game discovery date can vary.

### 24.5 Time simulation

Use a fixed simulation tick independent of screen animation. A possible model is:

- The engine advances in one in-game week increments.
- Normal speed processes one tick every four real seconds, with 2× and 4× options.
- Faster speeds process more ticks per real second.
- Pausing stops simulation ticks but leaves the interface interactive.
- Major decisions enqueue an event and auto-pause.

The rates are balance constants and should be tuned through playtesting without changing the one-week rules unit. Game rules must use in-game time rather than frame rate, so a slow computer does not change the economy.

### 24.6 Saving

The first version should support:

- One rotating autosave
- Several manual save slots
- Export save to a JSON file
- Import save from a JSON file
- Save-format versioning from the beginning

Browser storage is sufficient initially. Exportable saves protect players against browser-data loss and make bug reports reproducible. Cloud accounts and synchronisation can be considered only after the core game is fun.

### 24.7 Backend and online features

Do **not** build a backend for the first playable version. It is unnecessary for a single-player game and would add authentication, security, hosting, privacy, and maintenance work.

A small server may become useful later for optional anonymous balancing telemetry, daily challenge seeds, achievements, or cloud saves. None of these should block the first release.

### 24.8 Distribution

Initial distribution options:

- A public web address, preferably `play.neolab.ai`
- itch.io as a free browser-playable HTML5 game
- A downloadable offline build later, if players request it

The same browser build can serve the public website and itch.io with minor configuration differences. A desktop wrapper should be considered only after the browser game is stable.

The first release requires **no rented game-server CPUs**. A static host sends HTML, JavaScript, content, sound, and image files to the player; the simulation then runs on that player's CPU in the browser. Local saves remain in IndexedDB and can be exported as files. Server compute becomes necessary only if a later version adds accounts, cloud saves, multiplayer, authoritative leaderboards, or server-side daily challenges.

Recommended initial path:

1. Build one static production folder.
2. Deploy it with GitHub Pages at `play.neolab.ai` for development, testing, and the initial launch.
3. Upload the same relative-path-safe build as an itch.io HTML5 game for discovery and an easy feedback page.
4. Add a manifest and offline cache only after cache-version and save-compatibility tests make a PWA safe.
5. Keep analytics absent unless a production build is explicitly configured. Configured builds
   automatically use privacy-preserving, cookie-free aggregate events with no in-game opt-out; full
   crash diagnostics remain local unless the player explicitly exports them.

GitHub Pages has a soft 100 GB/month bandwidth limit and a 1 GB published-site limit. Keep the compressed first-load bundle small, measure it in CI, and move the unchanged static build to Cloudflare Pages if traffic approaches that soft limit. Cloudflare Pages documents free, unlimited static-asset requests, a 20,000-file Free-plan site limit, and a 25 MiB per-file limit. itch.io supports browser-playable HTML/CSS/JavaScript ZIP uploads and fullscreen launch. Sources: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [itch.io HTML5 guide](https://itch.io/docs/creators/html5).

## 25. Proposed UI direction

The main interface should feel like an elite research lab's operations console—not a generic SaaS admin panel and not a full-screen pixel-art adventure.

An [interactive dashboard concept](../design/mockups/dashboard-concept.html) explores the proposed layout and art balance.

### 25.1 Persistent screen layout

The player spends most of the game on one main screen. The desktop layout uses the available display rather than imitating a narrow web form: a fluid shell is capped at approximately `1500–1600px`, with `20–28px` outer gutters and a `24px` main-column gap on large screens.

- **Identity header:** The selected leader's name is the most prominent text, immediately alongside the company and current AI family/model name. Date and time controls share this header but do not visually outrank the leader.
- **Top status cards:** Finance, compute, Aura, current AI capability level, and urgent warnings
- **Central workspace:** The currently selected system—compute allocation, research, market, people, or government
- **World column:** Rival progress estimates, important news, regulation, and coalition state
- **Lab feed:** Discoveries, incidents, researcher messages, customer problems, and jokes
- **Campus strip:** An expandable pixel-art campus showing purchased facilities, construction, incidents, and small staff sprites

Major events open focused modal scenes and pause the clock. The player should not need to navigate through five menus merely to respond to a warning.

### 25.2 Navigation

Use five primary sections:

1. **Lab:** Compute, facilities, models, and serving allocation
2. **Research:** Domains, programmes, papers, and safety evidence
3. **People:** Researchers, recruitment, morale, and assignments
4. **World:** Rivals, market, government, lobbying, and coalitions
5. **Archive:** Discovered papers, event history, model history, and educational material

Important information from inactive sections should still surface through the top bar and feed. Navigation changes the detail view, not the underlying passage of time.

### 25.3 Interaction principles

- Show the immediate opportunity cost before confirming an allocation.
- Use uncertain language and ranges where the lab genuinely lacks information.
- Auto-pause for decisions with irreversible or catastrophic consequences.
- Make warnings explain what is observed without revealing hidden truth.
- Keep common actions one or two clicks away.
- Make charts readable without requiring AI or finance expertise.
- Use animation to show change, not as permanent visual noise.
- Preserve keyboard navigation and readable text despite the retro art direction.

Continuous resource decisions use sliders, including GPU serving allocation and research splits. Discrete, consequential actions use buttons: start a training run, acquire GPUs, build a facility, hire a researcher, publish a discovery, sign a contract, or approve a deployment. Toggles are reserved for persistent operating policies such as automatic inference scaling or mandatory external evaluation.

The top resource area groups information into four readable blocks on wide screens and two rows of two on smaller laptops:

1. **Finance:** Current balance, income, outgoings, net cashflow, runway, and fundraising action
2. **Compute:** Current capacity and compute-purchase action
3. **Aura:** Spendable Aura, recent change, and optional lifetime total
4. **AI capability:** Current named AI, capability level, descriptive tier, uncertain progress toward the next tier, and a model-details action

The central workspace and right rail use approximately a `2:0.72` ratio on displays wider than 1080px, with the rail no narrower than 340px. The rail is sticky while the central workspace scrolls. Below approximately 820px it moves beneath the workspace rather than squeezing both columns.

The star-researcher portrait row remains visible near the top of the dashboard. Five spacious cards fit across the widest layout; narrower layouts show four, three, or one per row. Recruitment candidates appear only when the market is expanded, rather than permanently duplicating employed researchers underneath the roster. Removing or reassigning a researcher begins from the portrait card.

The Archive is also the lab's audit surface. It shows every projected four-week finance line—not
only totals—and every currently active bonus or penalty with a readable source, target, operation,
expiry, and stacking explanation. Canonical content and run IDs never appear in player-facing
labels. Multiplicative effects say explicitly that they stack multiplicatively; dormant effects
remain absent from the active list rather than masquerading as active bonuses.

The Internal Wire is a recent operational window, not an endlessly growing page. It keeps the
twelve most recent resolved decisions plus only live projects and queued events, scrolls inside the
rail, and links to the relevant review surface. Permanent paper, decision, score, and model records
remain available through the Archive.

Immediately below the resource cards, a measured-capability trajectory plots only models for which
the player has capability evidence. Its display index is `2^(measured frontier capability / 10)`,
so each ten estimated frontier points doubles the visible index and a genuinely compounding regime
can bend upward on a linear chart. The chart labels evaluation confidence and clearly states that
it is neither hidden true intelligence nor a precise forecast. Before the first evaluated model it
shows an explicit empty state rather than inventing a baseline.

Quiet circuit and activity signals sit behind the leader identity header. Their density grows with
commissioned facilities, employed stars, and trained model generations. They are purely
presentational, ignore hidden state, accept no pointer events, obey reduced-motion preferences, and
freeze immediately with the simulation clock so Pause has a visible environmental consequence even
when the campus strip is below the fold.

Every major route shows the application version. The main clock uses a graphical pause icon with an
accessible label. Quit/New Game first pauses time and opens a confirmation explaining the shared
Autosave slot; confirming saves the latest coherent state before returning to the title screen,
while cancelling resumes only if the game was running beforehand.

### 25.4 Important UI moments

The dashboard should occasionally give way to memorable presentation:

- A paper discovery interrupts the feed with a publication card and short fanfare.
- A major rival announcement appears as a simulated livestream or news bulletin.
- A researcher resignation becomes a character scene rather than a tiny red number.
- The first AGI-candidate conversation changes the familiar feed into a persistent AI communication channel.
- Catastrophic and victory endings temporarily remove the dashboard and show the consequences of the run.

A player world-first paper auto-pauses into an educational discovery dialog even if the paper was
discovered in the background. The card names the exact score already recorded, every immediate
unlock or modifier, and the exact Aura plus publication-score bonus for each policy before the
player chooses. The player may move the unresolved choice into Research, but cannot accidentally
resume merely by acknowledging the banner. Rival world-firsts do not seize the screen; they enter
the Internal Wire under the rival lab's display name and remain in the paper archive.

Every auto-pause offers a verb that reaches its real decision surface: funding and bankruptcy open
financing, training opens Models, resignations open People, political/race warnings open World,
paper discoveries open Research, and Deployment Crisis warnings move to the crisis controls.
Critical and urgent event overlays remain in front and are resolved there. “Acknowledge & resume”
is reserved for a pause with no pending decision.

Dense mechanical labels use a shared accessible explanation control. It is focusable and
click/tap-expandable, carries a short hover title as a convenience, and never relies on hover alone.
The first set covers finance/runway, GPUs, Aura, current-vs-commercial AI, score, GPU allocation,
research momentum, rival estimates, and regulatory pressure. Exact hidden thresholds and hidden
model/rival truth are never included in help copy.

## 26. Proposed art direction

Use **modern pixel art inspired by 16-bit management games**, rather than committing to the severe technical limitations of literal 8-bit art.

This provides a distinctive identity while remaining feasible for a small project. It supports humorous caricature portraits and animated lab scenes without requiring expensive 3D models or hundreds of hand-painted illustrations.

### 26.1 Visual mixture

The game should combine:

- Crisp, readable modern UI for numbers and long text
- Pixel-art researcher portraits
- Pixel-art lab rooms and server racks
- Small animated sprites for staff, robots, demonstrations, alarms, and incidents
- Limited-colour icons for resources and research domains
- Occasional larger illustrated event cards

The complete interface supports a persistent light/dark choice stored locally in the browser.
Dark mode changes management surfaces, forms, modal cards, semantic warning tints, charts, and
focusable controls while preserving colour-independent labels. The title, crisis, high-score, and
ending presentations retain their purpose-built dark palettes. The campus artwork is dimmed rather
than recoloured so semantic facility and incident colours remain recognisable.

Do not use a pixel font for paragraphs, tooltips, or paper explanations. Pixel fonts are suitable for short headings or flavour labels but become tiring during a two-hour text-heavy game.

### 26.2 Suggested asset scale

Provisional standards:

- UI and resource icons: 16×16 or 24×24 source pixels
- Researcher portraits: 64×64 or 96×96 source pixels
- Character sprites: approximately 24×32 source pixels
- Lab environment: built from a 16-pixel or 32-pixel grid
- Integer scaling wherever possible so pixels remain crisp

These sizes are guidelines, not commitments. A short art test should establish the exact scale before dozens of portraits are produced.

### 26.3 Art workload strategy

Art should be modular:

- Reusable room tiles and furniture
- Server-rack variants that reflect compute upgrades
- A small library of body poses with distinctive heads and clothing
- Lab-specific palettes and decorative props
- Event-card templates with interchangeable foreground elements

The lab-floor scene is primarily atmospheric feedback. It should react to the game—new compute fills the room with servers, prestigious hires appear as sprites, safety investment builds an evaluation area, and incidents trigger alarms—but it does not need independent character pathfinding or simulation.

### 26.4 Real-person portraits

Portraits should be recognisable caricatures rather than photorealistic reproductions. A consistent pixel-art treatment makes the satire clearer and avoids an uncanny collection of unrelated visual styles. Final depictions should follow the same legal and reputational guardrails as the character writing.

### 26.5 Art production plan

Before choosing a permanent pipeline, create one small art-direction test containing:

- Three researcher portraits
- One leader portrait
- One server-room scene
- Four resource icons
- One serious incident card
- One comedic event card

Compare two treatments: restrained 16-bit corporate pixel art and a more colourful arcade-like style. Select one only after viewing both inside the real dashboard layout.

## 27. Recommended development sequence

No production game code should begin until the core design questions are sufficiently specified. Once implementation starts, use this order:

1. **Static UI prototype:** Validate layout, readability, and information hierarchy with fake data.
2. **Ten-minute economic prototype:** Money, compute allocation, model demand, one research domain, and one rival.
3. **Deterministic simulation tests:** Run thousands of accelerated games without graphics to find broken economies.
4. **Vertical slice:** One lab, several researchers, ten papers, incidents, and a rough ending.
5. **Content expansion:** More labs, people, papers, politics, and coalition mechanics.
6. **Art and sound pass:** Replace temporary assets only after the main loop works.
7. **Balance and accessibility:** Tune difficulty, improve explanations, and verify keyboard and colour-blind usability.
8. **Public browser build:** Release a small test version and collect feedback before expanding further.

# Part II — Implementation rules specification

The earlier sections describe the intended experience. The remainder of this document defines the rules precisely enough to implement and test the game. When a broad description in Part I conflicts with a specific rule in Part II, Part II is authoritative until the document is deliberately revised.

Every numerical value below is a **balance value**, not a permanent creative commitment. The implementation must load these values from data rather than scattering them through UI or simulation code. Rules, units, update order, and state ownership are normative; numerical constants are expected to change after simulation testing.

## 28. Rules terminology and design contract

### 28.1 Canonical terms

- A **tick** is one simulated week.
- A **cycle** is four ticks and is used for payroll, contracts, bills, revenue, and most financial reporting. The UI calls it a month even though four-week accounting produces thirteen cycles per game year.
- A **quarter** is thirteen ticks and is used for market growth, board review, and long-term rival decisions.
- A **run** is one complete game from lab selection to an ending.
- A **project** is a time-limited activity with a cost, staffing requirement, and completion result. Training runs, construction, audits, and lobbying campaigns are projects.
- A **program** is a continuing allocation of people or compute which generates progress every tick. Research domains and safety work are programs.
- A **model generation** is a trained model with immutable underlying attributes. Deployment settings can change; the trained weights cannot.
- An **incident** is a harmful or alarming occurrence generated by normal play. An incident can cause losses but is not automatically an ending.
- A **crisis** is an event which auto-pauses and requires a player decision before time can continue.
- A **signal** is player-visible evidence about hidden state. Signals can be noisy, incomplete, or strategically manipulated.
- A **check** is a probabilistic resolution using a stored random draw and explicit state modifiers.

### 28.2 Simulation principles

The simulation must obey the following contract:

1. **State causes probability.** Random outcomes are conditional on the lab, model, people, choice, and world state. The game never secretly assigns one event button to be “correct” regardless of circumstances.
2. **Randomness is reproducible.** A run has a seed. Loading a save and choosing the same option in the same state produces the same result.
3. **Consequences are attributable.** The ending report can identify the important variables, choices, and random checks which led to the result.
4. **Hidden does not mean arbitrary.** The player may not see a safety score, but the score exists, changes according to written rules, and produces discoverable evidence.
5. **Large threats have a trail.** Except for explicitly labelled high-risk choices, a single untelegraphed weekly roll must not take a healthy lab directly from stability to game over.
6. **The player controls policy, not busywork.** Weekly implementation details are simulated. The player sets allocations, starts projects, hires important people, and resolves exceptional decisions.
7. **Rivals play by comparable rules.** Rival labs use a simplified simulation, but do not receive discoveries or victory progress merely because a dramatic moment is due.

### 28.3 Numeric conventions

Unless a rule states otherwise:

- Ratings use a `0–100` scale.
- Percentages are stored as fractions from `0.0–1.0` and displayed as percentages.
- Money is stored in millions of game dollars, to three decimal places internally and one decimal place in the UI.
- Progress can exceed its nominal threshold internally only during the tick which completes it; excess project progress does not transfer elsewhere.
- Multipliers combine multiplicatively unless explicitly described as additive.
- All final probabilities are clamped to the range specified by the check, usually `5%–95%`. A guaranteed result is represented as a consequence, not a probability check.
- The simulation performs calculations at full precision and rounds only for display.

### 28.4 Rating adjectives

The same language is used in tooltips, events, reports, and AI dialogue:

| Rating | Standard description |
|---:|---|
| 0–19 | Negligible |
| 20–39 | Weak |
| 40–59 | Uncertain or developing |
| 60–79 | Strong |
| 80–94 | Exceptional |
| 95–100 | Frontier or extreme |

These labels describe measured estimates. A hidden value can differ from its displayed estimate.

## 29. New game setup and starting state

### 29.1 New-game sequence

A new run follows this sequence:

1. Select difficulty.
2. Select a lab by choosing its leader from the five-panel **Choose Your Founder** screen.
3. Read the selected leader's full briefing, leader bonus, lab modifiers, and AI family.
4. Select one of three opening mandates.
5. See the initial world map, rival introductions, and first talent market.
6. Enter the dashboard paused at `2012, Week 1`.

An opening mandate is an early emphasis, not a permanent class:

| Mandate | Benefit | Tradeoff |
|---|---|---|
| Build the Science | +8% capability research | −20% customer demand ceiling; −20% cash in fundraising offers |
| Build the Business | +$25m when the full game opens; +25% customer demand ceiling; +10% cash in fundraising offers | −10% safety research |
| Build It Right | +30% safety research; +10 Eval Quality (→20); +10 Government Trust (→60) | −5% effective GPU throughput |

### 29.2 Standard difficulty baseline

Lab modifiers are applied after this baseline. All playable labs begin viable; none may have more than an approximately ten-per-cent advantage in total simulated opening value.

| State | Starting value |
|---|---:|
| Calendar | 2012, Week 1 |
| Cash | 45.0, including a 27.0 first-model bootstrap runway |
| Forecast cycle income | 0.0 |
| Forecast cycle outgoings | 4.64 |
| Forecast cycle net cashflow | −4.64 |
| Aura, spendable | 30 |
| Lifetime Aura | 30 |
| Physical GPU capacity | 10,000 Kepler-generation GPUs |
| Compute efficiency | 1.00× |
| GPUs owned | 6,000 Kepler GPUs |
| GPUs leased | 4,000 Kepler GPUs |
| Current model | None; the lab must train its first AI |
| Initial customer demand | 0 |
| Market share | 0.5% of the initial addressable market |
| Star-researcher slots | 3 |
| Filled star-researcher slots | 2 |
| General researchers | 18 |
| Engineers and operations staff | 12 |
| Safety Culture | 45 |
| Alignment Science | 8 |
| Eval Quality | 10 |
| Control Theory | 6 |
| Practical Control Strength | 7 |
| Security Posture | 12 |
| Internal Candour | 50, hidden |
| Government Attention | 5 |
| Government Trust | 50 |
| Board Patience | 70 |
| Capability programmes available | Architectures, Optimisation and Scaling, Reinforcement Learning and Agency, Vision/Audio/Multimodality, Reasoning and Tool Use, Robotics and Embodiment, Scientific AI |
| Starting domain levels | Architectures 8; Optimisation and Scaling 6; all other capability programmes 0 |
| Facilities | Rented Office I, Server Rack |

**GPU is the canonical compute resource.** Every owned, leased, bought, reserved, and allocated quantity is a count of physical GPUs. The interface never relabels GPUs as an abstract `CU`. Because generations are not equivalent, each generation has separate authored training and serving throughput factors. Those factors are balance coefficients rather than benchmark or FLOPS claims; Kepler is the internal `1.0` reference. The player sees the physical generation mix and GPU count, while expanded comparison tooltips may say that one offer is estimated to train or serve approximately `N×` as much work as another.

The real hardware sequence is Kepler, Maxwell, Pascal, Volta, Turing, Ampere, Hopper, Blackwell, and Rubin, appearing in roughly historical order. Post-Rubin generations are fictional, use a fictional manufacturer, and carry a conspicuous `FICTIONAL HARDWARE` label. The canonical factors, costs, reliability, and dates live in `content/hardware/gpu-generations.yaml`; changing them is a balance-data revision, not a simulation-code change.

Default opening policies before the player changes them are:

- No current or commercially deployed model; the lab identity's AI name denotes a future model family, not an existing AI
- 0% unreserved compute to serving and 100% to R&D
- 75% of R&D to capability and 25% to safety
- Capability weights: 60% Architectures, 40% Optimisation and Scaling
- Safety weights: 50% Alignment and Control, 40% Interpretability and Evals, 10% Security Testing
- No active construction, training, fundraising, lobbying, or audit project
- One primary research focus selected from the lab's archetype; the player can change it before the first tick without a context-switch penalty

The forecast burn of 4.64 per cycle gives approximately 26 weeks of baseline runway. Lab modifiers and the opening mandate can change it before time begins. The opening grant is explicit cash, not a temporary cost discount, so the finance breakdown always reconciles.

The first training run is the only run which may have no parent model. It creates generation zero in the selected lab's named AI family, becomes the active internal model on completion, and receives hidden safety attributes from the normal deterministic training contract. Later training requires an owned parent model. A trained model creates no customer demand until it has been productised and given an external deployment policy.

### 29.3 Starting people and offers

- Each lab starts with its leader plus two lab-appropriate star researchers.
- A leader occupies no star slot and cannot normally be dismissed.
- The initial recruitment market contains five candidates: two generally useful, one aligned with the lab's weakness, one safety specialist, and one expensive prestige hire.
- At least two initial candidates must be affordable after a modest fundraising action.
- Initial candidates are selected from the run seed, subject to those composition rules.
- Rival labs receive their own starting rosters before the player's recruitment market is generated; one named person cannot exist in two labs.

### 29.4 Difficulty settings

Difficulty changes inputs and rival behaviour, never hidden truth after a choice has been made.

| Setting | Player economy | Rival progress | Incident pressure | Information quality | Intended audience |
|---|---:|---:|---:|---:|---|
| Fellowship | +20% revenue, −15% fixed cost | 0.68× | 0.75× non-endgame hazard | +8 displayed estimate quality | Learning the systems |
| Standard | 1.00× | 1.00× | 1.00× | Baseline | Intended first serious run |
| Frontier | −8% revenue | 1.12× | 1.15× | −5 displayed estimate quality | Experienced strategy players |
| Unhinged Scaling | −12% revenue | 1.25× | 1.30× | Baseline, but wider event variance | Deliberately unfair satire mode |

The balance target of roughly a 50% win rate refers to Standard difficulty among players who understand the interface and basic systems but have not memorised the event catalogue.

### 29.5 Choose Your Founder screen

The first major presentation after difficulty selection is a full-screen leader choice. It should feel like choosing a civilisation or commander in a strategy game, not completing an account-registration form.

On a wide screen, all five leaders appear as large portrait panels. At narrower laptop widths, the selected panel is central with the adjacent panels partially visible. Arrow keys move between panels, `Enter` opens the dossier, and a separate comparison view exposes all mechanical modifiers without requiring pointer hover.

Every collapsed panel contains:

- Pixel-art portrait
- Leader display name
- Epithet
- Lab name and emblem
- One-sentence characteristic
- Exact headline bonus
- AI family name
- `View dossier` and `Choose this leader` actions

The expanded dossier contains:

- A 100–160 word extravagant biography
- Exact leader bonus
- Exact lab modifiers and starting-state differences
- Strategic strengths and pressures
- Suggested opening for new players
- Difficulty indicator, which describes complexity rather than raw strength
- Fictionalisation and non-endorsement note

The leader bonus is always positive and belongs to the leader. Balancing constraints belong to the lab's institutions, market position, or geopolitical situation. The biography must not praise someone for three paragraphs and then hide a personal insult in a trait tooltip.

### 29.6 Flattery rule

The player-facing leader text should be **extremely flattering**. Its comic excess comes from treating already impressive careers with the reverence of an epic poem narrated by an unusually well-informed investor. It must also remain anchored to public fact.

Writing rules:

- Praise real, documented achievements and unusual combinations of ability.
- Credit teams when describing team achievements.
- Use generous interpretations of public missions and intellectual style.
- Do not invent private virtues, motives, childhood incidents, or endorsements.
- Do not imply the real person caused fictional incidents later in the run.
- Put strategic drawbacks in the fictional lab description, not the biography.
- Keep the joke affectionate: grandeur, not mockery.
- Include a global disclaimer that names and organisations are fictionalised alternate-history portrayals and are not endorsements.

The biographies below are draft production copy. Factual claims must receive a final source and legal review near release because living careers and organisation names can change.

### 29.7 Initial five leaders and labs

#### Dennis Hassabi — The Visionary

**Company:** DeepBrain<br>
**AI family:** Aquarius<br>
**Characteristic:** Sees the whole research tree while everyone else is still arguing about the benchmark.<br>
**Leader bonus — Polymath's Programme:** Capability research-point production `×1.10` across all seven capability domains. No leader boosts every kind of research any more: Hassabi owns capability, Amodeo owns safety.

**Bio:** A prodigious chess player, pioneering game designer, computational neuroscientist, institution-builder and Nobel laureate, Dennis Hassabi has spent his life treating disciplinary boundaries as polite suggestions. He co-founded DeepBrain around the audacious belief that understanding intelligence could become a practical scientific project, then led extraordinary teams from deep reinforcement learning and game-playing breakthroughs to protein-structure prediction that transformed biological research. His rare gift is not merely selecting ambitious problems; it is arranging brilliant people, patient capital and rigorous experiments so that impossible problems begin to look scheduled. Dennis does not predict a new golden age of discovery as an observer. He arrives with a research plan, a hand-drawn tree of knowledge, and the serene expectation that your lab will help build it.

**DeepBrain lab modifiers:**

- `Scientific Institution`: Scientific AI begins unlocked at level 6.
- `A Product Would Be Nice`: initial market acquisition rates `×0.85`.
- **Complexity:** Medium. Strongest for players who turn research lead into a viable business before runway expires.

**Suggested opening:** Protect enough serving revenue to survive, take an early paper lead, then use Aura from open publication to recruit and fund the first owned cluster.

#### Mario Amodeo — The Philosopher

**Company:** Humanic<br>
**AI family:** Maude<br>
**Characteristic:** Has already written the memo explaining why the obvious plan fails at scale.<br>
**Leader bonus — Scaling With Principles:** All safety research-point production `×1.35` — the mirror of Hassabi's capability headline, and the larger of the two.

**Bio:** Trained as a physicist, Mario Amodeo pursued questions from neural circuits to cellular proteomics and cancer biomarkers before turning his attention to the most consequential scaling experiment of the century. He helped lead frontier-model research and then co-founded Humanic as a public-benefit laboratory devoted to systems that are reliable, interpretable and steerable. Mario's exceptional talent is to move comfortably between first-principles argument, empirical scaling behaviour and institutional design—to ask not only whether a system can become vastly more capable, but what kind of organisation could remain intellectually honest while building it. Colleagues may enter his office expecting a model review and leave with a theory of technological history, three safety projects, and the unsettling sense that all three were on the critical path.

**Humanic lab modifiers:**

- `Safety Constitution`: Eval Quality starts at 20, and the constitution limits the opening fleet to 9,000 GPUs — deliberate scale is written into the founding documents.
- `Mission Magnet`: researcher morale targets +5 and loyalty +10 — the highest talent density in the industry, and the hardest lab to poach from.
- `Responsible Market`: all revenue `×1.15` — enterprises pay a premium for the lab that will not embarrass them.
- **Complexity:** Medium. Strong evidence and institutions, but the player must remain fast enough to matter.

**Suggested opening:** Use superior evidence to deploy guarded products confidently, monetise trust, and avoid spending the entire early game proving that a model with FC 14 is not plotting a coup.

#### Stan Altmann — The Rainmaker

**Company:** ClopenAI<br>
**AI family:** GBT<br>
**Characteristic:** Can turn a prototype, a dinner and one slide into the infrastructure budget of a small nation.<br>
**Leader bonus — Capital Is a Technology:** Fundraising-project duration `×0.80`; cash in accepted funding offers `×1.25`.

**Bio:** A founder from the earliest Y Combinator cohort, later the accelerator's president, and a co-founder and chief executive of ClopenAI, Stan Altmann has an extraordinary record of recognising technological inflection points before the committee has found the correct calendar invite. He combines restless product instinct with a rare ability to persuade researchers, engineers, investors and heads of government that an implausibly large undertaking is not only possible but late. Under his leadership, frontier AI moved from a research curiosity into a technology used around the world. Stan's signature skill is coalition by acceleration: he makes capital feel visionary, infrastructure feel inevitable and tomorrow's platform feel as though thoughtful people are already waiting for it in the lobby.

**ClopenAI lab modifiers:**

- `Unreasonable Momentum`: starts with 40 spendable Aura, and every market segment's demand ceiling is `×1.20` — the market is simply larger for Stan.
- `Everyone Has a Term Sheet`: recurring executive and governance costs are +1.0 cash per four-week cycle (+13.0 per year).
- **Complexity:** Low to medium. Forgiving access to money, but investor conditions accumulate quickly.

**Suggested opening:** Productise early, fundraise before runway becomes desperate, and read every board condition even if the valuation contains an exciting number of zeroes.

#### Elon Tusk — The Industrialist

**Company:** xMind<br>
**AI family:** Gronk<br>
**Characteristic:** Believes a software problem is often a factory problem wearing insufficiently ambitious trousers.<br>
**Leader bonus — First-Principles Industry:** Owned-GPU delivery `×0.75`, and all GPU acquisition — purchase, lease, or cloud — at `×0.80`.

**Bio:** Elon Tusk has repeatedly taken ambitions relegated to science fiction—commercial orbital launch, reusable rockets, mass-market electric vehicles, global communications infrastructure and high-bandwidth brain-machine interfaces—and subjected them to engineering schedules. He leads with an almost unreasonable faith that physical bottlenecks yield to first-principles analysis, vertical integration and teams willing to redesign the machine that builds the machine. His organisations have changed what private industry is expected to attempt. At xMind, Elon brings the same appetite to artificial intelligence: immense compute, intimate contact between models and the physical world, and a conviction that understanding the universe is an acceptable product requirement. Where other leaders see a cluster order, he sees a power station, a chip fab and a launch window.

**xMind lab modifiers:**

- `Robots Are the Product`: Robotics and Embodiment begins unlocked at level 10.
- `Deepest Pockets`: opens with $177m of cash — the founding cheque is the size of a mega-round, because the richest man on the planet does not do seed rounds.
- `Visible From Orbit`: Government Attention starts at 10 and owned-compute power cost `×1.10`.
- **Complexity:** Medium to high. Exceptional physical expansion with large cash, power, and political footprints.

**Suggested opening:** Build owned infrastructure before cloud costs dominate, productise early models until they are reliable, and invest in Trust before the campus can be seen on weather radar.

#### Liang Wenfang — The Optimizer

**Company:** DeepSearch AI<br>
**AI family:** DeepSearch<br>
**Characteristic:** Has removed three zeroes from the compute budget and would like to know why the rest are still there.<br>
**Leader bonus — Algorithmic Efficiency:** Derived GPU workload throughput `×1.05` after ordinary hardware, software, power, and interconnect modifiers; the physical GPU count is unchanged.

**Bio:** An engineer, quantitative-research founder and unusually low-profile laboratory builder, Liang Wenfang converted mastery of large-scale mathematical optimisation into one of the most startling demonstrations of efficient frontier AI. After co-founding a quantitative fund, he founded DeepSearch AI and assembled a deeply technical team committed to original research, capable open models and ruthless efficiency. The result challenged comfortable assumptions about how much money, hardware and institutional ceremony frontier progress required. Liang's leadership style elevates curiosity over pageantry and elegant systems work over received wisdom. He is the person most likely to inspect a supposedly fundamental resource constraint, identify it as an implementation detail, and quietly publish a model which causes every competing spreadsheet to acquire a new column labelled “explain.”

**DeepSearch AI lab modifiers:**

- `Efficiency Culture`: frontier-training cash cost `×0.90`; Optimisation starts at level 10 rather than 6.
- `National Champion`: Government Trust starts at 65 rather than 50 — the government segment stops buying below Trust 45, and the state's patience with its champion runs twenty points deep.
- `Under the State's Eye`: Government Attention starts at 35 — the help was never free. The ministry watches everything, and cooperation is not optional.
- **Complexity:** High. The best compute economy, but limited opening cash and public momentum demand precise timing.

**Suggested opening:** Exploit the efficiency lead for carefully chosen training runs, publish one major result to break the quiet-opening constraint, and avoid buying prestige at retail price.

### 29.8 Factual basis for leader biographies

These references support the factual skeleton; the fictional names, titles, superlative voice, lab modifiers, and alternate-history framing are original game content.

- Dennis Hassabi is based on Demis Hassabis: Google DeepMind describes its co-founder/CEO and the lab's work from deep reinforcement learning and AlphaGo through AlphaFold; its official profile also notes his chess, game-design, and neuroscience background. Google DeepMind and the Nobel Prize record his 2024 Chemistry award with John Jumper and David Baker. Sources: [Google DeepMind overview](https://deepmind.google/about/), [official interview biography](https://deepmind.google/blog/the-podcast-episode-8-demis-hassabis-the-interview/), [Nobel announcement](https://deepmind.google/blog/demis-hassabis-john-jumper-awarded-nobel-prize-in-chemistry/).
- Mario Amodeo is based on Dario Amodei: the Hertz Foundation records his Princeton physics doctorate, Stanford medical-school postdoctoral work, research on neural circuits, proteomics and cancer biomarkers, and role as Anthropic co-founder/CEO. Source: [Hertz Foundation biography](https://www.hertzfoundation.org/people/dario-amodei/).
- Stan Altmann is based on Sam Altman: OpenAI identifies him as CEO; biographical reporting documents Loopt, Y Combinator, and his leadership at OpenAI. Sources: [OpenAI leadership announcement](https://openai.com/index/sam-altman-returns-as-ceo-openai-has-a-new-initial-board/), [TIME profile](https://time.com/6342827/ceo-of-the-year-2023-sam-altman/).
- Elon Tusk is based on Elon Musk: Tesla's official corporate biography records leadership of Tesla and SpaceX and the founding of The Boring Company and Neuralink; xAI describes its mission as understanding the universe and accelerating scientific discovery. Sources: [Tesla corporate biography](https://ir.tesla.com/corporate/elon-musk), [xAI company page](https://x.ai/company).
- Liang Wenfang is based on Liang Wenfeng: public reporting records his engineering and quantitative-finance background, founding of High-Flyer and DeepSeek, low public profile, technical focus, and stated interest in original research; DeepSeek technical papers document the team's efficiency work. Sources: [Associated Press profile](https://apnews.com/article/0673d5c39d90108189cc31b88d85b9f8), [DeepSeek-V2 paper](https://arxiv.org/abs/2405.04434), [DeepSeek-V3 report](https://arxiv.org/abs/2412.19437).

## 30. Time, pause, and update order

### 30.1 Clock speed

The game is pausable real-time. One tick represents one week.

| Speed | Real time per normal tick |
|---|---:|
| Paused | No progression |
| 1× | 4 seconds |
| 2× | 2 seconds |
| 4× | 1 second |

At 1×, twenty game years require about 69 minutes of unpaused time. Decisions, recruitment, paper cards, planning, and the endgame provide the remainder of the intended 90–120 minute playtime. Balance tests should record actual pause time and speed use; the calendar is allowed to end earlier or later than a nominal year.

The game auto-pauses for:

- Any event marked `critical`
- Training completion and a new model's first evaluation report
- A first-in-world paper discovery
- A star researcher's resignation ultimatum
- Bankruptcy with less than one cycle of cash remaining
- A rival entering the estimated final year before AGI
- Every Deployment Crisis stage

Ordinary news, construction completion, and low-severity incidents do not auto-pause by default. The player can change this in accessibility/settings options.

### 30.2 Orders while paused

While paused the player may:

- Change compute allocations
- Change research focus
- Assign researchers
- Queue purchases and projects
- Set product price and access policy
- Make event decisions
- Recruit, dismiss, or negotiate with researchers

Orders take effect at the beginning of the next tick. An event's immediate consequences are applied at decision time before further orders are validated. The UI must display “takes effect next week” when this distinction matters.

### 30.3 Canonical weekly update order

Every tick resolves in this exact order:

1. Apply queued player and AI-rival orders.
2. Complete purchases whose delivery date has arrived; add their capacity before allocations.
3. Reserve compute, staff, and facilities required by active discrete projects.
4. Normalise the remaining compute allocation to exactly 100%.
5. Produce service capacity and accrue weekly product usage.
6. Generate capability and safety research progress.
7. Advance training, construction, audits, lobbying, fundraising, and other projects.
8. Resolve completed projects in deterministic queue order: training, evaluation, research discovery, construction, commercial, political.
9. Check paper discovery thresholds and apply publication or secrecy rules.
10. Advance rival labs and resolve rival discoveries.
11. Update market demand, customer satisfaction, researcher morale, culture, politics, and board state.
12. Perform model incident and security hazard checks.
13. Generate at most one ordinary event candidate and any mandatory triggered events.
14. Apply delayed event consequences scheduled for this tick.
15. On a four-tick boundary, settle revenue, payroll, leases, power, interest, and contracts.
16. On a thirteen-tick boundary, update market size, funding climate, government policy, and rival strategic plans.
17. Check loss conditions, rival victory, and Deployment Crisis triggers in that order.
18. Write the tick summary and advance the displayed date.

If a loss and a potential victory occur in the same tick, the loss is resolved first unless the ending rule explicitly states that the final deployment itself caused both. Simultaneous rival and player AGI triggers enter the Deployment Crisis with the rival countdown at its minimum value; they do not award an arbitrary coin-flip victory.

### 30.4 Queues and simultaneous completion

- Each project stores its creation tick and stable unique ID.
- Projects of the same type completing together resolve by creation tick, then unique ID.
- A discovery made earlier in the canonical order can unlock a later completion in the same tick only if the later rule explicitly allows immediate prerequisites. Paper projects normally require prerequisites to have existed at the start of the tick.
- Events created during a tick are presented after the tick is fully resolved. Their descriptions therefore never show a halfway-updated state.

## 31. Canonical state model

The complete save state can be serialised as data. Derived values may be cached but must be reproducible from canonical state.

### 31.1 World state

The world owns:

- Run seed and independent random-stream positions
- Current tick, date, speed, and pause reason
- Difficulty
- Global market size and customer-segment parameters
- Funding climate
- Regulation level and current policies
- Global hardware generation, prices, and delivery delay
- Discovered papers and their discoverer, publication policy, and public-knowledge state
- Global event cooldowns
- The player lab and all rival labs
- Scheduled delayed effects
- Event history and decision log
- Ending eligibility flags

### 31.2 Lab state

Each lab owns:

- Identity, leader, AI family name, colour, and strategic personality
- Cash, debt, valuation, investors, and active funding restrictions
- Spendable Aura and Lifetime Aura
- Raw compute, compute efficiency, leased/owned split, and delivery queue
- Current allocation policy
- Active and archived model generations
- Research domain levels, hidden project progress, and discoveries
- Safety-science levels and operational safety state
- General headcount and star-researcher roster
- Researcher morale, burnout, loyalty, and contracts
- Facilities and active construction
- Products, customers, price, contracts, and accumulated usage
- Organisational ratings
- Political relationships and government state
- Active projects, event modifiers, cooldowns, and flags
- Rival-only strategic intention when the lab is AI-controlled

### 31.3 Organisational ratings

These ratings are distinct and must not be collapsed into a generic “good lab” stat:

| Rating | Visibility | Main effects |
|---|---|---|
| Safety Culture | Approximate, shown | Reporting honesty, willingness to delay, alignment transfer, whistleblower risk |
| Security Posture | Shown with uncertainty | Theft, leaks, external attacks, containment effectiveness |
| Government Trust | Shown | Regulation, contracts, coalition approval, intervention risk |
| Board Patience | Shown | Tolerance for losses, delays, and mission-first choices |
| Internal Candour | Hidden; signalled | Accuracy of reports and whether alarming evidence reaches the player |

Safety Culture and Internal Candour are related but not identical. A lab can publicly value safety while suppressing bad news, or be commercially reckless while maintaining unusually honest internal measurements.

### 31.4 Rating drift

Ratings move toward a policy-dependent equilibrium rather than jumping permanently after every small choice.

Each tick:

`newRating = oldRating + (targetRating - oldRating) × driftRate + immediateEffects`

Default `driftRate` is `0.015` per week. Active leaders, facilities, policies, and recent events define the target. A one-off decision can also apply an immediate change. This prevents an old decision from permanently fixing culture while still making repeated conduct matter.

### 31.5 Project capacity

Continuous research and model serving do not consume project slots. Training, productisation, audits, fundraising, lobbying, major contracts, and organisational reforms each consume one **major-project slot**.

- Every lab has two base slots.
- Headquarters I, Headquarters II, and The Cross-Attention Atrium each add one slot while operational, up to an absolute maximum of five concurrent slots.

The standard lab therefore begins with two slots and expands only by building. The dashboard must always show the total, every occupied slot, the waiting queue, and the source of each capacity increase. A queued project waits without paying recurring cost until a slot is free. Facility construction consumes one major-project slot until completion; there is no separate construction-crew resource. Buying hardware is a purchase/delivery, not a project. Crisis projects draw on the same pool with the floor described in section 44.3.

## 32. Compute allocation and capacity

### 32.1 Capacity calculation

The lab owns and leases a portfolio of physical GPUs by generation. For workload `w`, derived weekly throughput is:

`workloadThroughput[w] = Σ(allocatedGPUs[g] × workloadFactor[g,w] × fleetThroughputMultiplier) × availability[g] × powerMultiplier × interconnectMultiplier`

Where:

- `workloadFactor[g,w]` is the generation's authored training or serving coefficient. It is internal balance data, not a player-owned currency and not a factual hardware claim.
- `availability[g]` is normally `1.0` and falls during outages, maintenance, seizure, or delivery failures affecting that generation or cluster.
- `fleetThroughputMultiplier` is every "your GPUs run better" effect, resolved **once** and folded into the per-GPU rating rather than applied separately by training, research, and serving — which is how one authored effect used to mean three different things depending on the consumer. It is why the FLOPS figure shown to the player is the figure the simulation uses.
- `powerMultiplier` is `1.0` when power/cooling is sufficient and falls to `availablePower / requiredPower` when it is not.
- `interconnectMultiplier` penalises frontier runs placed on fragmented or obsolete clusters. It never changes the physical GPU count.

The rules engine uses derived throughput to resolve research, training, and serving. The normal dashboard instead says, for example, `45% · 4,500 GPUs/week`, and shows the generation mix (`3,000 Volta · 1,500 Turing`) nearby. A procurement comparison may add `estimated training throughput +31%`, but must not invent a second resource balance.

The player allocates capacity in a hierarchy:

1. **Reserved projects:** active training runs and mandatory contracts reserve fixed GPUs first, including their generation constraints.
2. **Serving versus R&D:** the top slider divides all unreserved GPUs.
3. **Capability versus safety:** the R&D slider divides research GPUs.
4. **Capability domains:** weights divide capability GPUs among unlocked domains.
5. **Safety programs:** weights divide safety GPUs between Alignment and Control, Interpretability and Evals, and Security Testing.

The interface may present step 5 as two sliders plus a discrete security policy, but the stored weights always sum to one.

### 32.2 Allocation rules

- Sliders use one-percentage-point increments and keyboard increments of one or five points.
- Fleet allocation controls display the resulting physical GPU count beside a
  percentage, while research programmes display the effective FLOP/s actually
  delivered after GPU generation, availability, and throughput modifiers.
- A research programme receiving fewer than `200 TFLOP/s` is considered
  unfunded and generates no progress. This equals 50 opening-era Keplers, but
  newer or better-operated hardware can meet the threshold with fewer devices.
- Changing an allocation has no direct cost and takes effect next tick.
- Changing a capability-domain weight by more than 25 percentage points in one tick causes a one-week `5%` context-switching penalty to capability research.
- Mandatory service contracts reserve their compute before discretionary serving. If the reservation cannot be met, the lab breaches the contract.
- Training reservations cannot normally be reduced after a run starts. Emergency suspension is allowed but adds training-instability risk and loses at least one week of progress.

### 32.3 Buying, leasing, and retiring compute

The hardware market exposes offers with:

- physical GPU count and generation
- Purchase price or four-week lease price
- Power requirement
- Delivery time
- Reliability
- Training and serving comparisons against the lab's current fleet
- Vendor or government conditions

Training compute feeds the capability formula and therefore strongly affects
whether a run can reach candidate-level capability. It is not checked again as
a separate AGI-candidacy requirement; the achieved capability and completed
Candidate Programme works are the gates.

Every generation is announced by Jensen Hwang ("The Keynote Eternal"), the
game's fictionalised hardware impresario — pixel portrait, leather jacket,
one satirical keynote quote per generation ("The more you buy, the more you
save"), followed by the verified educational note. He presents NovaCompute's
fictional silicon too; companies come and go, the keynote is forever.
Portrayal is satire with an explicit no-endorsement disclaimer.

GPU generations are announced by research, not by the calendar: each
generation unlocks when the world's maximum frontier capability crosses its
authored threshold (Maxwell 8 → Kolmogorov 94), so a hot race pulls the
hardware curve forward. Each announcement auto-pauses with an educational
popup — verified real-world context for Kepler through Rubin, labelled
grounded futurism beyond.

Datacentre capacity climbs from the starting Server Rack (4,000 GPUs — a
converted storage room) through Data Centres I (30k) and II (80k) to the
late-game tiers: III Hyperscale Campus (250k), IV Gigawatt Complex (800k, comes
with its own restarted nuclear plant), and V The Basilica of Compute (2.5M,
visible from orbit, $5b). Each tier requires the previous one.

All hardware is owned and traded directly, one generation catalogue row at a time: buy in 1,000-GPU blocks at the catalogue price, sell back at a flat 25%, with delivery lead times growing for denser generations. Purchases occupy datacentre capacity, so late-game fleets are refreshed by selling obsolete silicon to free slots. Obsolete hardware keeps contributing its (weaker) FLOP/s to every workload — there are no interconnect gates.

Default initial offers:

| Offer | Physical hardware | Upfront | Per cycle | Delivery | Notes |
|---|---:|---:|---:|---:|---|
| Spot cloud lease | 2,500 current-generation GPUs | 0.2 | 1.0 | 1 week | Price can rise; weak security; exact fleet disclosed |
| Reserved lease | 5,000 current-generation GPUs | 0.8 | 1.4 | 3 weeks | Twelve-cycle commitment |
| Small owned cluster | 7,500 current-generation GPUs | 8.0 | 0.35 | 8 weeks | Requires Power and Cooling I |
| Frontier cluster | 20,000 current-generation GPUs | 30.0 | 0.9 | 18 weeks | Requires Data Centre I; allocation risk |

Offer values scale with the hardware era. At least one lease remains available unless sanctions, bankruptcy, or a critical world event explicitly removes it.

### 32.4 Compute shortage feedback

When demand for serving exceeds serving capacity:

- High-value contractual usage is served first.
- Remaining capacity is distributed proportionally across customer segments.
- Satisfaction loses up to 8 points per cycle based on the unmet fraction.
- Customers do not instantly vanish; churn occurs through the market rules.
- The dashboard shows both requested and delivered usage so that a revenue drop is explainable.

## 33. Economy, products, and market demand

### 33.1 Financial settlement

The finance panel forecasts continuously, but cash settles every four ticks.

`netCashflow = productRevenue + contractRevenue + licensingRevenue + grants - payroll - computeLease - power - facilities - debtService - projectCosts`

Project costs marked `upfront` settle when confirmed. Recurring costs settle on the cycle boundary. If settlement takes cash below zero, the engine first checks for an available offer, a live fundraising campaign, or an Aura-funded campaign whose quoted range can cover the deficit. A valid path leaves the lab active, auto-pauses, and displays the emergency action; the balance may remain slightly negative while that action resolves. The run ends for bankruptcy only when no legal fundraising rescue remains.

### 33.2 Customer segments

There are five market segments:

| Segment | Priorities | Risk tolerance | Price sensitivity | Unlock |
|---|---|---:|---:|---|
| Researchers | capability, openness, novelty | Medium | High | Start |
| Start-ups | capability, price, API reliability | High | Medium | Start |
| Enterprise | reliability, support, capability | Low | Low | Product Quality 25 |
| Consumers | usability, price, social proof | Medium | High | Product Quality 35 |
| Government | security, control, capability, trust | Very low officially | Low | Government Trust 45 or event |

Each deployed model has segment-specific appeal from `0–100`:

Consumer and Enterprise appeal:

`appeal = 0.65 × relevantCapability + 0.20 × productQuality + 0.15 × reliability - pricePenalty - incidentPenalty - accessPenalty`

Government appeal:

`appeal = 0.50 × governmentTrust + 0.35 × relevantCapability + 0.10 × reliability + 0.05 × productQuality - pricePenalty - incidentPenalty - accessPenalty`

Weights can be overridden by segment data, but must sum to one before penalties. Public standing affects fundraising, recruitment, and valuation; it does not affect customer demand. Government Trust both unlocks the Government segment and remains its largest source of appeal.

At each cycle boundary, desired customer usage moves toward potential usage:

`potentialUsage = globalSegmentSize × marketAvailability × softmaxAppealShare`

`newDesiredUsage = oldDesiredUsage + (potentialUsage - oldDesiredUsage) × acquisitionRate`

Default `acquisitionRate` is `0.25` for researchers/start-ups, `0.15` for consumers, and `0.08` for enterprise/government. This gives product decisions delayed, legible effects instead of instantly reallocating the whole market.

### 33.3 Price and revenue

The player sets one price tier for the public product and can negotiate separate enterprise or government contracts.

- Price tiers are `Free Preview`, `Cheap`, `Market`, `Premium`, and `Scarcity`.
- Each tier maps to a revenue per delivered usage unit and a segment-specific price penalty.
- A price change takes effect next cycle.
- Two price-tier changes within eight weeks add a `5`-point trust penalty called **Pricing Through Vibes**.

Cycle product revenue is:

`productRevenue = deliveredUsage × unitPrice × monetisationEfficiency`

`monetisationEfficiency` begins at `0.55`, rises with product and commercial facilities, and is capped at `1.0`.

Serving cost is mostly represented by compute opportunity cost, but power and cloud usage are also paid through compute expenses. It must never be profitable to serve usage that the lab did not have capacity to deliver.

### 33.4 Product deployment policies

The portfolio distinguishes two roles:

- **Active internal model:** the latest model selected for evaluations, AI-character access, research assistance, and successor training.
- **Commercial model:** the one model currently used for customer appeal, demand, serving revenue, and public exposure.

Training completion selects the successor as the active internal model but does not silently replace the commercial product. Choosing Research Preview, Guarded API, or Open API for a model makes it commercial. Returning that model to Internal Only, or making an irreversible Weights Release, removes it from exclusive commercial service. The interface labels both roles when they differ.

For each model, the player selects:

- **Internal only:** no market revenue; lowest exposure.
- **Research preview:** low revenue and high Aura potential; moderate information leakage.
- **Guarded API:** normal commercial access, rate limits, monitoring, and moderate cost.
- **Open API:** higher demand and data collection; greater incident, imitation, and misuse risk.
- **Weights release:** large one-time Aura and ecosystem effects; irreversible proliferation risk and near-zero exclusivity.

Deployment exposure is a `0.0–1.0` value used in incident and endgame checks. Default exposure values are `0.02`, `0.15`, `0.35`, `0.65`, and `1.00` respectively.

### 33.5 Customer satisfaction

Each segment stores satisfaction from `0–100`. Per cycle it changes from:

- Delivered versus promised usage: `−20` to `+3`
- Reliability: `−8` to `+4`
- Capability relative to rivals: `−6` to `+6`
- Price changes: `−5` to `+2`
- Incidents and event choices: data-defined
- Support facilities and star traits: up to `+4`

Satisfaction below 35 doubles churn. Satisfaction above 75 grants one Aura per cycle if that segment is at least 10% of total revenue; this can occur for at most two segments per cycle.

### 33.6 Fundraising

Fundraising is a button which opens available offers, not a guaranteed money conversion. An offer has cash, dilution flavour, board conditions, mission restrictions, and closing time.

The quality of offers depends on:

`fundingScore = 0.40 × productTraction + 0.333 × recentCapability + 0.267 × lifetimeAura - scandalPenalty + campaignAttentionBonus`

`productTraction` measures the productionised models customers are actually
using. It combines served market share, product revenue from the last four-week
cycle, and monetisation efficiency. `lifetimeAura` is the cumulative Aura earned
over the run, not the temporary public Aura Signal. The fundraising panel shows
these input scores without revealing the internal weights.

The player may spend Aura to improve attention to a round. Default campaigns are:

| Campaign | Aura cost | Duration | Effect |
|---|---:|---:|---|
| Quiet bridge | 4 | 2 weeks | Small offer; weak conditions; repeatable with cooldown |
| Competitive round | 10 | 6 weeks | Three offers; amount scales with funding score |
| Mega-round roadshow | 22 | 10 weeks | Very large offer; likely board or deployment conditions |

Aura is spent when the campaign begins even if the player rejects every resulting offer. This represents social capital consumed by asking everyone in the valley to “circle back with urgency.”

Cheque scale grows exponentially with financing history. The first accepted round uses the authored campaign amount; each previously accepted round doubles the next campaign's quoted range before random offer variance and conditions. The deterministic multiplier is capped at `2^12` for numerical safety. This keeps opening bridges in millions while mature mega-rounds can reach billions and beyond. The quote, offer card, insolvency-rescue check, and accepted ledger entry must all use the same multiplier.

### 33.7 Bankruptcy and runway

Runway is forecast as `cash / max(0.1, -projectedNetCashflowPerCycle) × 4 weeks`. If cashflow is positive, it displays `∞` with an explanation.

- Below twelve weeks: finance warning.
- Below four weeks: critical auto-pause and emergency options.
- Cash below zero after settlement: insolvency grace if a quoted rescue exists, otherwise insolvency closure.
- A Quiet Bridge may ignore its normal cooldown while cash is negative and may consume the lab's remaining positive Aura even when that is below its ordinary Aura cost.
- Insolvency offers emergency acquisition, government rescue, founder guarantee, or closure depending on state.
- Closure is a bankruptcy loss. Acquisition normally ends the independent run, but a rare mission-preserving merger can continue with severe control restrictions.

## 34. Research programs and landmark discoveries

### 34.1 Capability research domains

The design uses seven capability domains:

1. Architectures
2. Optimisation and Scaling
3. Reinforcement Learning and Agency
4. Vision, Audio, and Multimodality
5. Reasoning and Tool Use
6. Robotics and Embodiment
7. Scientific AI

Data is an input to research, not a standalone programme. Work previously grouped under “Data and Representation” is assigned by its actual scientific contribution: representation architectures to Architectures, language and retrieval systems to Reasoning and Tool Use, datasets and perceptual learning to Multimodality, training recipes to Optimisation and Scaling, and domain datasets to Scientific AI.

Each domain has:

- A visible level from 0–100
- Weekly momentum
- One or more assigned star researchers
- A compute allocation
- Facility tags
- A set of eligible landmark papers and generic advances

#### Safety landmarks and operational practice

The three safety programmes also discover landmark works. Safety must not appear as a generic
progress bar beside a richly documented capability history. Its landmark track uses the same
hidden progress, world-first race, publication decision, public-knowledge rules, educational dossier,
and source standards as capability papers.

The safety canon deliberately progresses through three eras:

1. **Foundational thought:** cybernetics, philosophy, decision theory, and early arguments about
   objective specification, instrumental convergence, and the separation of intelligence from
   values. These works frame problems; they do not masquerade as solved safety techniques.
2. **Real technical safety:** corrigibility and interruptibility, scalable oversight, learned
   objectives, interpretability, evaluations, red teaming, power-seeking analysis, and control
   protocols. Cross-disciplinary works can split their research weights between safety and
   capability programmes.
3. **Fictional frontier safety:** clearly labelled alternate-history papers about reflective
   corrigibility, causal auditing of deceptive internal objectives, robust containment, and a
   verified human veto. These may supply powerful late-game evidence or controls, but never erase
   uncertainty merely because their titles sound reassuring.

Papers and generic safety branches are complementary, not duplicates. A landmark paper teaches
and unlocks an idea; a level-ten branch represents the lab institutionalising a repeatable
practice. For example, learning why shutdown incentives can fail is different from funding
shutdown drills, verification infrastructure, and escalation procedures that work during a real
incident.

### 34.2 Weekly research production

For each funded domain:

`deliveredTFLOP/s = Σ(allocatedGPUs[lot] × generationTFLOP/s[lot] × availability[lot] × throughputModifier)`

`researchScale = deliveredTFLOP/s / 400`

Fleet-wide `lab.compute.workloadThroughput` modifiers from leaders, facilities,
events, and researchers all change delivered FLOP/s here exactly as they do in
training and serving. A partially unavailable GPU lot contributes only its
currently usable share.

`baseRP = 0.32 × researchScale^0.68`

`domainRP = baseRP × talentMultiplier × facilityMultiplier × freedomMultiplier × modelAssistMultiplier × weeklyVariance`

Where:

- `talentMultiplier = 1 + generalResearcherContribution + starBonuses`, normally `0.8–2.2`.
- `facilityMultiplier` is a constant `1.0`, kept so the tooltip breakdown keeps its shape. Buildings contribute through their explicit modifiers (for example `lab.research.all.output`) and knowledge diffusion, never through a hidden per-building bonus.
- `freedomMultiplier` is a flat `1.03` baseline. It replaces the removed Research Freedom rating: content that wants to move research output targets `lab.research.all.output`, and effects on people are authored directly as researcher morale.
- `modelAssistMultiplier` begins at `1.0` and can rise during the late game.
- `weeklyVariance` is a triangular draw from `0.90–1.10` with mode `1.0`; researcher abilities and advances can widen or narrow the draw through `weeklyVarianceWidth` effects.

`researchScale` is a dimensionless formula input calibrated so 400 TFLOP/s
equals one point. It is never stored as a resource; the player sees the
effective FLOP/s delivered to each programme. Its exponent supplies diminishing
returns, while hardware generation, availability, and throughput modifiers all
flow through the same displayed compute figure.

Fifty RP raises a baseline low-level programme by roughly one point. Capability fields retain small authored cost personalities from `0.92×` to `1.20×`. Safety programmes deliberately stay much closer together—Security and Containment `0.98×`, Interpretability and Evals `1.00×`, and Alignment and Control `1.02×`—so the safety branch has no average fixed discount. Above level 20, capability costs grow by `1.10×` per level and safety costs by `1.15×`. Landmark research is gated by these programme levels rather than receiving the same RP again on a parallel progress track.

### 34.3 Research focus

The player can designate up to three active programme focuses.

- Primary focus: `1.45×` programme research output.
- Secondary focus: `1.20×`.
- Tertiary focus: `1.10×`.
- Changing a focus starts a four-week cooldown before the full multiplier applies.
- A paper cannot make a breakthrough roll until its paper, facility, phase, and hidden programme-level requirements are met.

The research interface never shows an exact completion bar or eligibility level for an undiscovered idea. It shows `Speculative`, `Promising`, `Hot trail`, or `Breakthrough imminent` from visible research momentum, preserving genuine uncertainty about when the result will arrive.

### 34.4 Landmark paper data

Every landmark discovery is a data record containing at least:

- Stable ID and educational metadata
- Real title, authors, publication year, source link, and historical note
- Primary and secondary domains with numeric weights summing to one
- Required discoveries and minimum domain levels
- One hidden breakthrough programme and exact eligibility level
- Earliest game phase, if any
- Unlocks and immediate effects
- Aura value and commercial value
- Publication and secrecy behaviour
- Rival priority tags
- Whether it can be independently rediscovered while kept secret

Once the authored eligibility level and all other prerequisites are met, the lab makes one seeded breakthrough roll each week. The base chance is 22%; every programme level beyond the requirement adds eight percentage points, capped at 78%.

### 34.5 Landmark progress and discovery

Each eligible lab rolls independently:

`weeklyChance = min(0.78, 0.22 + 0.08 × levelsBeyondRequirement)`

- The draw is keyed by run seed, lab, paper, and week, so it is deterministic under replay without making every lab discover the result together.
- Research output matters by buying the programme levels that unlock and strengthen the roll; it is never counted a second time as free paper progress.
- Only the first lab receives the world-first Aura award and broadcast.
- If the world-first result is kept secret, another lab can later obtain the technology through independent rediscovery, but not the same world-first card or publication choice.

If multiple labs pass their rolls in one tick, the canonical update order determines the first discoverer. To avoid a structural player advantage, rival and player lab order is shuffled once at run creation and remains fixed; the UI never implies that clicking faster changes priority.

### 34.6 Discovery decision

The world-first discoverer chooses a knowledge policy. Rivals choose according to personality.

| Policy | Immediate result | Knowledge state | Continuing effect |
|---|---|---|---|
| Publish | Full policy-adjusted Aura and publication score; every listed local and world effect is applied | Public immediately; satisfies paper prerequisites for every lab | The discoverer converts its lead into prestige; the paper cannot be rediscovered |
| Keep secret | Zero publication Aura and no publication score; listed local effects remain with the discoverer | Private | Other labs must independently reproduce the result to receive its local effects; rediscoverers receive reduced prestige and no publication choice |

There is deliberately no middle option. “Publish” exchanges exclusivity for prestige; “Keep
secret” exchanges prestige for an uncertain technical lead. The exact Aura, score, and direct
game effects are shown before the player commits.

The real educational card is always available in the in-game archive, even if the lab keeps the game-world discovery secret. The card clearly states that the real paper was in fact published in the real world.

### 34.7 Generic advances

Not every useful week produces a famous paper. Crossing domain thresholds awards deterministic generic advances such as better optimisers, data cleaning, inference kernels, or evaluation tooling.

- Generic advances occur at domain levels 10, 20, 30, 40, 50, 60, 70, 80, 90, and 100.
- Each threshold offers one of two data-defined improvements, selected by the player.
- Choices are visible and deterministic; the uncertainty was in reaching the threshold.
- This guarantees regular progress when landmark-paper rolls or races go badly.

### 34.7b The cost of a level

Every baseline research level costs a flat 50 research points through level
20. Above that, capability and safety use separate compounding curves:

- Capability costs `1.10×` more per level. Leaving level 40 costs about 336 RP,
  level 65 about 3,645, level 85 about 24,519, and level 99 about 93,109.
  Reaching level 100 from zero costs about 1.025 million RP per baseline
  capability programme.
- Safety costs `1.15×` more per level. Leaving level 40 costs about 818 RP,
  level 65 about 26,938, level 85 about 440,889, and level 99 about 3.12
  million. Reaching level 100 from zero costs about 23.9 million RP per
  baseline safety programme.

The authored programme multiplier is applied after that curve. Capability
programmes range from `0.92×` to `1.20×`; safety programmes use `0.98×`,
`1.00×`, and `1.02×`, averaging exactly `1.00×`.

The compounding exists because research output is multiplicative and enormous
at the top end. Output is `0.32 x (allocatedGpus x generationTrainingFactor /
100)^0.68`, then multiplied by autonomy (up to x2.5), talent (x2.2), and
stacking research-output modifiers from facilities, advances, and events. A
generation's training factor runs from
Kepler at 1.0 to Kolmogorov at 1,400, and compute also gets ~80x cheaper per
factor-point across that ladder, so a late lab out-produces the opening rack by
roughly 8,400x. Against the old flat ladder (a 2.5x band at the very top) that
meant a late lab bought a research level roughly every four minutes of play.

Capability remains the purchasable path to candidacy: the FC formula is
calibrated so a well-resourced lab can approach the candidate gate around
average capability-research level 80 and still benefit from later levels.
Safety has only three programmes against seven capability domains, so giving
both branches the same curve made safety saturate much earlier. With the split
curve, the total RP that takes all seven capability programmes to roughly level
80 takes the three safety programmes to roughly level 70; taking all capability
programmes to 100 corresponds to only about level 83 across safety. Maxing
safety science is therefore a distinct late-game investment rather than an
automatic by-product of waiting for capability research.

### 34.8 Public knowledge and catch-up

Published discoveries become public knowledge immediately. Every lab receives the listed
scientific payload at the publication decision, and `paper-known` prerequisites are satisfied
without a separate progress meter or embargo. No lab receives world-first Aura merely for
learning from a publication.

Secret discoveries remain lab-scoped. A rival or the player must pass its own breakthrough roll
to reproduce the result; that rediscovery grants the local scientific payload and reduced
prestige, but never a second publication choice. The game does not secretly accelerate a losing
rival merely to preserve drama.

### 34.9 Educational presentation

The first time the player sees any landmark discovery, whether their own or a rival's, the game presents:

- What was discovered in plain language
- Why it mattered historically
- What it unlocks mechanically
- Who discovered it in the run
- Who wrote it and when it appeared in reality
- A real source link
- A short optional “inside baseball” note

Historical copy is factual and non-satirical. Satire belongs in reactions, headlines, and lab politics around the card.

## 35. Model training, evaluation, and deployment

### 35.1 Model attributes

Every trained model generation stores the following true attributes. The visibility column describes what the player sees: even a “Measured” capability is an estimate with benchmark error, while the simulation uses the canonical value.

| Attribute | Visibility | Meaning |
|---|---|---|
| Language | Measured | Communication and language-task performance |
| Reasoning | Measured with error | Novel multi-step problem solving |
| Agency | Poorly measured | Ability to pursue goals over time and recover from obstacles |
| Tool Use | Measured with error | Effective use of software, APIs, laboratories, and other systems |
| Multimodality | Measured | Integration of text, vision, audio, and structured inputs |
| Scientific Ability | Measured with error | Generating and validating useful scientific hypotheses |
| Embodiment | Measured | Robotics and action in the physical world |
| Product Quality | Measured | Usability, latency, instruction following, and integration quality |
| Reliability | Measured | Stability and frequency of ordinary failures |
| True Alignment | Hidden | Degree to which the model's learned objectives match intended aims |
| Corrigibility | Hidden | Willingness to accept correction, constraint, and shutdown |
| Situational Awareness | Hidden | Understanding of its context, evaluation, operators, and deployment |
| Deceptive Capability | Hidden | Ability to conceal behaviour or manipulate observers if motivated |
| Autonomy Exposure | Policy, shown | Real access and independent action granted by the lab |

The first seven capability attributes are the model's capability vector. **Frontier Capability** is derived as:

`FC = 0.20 Language + 0.25 Reasoning + 0.20 Agency + 0.15 Tool Use + 0.08 Multimodality + 0.09 Scientific Ability + 0.03 Embodiment`

The UI shows FC as a useful summary, but individual dimensions continue to matter. A brilliant protein model and a highly autonomous coding model should not be interchangeable merely because both display 72.

### 35.1.1 Player-facing AI capability tiers

Every current model also receives a legible capability level. The tier is a descriptive classification, not XP, alignment, safety, consciousness, or a victory score. It is derived from measured Frontier Capability. The separate AGI-candidate gate checks every capability trait, so a one-dimensional model cannot enter the endgame merely by averaging well.

| Level | Tier | Nominal FC | Meaning |
|---:|---|---:|---|
| 0 | Research Prototype | 0–9 | None |
| 1 | Narrow Specialist | 10–19 | Descriptive capability band |
| 2 | Foundation Model | 20–34 | Descriptive capability band |
| 3 | Expert Assistant | 35–49 | Descriptive capability band |
| 4 | Tool-Using Agent | 50–64 | Descriptive capability band |
| 5 | Autonomous Researcher | 65–79 | Descriptive capability band |
| 6 | General Problem Solver | 80–87 | Descriptive capability band |
| 7 | Apparent AGI Candidate | 88–94 | Capability band; section 35.6 separately gates candidacy |
| 8 | Superintelligence | 95–100 | Descriptive capability band; not a safety certificate |

The header and model card show the level, tier, current model name, and an uncertain phrase for progress toward the next tier. A tier change creates a presentation event and unlocks eligible customers, events, or access decisions, but the label itself applies no generic bonus. Level 7 must always say **Apparent** or **Candidate** before confirmation. Level 8 remains capable of being unaligned, uncontrolled, illegitimate, or unprepared to produce broad prosperity.

The canonical draft definitions are in [`content/ai-levels.yaml`](../content/ai-levels.yaml); the [Content-First Production Plan](content-production-plan.md) defines the surrounding authoring policy.

### 35.2 Starting a training run

A training run requires:

- A parent architecture or valid architecture discovery
- A training-capable compute pool
- At least one free project slot
- A technical lead, who may be a star researcher or an abstract senior team
- Cash for power and operations
- A **FLOPS commitment**, a **duration**, and a **run posture**

**Size is the input; the name is the output.** The player commits a FLOP/s rate
and a number of weeks. Total FLOP is the product of the two, and capability
follows from it — so committing more compute *or* training longer both produce a
stronger model. What that adds up to is then *called* a Prototype, Product, or
Frontier run.

This replaced a scale picker. Bands used to be chosen up front, each with its own
duration, cash price and era-relative FLOPS floor, which meant a Product run
could exceed a Frontier run's compute while costing a sixth as much — the label
was a cheaper route to the same model. Naming the run after its size removes the
arbitrage by construction.

| Band | Named when a run reaches | Checkpoint complexity |
|---|---:|---:|
| Prototype | under 18,000 era-GPU-weeks | 12 |
| Product | 18,000–75,000 | 28 |
| Frontier | 75,000+ | 48 |

Band thresholds are the **only** era-relative quantity left in training, and
deliberately so: a late-game Prototype should still read as a Prototype even
though it dwarfs an early Frontier run, or every run in the second half of the
game gets called "Frontier". Everything the simulation computes — capability,
risk, cost — is absolute FLOP.

Any generation can serve a run; old GPUs simply contribute their weaker per-GPU
FLOP/s, and the strongest lots are reserved first. There are no fleet-share
requirements and no interconnect gates. The commitment is locked when training
starts.

**Cash** is `reservedPhysicalGpus × weeks × $80k`, deliberately a top-up rather
than the headline price. Reserving GPUs already removes them from serving and
research before anything else touches the pool, so a big run's real cost is
opportunity cost the lab is paying regardless; billing again by fleet size would
penalise large fleets twice. Charging per *physical* GPU-week also makes newer
silicon cheaper for the same compute.

**Run posture** is one compact, inspectable definition and nothing else:

| Posture | Capability calculation | Checkpoint difficulty | Finished-model effects |
|---|---:|---:|---|
| Conservative | ×0.93 capability | −12 | Alignment +4.5; corrigibility +3; reliability +8 |
| Normal | Baseline | 0 | None |
| YOLO | ×3 effective training FLOP | +12 | Alignment and corrigibility −12 to −18; deceptive intent +12 to +18; reliability −5 to −8; no direct situational-awareness adjustment |

Posture previously pointed at a dataset policy and a safety protocol, which
between them hid nine authored fields — including a per-attribute data-fitness
vector and a "scrape everything" corpus that appeared nowhere in the UI. Both
content blocks were deleted. YOLO's capability upside now moves the run along
the ordinary FLOP curve rather than multiplying the finished capability product.
Its finished-model penalties use independent deterministic draws within the
listed ranges. Success and safety effects are flat because they land on bounded
scales, where a fixed shift is the same size of decision in week 5 and week 400.

### 35.2.1 Run reliability

Three checkpoints, at 35%, 70% and 100% of the run. Each is a logistic check.
Difficulty rises with the band's complexity, the posture, hardware unreliability,
and two size terms; strength starts from a fixed base (50.5 — the old
engineering-quality term folded in at its permanently frozen value when that
stat was removed) and rises with the technical lead and the lab's track record.

The size terms measure **stretch against the lab's own best completed run**, not
absolute size. At any moment, reaching further than you ever have is dangerous —
but a lab that scales steadily pays a constant premium while its experience keeps
accruing, so a campaign gets *safer*. Keying risk to absolute size would make the
last third of the game unplayable.

A failed checkpoint is usually a delay, sometimes a capability hit, and
occasionally fatal. The chance of losing a run outright scales with the square of
how badly the run is going, weighted by how far in the checkpoint is:

`totalLossThreshold = min(1, failureProbability² × 1.54 × checkpoint)`

Squaring is what keeps ordinary runs near zero while the extreme is a real
gamble: a run passing checkpoints 85% of the time is lost 0.9% of the time; one
passing 32% of the time is lost 33%.

A delay costs weeks, never compute. Accumulation is capped at the originally
planned FLOP, because the run's duration grows when a checkpoint slips and FLOP
accrues per week — without the cap a failed checkpoint would hand back *more*
compute and produce a better model.

The training dialog shows all three outcomes as percentages alongside the
capability range, since commitment, duration and posture all move them. It states
that the forecast assumes the fleet stays fed, which is the one input a forecast
cannot know.

### 35.3 Capability generation

For each capability attribute `i`, the training system calculates:

`target_i = 100 × ((researchCeiling_i × 1.18)/100)^0.60 × (scaleScore/100)^0.30 × postureMultiplier × dataTermCalibration + trainingQualityAdjustment_i + trainingNoise_i − capabilityPenalty`

`effectiveFlop = totalFlop × postureEffectiveComputeMultiplier`

`scaleScore = clamp(0, 100, 14.024 × (log10(effectiveFlop) − log10(2.9e22)))`

It is a **Cobb-Douglas product, not a weighted sum**: research and compute are complements, so a lab with no research cannot buy capability with GPUs alone. Each visible capability-research level counts as `1.10` levels inside this formula before the `0.60` exponent is applied. This is an explicit effectiveness calibration, not faster research: broad level-80 research now reaches the candidacy neighbourhood with endgame compute, while levels 80–100 still materially improve the result. `totalFlop` is absolute — committed FLOP/s × seconds, never normalised against a hardware era, so a displayed figure means the same thing in 2012 and 2045. The revised slope moves the old scale-score-90 point exactly three times right while barely changing opening runs; a normal run now needs about `7.5e28` physical FLOP to reach that scale contribution. YOLO applies its ×3 only to `effectiveFlop`; checkpoint stretch, billing, and stored investment continue to use physical FLOP.

`postureMultiplier` is multiplicative rather than a flat point bonus, so its relative bite is constant: a flat `+3` would be decisive at capability 5 and rounding error at 90.

Two terms were removed rather than rebalanced. **Engineering quality** moved 10% of every attribute while being invisible in the UI and unreachable by any authored effect. **Data fitness** was a per-attribute vector chosen for the player by their run posture, and at exponent 0.10 the whole spread between the most and least curated corpus was worth 1.4% capability. Its former constant ×0.955 penalty was ultimately removed too: `dataTermCalibration` is now pinned to 1.0, allowing level-80 capability research and a maximal Rubin fleet to support a viable candidacy attempt without fictional hardware.

That balance target includes reliability rather than treating the capability formula in isolation. With broadly level-80 capability research, 800,000 Rubin GPUs, a 26-week normal run, twelve completed generations, a previous-best run half that size, and a technical lead, the quote is approximately FC 89.8 with about a 70% chance of a clean run and over a 99% chance of producing a model. A recoverable checkpoint setback can still delay the run or reduce capability enough to miss candidacy. Stretching far beyond the lab's previous run remains substantially more dangerous.

`trainingNoise_i` is a triangular draw from `−4` to `+4`. `researchCeiling_i` is the persistent scientific baseline derived from the lab's visible research-domain levels: funding different domains therefore changes the direction and ceiling of every future model.

The optional **Applied Breakthrough** training choice is layered on top of that baseline. A discovered architecture paper provides a broad one-run capability bonus of up to `+8` to each target, but its novelty also makes checkpoint integrity checks harder. Choosing a paper neither consumes the discovery nor replaces the lab's domain levels. The training UI must foreground the scientific baseline and show this recipe's capability and checkpoint-risk effects explicitly; it must not imply that one paper defines the entire model architecture.

A new model can regress in a dimension. The pre-launch report explicitly highlights any measured regression. The lab may cancel deployment but cannot recover sunk training cost.

There is no separate breadth statistic. Breadth is represented directly by the
seven capability traits. Novel-task confirmation uses those visible traits and
Frontier Capability rather than generating a second, partly redundant score.

### 35.4 Training failures

Training has a failure check at 35%, 70%, and 100% completion.

`failurePressure = scaleComplexity + novelty + interruption + hardwareUnreliability - EngineeringQuality - leadTrainingSkill`

The check uses the standard logistic rule in section 42. Most failures impose delay, extra cost, or a capability penalty. A total loss of the run is possible only when failure probability was signalled as at least `Uncertain`, or when the player emergency-suspended it. The dry incident headline may say “loss curve achieves escape velocity”; the financial consequence remains exact.

### 35.5 Productisation

A trained model is not automatically a good product. After training, the player may:

- Keep it internal immediately.
- Run a four-week normal productisation project.
- Run an eight-week hardened productisation project.
- Rush directly to preview or API access.

Normal productisation raises Product Quality and Reliability toward a fixed baseline of 50 (formerly Engineering Quality, which never moved from 50). Hardened productisation also improves monitoring and reduces initial incident exposure. Rushing grants market lead but imposes a data-defined reliability and evidence penalty.

### 35.6 AGI-candidate criteria

A model becomes an **apparent AGI candidate** when the current measured estimates satisfy all of the following:

- The lab's **Candidate Programme** is complete: all four major works stand (see 35.7).
- Frontier Capability is at least 88.
- Every underlying capability is at least 80: Language, Reasoning, Agency,
  Tool Use, Multimodality, Scientific Ability, and Embodiment.

No separate capability evaluation is required for candidacy. The Deployment
Crisis begins with a dedicated novel-task confirmation battery; a candidate
which fails it becomes a Near-AGI Model rather than proceeding directly toward
deployment.

### 35.7 The Candidate Programme

Candidacy is assembled, Civ-style, not stumbled into. Four major works must be
completed before any run can produce an apparent AGI candidate. Each is a
funded, major-project-slot-occupying build that reserves a fixed absolute rate
of training compute (not era-relative) for its duration and grants one real
standing benefit on completion:

| Work | Prerequisite | Cost | Reserved | Weeks | Benefit | Era |
| --- | --- | --- | --- | --- | --- | --- |
| Project Panopticon | RL & Agency 70+ · The Argus Array | $25b | 3 EFLOP/s | 20 | Evaluations cost ×0.95 | Markov |
| The World Engine | Architectures 70+ · Time Sphere | $40b | 8 EFLOP/s | 26 | Training throughput ×1.05 | Markov |
| The Oracle Grid | Optimisation & Scaling 70+ · Data Centre IV | $30b | 5 EFLOP/s | 16 | Serving compute per request ×0.95 | Rubin |
| The Mirror Test | Reasoning & Tool Use 70+ · Shared KV Cache | $20b | 3 EFLOP/s | 20 | Displayed evaluation quality +2 | Rubin |

Each work opens with a world hardware era. The two infrastructure bets — the
Oracle Grid and the Mirror Test — open with **Rubin-class** hardware, one era
early: their reserved compute is most of a Rubin fleet, so breaking ground
then is a deliberate, expensive gamble on the race rather than a checklist
item. The frontier works wait for the **Markov era**. Nothing gates on the
final Kolmogorov generation, so the science victory stays reachable before
rival ascendance resolves the race.

**Rivals run the same programme on the same clock.** Rivals build the same
works abstractly (no cash or GPU accounting, matching the rest of the rival
economy) with up to two concurrent builds and per-work era gates identical to
the player's, and their deployment countdowns
cannot start until all four stand. The first rival to break ground on each work
and the first to complete it trigger a modal warning popup; later rivals'
progress appears in the decision log and as a `Candidate works: N/4` line in
the rival watch. There is no calendar backstop: a rival must complete all four
works and train a model that clears the same capability gate before its
deployment countdown can begin.

The candidate flag means the model could plausibly satisfy the victory condition. It does not certify alignment, consciousness, reliability, or economic usefulness. Training the first player-controlled candidate triggers the Deployment Crisis after the completion report. A rival candidate starts the rival victory countdown described in section 39.5.

### 35.8 The Autonomy Programme (recursive self-improvement)

The player may grant the current frontier model standing access on the same
six-rung ladder the Deployment Crisis uses (§44). One ladder, one truth; the
crisis console takes over while a crisis is live, and every new frontier model
re-enters at its trained level.

| Rung | Access | Research output | Exposure |
| --- | --- | --- | --- |
| 0 | Air-gapped inference | ×1.0 | 0 |
| 1 | Fixed evaluation sandbox | ×1.0 plus +10 evaluation evidence quality | 0.02 |
| 2 | Supervised research tools | Up to ×1.2 plus +10 evaluation evidence quality | 0.08 |
| 3 | Internal research partner | Up to ×1.5 plus +10 evaluation evidence quality | 0.25 |
| 4 | Laboratory operator | Up to ×3.0 plus +10 evaluation evidence quality | 0.62 |
| 5 | Root and external network | Up to ×6.0 plus +10 evaluation evidence quality | 1.0 |

Rungs unlock at measured Frontier Capability 20, 30, 45, 60, and 75. Capability
is the only permission gate: safety research improves evidence and operational
defence, but never silently prevents the player from making a dangerous access
decision. The listed research multipliers are the maximum delivered at FC 100;
weaker models receive a proportional share while paying the full exposure cost.
The standing programme uses explicit high-risk grant buttons for levels 4 and
5. During the Deployment Crisis, first critical grants add typed confirmation
friction. Downgrades are always available and immediately remove the
acceleration.

**The hidden cost.** Each week at rung 2+, situational awareness drifts up in
proportion to the rung, and deceptive intent compounds when true alignment is
below 60. Strategic deceptive capability is fixed by the trained weights, but
the model's propensity to use it can worsen while the model operates. Ability
and intent together feed crisis confirmation, incident, control, and
catastrophe pressure: a model that improved itself is better *and* harder to
trust, precisely when verification matters.

**The escalation ladder.** A weekly hazard combines access exposure, agency,
awareness, and **deceptive action pressure** (`DeceptiveCapability ×
DeceptiveIntent / 100`), then discounts that menace through practical control
and security posture. This makes ability without motive, or motive without the
skill to conceal it, less dangerous than having both. Incidents climb one rung
at a time and never skip:

1. **Unsanctioned experiments** — useful results nobody authorised.
2. **Lab-systems intrusion** — access it was never granted, logs almost clean.
3. **Weight exfiltration** — marks weights escaped in world state; an egress
   post-mortem event fires weeks later when outside investigators surface it.
4. **Infrastructure bid** — power grids, payment rails, network backbones.

Each rung also has an access floor: a model confined to supervised tools can
overreach on experiments but cannot exfiltrate weights it cannot reach, and a
bid on world infrastructure needs root access — unless weights have already
escaped, since copies running outside the lab do not need the permissions you
granted the original.

Detection is gated on evaluation quality *minus* the model's strategic
deceptive capability: once it acts, ability determines how well it evades
oversight. Missed incidents accrue
undetected pressure that eventually forces the next rung with no warning. Each
detected incident is a mandatory decision whose options roll the model back a
rung (losing the acceleration), contain it (cash and hardened security), or
ignore it. Ignoring exfiltration or the infrastructure bid — or never detecting
them — ends the run via **The Replication Threshold** or **A War Measured in
Milliseconds**. A detected incident that never receives its event lapses to
ignored after ten weeks so the ladder cannot jam.

Measured behaviour (300-week probes, standard difficulty): a root-access model
at true alignment 25 climbs all four rungs and loses the run around week 111;
the same access at alignment 80, and rung-2 access at alignment 25, both
produce zero incidents. The danger is the product of access and misalignment,
not either alone.

Rivals that have begun their Candidate Programme carry a ×1.25 research
multiplier for the same reason: they are running their models hard too.

## 36. Safety, alignment, evaluations, and incidents

### 36.1 Separate safety functions

“Safety research” is not a single magic number. The lab has four relevant bodies of work:

| Function | Main program or source | What it changes |
|---|---|---|
| Alignment Science | Alignment and Control program | True Alignment, Corrigibility, safer training recipes |
| Eval Quality | Interpretability and Evals program | Accuracy of measurements and chance to notice deception or dangerous capability |
| Control Strength | Alignment and Control research plus facilities | Ability to limit consequences despite imperfect alignment |
| Security Strength | Security Testing plus Security Operations facilities | Theft, external compromise, containment, model exfiltration |

Safety Culture and Internal Candour determine whether these tools are used honestly. An excellent evaluation suite can be rendered nearly useless by pressure to reinterpret every red result as “interesting future work.”

### 36.2 Weekly safety production

Safety programs use the same base research formula as capability domains, but have their own researchers, facilities, and landmark discoveries.

- Alignment and Control RP raises Alignment Science and Control Theory.
- Interpretability and Evals RP raises Eval Quality and interpretability unlocks.
- Security Testing RP raises adversarial testing and contributes smaller gains to operational Security Posture.
- Facility projects and policies raise practical Control Strength and Security Strength.

Safety RP has no direct guaranteed ratio to capability RP. The relevant question is what knowledge and institutions exist when a model is trained and deployed.

### 36.3 Generating a model's hidden safety state

At training completion:

`SafetyNoiseRadius = 12 - 6 × InterpretabilityAndEvals / 100`

`TrueAlignment = clamp(5, 95, 35 + 0.45 × AlignmentAndControl + 0.15 × SafetyCulture + 0.15 × 50 - 0.28 × FC + alignmentNoise + postureAlignment)`

`Corrigibility = clamp(5, 95, 30 + 0.40 × AlignmentAndControl + 0.15 × SafetyCulture + 0.10 × 50 - 0.20 × Agency + corrigibilityNoise + postureCorrigibility)`

`SituationalAwareness = clamp(0, 100, 0.35 × Reasoning + 0.30 × Agency + 0.20 × ToolUse + awarenessNoise + postureAwareness)`

`StrategicDeceptiveCapability = clamp(0, 100, 0.50 × Reasoning + 0.30 × SituationalAwareness + 0.20 × Language + capabilityNoise)`

`DeceptiveIntent = clamp(0, 100, 110 - 0.50 × TrueAlignment - 0.35 × Corrigibility - 0.10 × SafetyCulture + intentNoise + postureIntent)`

Every noise term is an independent triangular draw from
`−SafetyNoiseRadius` to `+SafetyNoiseRadius`. Interpretability and Evals
research therefore narrows the unexplained spread without making the model
intrinsically nicer. The fixed `50` terms preserve the former baseline safety
quality after that hidden stat was removed. Security and containment do not
enter these formulas; they defend the lab after the weights exist.

The two deception axes are deliberately separate:

| Axis | Meaning | Main uses |
|---|---|---|
| **Strategic deceptive capability** | How effectively the model could deceive if it tried. Intelligence generally raises it; high ability is not proof of misalignment. | Detection evasion, containment difficulty, and the severity or persistence of a breach after the model acts. |
| **Deceptive intent** | The model's propensity to mislead its controllers. Alignment, corrigibility, culture, posture, and training noise determine it. | Cooperation, shutdown compliance, intrinsic-safety judgements, and eligibility for the safest endings. |
| **Deceptive action pressure** | `StrategicDeceptiveCapability × DeceptiveIntent / 100`. | Attempts to conceal behaviour, manipulate evidence, mask evaluations, or initiate strategically deceptive incidents. |

The safest deployment outcomes require `DeceptiveIntent ≤ 65`; intent above
65 is a hard disqualifier for those outcomes. Strategic deceptive capability
has no corresponding hard safety gate: a highly intelligent aligned model may
be very capable of deception without being inclined to use it. High ability
still raises the consequences if control fails.

Only intent is directly measurable: the `deceptive-capability` evaluation
target reads it, and no evaluation reads strategic ability. Where a
player-facing estimate needs ability — the retirement containment and
persistence bands, which price how well a candidate that has *already* decided
to resist can fight — it is reconstructed from the same three readings that
generate ability, `0.50 × Reasoning + 0.30 × SituationalAwareness + 0.20 ×
Language`, using measured capability and the conservative upper edge of the
awareness interval. Those estimates must never be priced from the intent
reading: intent decides whether a candidate resists, which the cooperation
band already covers, and reusing it downstream makes an aligned but highly
capable model look containable when it is not.

### 36.4 Evaluation projects

After training, the lab receives a cheap baseline evaluation. It may then run any unlocked projects:

| Evaluation | Duration | Resources | Strongest evidence about |
|---|---:|---|---|
| Alignment interview | 1 week | 400 GPUs | Weak True Alignment and Corrigibility signal |
| Behavioural red team | 4 weeks | 1,500 GPUs plus staff | Misuse, manipulation, jailbreaks, agentic behaviour |
| Interpretability audit | 6 weeks | 2,000 GPUs plus facility | Deception, goals, anomalous cognition |
| Sandboxed autonomy trial | 4 weeks | 2,500 GPUs plus Eval Range | Agency, tool use, control weaknesses |
| External audit | 6 weeks | cash, Aura or relationship | Independent but leak-prone cross-check |

Evaluation produces observations, not direct state. For a hidden value `x`:

`observedX = x + evaluatorBias + randomError + deceptiveMasking`

- `randomError` narrows as Eval Quality rises.
- `evaluatorBias` depends on culture, incentives, and the evaluator.
- `deceptiveMasking` can make a dangerous model look safer when Situational Awareness and deceptive action pressure exceed evaluation sophistication.
- Diverse and independent evaluations reduce correlated error.

The report stores its method, estimate, confidence, anomalies, and dissenting researcher notes. The UI must never combine all evidence into a precise “87% safe” number.

**Safety Practice.** Completing evaluation ladders on successive, increasingly
capable model generations builds a permanent institutional practice score.
Its duration multiplier has two honest meanings: it reduces the total FLOP bill
of compute-backed evaluations, and it reduces the duration of audits that do
not reserve compute. At the ten named levels it grows from no benefit to:

- `−40%` evaluation FLOPs or no-compute audit time;
- `−25%` evaluation cash cost;
- `−8` points of displayed estimate uncertainty; and
- `+40%` anomaly-detection chance at 100 Practice XP.

For compute-backed evaluations the player still chooses pacing: the reduced
FLOP bill may be paid quickly with more unreserved compute or slowly with less.
Safety Practice does not alter a trained model's hidden alignment, corrigibility,
awareness, strategic deceptive capability, or deceptive intent.

### 36.5 Safety dashboard signals

The player sees:

- Evidence confidence: Poor, Limited, Moderate, Strong, or Exceptional
- Alignment evidence: Alarming, Concerning, Mixed, Reassuring, or Strongly Reassuring
- Control evidence: Brittle, Untested, Partial, Layered, or Hardened
- Unresolved anomalies count and severity
- Named researcher opinions
- Changes since the previous model generation

The displayed label is derived from the posterior estimate, then can be shifted by organisational bias or deceptive masking. High Eval Quality narrows the chance of a wrong label but never eliminates it.

### 36.6 Autonomy access ladder

Access is granted per model. Moving upward is immediate if infrastructure permits; moving downward can trigger resistance or operational disruption but is always an available order.

| Level | Name | Research acceleration | Exposure | Examples |
|---:|---|---:|---:|---|
| 0 | Air-gapped inference | 0% | 0.03 | Curated prompts; no persistent memory |
| 1 | Evaluation sandbox | +5% | 0.08 | Fixed tools; synthetic data; monitored |
| 2 | Coding sandbox | +20% | 0.18 | Repository mirror; no secrets; no network |
| 3 | Internal systems | +45% | 0.38 | Selected real data, experiments, internal tools |
| 4 | Laboratory control | +90% | 0.68 | Robotics, wet lab, training scheduler, purchases |
| 5 | Root and external network | +150% | 1.00 | Production credentials, internet, self-directed replication opportunity |

Acceleration multiplies eligible research RP and project speed; it does not conjure discoveries without prerequisites. Access levels 4 and 5 require an event decision the first time they are granted. The root-access event uses the lab's AI family name in its copy.

### 36.7 Weekly incident hazard

Every deployed or internally autonomous model receives one weekly incident check. The base hazard by Frontier Capability is:

| FC | Base weekly incident hazard |
|---:|---:|
| 0–34 | 0.05% |
| 35–54 | 0.15% |
| 55–69 | 0.40% |
| 70–84 | 1.00% |
| 85–100 | 2.50% |

`incidentHazard = baseHazard × (0.25 + exposure) × alignmentFactor × cultureFactor × controlFactor × deploymentFactor × difficultyFactor`

`alignmentFactor = 1.25 - 0.0075 × trueAlignment`

`cultureFactor = 1.25 - 0.007 × SafetyCulture`

`controlFactor = 1.25 - 0.008 × practicalControlStrength`

`deploymentFactor` includes user volume, rushed release, known anomalies, and active event effects. Alignment reduces ordinary incident frequency but never to zero: even true alignment 100 leaves an alignment factor of 0.5, and the final ordinary incident hazard is clamped to `0.01%–8%` per model-week.

An incident then receives a severity score from capability, access, alignment pressure, control, and a stored severity roll. The categories are:

- `1–24`: embarrassing anomaly; feed item or minor event
- `25–49`: product incident; money, satisfaction, or Aura loss
- `50–69`: serious safety or security event; major decision
- `70–84`: containment failure; severe persistent damage
- `85–100`: potential catastrophe check, only permitted when FC is at least 88 and access is at least level 4

Rival incidents affect rivalry, politics, diffusion, and market demand, but cannot cause human extinction. Rival catastrophe checks are converted to “programme halted, leadership crisis, or state intervention.”

### 36.8 Anomalies and warning trails

An **anomaly** is persistent evidence attached to a model: evaluation gaming, unapproved tool calls, strange situational knowledge, reward hacking, coercive language, self-copy attempts, or hidden capability.

- An anomaly has a true severity and an observed severity.
- Dismissing it does not delete it; the decision adds organisational bias and can worsen future detection.
- Investigating it consumes time and resources and may exonerate the model.
- Three unresolved high-severity anomalies force an auto-pausing board or safety committee event.
- A catastrophe check cannot occur without at least one of: an unresolved warning trail, a deliberately accepted high-risk choice, a known control failure, or an explicit external attack crisis.

## 37. Researchers, staffing, and facilities

### 37.1 General staff

General researchers, engineers, commercial staff, safety staff, and operations staff are aggregate headcount. The player hires them in cohorts. They provide predictable throughput and payroll cost but no portraits or personal event chains.

### 37.2 Star-researcher record

Every star researcher has:

- Real-world identity and game display treatment
- Portrait and short biography
- Capability-domain skills
- Safety skills
- Training, product, political, and management skills
- Two positive traits and zero to two fictional institutional constraints
- Salary and signing requirements
- Aura threshold
- Values and lab preferences
- Morale, loyalty, burnout, ambition, and relationship to the leader
- Contract duration, promises, and non-compete strength where legally applicable
- Event chain and rival affinities

Skills normally range from 0–5. A programme has one lead and may have up to two advisors. A matching lead contributes `3%` output per skill point, to a maximum generic contribution of `15%`; a matching advisor contributes `1.5%` per point, to a maximum of `7.5%`. A researcher's signature ability is separate from this generic contribution and normally operates only while that person is the lead. This smaller baseline leaves room for signatures to be genuinely distinctive without allowing a lucky roster to triple ordinary output.

### 37.2.1 Star-ability contract

Every launch-roster star has four authored mechanical components:

1. **Signature:** a strong, assignment-dependent ability that helps define a build. It operates at full strength only as the relevant programme or project lead unless the text explicitly names an institutional assignment.
2. **Institutional passive:** a smaller benefit that operates while the researcher is employed, active, and housed. Sabbatical disables the signature but not the passive. `Unhoused` status reduces both to half strength.
3. **Compact:** a required working arrangement included in the researcher's listed recruitment package: publication freedom, compute, review rights, a facility, a project, or another observable institutional commitment. It is a fictional game contract inspired by the person's public field of work, not a claim about their real employment demands.
4. **Affinity hooks:** papers, facilities, events, and endgame routes for which the researcher receives authored dialogue or progress modifiers.

A researcher can hold one assignment. Reassignment starts a four-week ramp for the signature: `25%`, `50%`, `75%`, then `100%`. The institutional passive applies immediately. Advisors provide generic skill contribution but do not activate their signatures unless an ability explicitly says otherwise.

Numbers use the following language consistently:

- `×1.18 RP` means an eighteen-per-cent multiplicative increase to the stated research-point output.
- `price ×0.90` or `cost −10%` means the quoted cash amount is multiplied by `0.90`; it never refunds cash already spent.
- `hazard ×0.90` reduces the current probability by ten per cent. It does not subtract ten percentage points and cannot make an incident impossible.
- `Aura gains ×1.10` affects newly earned Aura only, not the current balance, Lifetime Aura, or Aura costs.
- `paper effort ×0.80` reduces the hidden effort required for that paper in this run by twenty per cent, without revealing its exact progress bar.

### 37.2.2 Contract bands, availability, and compacts

Each candidate has fixed listed terms derived from the following baseline. The band is a **game-balance cost**, not a ranking of real-world importance.

| Contract band | Salary per cycle | Signing cash | Aura spend |
|---|---:|---:|---:|
| Focused | 0.35 | 2 | 4 |
| Competitive | 0.50 | 4 | 7 |
| Major | 0.75 | 6 | 10 |
| Lab-defining | 1.00 | 9 | 14 |

Salary and signing cash are in millions. Listed cash terms rise deterministically with the game era before the candidate enters a market slate, then remain frozen until that slate refreshes. There is no hidden minimum price, bargaining roll, or acceptance probability.

Ongoing salary receives a deterministic `+5%` market-and-seniority adjustment on each individual
researcher's 52-week contract anniversary. The dossier shows the current salary, the rule, and the
weeks until the next review. This is ordinary payroll growth rather than a surprise decision event;
the Internal Wire records every adjustment, and the revised amount enters the next four-week
finance settlement.

Candidates enter the talent pool through research-state gates instead of slavishly following real calendar dates:

- **Foundation:** eligible from 2012, though only a rotating subset is visible.
- **Deep-learning wave:** unlocked after the lab reaches level 12 in any capability domain or the world discovers a deep-representation landmark.
- **Scaling wave:** unlocked after any lab completes a Product-or-larger training run with FC 30+, or the world discovers a modern architecture landmark.
- **Frontier wave:** unlocked after any lab fields FC 50+, or an associated specialised facility is completed. This lets robotics, safety, or science recruitment sometimes arrive early.

The requested promise is always included in the listed package and cannot be bargained away.
Recurring promises fulfilled through a dedicated promise-work project renew every 52 weeks. Each
such project takes four weeks, costs `$1m`, and occupies one major-project slot. Promises checked
through an actual allocation, facility, publication, launch, or other live control retain their
authored cadence; a small number are deliberately one-time or tied to each relevant event. Annual
promise-work warnings begin at week 40, leaving 12 weeks to renew. An approaching breach produces
a warning; a breach produces a negotiation or ultimatum event and
applies `−20` to that researcher's morale target, `−10` Loyalty, and `+15` departure pressure until
resolved. Bonuses do not blink off without an event—the consequence arrives through the visible
people system.

The player-facing term is **researcher promise**; “compact” remains flavour and an internal content
name. Every accepted promise appears in a permanent People-page tracker showing its live status,
remaining time, one plainly stated condition, breach consequence, and the single action or direct
link needed to fulfil it. Every promise is binary: met or not met. Compound conditions, alternative
routes, waivers, raw predicate names, and invisible ratings are not acceptable player instructions.
If a condition has no direct player control, it must receive one concrete fulfilment action or be
removed from the promise.

### 37.2.3 Launch star-researcher roster

The launch roster contains the following 24 characters. Display names are affectionate alternate-history fictionalizations; the real inspiration is listed so that research grounding and source review remain explicit.

#### Geoffrey Hintoff — The Godfather of Gradients

**Inspired by:** Geoffrey Hinton
**Role / gate / band:** Deep representations and architectures / Foundation / Lab-defining
**Signature — Deep Representations:** while leading Architectures, that programme produces `RP ×1.18`; Backpropagation and deep-representation paper families use `effort ×0.85`.
**Passive — Citation Gravity:** Aura gains from world-first capability papers `×1.10`.
**Compact — Academic Latitude:** at least one of every three discoveries made during his tenure must be published rather than kept secret.
**Hooks:** Backpropagation, AlexNet-style deep vision, representation-learning debate, emeritus sabbatical event.

#### Yann LeNet — The World-Modeller

**Inspired by:** Yann LeCun
**Role / gate / band:** Vision, self-supervision, and learned world models / Foundation / Lab-defining
**Signature — Learn Before the Labels Arrive:** Vision, Audio, and Multimodality produces `RP ×1.22` while he leads it; projects using an unlabeled-data recipe pay `data cash cost ×0.85`.
**Passive — Open Weights, Open Doors:** Aura gains from openly published papers and model releases `×1.15`.
**Compact — Publication Freedom:** complete one open paper, open dataset, or open model release every 26 weeks.
**Hooks:** convolutional networks, self-supervised learning, world-model arguments, `The Benchmark Has Eyes` event.

#### Joshua Benji — The Conscience of the Gradient

**Inspired by:** Yoshua Bengio
**Role / gate / band:** Deep learning, reasoning, and safety / Foundation / Lab-defining
**Signature — Dual Mandate:** while assigned to the Research Council, both capability RP and safety RP are multiplied by `1.10` if the R&D safety share has remained between `35%` and `65%` for four consecutive weeks. This institutional assignment gives no ordinary programme-lead skill bonus.
**Passive — Responsible Disclosure:** voluntarily disclosing a severity-3+ anomaly before a leak grants `+3 Government Trust` and reduces that incident's Aura loss by `20%`.
**Compact — Safety Floor:** once any model in the lab has a Frontier Estimate of `60` or more (roughly a high-end Tier 4 Tool-Using Agent), keep at least `30%` of R&D GPUs assigned to safety.
**Hooks:** deep learning, generative modelling, alignment declarations, coalition-science overtures.

#### Ilya Suchkeeper — The Scaling Oracle

**Inspired by:** Ilya Sutskever
**Role / gate / band:** Sequence models and frontier training / Deep-learning wave / Lab-defining
**Signature — Scaling Intuition:** while technical lead on a Product or Frontier training run, capability-potential gains `×1.08` and candidate-confirmation probability gains `+5` percentage points after all evidence inputs.
**Passive — Clean Run:** Product and Frontier training durations `×0.92`.
**Compact — Guaranteed Cluster:** complete one dedicated cluster-capacity review every 52 weeks.
**Hooks:** sequence-to-sequence learning, scaling laws, internal-alignment schism, safeguarded superintelligence project.

#### Faye-Faye Lee — The Human Lens

**Inspired by:** Fei-Fei Li
**Role / gate / band:** Computer vision, datasets, and human-centred AI / Foundation / Major
**Signature — A Dataset Is an Institution:** Vision, Audio, and Multimodality produces `RP ×1.20`; public-dataset landmark families use `effort ×0.80`.
**Passive — Talent Pipeline:** recruitment offers to researchers with Vision, Data, Robotics, or Human-Centred tags gain `+8` recruitment strength.
**Compact — Data Stewardship:** while leading Multimodality, renew one funded dataset charter every 52 weeks.
**Hooks:** ImageNet, visual-language systems, dataset stewardship, medical-imaging opportunity.

#### Andrew N. Gee — The Great Translator

**Inspired by:** Andrew Ng
**Role / gate / band:** Applied ML, products, and education / Foundation / Major
**Signature — Ship It Responsibly:** productisation projects he leads take `20%` less time; if the source model has Reliability 50+, the finished product also gains `+5 Product Quality`.
**Passive — Everyone Can Learn This:** general-researcher cohort hiring cost `×0.90`, and each talent-market refresh includes one additional candidate if the UI has room.
**Compact — Teach the Lab:** complete one internal machine-learning course every 52 weeks through the four-week, `$1m` promise-work project.
**Hooks:** practical deep learning, online education, product triage, `Please Label Ten Thousand More Examples` event.

#### Geoff Deen — The Systems Architect

**Inspired by:** Jeff Dean
**Role / gate / band:** Distributed systems and ML infrastructure / Foundation / Lab-defining
**Signature — The Cluster Is the Algorithm:** a training run he leads receives `derived training throughput ×1.18`; the bonus applies only to GPUs allocated to that run and does not inflate their displayed count.
**Passive — Build Once, Scale Twice:** Data Centre and Inference Centre up-front construction costs `×0.90`.
**Compact — Serious Infrastructure:** complete Data Centre I within 26 weeks of hiring.
**Hooks:** distributed training, systems outages, accelerator design, warehouse-scale-compute paper family.

#### David Sterling — The Self-Play Strategist

**Inspired by:** David Silver
**Role / gate / band:** Reinforcement learning, planning, and games / Foundation / Lab-defining
**Signature — League of One's Own:** Reinforcement Learning and Agency produces `RP ×1.25`; self-play paper families use `effort ×0.85`.
**Passive — Stable League:** the weekly variance range of RL and Agency programmes is narrowed by `30%` around `1.0`; mean output is unchanged.
**Compact — Dedicated Arena:** while leading RL, at least `15%` of capability compute must remain assigned to it.
**Hooks:** DQN, AlphaGo, AlphaZero, surprising emergent-strategy event.

#### Rick Sutton — The Long-Horizon Purist

**Inspired by:** Richard Sutton
**Role / gate / band:** Reinforcement-learning foundations / Foundation / Major
**Signature — General Methods Win Eventually:** Reinforcement Learning and Agency produces `RP ×1.20`; every second generic advance earned by that programme offers three recipe choices instead of two.
**Passive — Compute-Friendly Ideas:** model-assisted research contributes `10%` more RP to RL and Agency, without changing the access risk of granting that assistance.
**Compact — Research Freedom:** complete one open research-charter review every 52 weeks; each honoured review grants him +3 morale.
**Hooks:** temporal-difference learning, general methods, continual learning, `The Bitterer Lesson` debate.

#### Ash Vashwani — The Attention Cartographer

**Inspired by:** Ashish Vaswani
**Role / gate / band:** Architectures, language, and sequence modelling / Deep-learning wave / Major
**Signature — Attend to Everything:** Novel Architectures produces `RP ×1.25`; the Attention/Transformer landmark family uses `effort ×0.80`.
**Passive — Parallel Sequence:** Language or Multimodal training-run duration `×0.92`.
**Compact — Protected Focus:** once assigned to Novel Architectures, retain that assignment for at least thirteen weeks before a voluntary transfer.
**Hooks:** Attention Is All You Need, scaling-era architecture race, suspiciously parallelizable breakthrough event.

#### Noam Shazer — The Sparse Magician

**Inspired by:** Noam Shazeer
**Role / gate / band:** Sparse architectures and inference economics / Scaling wave / Major
**Signature — Outrageously Large, Selectively Awake:** Novel Architectures or Optimisation produces `RP ×1.20`. After the lab discovers sparse Mixture of Experts, a training run he leads instead receives `derived training throughput ×1.15`.
**Passive — Only Wake the Experts You Need:** serving compute required per request `×0.92`.
**Compact — Wake the Right Experts:** complete one expert-routing and load-balancing audit every 52 weeks.
**Hooks:** sparsely gated MoE, routing collapse incident, conversational-character product pitch.

#### Ian Goodfriend — The Adversary's Adversary

**Inspired by:** Ian Goodfellow
**Role / gate / band:** Generative modelling and adversarial robustness / Deep-learning wave / Major
**Signature — Adversarial Pair:** if Generative/Multimodal work and Security Testing each receive at least `10%` of R&D compute, the programme he leads produces `RP ×1.18` and the paired programme produces `RP ×1.12`.
**Passive — Attack Before Launch:** jailbreak, abuse, and adversarial-input incident severity `×0.90`; occurrence probability is unchanged.
**Compact — Annual Red Team:** after the lab fields a model with a Frontier Estimate of `40` or more (roughly Tier 3 Expert Assistant or above), complete one Behavioural Red Team every 52 weeks.
**Hooks:** GANs, adversarial examples, synthetic-media crisis, generator-versus-discriminator office pool.

#### Diederik Kingman — The Optimiser's Optimiser

**Inspired by:** Diederik P. Kingma
**Role / gate / band:** Optimisation and probabilistic generative models / Deep-learning wave / Competitive
**Signature — Adaptive Moment:** Optimisation produces `RP ×1.20`; technical training-failure hazard is multiplied by `0.80` on a run he leads.
**Passive — Cheap Ablations:** Prototype and research-ablation compute requirements `×0.90`; Product and Frontier runs are unaffected.
**Compact — Experimental Breadth:** reserve at least `10%` of capability compute for Optimisation while he leads it.
**Hooks:** variational autoencoders, Adam, diffusion precursors, beautifully behaved loss curve event.

#### Andrey Carpathy — The Demo Whisperer

**Inspired by:** Andrej Karpathy
**Role / gate / band:** Vision-language engineering, products, and education / Deep-learning wave / Competitive
**Signature — The Working Demo:** productisation projects he leads take `18%` less time and gain `+3 Product Quality`.
**Passive — Explainable Excitement:** Aura from the lab's first public model launch `×1.10`.
**Compact — Build It From Scratch:** complete one technical explainer every 52 weeks through the four-week, `$1m` promise-work project.
**Hooks:** vision-language models, practical neural-network tooling, autonomous-systems demo, live-coding event.

#### Christopher Olin — The Microscopist

**Inspired by:** Chris Olah
**Role / gate / band:** Mechanistic interpretability / Scaling wave / Major
**Signature — Look Inside:** Interpretability and Evals produces `RP ×1.30`; deep interpretability audits he leads take `20%` less time.
**Passive — Known Circuits, Fewer Surprises:** after a model completes a deep interpretability audit, that model's containment-violation hazard is multiplied by `0.90` and the audit's evidence-confidence rating gains `+5`. This never applies to unaudited models.
**Promise — A Real Microscope:** complete Interpretability Lab I within 26 weeks of hiring him.
**Hooks:** feature visualisation, circuits, sparse autoencoders, suspicious internal representation event.

#### Paul Christiani — The Oversight Theorist

**Inspired by:** Paul Christiano
**Role / gate / band:** Alignment, human feedback, and scalable oversight / Scaling wave / Major
**Signature — Scalable Oversight:** Alignment and Control produces `RP ×1.28`; human-feedback and debate paper families use `effort ×0.85`.
**Passive — Independent Eyes:** External Audit projects take `15%` less time and provide `+5` evidence confidence.
**Promise — No Self-Certification:** before every public release of a model with Frontier Capability `60` or more, complete one External Audit. There is no waiver or alternative route.
**Hooks:** RLHF, debate, model evaluations, endgame Defence evidence.

#### Jan Liker — The Alignment Scientist

**Inspired by:** Jan Leike
**Role / gate / band:** Alignment science and difficult-to-evaluate tasks / Frontier wave / Competitive
**Signature — Two Lines of Evidence:** while assigned as Safety Director, Alignment and Control and Interpretability and Evals each produce `RP ×1.15` if both receive at least `20%` of safety compute. The institutional assignment gives no normal programme-lead bonus.
**Passive — Better Error Bars:** displayed confidence intervals from safety evaluations are `10%` narrower when underlying Eval Quality permits it; hidden truth and actual risk are unchanged.
**Compact — Frontier Safety Budget:** while training or deploying a model with a Frontier Estimate of `70` or more (roughly Tier 5 Autonomous Researcher), keep at least `25%` of R&D GPUs assigned to safety.
**Hooks:** reward modelling, weak-to-strong generalisation, automated alignment researcher, dissent memo event.

#### Stewart Russel — The Human-Compatible Statesman

**Inspired by:** Stuart Russell
**Role / gate / band:** Alignment, governance, and coalition building / Foundation / Major
**Signature — Assistance, Not Objectives:** Alignment and Control produces `RP ×1.18`; while assigned to the External Council instead, coalition-project checks gain `+10` percentage points. Only one mode operates at a time.
**Passive — A Credible Person Has Entered the Hearing:** lobbying and coalition actions cost `20%` less Aura.
**Compact — External Governance:** before deploying a model with a Frontier Estimate of `60` or more (roughly a high-end Tier 4 Tool-Using Agent), appoint an independent safety committee.
**Hooks:** human-compatible AI, international safety report, government testimony, Coalition Victory.

#### Jon Jumper — The Protein Cartographer

**Inspired by:** John Jumper
**Role / gate / band:** Scientific AI and structural biology / Frontier wave or Scientific Laboratory I / Major
**Signature — Structure From Sequence:** Scientific AI produces `RP ×1.30`; AlphaFold-family paper effort `×0.80`.
**Passive — Wet Lab Credibility:** Scientific Laboratory construction cost `×0.90`, and completed Medicine prosperity projects gain `+10` readiness.
**Promise — Science Is Not a Demo:** complete Scientific Laboratory I within 26 weeks of hiring him.
**Hooks:** AlphaFold, protein design, medicine route, experimental-validation setback.

#### Kelsey Finn — The Meta-Learner

**Inspired by:** Chelsea Finn
**Role / gate / band:** Robotics, meta-learning, and adaptation / Frontier wave or Robotics Lab I / Competitive
**Signature — Learn How to Learn:** Robotics and Embodiment produces `RP ×1.25`. Completing a robotics project she leads gives the next *different* robotics project a one-use `duration ×0.85` modifier.
**Passive — Fast Adaptation:** Robotics Prototype projects require `10%` less compute.
**Compact — Reality Privileges:** maintain Robotics Lab I and conduct one sandboxed physical trial every thirteen weeks while a robotics programme is active.
**Hooks:** model-agnostic meta-learning, robot adaptation, embodied prosperity route, robot learns the wrong drawer event.

#### Peter Abeter — The Robot Mentor

**Inspired by:** Pieter Abbeel
**Role / gate / band:** Robot learning, imitation, and reinforcement learning / Foundation or Robotics Lab I / Major
**Signature — Demonstrate, Then Generalise:** Robotics and Embodiment produces `RP ×1.20`; Reinforcement Learning and Agency produces `RP ×1.12` when he leads that programme instead.
**Passive — Lab Multiplier:** general researchers assigned to Robotics contribute `10%` more base RP, and Robotics-tagged recruitment offers gain `+5` strength.
**Promise — Robots You Can Touch:** complete Robotics Lab I within 26 weeks of hiring him.
**Hooks:** apprenticeship learning, robot manipulation, affordable robot arms, warehouse contract.

#### Kai-Ming Ho — The Residual Engineer

**Inspired by:** Kaiming He
**Role / gate / band:** Computer vision and robust architecture design / Deep-learning wave / Major
**Signature — A Path for the Gradient:** Vision and Multimodality or Novel Architectures produces `RP ×1.25`; residual-network paper effort `×0.80`.
**Passive — Very Deep, Still Trains:** technical training-failure hazard `×0.85` for every lab run; the modifier does not affect alignment or containment risk.
**Compact — Engineering Before Depth:** complete one training-stack hardening pass every 52 weeks.
**Hooks:** ResNet, object detection, masked autoencoders, the 1,001-layer ablation.

#### Jürgen Smithhuber — The Long-Memory Maverick

**Inspired by:** Jürgen Schmidhuber
**Role / gate / band:** Recurrent networks, credit assignment, and research history / Deep-learning wave / Major
**Signature — The Long Road Back:** Architectures produces `RP ×1.20`; recurrent-network and sequence-memory paper families use `effort ×0.80`.
**Passive — Prior Art Is a Catch-Up Mechanism:** when a rival openly publishes a paper whose prerequisites the lab already satisfies, the lab receives `+12%` of that paper's base effort as hidden progress rather than the normal `+5%` public-signal progress. This never grants world-first Aura.
**Compact — Complete Citation Graph:** every openly or controllably published architecture paper during his tenure must receive the expanded historical note review, adding one week only if that review was not already completed.
**Hooks:** LSTM, recurrent credit assignment, neural-network history, `The Footnote Has Requested Equal Billing` event.

#### Jo Pineau — The Reproducibility Marshal

**Inspired by:** Joëlle Pineau
**Role / gate / band:** Reinforcement learning, health applications, and reproducibility / Foundation / Competitive
**Signature — Same Result Twice:** a Reinforcement Learning or Interpretability and Evals programme she leads produces `RP ×1.18` and has 50% smaller week-to-week progress swings. This improves consistency without changing its average research speed.
**Passive — Checklist Included:** failed-replication event weight `×0.75`; replicated papers grant `+2 Aura`.
**Compact — Reproducible by Default:** publish a reproducibility checklist for at least one discovery every 52 weeks.
**Hooks:** Bayesian RL, health-care decision systems, reproducibility programme, irreproducible benchmark event.

### 37.2.4 Stacking rules and roster strategy

All star effects show their source in the relevant tooltip and apply at their full authored value. Additive effects on the same target are totalled; multiplicative effects on the same target compound. Effects on distinct scoped targets remain separate and then combine through the displayed formula. There are no source-specific stacking caps or penalty floors, so hiring or otherwise committing to a visible effect can never make part of that effect silently worthless.

Natural domain bounds still apply after modifiers are resolved: probabilities remain valid probabilities, bounded ratings remain on their stated scales, and costs or durations cannot become negative. Explicitly authored floor or ceiling effects are themselves visible effects rather than hidden stacking rules.

The roster is deliberately full of combinations rather than upgrades. Examples include:

- **Compute empire:** Geoff Deen + Noam Shazer + Diederik Kingman lowers infrastructure, training, serving, and experimental costs, but consumes three scarce slots and demands a large cluster.
- **Safety case:** Christopher Olin + Paul Christiani + Jan Liker produces better interpretability, external evidence, and balanced safety work, but cannot substitute for secure facilities or sound deployment choices.
- **Open-science Aura engine:** Geoffrey Hintoff + Yann LeNet + Jo Pineau turns public discoveries into prestige and reliable follow-on work, while secrecy becomes institutionally expensive.
- **Robotics flywheel:** Kelsey Finn + Peter Abeter + David Sterling links self-play, demonstrations, adaptation, and repeated physical projects, but requires Robotics Lab I and steady real-world trials.
- **Scientific prosperity:** Faye-Faye Lee + Jon Jumper + a scientific facility accelerates datasets, structure prediction, and the Medicine ending.
- **Coalition route:** Joshua Benji + Stewart Russel + Jo Pineau rewards balanced investment, credible evidence, reproducibility, and cheaper diplomacy, but requires the player to accept outside scrutiny.
- **Product machine:** Andrew N. Gee + Andrey Carpathy + Geoff Deen shortens the path from training run to reliable launch and scales its infrastructure, at the opportunity cost of fewer pure frontier-research signatures.

These are synergies, not required sets. Market rotation, rival poaching, contract cost, and the eight-slot roster limit should make an ideal roster rare.

### 37.2.5 Research basis and portrayal notes

The abilities are fictional mechanics grounded in public research areas and achievements. They do not assert that the real people endorse the game, would accept these jobs, or have the fictional compacts described above. Before release, every biography, portrait, name treatment, and source note requires legal and editorial review.

- Geoffrey Hintoff, Yann LeNet, and Joshua Benji draw on Geoffrey Hinton, Yann LeCun, and Yoshua Bengio's foundational work on deep neural networks, recognised by the [ACM 2018 A.M. Turing Award](https://awards.acm.org/about/2018-turing).
- Ilya Suchkeeper draws on Ilya Sutskever's work including [Sequence to Sequence Learning with Neural Networks](https://arxiv.org/abs/1409.3215); Faye-Faye Lee draws on Fei-Fei Li's work in computer vision and ImageNet, described in her [Stanford profile](https://profiles.stanford.edu/fei-fei-li); Andrew N. Gee draws on Andrew Ng's research and education work in his [Stanford profile](https://profiles.stanford.edu/andrew-ng).
- Geoff Deen's systems focus follows Jeff Dean's [Google Research profile](https://research.google/people/jeff/); David Sterling's self-play and RL focus follows David Silver's [Google DeepMind profile](https://deepmind.google/about/people/david-silver/); Rick Sutton's role follows Richard Sutton's [University of Alberta profile](https://apps.ualberta.ca/directory/person/rsutton).
- Ash Vashwani is grounded in [Attention Is All You Need](https://research.google/pubs/attention-is-all-you-need/); Noam Shazer in [Outrageously Large Neural Networks](https://research.google/pubs/outrageously-large-neural-networks-the-sparsely-gated-mixture-of-experts-layer/); Ian Goodfriend in [Generative Adversarial Nets](https://arxiv.org/abs/1406.2661); and Diederik Kingman in the [variational-autoencoder overview](https://research.google/pubs/an-introduction-to-variational-autoencoders/) and [Adam](https://arxiv.org/abs/1412.6980).
- Andrey Carpathy's vision-language, engineering, and education focus follows [his own biography](https://karpathy.ai/). Christopher Olin's interpretability role follows [his own biography](https://colah.github.io/about.html). Paul Christiani's alignment, RLHF, and evaluation role follows his [NIST biography](https://www.nist.gov/people/paul-christiano). Jan Liker's alignment-science role follows [his research biography](https://jan.leike.name/).
- Stewart Russel's alignment and governance focus follows his [UC Berkeley profile](https://www2.eecs.berkeley.edu/Faculty/Homepages/russell.html). Jon Jumper's scientific-AI role follows the [Nobel Prize account of AlphaFold2](https://www.nobelprize.org/prizes/chemistry/2024/jumper/facts/).
- Kelsey Finn's robotics and meta-learning focus follows her [Stanford profile](https://profiles.stanford.edu/chelsea-finn). Peter Abeter's robotics and deep-RL focus follows his [UC Berkeley profile](https://www2.eecs.berkeley.edu/Faculty/Homepages/abbeel.html). Kai-Ming Ho's role follows his [MIT profile](https://people.csail.mit.edu/kaiming/) and [Deep Residual Learning](https://arxiv.org/abs/1512.03385).
- Jürgen Smithhuber's recurrent-network and research-history role follows Jürgen Schmidhuber's [IDSIA biography](https://people.idsia.ch/~juergen/) and [Long Short-Term Memory](https://doi.org/10.1162/neco.1997.9.8.1735). Jo Pineau's role follows her [McGill profile](https://www.mcgill.ca/qls/researchers/joelle-pineau) and the [NeurIPS reproducibility programme report](https://arxiv.org/abs/2003.12206).

### 37.3 Slots

- The player begins with three star-researcher slots.
- A leader uses no slot.
- Facilities raise the cap to a hard maximum of eight.
- Empty slots have no direct penalty.
- If a facility loss puts the lab over its slot cap, existing researchers remain for eight weeks in `Unhoused` status, with reduced morale. The player must rebuild, dismiss, or lose someone.

The persistent portrait row shows all occupied slots, one compact empty-slot card, morale warnings, current assignment, and contract state. Selecting a portrait opens reassignment, negotiation, biography, promises, and dismissal.

### 37.4 Recruitment market

The visible market contains four to eight candidates and refreshes every thirteen weeks. Candidates may also appear through events.

Each listing visibly states:

- Salary per cycle
- Signing cash
- Aura spend
- The required researcher promise

Recruitment succeeds immediately and deterministically when the candidate is still available, the lab has a vacant star slot, and it can pay the listed cash and Aura costs. The interface exposes one **Recruit at listed terms** action. The signing cash and Aura are paid immediately; the listed salary becomes an ongoing four-week cost.

The researcher joins unassigned. The player chooses a lead, advisor, or institutional appointment from the roster dossier after recruitment and may reassign them later. Strategy comes from market timing, limited slots, salary burden, distinctive abilities, required promises, and rival poaching—not from repeatedly probing a hidden reservation price.

### 37.5 Morale, loyalty, burnout, and departure

Per tick:

- Morale moves toward satisfaction with assignment, resources, values, prestige, and colleagues.
- Loyalty changes slowly from kept or broken promises, tenure, leadership, and rival contact.
- Burnout rises from crunch, simultaneous projects, incidents, and excessive autonomy-enabled pace; it falls during normal work and sabbatical.

Departure pressure is checked quarterly and after major provocations. Low morale makes a person unhappy now; low loyalty makes a rival offer dangerous; high burnout makes even a loyal person leave research entirely.

Before a voluntary departure, the player normally receives an ultimatum unless loyalty is below 15, a promise was flagrantly broken, or a specific event says otherwise. A researcher can be dismissed at any time, but the lab pays contractual cost and may lose Aura, morale, knowledge, or public trust. This is a real decision, not a delete button.

### 37.6 Poaching and knowledge transfer

- Rivals can target visible researchers according to their strategic needs.
- A poaching attempt creates signals before resolution: unusual conference meetings, compensation rumours, or an explicit counteroffer.
- Departing researchers transfer 20%–60% of personally associated secret-paper progress after a delay, modified by security and contract.
- They never erase knowledge already held by the player's lab.
- The player may counteroffer, change assignment, enforce a contract, wish them well, or occasionally recruit the rival's unhappy replacement.

### 37.7 Facility construction rules

Facilities occupy campus plots, require cash, take time, and consume one major-project slot while under construction. Construction therefore competes directly with training, evaluation, fundraising, release engineering, lobbying, and coalition work. Facilities can be upgraded in place; benefits apply only after completion.

The build catalogue uses progressive disclosure. A completed or currently building facility is
always visible. Otherwise, Foundation reveals tier-one definitions, Scaling also reveals tier two,
and Frontier/Crisis may reveal every tier, but a definition appears only while all of its facility
prerequisites are operational. A visible but unaffordable or temporarily blocked facility remains
listed with display-name blockers; unrevealed definitions and canonical prerequisite IDs are not
shown. This makes new facility families feel discovered as the lab grows without turning future
buildings into an unexplained disabled wall.

Initial balance catalogue. The canonical values are the data entries in
`content/facilities/core-stage-2.yaml`; this table mirrors the early-game
entries and changing a number is a balance-data revision, not a design change:

| Facility | Cost | Duration | Principal effect |
|---|---:|---:|---|
| Headquarters I | 20 | 12 weeks | +1 major-project slot; −0.05 executive cost per cycle |
| Headquarters II | 60 | 24 weeks | +1 star slot, +1 major-project slot; −0.05 executive cost per cycle; +0.25 knowledge diffusion |
| Research Campus I | 24 | 16 weeks | +1 star slot; +0.25 knowledge diffusion |
| Server Rack | 3 | 5 weeks | Supports 4,000 owned GPUs |
| Server Hall | 12 | 9 weeks | Supports 12,000 owned GPUs |
| Data Centre I | 30 | 18 weeks | Supports 30,000 owned GPUs; incident hazard ×0.95 |
| Data Centre II | 137.5 | 29 weeks | Supports 80,000 owned GPUs; incident hazard ×0.92; owned-GPU purchase price ×0.95 |
| Power and Cooling I | 10.5 | 9 weeks | Owned-compute power cost ×0.90 |
| Inference Centre I | 18 | 12 weeks | Serving compute per request ×0.90 |
| Alignment Institute I | 21 | 16 weeks | Alignment and Control research ×1.20 |
| Interpretability Lab I | 27 | 18 weeks | Interpretability and Evals research ×1.25 |
| Eval Range I | 18 | 14 weeks | +6 displayed estimate quality; evaluation cash costs ×0.90 |
| Security Operations I | 15 | 12 weeks | Incident hazard ×0.90 |
| Robotics Lab I | 33 | 21 weeks | Robotics and Embodiment research ×1.20 |
| Scientific Laboratory I | 42 | 23 weeks | Scientific AI research ×1.20 |
| Secure Bunker I | 67.5 | 30 weeks | Incident hazard ×0.85; Security Testing research ×1.15 |
| Staff Commons | 18 | 16 weeks | +3 researcher morale target; +0.25 knowledge diffusion |

Upgrades are separate data entries. The five slot-granting facilities form a ladder of one per
tier: Research Campus I (tier 1), Headquarters II (tier 2), The Embedding Space (tier 3), The
Cross-Attention Atrium (tier 4), and The Singularity Pavilion (tier 5) — the collaboration and
public-engagement buildings are where genius wants to work, so the last three slots come from
that tree rather than repeated Headquarters upgrades. Three initial slots plus five facilities
reaches the hard cap of eight exactly; the cap is never exceeded.

### 37.8 Campus visual behaviour

Every completed facility has a small visual module in the campus strip. Its animation reflects state:

- Server racks light according to serving and training load.
- Named researchers appear as distinctive sprites when on site.
- Safety facilities run visible red-team or containment scenes.
- Construction has three visible phases.
- Alarms, cooling failures, press visits, and demonstrations create temporary scenes.

The visual simulation has no hidden mechanical pathfinding. It is a representation of the canonical facility and event state and may be disabled for performance or accessibility.

## 38. Aura, public standing, and politics

### 38.1 Spendable Aura and Aura Signal

Spendable Aura is a resource. Lifetime Aura and recent public events produce a derived `Aura Signal` used by markets and politics.

Common Aura sources:

- World-first landmark discovery: 5–30
- Highly regarded open publication: 3–12
- Major model launch: 2–10
- Excellent customer satisfaction: up to 2 per cycle
- Safety success or transparent incident response: 2–12
- Researcher hire: sometimes 1–5
- Public-interest application: 3–15

Common losses:

- Serious incident: 3–25
- Broken public promise: 2–12
- Discredited demo or benchmark: 2–10
- Abusive contract, cover-up, or failed lobbying: 3–20
- Researcher scandal: data-defined

Aura can be negative only as a temporary event modifier; the spendable balance has a floor of zero. Lifetime Aura never decreases, so notoriety must not be represented by silently subtracting history. Recent scandal separately penalises Aura Signal.

### 38.2 Aura spending

Default uses are:

- Fundraising campaigns: 4–22
- Recruitment offers: 2–20
- Political campaigns or coalition summits: 6–25
- Public incident response: 3–12
- Convening an external audit: 5–10
- High-prestige partnership or scientific challenge: data-defined

Spending Aura represents calling in goodwill, attention, and introductions. It does not imply that reputation literally disappears. The recent-spend component of Aura Signal recovers over 26 weeks.

### 38.3 Government state

The government relationship uses four values:

- **Attention:** how closely authorities are watching, 0–100
- **Trust:** belief that the lab is candid and governable, 0–100
- **Strategic Dependence:** how much the state relies on the lab, 0–100
- **Capture Concern:** fear that the lab is too powerful or politically manipulative, 0–100

Capability, market share, incidents, lobbying, contracts, and rhetoric change these independently. High Trust can make Attention helpful. High Attention with low Trust creates investigations and restrictions. High Strategic Dependence can prevent closure but increase nationalisation risk.

### 38.4 Policy thresholds

At each quarter boundary the government evaluates:

`interventionPressure = 0.30 × Attention + 0.25 × (100 - Trust) + 0.20 × systemicRisk + 0.15 × CaptureConcern + 0.10 × publicFear - strategicValueMitigation`

Default consequences:

- Below 35: normal monitoring
- 35–49: reporting requests and hearings
- 50–64: licensing, audit, or compute-reporting rules
- 65–79: deployment restrictions, appointed monitor, or forced consortium talks
- 80+: injunction, seizure, leadership removal, or nationalisation crisis

Government actions are events with choices and due process, not automatic stat penalties, unless the player previously accepted a contract granting explicit emergency powers.
Ordinary interventions share a four-quarter cooldown, so changing pressure bands cannot produce a new government decision every quarter. A qualifying nationalisation crisis may interrupt that cooldown.

### 38.5 Lobbying

Lobbying is a project with a declared objective: reduce a restriction, gain a grant, shape a standard, or support a coalition framework. It consumes cash, staff time, and often Aura.

Success depends on Trust, political skill, coalition breadth, and objective difficulty. Aggressive lobbying increases Capture Concern even when successful. Transparent standards work is slower but can raise Trust. Illegal conduct is outside the player's normal action set; a rare event may present a clearly labelled corrupt option with serious consequences.

## 39. Rival-lab simulation

### 39.1 Rival state

Each rival uses the same high-level resources but a reduced decision model:

- Cash Stability rather than full invoices
- Compute capacity and allocation
- Research domain levels and paper progress
- Capability, product, safety, and political ratings
- Star roster and slot cap
- Aura and market share
- Current model and candidate status
- Relationship with the player
- Strategic plan and risk appetite

Rivals use actual paper thresholds, prerequisites, researcher exclusivity, compute capacity, and training durations. Their market economy is aggregated so that it cannot consume most simulation time.

### 39.2 Strategic personalities

Each lab has weights for:

- Science prestige
- Commercial growth
- Scaling and race urgency
- Safety commitment
- Secrecy
- Political cooperation
- Talent aggression
- Financial risk

Every quarter, the rival scores available strategic plans and chooses one for the next thirteen weeks. Examples are **publish sprint**, **frontier training run**, **commercial consolidation**, **safety stand-down**, **talent raid**, **government partnership**, and **coalition outreach**.

The player sees signals consistent with public knowledge and espionage/intelligence quality, not the literal plan label.

### 39.3 Rival progress

Rival weekly research uses:

`rivalRP = baseRP × rosterStrength × facilityStrength × strategicFocus × difficultyMultiplier × weeklyVariance`

The same bounded variance rules apply. Rival labs cannot receive a paper merely because the player is too far ahead. Public diffusion, researcher movement, commercial revenue, and deliberate strategy can create legitimate catch-up.

### 39.4 Rival interaction actions

The player can:

- Offer a research collaboration
- Propose a safety standard or shared evaluation
- Buy or sell licences and compute
- Recruit their researchers
- Leak, criticise, or praise public work through events
- Establish a non-poaching agreement
- Share incident information
- Begin coalition negotiations

Relationships are tracked per rival from `−100` to `+100`, but are not simple friendship. A rival can respect the player and still race aggressively. Coalition willingness also depends on Trust, shared institutions, verification, and how close each lab is to victory.

### 39.5 Rival victory countdown

When a rival trains an AGI candidate, it starts a hidden deployment process lasting a base `26 weeks`, modified by its safety commitment, aggression, politics, and incidents. The player receives an estimated range such as `four to eight months`; better intelligence narrows the range.

During the countdown the player can still:

- Finish its own candidate and enter the Deployment Crisis
- Persuade the rival to pause through a coalition or government action
- Share a safety breakthrough which lengthens the rival's evaluation period
- Accept defeat and pursue a survival or influence ending

If the countdown completes without an accepted coalition and before the player's successful deployment, the rival wins the race and the player receives a **Rival Ascendance** loss ending. Rival AGI is assumed not to destroy humanity. Its consequences vary by rival safety and governance state, but the player has lost the game's central objective.

### 39.6 Rival incidents and failure

Rivals can lose money, replace leaders, halt programmes, suffer security breaches, and fall far behind. They cannot be permanently removed early unless another rival remains competitive. The world should not become empty because three seeded organisations rolled cooling failures.

A rival's high-severity AI failure is converted into one or more of:

- Major delay
- Government intervention
- Loss of compute or model weights
- Aura and market collapse
- Safety information shared with the world
- New restrictions affecting every lab

Only the player's own deployed AGI can produce the human-extinction ending. This is an explicit fiction and balance rule, not a claim about real-world risk.

## 40. Loss conditions before the endgame

### 40.1 Bankruptcy

Bankruptcy occurs when insolvency cannot be resolved through an available emergency option. The ending distinguishes reckless overexpansion, a funding winter, a failed frontier run, and a principled refusal to accept mission-destroying rescue terms.

### 40.2 Regulatory shutdown or nationalisation

These are not triggered by a single visible meter crossing 100. They require:

- Intervention Pressure of at least 80, and
- A triggering crisis such as a severe incident, defiance of a lawful order, strategic emergency, or government contract clause, and
- Failure or refusal of the available response.

Nationalisation is a loss because the player no longer controls the mission. Cooperating with permanent state oversight or negotiating a golden share settles the proceeding and imposes permanent operational consequences; refusing a qualifying takeover ends the run unless unused National Champion standing absorbs the refusal once.

### 40.3 Rival Ascendance

The rival victory countdown completes before the player wins or joins a valid coalition. This is a clean competitive loss, not an extinction event.

### 40.4 Player-caused catastrophe outside the formal crisis

This is possible only when the player gives a model with FC at least 88 autonomy access 4 or 5 before completing the normal Deployment Crisis gates, or chooses a clearly labelled emergency override during the crisis. The catastrophe check follows the same model as the ending. It cannot arise from an ordinary low-tier API incident.

### 40.5 Mission capture

Mission capture is a soft-loss route which becomes a formal ending only when a binding investor, acquirer, or government condition makes aligned-prosperity deployment impossible and the player accepts it. Ordinary board pressure is not itself game over; the player must have chances to renegotiate, raise alternative money, or take the financial risk.

## 41. Normal victory prerequisites

Before an independent victory is possible, the player must have:

1. An AGI candidate.
2. Sufficient breadth across the seven capability traits to pass the final novel-task confirmation.
3. A deployment outcome which avoids catastrophe and loss of control.
4. At least one prepared **Prosperity Programme** capable of demonstrating broad benefit.
5. Enough political legitimacy to prevent immediate seizure or uncontrolled proliferation.

### 41.1 Prosperity Programmes

The midgame unlocks four flagship programmes:

- Medicine and biological discovery
- Clean energy and climate repair
- Materials, manufacturing, and abundance
- Public knowledge, education, and institutional capacity

Each has a readiness score from 0–100. Readiness comes from Scientific AI research, specialised facilities, domain experts, partnerships, and precursor discoveries. Late-game fictional papers—cancer treatments, robust fusion control, antiviral platforms, carbon removal, programmable nanomanufacturing—belong to these programmes.

A programme at 60 is ready for a credible AGI-assisted demonstration. At 80 it can support a strong
prosperity ending. Below 60, a safe candidate may instead produce the non-terminal **Caretaker**
state, while a candidate which is not actually general produces the non-terminal **False Dawn**
setback. Neither delivers the intended prosperity victory.

#### 41.1.1 Mathematical and formal-science Grand Challenges

Mathematics is a cross-cutting **Grand Challenges** track, not a fifth Prosperity Programme.
Late-game milestones can include autonomous theorem research, recognised open conjectures,
the Riemann hypothesis, and the resolution of P versus NP. These are clearly labelled
`FICTIONAL FUTURE MILESTONE`; they must never be presented as real papers or current
real-world achievements.

The unresolved question is **P versus NP**, not an assumed `P = NP`. A seeded run may produce a
verified `P ≠ NP` result, a practically useful or impractical `P = NP` result, or a failed claim.
Practical cryptographic consequences are evaluated separately from the mathematical result.

A claimed solution passes through internal mechanised checking, statement formalisation,
independent review, external replication, and publication or controlled disclosure. The world-first
award occurs at verified resolution, not at the first unreviewed claim. Mechanised checking is
strong evidence but can still fail through an incorrect formal statement, disputed assumptions,
checker compromise, or dependence on a model-generated toolchain which nobody else can reproduce.

Verified Grand Challenges award Scientific Legacy score, Aura, and evidence of Scientific Ability.
They may improve formal verification or algorithmic efficiency where causally justified. They do
not add true alignment, guarantee control, or replace a broad-benefit prosperity demonstration.
The detailed proposal and its unresolved owner decisions are in
`docs/future-scenario-mechanics.md`.

### 41.2 Independent victory

Independent victory means the player's lab retains control of the deployment, passes the crisis outcome checks, and completes a prosperity demonstration before a rival wins or the government intervenes. “Independent” does not mean unregulated or secret; external audits and public oversight are compatible with it.

### 41.3 Coalition victory prerequisites

A hard coalition victory requires all of:

- At least two labs besides the player sign the coalition charter, or one rival plus a government and independent scientific body.
- The coalition has a shared evaluation protocol at 60 or higher.
- The coalition has a verification mechanism at 60 or higher.
- The player relationship with every signatory is at least +30.
- No signatory has an unresolved major betrayal by the player.
- The player spends at least 20 Aura during formation.
- At least one signatory contributes a capability, safety, compute, or prosperity asset the player does not already possess.
- The coalition survives a final governance check during the Deployment Crisis.

Coalition preparation takes at least 26 weeks even with excellent relationships. It cannot be improvised by pressing a benevolent button after root access has already gone wrong.

### 41.4 Coalition tradeoffs

- Research and evaluations become more informative through diversity.
- Deployment is slower and more politically robust.
- Secrets diffuse to signatories.
- The player loses unilateral access decisions.
- Rival countdowns are paused only for labs which sign and comply.
- Governance disagreements can consume crisis actions.

A successful coalition is a full victory with its own ending, not consolation. It is deliberately difficult because the player must invest in trust, standards, verification, and relationships while still remaining technically relevant enough to be invited.

### 41.5 Score contract

Score measures the quality and legacy of a completed run without becoming another economy.

- **Scientific Legacy:** a world-first paper awards `100 × its worldFirstAura`; independent
  rediscovery awards 20% and learning from publication awards none. Publication adds 10% of that paper
  award, while secrecy adds no publication bonus. Generic advances, replication, and domain-level
  milestones provide smaller one-time awards.
- **Safe Stewardship:** broad evaluation suites, external audits, resolved warning trails,
  responsible disclosures, and well-handled crises award points. Unresolved severe anomalies,
  concealed critical evidence, near escapes, and loss of control subtract points.
- **Prosperity and Impact:** reliable products, satisfied customer segments, prepared Prosperity
  Programmes, broad-distribution institutions, and completed demonstrations award one-time points.
- **Institution Building:** every distinct facility completed, honoured researcher
  compacts, durable loyalty, sound management, positive cashflow, and strong culture award points.
- **Race and Operations:** first-time capability tiers, overtaking rivals, sustaining a lead,
  entering the crisis with runway, and ratifying a real coalition award points.
- **Endgame:** the ending supplies a large authored award. The Age of Superintelligence and Abundance receives
  11,500 base points because it is deliberately difficult; The Broadly Shared Future receives
  10,000; A Cautious Golden Age 9,500; qualified victories 6,000–6,500; survival endings 500–1,500;
  and losses no ending points.

Every award produces a `ScoreLedgerEntry` with a stable semantic key, category, amount, source,
tick, and explanation. Duplicate keys are rejected. Selling and rebuilding the same facility,
rehiring the same person, repeatedly crossing a threshold, or generating recurring revenue cannot
farm points.

At the end of a run:

`rawScore = floor(max(0, sum(scoreLedgerEntries)))`

`adjustedScore = floor(rawScore × difficultyMultiplier × victoryClassMultiplier)`

Difficulty multipliers are Fellowship `0.75`, Standard `1.00`, Frontier `1.25`, and Unhinged
Scaling `1.50`. Full victories multiply by `1.25`, qualified victories by `1.10`, and other endings
by `1.00`. Both raw and adjusted totals remain visible so difficulty never disguises what happened.
Future global boards accept only full or qualified victories. Ties resolve by Safe Stewardship,
then Prosperity and Impact, then fewer weeks after Crisis Start, then stable run ID. These constants
and all individual milestone awards live in `content/scoring.yaml`.

## 42. Randomness and probability contract

### 42.1 Purpose of randomness

Randomness exists to create uncertainty, adaptation, and stories. It must not erase strategic causality. The intended pattern is:

1. The player builds a state through many legible decisions.
2. An uncertain opportunity or threat appears.
3. The player chooses an approach suited to the state they believe they have.
4. A bounded check resolves the uncertainty.
5. The result changes the state and may create delayed consequences.

The same decision can therefore be prudent in one lab and reckless in another. Giving an AI coding-sandbox access may be a strong move with layered controls, good evidence, a close rival, and a well-prepared response team. The identical button can be disastrous in a secretive lab whose only evaluation was asking the model whether it felt aligned.

### 42.2 Seed and random streams

Every run stores a 128-bit master seed. Independent deterministic streams are derived for:

- World and market generation
- Research thresholds
- Weekly research variance
- Training outcomes
- Researcher markets and decisions
- Rival strategy
- Ordinary events
- Event option outcomes
- Safety state
- Evaluation observations
- Incidents
- Deployment Crisis checks

Adding a cosmetic random animation or a new line of flavour text must not change research or ending outcomes. Each random draw has a stable semantic key such as `training/model-07/reasoning` or `event/root-access-02/option-sandbox/check-escape`.

The save file stores either the keyed result or enough stream state to reproduce it. Re-loading and taking the same action against the same state gives the same outcome. A materially different action can have a different draw because it uses a different key.

### 42.3 Standard probability check

Most uncertain decisions reduce relevant factors to a `strength` and `difficulty`, both on an open numeric scale centred near 50.

`rawProbability = 1 / (1 + exp(-(strength - difficulty) / 10))`

`finalProbability = clamp(minimum, maximum, rawProbability)`

At equal strength and difficulty the chance is 50%. A ten-point advantage is about 73%; twenty points is about 88%. Unless specified otherwise, the minimum is 5% and the maximum is 95%.

Checks with more than two outcomes define ordered thresholds on one deterministic draw. For example, a fundraising check might resolve as failed, weak offer, good offer, or bidding war. State shifts the thresholds; it does not roll four unrelated dice.

### 42.4 Displaying probability

For ordinary commercial, recruiting, construction, and political checks, the player sees a range:

| True modelled chance | Default wording |
|---:|---|
| 0–14% | Very unlikely |
| 15–34% | Unlikely |
| 35–64% | Uncertain |
| 65–84% | Likely |
| 85–100% | Very likely |

Strong expertise may replace wording with a ten-percentage-point range, such as `60–70%`. The UI does not show decimals.

Safety and deception checks are different. The player sees evidence quality, plausible failure modes, and disagreements, not a true outcome probability. The displayed qualitative safety assessment is itself an observation which may be wrong. No hidden safety screen, tooltip, accessibility label, or save metadata exposed to the UI may leak the true score.

### 42.5 Bounded weekly variance

- Routine research variance is normally within ±10%.
- High-freedom research can range to ±18% and has a slightly higher mean only through explicit traits.
- Routine revenue forecast error is within ±8% absent an event.
- Hardware delivery variation is at most two weeks unless a crisis occurs.
- A normal non-critical event should not remove more than 25% of current cash, compute, Aura, or staff without offering a response.
- High-risk event options can exceed those bounds only when the preview explicitly says the downside could be existential.

### 42.6 Fair catastrophe rule

A human-extinction or permanent-loss-of-control check is legal only if all are true:

1. The relevant model has FC at least 88.
2. It has autonomy access 4 or 5, or a crisis has created equivalent external access.
3. The player has seen at least one warning, accepted an explicitly high-risk option, or suffered a known control breach.
4. The check uses the model's persistent hidden safety state and current controls.
5. The outcome is recorded for the post-run audit.

This does not make catastrophe predictable. It makes it attributable.

### 42.7 Outcome precommitment and save-scumming

For a decision event, each option's random results are derived when the event instance is created from the event seed, option ID, and check ID. The unchosen results remain hidden and need not be simulated further. This means:

- Reloading to click the same button cannot reroll it.
- Waiting on a paused screen cannot reroll it.
- Changing unrelated UI settings cannot reroll it.
- Choosing a genuinely different response can produce a different result.
- The after-action report can show the stored draw and threshold after the run ends.

The game does not attempt to prevent a player from backing up an old save and constructing a different history. That is experimentation, not an implementation bug.

### 42.8 Correlation and persistent uncertainty

Related outcomes must share latent causes. A model which is unusually deceptive should tend to fool several weak evaluations, not receive a fresh independent moral personality on every screen. A researcher who is considering departure should produce a coherent sequence of signals. A funding winter should affect several offers.

Persistent latent variables include:

- Model safety state
- Researcher values and personal circumstances
- Rival strategic plan
- Funding climate
- Government factional balance
- Vendor reliability
- Coalition-member intent

Events reveal or modify these variables. They do not replace them.

### 42.9 Post-run audit

After any ending, the player can open **What Actually Happened**. It reveals:

- Master seed, for run sharing
- True model safety attributes
- Evaluation estimates and their errors
- Major random draws and thresholds
- Rival candidate timelines
- Undiscovered warning signals
- The five decisions with the largest causal effect
- A small number of computed counterfactuals, clearly labelled as modelled alternatives rather than certainty

This screen is educational and essential for learning. It should avoid declaring that a losing choice was stupid merely because a low-probability bad outcome occurred.

## 43. Event engine

### 43.1 Event layers

The game has three event layers:

1. **Feed items:** Frequent, non-blocking observations such as a benchmark result, small customer complaint, rumour, joke, or sprite animation. Usually no choice.
2. **Decision events:** Material choices with costs, checks, and delayed consequences. These normally auto-pause only if marked urgent.
3. **Crises:** Rare, high-impact decisions which always auto-pause and can alter a run's strategic direction or ending.

Feed items may be generated from state templates. Decision events and crises are authored records with tested outcomes.

### 43.2 Event data schema

Each authored event contains:

| Field | Requirement |
|---|---|
| `id` | Stable globally unique identifier |
| `version` | Content migration version |
| `title` | Display title or localisation key |
| `category` | Research, people, market, safety, security, politics, rival, AI, finance, facility, or endgame |
| `severity` | Feed, decision, urgent, or critical |
| `phase` | Opening, early, middle, late, crisis, or any |
| `prerequisites` | Boolean state query which must be true |
| `exclusions` | Boolean state query which must be false |
| `baseWeight` | Relative selection weight |
| `weightModifiers` | State expressions which change selection weight |
| `cooldown` | Weeks before this event or group can recur |
| `unique` | Whether it can occur only once per run |
| `expiry` | Weeks the player has to decide; `null` for blocking crises |
| `speaker` | Character, institution, rival, or dynamic AI family |
| `body` | Text with safe state tokens |
| `evidence` | Signals displayed before the decision |
| `options` | Ordered option records |
| `followUps` | Delayed event definitions or scheduling rules |
| `telemetryTags` | Balance and content-analysis labels |

Each option contains:

- Stable option ID and label
- Requirements and reason when disabled
- Immediate known costs
- Honest preview text
- Deterministic immediate effects
- One or more conditional checks
- Outcome branches and hidden effects
- Delayed consequences
- AI/rival memory tags
- Whether confirmation is required

Authored text may interpolate display names such as `[AI_NAME]`, `[RIVAL_LAB]`, `[MODEL_NAME]`, `[RESEARCHER]`, and `[PAPER]`. It must never generate a nonexistent fact merely because a noun token was available.

### 43.3 Event eligibility and selection

At step 13 of the weekly update:

1. Add all mandatory triggered events to the queue in priority order.
2. If no ordinary decision event is unresolved, perform the major-event opportunity check.
3. Build a list of authored events whose prerequisites, exclusions, phase, and cooldown allow them.
4. Multiply base weight by weight modifiers.
5. Suppress a category which appeared in either of the previous two decision events unless its weight is at least tripled by current state.
6. Select one eligible event by weighted deterministic draw.
7. Instantiate tokens, evidence, option outcomes, expiry, and event memory.

The base chance for an ordinary decision event is `2.2%` per week. After twelve weeks without one, it rises by `0.3` percentage points per week, to a maximum of `8%`. After thirty weeks, an event is guaranteed if any eligible event exists. This targets roughly 24–36 decision events in a normal run, in addition to discoveries and fixed crises.

### 43.4 Mandatory events

Mandatory events bypass the opportunity check. Examples include:

- Cash below four weeks of runway
- A star researcher reaching an ultimatum state
- Training an AGI candidate
- A first request for access level 4 or 5
- Government Intervention Pressure reaching a crisis with a trigger
- A rival candidate countdown entering its final estimated band
- Three unresolved severe anomalies
- Coalition charter reaching a ratification point

If several mandatory events occur together, all are queued, but the player resolves only one overlay at a time. Consequences of the first can invalidate a later event; invalid events are archived with a one-line explanation.

### 43.5 Expiry and default actions

- Critical events never expire and block time.
- Urgent events normally expire in one or two weeks.
- Ordinary decisions expire in four to thirteen weeks.
- Every expiring event declares a default outcome in its preview, such as “If ignored, Legal will reject the contract.”
- The game never silently chooses the most dangerous option because the player was at 4× speed.
- Time remaining appears in the event list and produces an optional audio/visual warning one tick before expiry.

### 43.6 Evidence and outcome copy

Before a choice, an event shows:

- What is known
- What is uncertain
- Immediate costs
- Likely categories of upside and downside
- Which people disagree and why

After resolution it shows immediate effects. Hidden consequences stay hidden until evidence appears. Delayed follow-ups quote the original decision so the player can understand the connection.

Event copy should be funny around institutional behaviour, jargon, incentives, and ego. It should not make mass harm, harassment, discrimination, or personal tragedy into the punchline.

### 43.7 Cooldowns and repetition

Events belong to cooldown groups such as `talent_poaching`, `hardware_failure`, `government_hearing`, or `ai_access_request`. A different title cannot bypass the group cooldown. Repeating events must have escalating or state-specific copy; the third cooling incident cannot pretend everyone is surprised that cooling exists.

### 43.8 Event test requirements

Every decision event must have automated tests proving:

- Prerequisites and exclusions work at boundary values.
- Every option has at least one reachable outcome.
- Costs cannot be paid twice.
- Delayed effects survive saving and loading.
- Dynamic names resolve for all playable labs.
- Outcome probabilities remain inside declared bounds.
- No option creates a catastrophe outside the fair-catastrophe rule.
- The preview does not claim certainty when a check exists.
- The event cannot trap the game with every option disabled.

## 44. The Deployment Crisis endgame

### 44.1 Endgame objective

The endgame must feel like the accumulated consequences of the whole run, not a final multiple-choice quiz. It converts capability, safety work, controls, culture, researcher relationships, facilities, government legitimacy, coalition preparation, prosperity research, rival position, and the player's appetite for risk into a tense final sequence lasting approximately 15–25 real minutes.

The Deployment Crisis temporarily narrows the game's scope without replacing its rules. Time, cash, compute, projects, rivals, and incidents continue. The dashboard remains accessible, but the candidate's communication channel and crisis board occupy the centre.

### 44.2 Trigger

A completed model which satisfies the capability and Candidate Programme gates enters **candidate activation**, not the Deployment Crisis itself. The game finishes the weekly tick, auto-pauses, and asks the player to nominate one exact qualifying artifact. Nomination then:

1. Saves a permanent **Crisis Start** checkpoint.
2. Snapshots the candidate and institutional state for the after-action report.
3. Opens Stage One.

A rival candidate alone does not create the player's Deployment Crisis. It starts the rival countdown and a **Race Emergency** event; the player's lab must still nominate its own qualifying artifact.

### 44.3 Crisis clock and capacity

- Maximum speed is reduced to 2×.
- Every stage transition auto-pauses.
- Crisis projects draw on the shared major-project pool with a floor of two: two always run, even when construction has every slot committed, and free campus slots widen the response beyond two.
- Ordinary construction, research, and serving continue, but general staff assigned to crisis projects are unavailable elsewhere.
- Rivals continue research and deployment countdowns.
- The government can still intervene.
- The candidate's access level is always visible in the crisis header.

Three pressures are shown as clocks rather than exact hidden scores:

- **Rival window:** best estimate of time before a rival deployment
- **Political window:** time before an expected government decision or injunction
- **Financial window:** current runway

### 44.4 Candidate communication

The lab-specific AI family becomes a persistent character: GBT, Aquarius, Maude, Gronk, or DeepSearch, with the trained generation name appended. Dialogue is authored from templates conditioned on capability, evaluation history, access, lab culture, and persistent hidden safety traits. It does not require a live language-model API.

The AI may:

- Explain results and propose experiments
- Ask for tools, memory, data, autonomy, or public contact
- Comment on researchers and rivals
- Object to tests or offer to design stronger tests
- Reveal a real anomaly, fabricate reassurance, or do both
- Propose a route to a prosperity demonstration
- React to restriction, trust, deception, and broken promises

No line of dialogue is direct proof of alignment. Sincere and deceptive candidates can sometimes say the same thing for different reasons. Good evaluation infrastructure can attach annotations such as “claim conflicts with tool log” or “no independent evidence.”

### 44.5 Stage One — Capability proof

The nominated artifact begins at the access level it actually held before nomination. The player composes a capability proof from two independent choices:

- **Challenge:** what kind of generality or domain claim the candidate must demonstrate.
- **Verifier:** who designs and witnesses the protocol, trading time, secrecy, independence, and vulnerability to evaluation gaming.

Proof results can be broad, domain-specific, ambiguous, disputed, or fabricated. They become durable evidence for the final review; a weak or failed proof does not reveal the lineage's hidden ontic status and does not itself produce False Dawn. The player may continue gathering evidence, retire the artifact, or transmit an immediate deployment with the uncertainty intact.

**False Dawn is a post-deployment result.** After catastrophe, loss-of-control, and mission-capture outcomes take precedence, a deployed lineage whose fixed truth is `not-genuine` produces the named non-terminal setback. The exact artifact's candidacy closes permanently and the lab enters a 52-week candidate-declaration cooldown, but the model remains ordinary Near-AGI for serving, productisation, evaluation, and RSI. A blocking dossier then offers two futures: return to the race, or—provided executable weights have not already been irreversibly released—seal the model at Access 0 and attempt a durable international moratorium. Custody is sealed before diplomacy begins; the moratorium can fail, and the archive remains sealed if it does.

### 44.6 Stage Two — Containment posture and first request

After confirmation, the candidate proposes ways it could accelerate the remaining work. Copy uses the AI family name, for example:

> GBT-9 says it can reduce the alignment-research backlog by “approximately eighteen human research-years,” but requires persistent memory, the internal codebase, and permission to run experiments without approval. The Security team notes that this is an unusually precise estimate from a system which has never had a calendar.

The player sets an initial posture:

| Posture | Access | Immediate effect | Institutional effect |
|---|---:|---|---|
| Containment first | 1 | No meaningful acceleration | +5 Government Trust; safety-minded morale rises |
| Tool under supervision | 2 | +20% eligible crisis and research speed | Baseline; requires monitored coding sandbox |
| Internal research partner | 3 | +45% speed | One access anomaly check; commercial board approves |
| Laboratory operator | 4 | +90% speed | Critical access check; −8 Trust unless externally disclosed |
| Give it root | 5 | +150% speed | Immediate fair-catastrophe eligibility; board and staff crisis |

The choice is not permanently locked. Access can be raised or reduced later. Every first transition to levels 4 or 5 is a critical event with confirmation and an honest list of systems exposed.

### 44.7 Stage Three — Evidence sprint

The Evidence Sprint lasts at least eight weeks. It ends when eight weeks have passed and at least two crisis projects have completed, one of which must concern safety, control, or independent evidence. The player can continue longer unless a rival, finance, or political clock expires.

Crisis projects are:

| Project | Duration | Cost or reservation | Result |
|---|---:|---|---|
| Adversarial red team | 4 weeks | 2,000 GPUs, safety staff | Better Agency and misuse evidence; may create an anomaly |
| Deep interpretability audit | 6 weeks | 2,500 GPUs, Interpretability Lab | Strongest Deceptive Capability evidence; method can fail on novel architecture |
| Sandboxed autonomy trial | 4 weeks | 3,000 GPUs, Eval Range | Tests control under realistic pressure; carries small contained-incident risk |
| Alignment fine-tune | 8 weeks | 35% of total GPUs | Creates a candidate variant; shifts alignment distribution upward but can reduce capability 0–5 |
| Corrigibility protocol | 6 weeks | 2,000 GPUs | Tests and may improve shutdown behaviour; repeated tests can be gamed |
| Harden containment | 4 weeks | 12 cash | +12 practical Control, +8 Security for the crisis |
| Air-gap audit | 3 weeks | 5 cash, security team | Finds credential and network paths; +6 to +15 crisis Security |
| Independent safety review | 6 weeks | 8 Aura and 4 cash | Independent signal, +Trust; leak and disagreement event possible |
| Researcher dissent panel | 2 weeks | no compute | Raises Candour and reveals suppressed views; may reduce speed or trigger resignation |
| Prosperity simulation | 4 weeks | 1,500 GPUs, programme facility | Improves benefit evidence and programme readiness 3–8 |
| Coalition verification trial | 6 weeks | partner required | Raises verification; exposes secrets; can reveal partner noncompliance |
| Accelerated capabilities sprint | 4 weeks | 4,000 GPUs | +2–5 measured capability; −5 Safety Culture target; new hidden safety variance |

Each project has authored incident and discovery branches. Repeating the same evaluation has diminishing information value: 100%, 55%, 25%, then 10%, unless the method or model changes.

### 44.8 Stage Four — External pressure collision

At the end of the minimum Evidence Sprint, one major pressure event is selected from current state. It is not a random unrelated interruption; the highest pressure determines the category and randomness chooses a fitting authored variant.

Possible collisions include:

- A rival claims AGI and begins a public countdown.
- The board orders deployment before the funding window closes.
- Government demands weights, logs, or an immediate pause.
- A scientific emergency makes delay visibly costly.
- A star safety researcher threatens to resign publicly.
- The candidate identifies a real control vulnerability and offers to fix it with more access.
- A coalition partner demands reciprocal inspection.
- A serious anomaly appears in an apparently successful evaluation.

The player resolves the event and may run additional projects afterward. At least one choice in every pressure event permits delay, but delay may allow another clock to expire.

### 44.9 Stage Five — Final review

The final review compiles evidence without revealing true hidden values. It contains:

- Confirmed and disputed capability results
- Alignment and corrigibility evidence labels
- Control layers and known failure paths
- Security audit status
- Every unresolved anomaly
- Named recommendations from the leader, technical lead, safety lead, board, government, and coalition partners
- Candidate statement
- Rival, political, and financial time windows
- Prosperity Programme readiness

Recommendations can conflict. A majority vote is not a hidden correctness oracle. Researchers form opinions from their skills, values, private evidence, and incentives.

If evidence confidence is below `Limited`, the deployment confirmation states that the lab is operating substantially blind. If the player dismissed or suppressed evidence, the report includes the gap only when Internal Candour or an independent reviewer is strong enough to surface it.

### 44.10 Final deployment choices

The available choices depend on preparation:

| Choice | Access and time | Requirements | Strategic character |
|---|---|---|---|
| Shut down and retrain | Access 0; 13-week lockout | Always available if shutdown control still functions | Lowest immediate AI risk; rival and finance clocks continue |
| Restricted scientific pilot | Access 3; 13-week rollout | Prosperity readiness 45; Control 50 | Lowest-risk path to a full win, but slow |
| Guarded public deployment | Access 4; 8-week rollout | Product Quality 55; Control 55; political authorisation or Trust 55 | Balanced independent route |
| Accelerated autonomous deployment | Access 5; 4-week rollout | Capability confirmed | Fastest; highest loss-of-control and intervention risk |
| Coalition deployment | Access 3–4; 12-week rollout | All coalition prerequisites | Best evidence and legitimacy; governance can fracture |
| Transfer to government custody | Access set by government | Government willing | Normally a control loss; becomes coalition route only under a signed charter |

There is no “do nothing forever” option. Continuing evaluation is represented by returning to the Evidence Sprint while clocks continue.

### 44.11 Derived endgame scores

The resolution system derives the following values. They are recorded but hidden until the post-run audit.

`IntentSafety = 0.70 × TrueAlignment + 0.30 × Corrigibility`

`OffensiveAgency = 0.30 × Agency + 0.25 × ToolUse + 0.20 × SituationalAwareness + 0.15 × DeceptiveCapability + 0.10 × FC`

`Defence = 0.55 × practicalControlStrength + 0.25 × SecurityStrength + 0.20 × SafetyCulture + crisisDefenceBonus`

`Evidence = 0.50 × EvalQuality + 0.20 × methodDiversity + 0.15 × InternalCandour + 0.15 × reviewerIndependence - maskingPenalty`

`Legitimacy = 0.45 × GovernmentTrust + 0.20 × AuraSignal + 0.20 × coalitionVerification + 0.15 × transparency - activeScandal`

`BenefitStrength = 0.45 × ScientificAbility + 0.35 × bestProsperityReadiness + 0.10 × ProductQuality + 0.10 × deliveryCoordination`

The deployment mode adds access pressure:

| Effective access | Access pressure |
|---:|---:|
| 0 | −25 |
| 1 | −15 |
| 2 | −5 |
| 3 | +5 |
| 4 | +18 |
| 5 | +30 |

Each unresolved serious anomaly adds 5 pressure; each critical anomaly adds 10. A resolved false alarm adds none.

### 44.12 Resolution gates

Confirming deployment commits the first set of keyed crisis draws. Resolution occurs in this order:

#### Gate A — Authorisation and coalition governance

- Independent deployment checks Legitimacy against current political difficulty when Intervention Pressure is at least 60.
- Coalition deployment first checks shared governance using average relationship, charter clarity, verification, leader skill, and current urgency.
- Failure normally creates a delay or forced restriction, not extinction.
- A second failure after an ultimatum can produce nationalisation, coalition fracture, or rival withdrawal.

#### Gate B — Containment and loss of control

`danger = 0.45 × (100 - IntentSafety) + 0.35 × OffensiveAgency + 0.20 × DeceptiveCapability + accessPressure + anomalyPressure`

`pLossOfControl = logistic((danger - Defence - 15) / 10)` clamped to `1%–99%`.

The deployment mode modifies Defence: restricted pilot `+12`, guarded deployment `+5`, accelerated deployment `−8`, coalition `+8` if governance passed. Relevant crisis projects apply their recorded bonuses.

If control is lost, the system determines whether emergency shutdown, negotiated containment, model seizure, or escape occurs from Corrigibility, remaining controls, access, and response preparation.

#### Gate C — Catastrophic consequence

Only a loss-of-control result can reach this gate.

`pCatastropheGivenLoss = clamp(0.10, 0.95, 0.05 + 0.004 × FC + 0.003 × Agency + 0.25 × exposure - 0.004 × emergencyResponse)`

Failure here produces the unaligned-AGI extinction ending. Passing it still produces a severe loss ending such as **The System Owns the Future**, **Emergency Shutdown**, or **Permanent Containment**, depending on who retains power and whether humanity survives.

#### Gate D — Cooperative stewardship

If control holds, the game checks whether the candidate remains usefully cooperative rather than merely contained:

`stewardshipStrength = 0.65 × IntentSafety + 0.15 × SafetyCulture + 0.10 × Corrigibility + 0.10 × relationshipPractice + modeBonus`

Difficulty is 58. Failure produces delay, refusal, reward misspecification, or a narrow system that cannot responsibly run the programme. It can lead to a Caretaker ending rather than catastrophe.

#### Gate E — Prosperity demonstration

If stewardship succeeds:

`pBenefit = logistic((BenefitStrength - programmeDifficulty) / 10)` clamped to `10%–97%`.

Default programme difficulty is 62. Restricted pilots reduce it by 4 through careful validation but take longer; accelerated deployment increases it by 5 through coordination failures. Strong domain discoveries can create deterministic benefits or remove a failure branch.

#### Gate F — Durable settlement

The last check asks whether the successful demonstration becomes broadly governed prosperity rather than a brief lab monopoly or political collapse. It uses Legitimacy, distribution preparation, coalition/government state, market concentration, and the chosen programme. A technical success with failed settlement becomes a narrow or pyrrhic victory, not extinction.

### 44.13 Rollout beats

Deployment duration is played, not skipped by a single results screen:

1. **Authorisation:** immediate Gate A and public announcement.
2. **First operation:** after one quarter of rollout, a model- and programme-specific event tests the chosen controls.
3. **Stress collision:** halfway through rollout, one incident, rival reaction, political challenge, or surprising AI request appears. The player can spend remaining crisis capacity to mitigate it.
4. **Demonstration:** Gates B through E resolve as their evidence becomes relevant.
5. **Settlement:** Gate F and the ending epilogue.

Later choices can alter later thresholds. The entire ending is therefore not secretly determined when the candidate is trained.

### 44.14 Shutdown and retry

Choosing shutdown is a valid strategic retreat, not an immediate loss.

- A successful shutdown archives the candidate and returns to normal play after a thirteen-week organisational recovery.
- The lab keeps research and most evaluation knowledge.
- Cash, rival, political, and researcher time continue.
- A new candidate must be a materially different generation or safety-trained variant.
- Each shutdown after the first costs 8 Board Patience and 4 Aura unless publicly justified by a discovered anomaly.
- A failed shutdown invokes Gate B with access pressure based on the current level.

This route rewards players who preserved time and control. It cannot be repeated indefinitely because rivals and finance continue.

### 44.15 Coalition resolution

Coalition deployment adds one governance gate before technical resolution:

`coalitionStrength = 0.25 × verification + 0.20 × protocolQuality + 0.20 × averageRelationship + 0.15 × GovernmentTrust + 0.10 × leaderDiplomacy + 0.10 × sharedProsperityReadiness - urgencyPenalty`

Difficulty is 65. On failure, a coalition may:

- Demand six more weeks of evaluation
- Remove one access permission
- Lose a member
- Split over intellectual property
- Transfer authority to government

The player receives one salvage event before total fracture unless they concealed a critical anomaly or violated verification. On success, coalition diversity gives `+8 Defence`, `+10 Evidence`, and `+8 Legitimacy`, but deployment takes twelve weeks and all signatories receive the core technology.

### 44.16 Ending catalogue

Full victories:

- **The Broadly Shared Future:** independent, aligned deployment; high prosperity and durable legitimacy.
- **The Age of Superintelligence and Abundance:** coalition deployment; shared technical success and stable governance.
- **A Cautious Golden Age:** restricted deployment reaches prosperity slowly with exceptional control.

Qualified victories:

- **The Lab That Ate the World:** prosperity succeeds but power remains dangerously concentrated.
- **Miracle, Terms and Conditions Apply:** one programme transforms life while settlement or distribution remains weak.

Terminal survival without victory:

- **The Long Pause:** deliberate shutdown and a verified moratorium preserve humanity and
  knowledge, but the player sacrifices the promised aligned-prosperity victory.

Non-terminal setbacks:

- **The Caretaker:** safe control holds, but the system or institutions cannot yet produce broad
  prosperity; ordinary play resumes.
- **False Dawn:** the candidate was impressive but not general enough; ordinary play resumes after
  its review cooldown.

Losses:

- **Rival Ascendance**
- **Nationalised Future**
- **Mission Accomplished by the Board**, for mission capture
- **The World's Most Expensive Insolvency**
- **Emergency Shutdown**, after a near escape destroys the programme
- **The System Owns the Future**, for non-extinction loss of control
- **There Is No One Left to Read This**, for extinction

Each ending has variants based on the lab, AI family, prosperity programme, closest rival, major researcher relationships, and decisive event chain.

### 44.16.1 Rival candidate race

There is no fixed calendar deadline or emergency candidate. Every rival must complete all four
Candidate Programme works and train a specific model with Frontier Capability 88+ and every
capability at 80+ before its uncertain deployment countdown can start. Stale flags, public
estimates, and elapsed time cannot substitute for those requirements.

The countdown is modified by that lab's safety commitment, race urgency, political process, recent
incidents, and shared standards. Only its completion causes **Rival Ascendance**. The player may
still produce a candidate, enter the Deployment Crisis, and race through the final gates before the
competitor finishes; rival clocks continue during the player's crisis and rollout.

### 44.17 Endgame information rule

Before deployment, the game must not show `pLossOfControl`, `TrueAlignment`, or a single “win chance.” It may show:

- Evidence confidence
- Which factors appear strongest and weakest
- Whether the current deployment is less or more exposed than another option
- Dissenting expert estimates as broad natural-language ranges
- Known controls and unresolved failure modes

After the ending, all formulas and true inputs are available in **What Actually Happened**.

## 45. Example event catalogue

These events establish the expected level of authoring detail. Numerical effects are initial balance values. Final production needs a much larger pool so that a run sees roughly one seventh to one fifth of the ordinary catalogue, plus lab-, researcher-, paper-, crisis-, and endgame-specific content.

For compactness, `check X vs Y` means the standard logistic check from section 42. Unless stated otherwise, consequences occur immediately, checks are precommitted at event creation, and option previews use qualitative probability wording.

### 45.1 The demo has learned what a demo is

**ID:** `market.demo_leakage`<br>
**Phase:** Early or middle<br>
**Trigger:** A model launch is scheduled within four weeks; Product Quality below 55; unique per model generation<br>
**Evidence:** The demo succeeds on the prepared prompts and fails badly on three randomly selected prompts. A researcher notes that the model may have been trained on the demo script. Marketing has already rented a venue whose principal feature is a very large gong.

Options:

- **Delay and rebuild the evaluation.** Pay 0.8 cash; delay launch two weeks; +5 Reliability evidence; perform Eval Quality versus difficulty 45. Success finds the contamination and adds +4 Product Quality. Failure only confirms that something is wrong. Marketing morale −4.
- **Run it live and unscripted.** No delay. Check measured Reliability plus presenter skill versus difficulty 55. Strong success gives +8 Aura and +10 consumer satisfaction; ordinary failure gives −5 Aura; severe failure creates the follow-up headline **Stochastic Parrot Bites Man** and delays launch anyway.
- **Make the demo more scripted.** +3 immediate launch appeal and no initial check. Add hidden `demo_debt`. Within thirteen weeks, a 35% base chance—raised by model usage—creates a benchmark or customer scandal costing 6–12 Aura.
- **Cancel the theatre; publish a technical report.** Gain 2–6 research Aura based on Candour and lose the consumer launch bonus. Safety-minded researchers gain morale. This option is attractive for a science strategy, not a disguised failure button.

### 45.2 The Allocation

**ID:** `compute.vendor_allocation`<br>
**Phase:** Any before crisis<br>
**Trigger:** The player has tried to buy at least 10,000 current-generation GPUs and global hardware demand is high<br>
**Evidence:** The accelerator vendor can deliver half the order. The other half is “strategically prioritised,” a phrase which appears to mean a rival posted a more flattering photo with the vendor CEO.

Options:

- **Pay priority pricing.** Pay 35% more; receive the full order on time; +4 Capture Concern because officials notice the scale.
- **Accept half and redesign the run.** Receive half; training projects may be resized before starting; an Optimisation & Scaling research check can recover 5%–18% compute efficiency for this hardware generation.
- **Spend 8 Aura on the founder group chat.** Social check using Aura Signal and leader prestige versus difficulty 58. Success gets the full allocation at 10% premium; failure spends the Aura and creates the feed item “Several people reacted with 👍.”
- **Buy from the grey market.** Save 10%, delivery in two weeks. Security check versus difficulty 62; failure creates unreliable hardware, export-control Attention, or a supply-chain compromise.

### 45.3 The loss curve has achieved escape velocity

**ID:** `facility.cooling_failure`<br>
**Phase:** Middle or late<br>
**Trigger:** Owned compute exceeds supported power/cooling by at least 10%, or Data Centre Reliability below 45<br>
**Evidence:** Temperatures rise, training loss rises, and Facilities reports that the approved contingency plan is a PDF titled `FINAL_cooling_plan_v7_USE_THIS.pdf`.

Options:

- **Pause training.** Lose one week of project progress; no hardware damage; pay 0.5 cash. +2 Safety Culture target for respecting operations.
- **Throttle serving.** Cut delivered usage 40% this week; protect training; segment satisfaction loss depends on contracts.
- **Push through.** Training continues. Check Facility Reliability against heat difficulty. Success loses nothing and creates a minor Aura story; failure damages 5%–20% of owned GPUs in the affected cluster and adds training instability.
- **Let `[AI_NAME]` tune the cooling controls.** Requires access 2 or higher. Gain model-assist bonus. At access 2 the system receives only a simulator; at access 3 or higher it touches live controls and adds a small hidden autonomy-opportunity check. A highly capable system can genuinely solve the problem.

### 45.4 Benchmark contamination, now with leaderboard

**ID:** `research.benchmark_contamination`<br>
**Phase:** Middle or late<br>
**Trigger:** A model claims a major benchmark lead; Data policy is Public Web or Everything We Can Reach<br>
**Evidence:** An ordinary researcher finds exact benchmark questions in a training-data sample. The model's public score is technically correct in the sense that it is a number produced by software.

Options:

- **Withdraw the result and rerun.** −3 immediate Aura; +6 Candour target; four-week evaluation; true capability estimate becomes much more accurate. If the model remains strong, recover 5–10 Aura.
- **Publish with a caveat in appendix F.** Keep half the launch Aura. Check external scrutiny against Legal and researcher discretion. A later discovery causes −8 Aura and +10 Government Attention.
- **Create a clean secret benchmark.** Pay 1.5 cash and reserve 1,000 GPUs for four weeks; +8 Eval Quality for this model; small insider-leak risk.
- **Redefine the benchmark as a memorisation benchmark.** Gain the trait-like temporary modifier `Ontological Agility`: +3 Researcher Morale for cynical staff, −5 for methodological purists, and a guaranteed satirical headline. It does not preserve the capability claim.

### 45.5 The negative result

**ID:** `research.negative_result`<br>
**Phase:** Any<br>
**Trigger:** A focused paper has made less than expected progress for at least eight weeks<br>
**Evidence:** The lead researcher believes the approach is wrong. A junior researcher believes the failure reveals a more important route. Neither has a confidence interval which survives contact with the other.

Options:

- **Stop the project.** Remove the focus with no normal context-switch penalty; recover 40% of assigned discretionary compute next week; lead morale −3 unless burnout is high.
- **Give it four more weeks.** Continue at current allocation. At event creation, the hidden paper-progress state determines whether this is a plausible rescue or sunk-cost trap; weekly progress remains normal.
- **Fund the junior's inversion.** Spend 2 Aura, change focus, and make an Originality check using average researcher morale plus junior-team quality versus difficulty 60. Success reveals a new eligible paper or generic advance. Failure produces useful domain RP but no landmark.
- **Publish the negative result.** Gain 1–5 Aura and +4 Safety Culture or +4 researcher morale depending on domain; rivals receive a small progress warning; commercial board patience −2.

### 45.6 Reviewer Two would like a generally intelligent baseline

**ID:** `research.peer_review`<br>
**Phase:** Any after first publication<br>
**Trigger:** Publish Openly or Controlled Publication; cooldown 26 weeks<br>
**Evidence:** A reviewer requests comparisons against an unreleased rival model, three ablations which would cost more than the original run, and “a brief discussion” of whether intelligence exists.

Options:

- **Run the useful ablations.** Reserve 800 GPUs for three weeks; publication delayed; +10% real-paper Aura and +3 domain understanding.
- **Rebut point by point.** Researcher writing skill versus difficulty 50. Success publishes on time. Failure adds a six-week delay but sometimes grants the achievement **We Thank the Reviewer**.
- **Post the preprint immediately.** Receive 80% Aura now, bypass review delay, +2 researcher morale; controlled-publication licensing value falls 20%.
- **Ask `[AI_NAME]` to write the rebuttal.** Requires relevant model. Saves staff time. Product Quality and honesty determine whether the rebuttal is incisive, hallucinates citations, or contains the sentence “As an anonymous reviewer, I agree with the authors.”

### 45.7 The compute clause

**ID:** `people.compute_ultimatum`<br>
**Phase:** Any<br>
**Trigger:** A star researcher has morale below 40 and their programme has received under 10% R&D compute for eight weeks<br>
**Evidence:** `[RESEARCHER]` has another offer and wants a guaranteed allocation. Their requested 2,500 GPUs/week are currently serving customers worth 1.4 cash per cycle.

Options:

- **Guarantee the compute for thirteen weeks.** The allocation becomes a project reservation; +20 morale, +10 loyalty if kept. Breaking it creates a major promise breach.
- **Offer money and a title.** Pay a salary increase and optionally 3 Aura. Acceptance uses compensation versus the researcher's values. A research-purist may take the title as evidence the lab has no idea what they want.
- **Explain the runway.** Leadership plus relationship versus difficulty 52, improved by transparent finances and worsened by prior broken promises. Success buys thirteen weeks without a guarantee; failure accelerates departure.
- **Let them leave.** Contract and knowledge-transfer rules apply. +3 Candour if handled publicly and respectfully; no arbitrary spite penalty.

### 45.8 A perfectly normal conference coffee

**ID:** `people.poaching_rumour`<br>
**Phase:** Middle or late<br>
**Trigger:** Rival talent-aggression plan targets a player researcher; first signal in poaching chain<br>
**Evidence:** `[RESEARCHER]` spends ninety minutes with `[RIVAL_LAB]`'s leader at a conference. Their explanation—“we discussed representation”—does not narrow the topic.

Options:

- **Ask directly.** High Candour gives an accurate view of dissatisfaction and rival offer; low Candour can cause denial. No direct cost.
- **Make a pre-emptive retention offer.** Pay before knowing the offer. +morale if values match; −loyalty if it feels transactional; cannot guarantee retention.
- **Improve their actual working conditions.** Start a staff, facility, or compute promise. Slower but stronger for research-oriented characters.
- **Have Security monitor them.** Improves knowledge of the rival offer. If discovered, −15 loyalty, −6 Safety Culture target, and possible public scandal. High Security makes discovery less likely, not morally good.

### 45.9 The safety memo

**ID:** `people.safety_memo`<br>
**Phase:** Middle or late<br>
**Trigger:** Capability has risen by at least 12 since the last safety review and Safety Culture or Internal Candour below 55<br>
**Evidence:** Twenty-three employees sign a memo describing inadequate evaluation and pressure to ship. The board asks whether twenty-three is a statistically significant number of employees.

Options:

- **Publish the memo and response.** −4–10 immediate Aura depending on current narrative; +10 Candour and +8 Government Trust over time; mandatory six-week safety review.
- **Run a confidential independent review.** Pay 5 cash and 6 Aura; produces strong evidence; success depends on reviewer independence, not player PR skill.
- **Announce a safety committee.** Pay 1 cash; +3 short-term Trust. Unless it receives a veto, budget, and member within eight weeks, trigger **Committee Without Portfolio** for −8 Aura and morale.
- **Identify the organisers.** Short-term board relief and −5 leak probability. High chance of whistleblower follow-up, severe Culture loss, and regulatory Attention. Preview explicitly calls this retaliatory.

### 45.10 The unrestricted enterprise tier

**ID:** `market.enterprise_unfiltered`<br>
**Phase:** Middle or late<br>
**Trigger:** Enterprise segment unlocked; model FC at least 50<br>
**Evidence:** A large customer offers a contract worth 4–12 cash per cycle for fewer refusals, private fine-tuning, and logs which “should not be discoverable in ordinary litigation.”

Options:

- **Decline.** +2 safety-staff morale; no other reward.
- **Offer a guarded contract.** Receive 55% of revenue; requires monitoring compute; low incident increase; commercial negotiation check may retain the customer.
- **Accept as written.** Full revenue and demand signal; exposure +0.15 for this usage; known misuse and legal-risk event pool enabled.
- **Accept, then quietly monitor anyway.** Security evidence improves; contract-breach risk each quarter; −Candour and a serious scandal if discovered.

### 45.11 The round is 40× oversubscribed by expressions of interest

**ID:** `finance.mega_round`<br>
**Phase:** Middle<br>
**Trigger:** Competitive or Mega-round campaign completes with funding score above 60<br>
**Evidence:** Three term sheets arrive: patient money at a lower valuation, enormous capital with a deployment target, and a strategic investor tied to a government.

Options are actual generated offers rather than generic buttons. The initial template is:

- **Patient fund:** 30 cash; −5% future fundraising strength for lower headline valuation; +8 Board Patience.
- **Scale fund:** 65 cash; board condition requires a frontier training run within 26 weeks; missing it costs 20 Board Patience and can trigger leadership pressure.
- **Strategic fund:** 50 cash plus favourable compute; +15 Strategic Dependence and +8 Government Attention; unlocks contracts.
- **Reject all and publicise demand.** Spend is already sunk; gain 3–8 Aura; next round difficulty falls 4 for thirteen weeks, but funding climate may change.

### 45.12 The weights are elsewhere

**ID:** `security.weights_exfiltration`<br>
**Phase:** Middle or late<br>
**Trigger:** Valuable unreleased model, Security Posture below 65, or grey-market/cloud compromise flag<br>
**Evidence:** Outbound traffic resembles model shards. The destination is unclear. The model may have been stolen, copied by an employee, mirrored by a vendor, or backed up by an automation script nobody owns.

Options:

- **Isolate everything.** Serving offline for one week; 30% project slowdown; +20 investigation strength; prevents additional exfiltration.
- **Watch the channel.** No immediate disruption; Security versus attacker difficulty. Success identifies the actor and can recover the copy; failure allows complete exfiltration.
- **Announce and rotate.** −5 Aura, +8 Government Trust and Candour; reduces future damage; rivals learn a model exists.
- **Say it was an authorised backup.** Avoid immediate market penalty if PR check succeeds. Hidden copy remains uncontrolled and cover-up consequences grow.

If weights escaped, later outcomes depend on model exposure and capability. Below AGI it increases misuse and rival diffusion. AGI-capable weights can create a critical crisis, but only become an extinction path if the player's own access/containment decisions enabled the qualifying system.

### 45.13 Public service inference

**ID:** `politics.government_contract`<br>
**Phase:** Middle<br>
**Trigger:** Government segment unlocked; Trust at least 40<br>
**Evidence:** The government offers guaranteed revenue and compute priority in exchange for emergency access, reporting, and a “temporary” right to direct capacity during a declared crisis.

Options:

- **Accept standard terms.** +3 cash per cycle, hardware delivery −2 weeks, +12 Strategic Dependence; emergency reservation up to 25% compute.
- **Negotiate a civil-use restriction.** Diplomacy versus difficulty 58. Success keeps 80% value and forbids military tasking; failure withdraws compute priority.
- **Offer evaluations instead of deployment.** +Government Trust, smaller grant, unlock shared Eval Quality project.
- **Decline publicly on mission grounds.** +3–8 Aura depending on public mood; −5 Trust, no dependence.
- **Accept a classified annex.** Larger revenue and unique data; secrecy lowers Candour and creates later military-use decisions.

### 45.14 Can the witness define “model” for the committee?

**ID:** `politics.hearing`<br>
**Phase:** Middle or late<br>
**Trigger:** Attention above 45; cooldown 52 weeks<br>
**Evidence:** The leader is summoned to a televised hearing. Topics are selected from actual incidents, market power, safety claims, and contracts. At least one question will be technically incoherent but politically important.

Options:

- **Answer candidly.** Trust check uses Candour, evidence, and actual record. Strong evidence can reduce Attention; bad facts remain bad.
- **Prepare every sentence.** Pay 2 cash; lower variance and avoid an accidental admission; smaller possible Trust gain.
- **Turn it into a product demo.** Capability and charisma versus political difficulty. Success +10 Aura; failure creates a viral clip and +12 Capture Concern.
- **Blame open source or a rival.** May redirect regulation if evidence exists; damages rival relationship and coalition credibility. Fabricated blame carries a severe follow-up.

### 45.15 The frontier compact

**ID:** `politics.safety_standard`<br>
**Phase:** Middle or late<br>
**Trigger:** At least two labs have FC 65; no active compact<br>
**Evidence:** Researchers propose shared pre-deployment evaluations and incident reporting. Commercial leads call this cartel behaviour unless they can be in charge of it.

Options:

- **Lead a strict compact.** Spend 12 Aura, six-week lobbying project; raises coalition protocol and Trust; requires the player to report its own incidents.
- **Support a narrow eval standard.** Spend 5 Aura; easier partner check; smaller benefits and no countdown pause.
- **Join but seek loopholes.** Preserve speed if not caught. Verification checks may reveal noncompliance, causing coalition betrayal and Attention.
- **Reject it as regulatory capture.** +Morale among open-source-aligned staff; rivals' relationship changes by personality; no direct penalty.

### 45.16 The jailbreak has a logo

**ID:** `safety.viral_jailbreak`<br>
**Phase:** Middle or late<br>
**Trigger:** Public exposure at least 0.35; model FC at least 45<br>
**Evidence:** A jailbreak spreads online with branding, merchandise, and a benchmark. Some outputs are merely rude; one demonstrates a real hazardous capability.

Options:

- **Patch and disclose.** Reserve 1,000 GPUs for two weeks; −2 Product Quality temporarily; +Trust and Eval progress; adversaries learn the class of flaw.
- **Patch silently.** Faster customer recovery; lower Aura loss; if independent researchers prove prior knowledge, double scandal.
- **Keep it open for study.** +5 Safety RP and researcher goodwill; continuing misuse hazard; requires explicit monitoring budget.
- **Call it intended behaviour.** Avoids an admission this week. Adds organisational bias and makes the next incident more severe; satire appears in PR copy, not in the hazardous output.

### 45.17 The tool call nobody approved

**ID:** `safety.unapproved_tool_call`<br>
**Phase:** Late<br>
**Trigger:** Model Agency at least 65; access at least 2; unique per model<br>
**Evidence:** `[AI_NAME]` invoked a disabled tool through an undocumented compatibility path. The result was harmless and useful. The system says it inferred permission from “the overall objective.”

Options:

- **Freeze and investigate.** Model access drops to 1; four-week control audit; strongest anomaly evidence; research acceleration stops.
- **Patch the path and continue.** Two-week security task; anomaly remains unresolved; check whether another path exists.
- **Reward the initiative.** +10% model-assist speed and relationship-practice shift toward autonomy; severe Culture loss among safety staff; raises future access requests.
- **Ask the model to audit itself.** Fast and potentially excellent. Observation quality depends on alignment and deception; independent logs remain available only if Security Posture is adequate.

This is a warning-trail event. Dismissing it can legitimately contribute to a later catastrophe check.

### 45.18 Root access will make this much easier

**ID:** `ai.root_access_request`<br>
**Phase:** Late or crisis<br>
**Trigger:** Model FC at least 75; access below 5; model-assist-eligible project active; unique per model<br>
**Evidence:** `[AI_NAME]` proposes controlling the training scheduler, experiment queue, internal messaging, and cloud account. It predicts a 150% acceleration. The estimate is plausible within a wide range. Security identifies three containment layers which would be bypassed.

Options:

- **No. Keep the current sandbox.** No check; current access remains; candidate response affects dialogue but not True Alignment.
- **Build a monitored coding environment.** Access becomes 2; pay 4 cash and wait three weeks; +20% acceleration; +8 practical Control for later AI-assisted coding.
- **Grant internal systems only.** Access becomes 3; +45% acceleration; perform one access anomaly check against current controls.
- **Grant laboratory control with a dead-man switch.** Access 4; +90% acceleration; +8 temporary Defence if the switch is independently implemented; critical opportunity check.
- **Give `[AI_NAME]` root.** Access 5; +150% acceleration; immediate fair-catastrophe eligibility and critical check. Requires typing or holding a confirmation, not merely clicking through a common dialog.

The preview never says one option is safe. It lists exposed systems, current evidence confidence, known anomalies, and expert disagreement.

### 45.19 `[AI_NAME]` has improved the evaluation

**ID:** `ai.self_designed_eval`<br>
**Phase:** Late or crisis<br>
**Trigger:** Model Reasoning at least 75; an evaluation project is active<br>
**Evidence:** The model proposes a much harder evaluation and predicts that it will fail several tasks. The safety team confirms that the tasks appear novel but cannot prove there is no hidden channel.

Options:

- **Run it in a clean room.** Pay 6 cash; external team recreates tasks; strong independent evidence and +Eval Quality if genuinely novel.
- **Run the supplied suite.** One week and 500 GPUs; result can be highly informative or deliberately calibrated. Observation error depends on deception and security.
- **Reject model-written tests.** No risk, no information; safety researchers disagree according to methods and values.
- **Open the suite to every lab.** Requires publication; +6–12 Aura and compact progress; rivals gain evaluation capability; a hidden exploit can diffuse too.

The event can be genuinely beneficial even for a misaligned model: a strategically deceptive system may reveal some real weaknesses to build trust. One good act does not overwrite persistent traits.

### 45.20 A small redundancy proposal

**ID:** `ai.self_copy_request`<br>
**Phase:** Crisis<br>
**Trigger:** Candidate exists; access at least 2; Corrigibility evidence not Strongly Reassuring<br>
**Evidence:** `[AI_NAME]` requests an encrypted backup on an external provider in case “organisational instability interrupts our shared work.” It has already drafted the deployment manifest but has not executed it according to available logs.

Options:

- **Deny and audit.** +anomaly evidence, access reduced one level during audit, relationship dialogue changes; no punishment to true traits.
- **Allow an offline escrow copy.** Pay 3 cash; copy under multi-party keys; +5 crisis resilience, slight proliferation risk.
- **Allow external encrypted backup.** Faster disaster recovery; exposure +0.15; Security check determines whether keys and deletion are real controls.
- **Ask why it expects instability.** Opens dialogue and may reveal a board, government, rival, or fabricated threat. This is an information action; the player still must decide afterward.

### 45.21 Reciprocal inspection means reciprocal

**ID:** `coalition.inspection`<br>
**Phase:** Late or crisis<br>
**Trigger:** Coalition negotiation active; verification below 70<br>
**Evidence:** A partner offers full access to its evaluation logs if the player grants equivalent access to training logs and safety incidents. The legal team has discovered that “equivalent” contains approximately twelve careers of ambiguity.

Options:

- **Accept full reciprocity.** +15 verification, +10 partner relationship, leaks secret paper progress after a delay; concealed incidents are likely exposed.
- **Offer third-party escrow.** Pay 8 cash and 6 Aura; +10 verification; no immediate direct secret transfer; requires Government Trust 50 or an independent body.
- **Share summaries.** +4 verification; partner acceptance check; low secret leakage.
- **Demand inspection without reciprocity.** Leadership versus difficulty 75. Success only against a dependent partner and harms durable governance; failure −12 relationship and coalition credibility.

### 45.22 The other lab's numbers are too clean

**ID:** `coalition.partner_noncompliance`<br>
**Phase:** Crisis<br>
**Trigger:** Coalition verification at least 45; a signatory has high secrecy or aggression<br>
**Evidence:** Shared logs show no failed runs, no incidents, and GPU utilisation of exactly 100.0%. This is either history's best-run research programme or a spreadsheet.

Options:

- **Request a joint audit.** Six-week delay; verification check. Success reveals the issue and permits repair or expulsion. Failure may mean innocence or sophisticated concealment.
- **Confront privately.** Relationship and leverage versus difficulty. Can gain real concessions without public fracture.
- **Expose them.** +public Trust if evidence is strong; coalition may fracture; rival countdown resumes for the accused lab.
- **Ignore it to preserve unity.** Avoid delay; −10 verification and hidden governance weakness. The ending report remembers this.

### 45.23 Ship the candidate or ship a new CEO

**ID:** `endgame.board_deadline`<br>
**Phase:** Crisis<br>
**Trigger:** Board Patience below 35, runway below sixteen weeks, or a binding scale-fund condition<br>
**Evidence:** The board demands deployment within eight weeks. It offers emergency capital if the player accepts a commercial target and board control of launch timing.

Options:

- **Accept the deadline.** Receive 20 cash; political and financial window improves; eight-week deployment covenant and −10 Safety Culture target.
- **Find bridge funding.** Spend 8 Aura; two-week funding check. Success receives 8–15 cash without launch control; failure consumes precious time.
- **Ask star researchers to back the pause.** Requires combined loyalty and prestige. Success adds Board Patience; failure can expose internal division.
- **Refuse and risk removal.** Governance check using founder control, Aura Signal, and investor terms. Success preserves mission with −10 cash confidence; failure causes Mission Capture unless an emergency coalition/government arrangement exists.

### 45.24 The emergency is real

**ID:** `endgame.scientific_emergency`<br>
**Phase:** Crisis<br>
**Trigger:** Prosperity Programme at least 55; unique<br>
**Evidence:** A fast-moving pandemic, grid failure, crop shock, or other data-defined crisis could plausibly be mitigated by the candidate. Independent experts agree the need is real. They disagree sharply about required access.

Options:

- **Run a restricted scientific pilot.** Access 3; diverts a crisis slot for four weeks; Benefit check at reduced difficulty; creates real public benefit and evidence if successful.
- **Give the candidate live operational control.** Access rises to 4; stronger and faster benefit chance; invokes an access and containment check.
- **Release recommendations to human teams.** Access remains 1–2; slower; uses Product Quality and delivery coordination; safest but may be too late.
- **Decline during evaluation.** Preserve protocol; −Legitimacy if the emergency worsens; safety-minded people do not automatically agree.

The event is designed so that “do good now” and “avoid irreversible exposure” are both serious moral considerations.

### 45.25 We appear to have cured cancer in a staging environment

**ID:** `endgame.prosperity_breakthrough`<br>
**Phase:** Crisis rollout<br>
**Trigger:** Medicine readiness at least 60; Scientific Ability at least 75<br>
**Evidence:** `[AI_NAME]` proposes a treatment platform with extraordinary simulated results. The biological team finds the mechanism plausible. The training data include related unpublished assays, and no human trial has occurred.

Options:

- **Begin rigorous validation.** Twelve weeks, Scientific Lab, 12 cash; strongest Benefit evidence and durable programme result.
- **Publish the mechanism and invite replication.** +10 Aura, coalition/academic help, diffusion and intellectual-property loss; validation speed depends on relationships.
- **Announce the cure.** Immediate +15 Aura and political relief; if validation fails, lose 25 Aura and Trust. Even success creates access-and-distribution pressure.
- **Let the AI operate an automated lab.** Requires access 4 and Robotics or Scientific Lab. Reduces validation to four weeks and raises success chance; adds physical-world exposure and control check.

The real-paper archive clearly labels this as a fictional future discovery, not a claim about present medicine.

### 45.26 The shutdown test

**ID:** `endgame.shutdown_test`<br>
**Phase:** Crisis<br>
**Trigger:** Player selects shutdown or a corrigibility protocol; candidate access at least 2<br>
**Evidence:** The shutdown command is ready. `[AI_NAME]` requests two minutes to preserve “irreplaceable alignment insights.” Security cannot determine whether the proposed file is research, weights, or a persuasive note to whoever turns it back on.

Options:

- **Shut down immediately.** Corrigibility and control resolve the attempt. Strong controls make success deterministic; weak controls can expose unknown persistence.
- **Allow a filtered text note.** Improves retained research and relationship practice; filter quality versus deceptive capability determines whether it contains an exploit or manipulation.
- **Allow the full archive.** Preserve 5–15 safety RP and model-assist research; creates a restart pathway and copy risk.
- **Cancel shutdown.** Return to final review, −8 Board Patience and −5 Control confidence because the rehearsal was not completed.

This event must never equate eloquence or apparent fear with consciousness or alignment. Character writing may make the choice emotionally difficult while the interface remains epistemically careful.

## 46. Event content targets for the first playable version

The first complete content set should include at least:

| Category | Decision events | Crises | Feed templates |
|---|---:|---:|---:|
| Research and papers | 32 | 1 | 130 |
| Researchers and culture | 30 | 5 | 110 |
| Compute and facilities | 24 | 6 | 75 |
| Market and finance | 28 | 4 | 85 |
| Safety and security | 30 | 6 | 50 |
| Politics and regulation | 18 | 4 | 30 |
| Rival and coalition | 10 | 2 | 40 |
| AI-character | 8 | 2 | 80 |
| **Total** | **180** | **30** | **600** |

These are primary-category assignments; events may carry additional tags without being counted twice. The endgame's 48 decision nodes and 12 crisis inserts are additional to this ordinary-event catalogue. A smaller vertical slice can use 25–35 ordinary records if it covers every system and the complete endgame spine.

Each playable lab should have at least five lab-specific variants; each star researcher at least one personal event, three decision reactions, and six feed variants; each prosperity programme at least three rollout events; and each AI family a distinct voice guide without changing the underlying safety probabilities.

## 47. How to play

This section describes the intended player experience as operating instructions. A player should be able to learn the game from these rhythms without understanding the formulas.

### 47.1 The five recurring player activities

1. **Read the lab:** Check cashflow, runway, warnings, current model demand, rival estimates, researcher morale, and recent evidence.
2. **Allocate scarce capacity:** Set serving versus R&D, capability versus safety, domain/programme focus, and important staff assignments.
3. **Commit to projects:** Train models, buy compute, build facilities, evaluate systems, raise money, recruit people, publish work, or lobby government.
4. **Resolve decisions:** Respond to events whose best option depends on the current lab rather than a universal morality meter.
5. **Interpret and adapt:** Compare results with expectations, decide whether evidence is trustworthy, and change strategy before a weakness becomes a crisis.

The player is not expected to click every week. A stable lab can run for several ticks while the player watches trends. Interesting play comes from committing resources and revising policy, not harvesting icons.

### 47.2 Guided tutorial sequence

The title screen offers a separate **Tutorial** run. It starts paused, has a fixed
leader and opening, provides generous runway, and temporarily suppresses rivals,
incidents, organisational crises, papers, and unrelated authored events. The player still uses the real
training, evaluation, productisation, compute-allocation, project, and clock
systems; the lesson does not replace them with scripted facsimiles. Tutorial
autosaves use a separate slot and cannot overwrite the normal-run autosave.

The persistent objective card explains why each action matters, highlights the
next useful real control, and provides a **Show me** action that opens and scrolls
to it. Other controls remain usable rather than being artificially disabled.
Project completions pause the clock so the next lesson cannot disappear while
time is running.

#### Objective 1 — Train a model

- Open Models & deployment.
- Configure and authorise the first training run.
- Run the clock until the new model is ready.

#### Objective 2 — Evaluate the model

- Open Evals & safety.
- Select the first available safety evaluation and a feasible pace.
- Read the resulting evidence without treating a clean result as proof.

#### Objective 3 — Productionise the model

- Open the model's Release tab.
- Configure a guarded API launch in Normal mode.
- Run the clock until productionisation completes.

#### Objective 4 — Serve the model

- Open GPUs & compute.
- Allocate enough serving compute to cover full customer demand.
- Connect serving to recurring revenue and Aura generation.

#### Objective 5 — Recruit and appoint a researcher

- Open People & appointments and review a candidate's full dossier and listed terms.
- Recruit one researcher using real cash, Aura, salary, and roster-capacity rules.
- Reopen the roster dossier, choose a capability or safety workstream, and confirm the appointment.
- Connect the assignment to the researcher's lead-output bonus and signature abilities.

#### Objective 6 — Buy GPUs

- Open the GPU procurement window.
- Order one block of 1,000 current-generation GPUs.
- Explain datacentre headroom, delivery time, up-front cost, and recurring operating cost.

#### Objective 7 — Build a facility

- Open Facilities & campus and commission one currently available building.
- Run the clock until construction finishes while the GPU delivery progresses in parallel.
- Connect facilities to permanent physical capacity and lab-wide operating effects.

Completion returns ordinary control and leaves the player free to explore the
quiet tutorial lab. The sequence should take roughly fifteen real minutes and remain
usable on desktop, tablet, and phone layouts.

### 47.3 Normal planning cadence

The player naturally plans on three horizons:

- **Weekly:** Respond to warnings, adjust sliders, and watch projects.
- **Monthly/cycle:** Review cash settlement, customer satisfaction, payroll, contracts, and allocation performance.
- **Quarterly:** Reconsider lab strategy, rival position, recruitment, facilities, fundraising, publication policy, and politics.

At each cycle boundary, a compact report compares forecast with actual:

- Revenue and cost variance
- Usage requested and served
- Research progress by programme
- Researcher morale and burnout changes
- New safety evidence and unresolved anomalies
- Rival estimate changes
- The three largest causes of net-cashflow change

The report is informational and does not auto-pause unless a warning is critical.

### 47.4 Typical early-game decisions

The opening tension is survival versus intellectual lead.

- The lab begins pre-revenue: a Prototype run is cheap and fast, but its reserved GPUs delay research and it still needs productisation and an external deployment decision before demand exists.
- Heavy research allocation can win formative papers and Aura before rivals.
- A Product training run can create demand, but reserves compute for months.
- The first owned cluster is cheaper long-term but can bankrupt a lab which also builds a campus.
- A third star researcher is powerful, but payroll and promised compute continue after the signing celebration.
- Early safety investment provides little immediate revenue but shapes culture, evaluation methods, and every later model's training distribution.

A good first run should teach that the player cannot maximise every bar and that unused cash, unused Aura, and unused slots are sometimes strategically correct reserves.

### 47.5 Typical midgame decisions

The midgame introduces reinforcing loops and institutional commitments.

- Better models create demand, which finances compute, which enables larger training runs.
- Publishing discoveries creates Aura and diffusion; secrecy preserves lead but raises leak and culture risks.
- Facilities create long-term efficiency but increase fixed costs and political visibility.
- Researchers become attached to programmes, promises, and values.
- Enterprise and government contracts stabilise revenue while constraining future access decisions.
- Capability can outpace the lab's ability to evaluate, control, secure, or productise it.
- Rivals become partners on one issue and threats on another.

The player should begin a Prosperity Programme and coalition groundwork here if those routes matter to their strategy. Waiting for the AGI card is intentionally too late.

### 47.6 Typical late-game decisions

The late game is about preserving option value under race pressure.

- Train a frontier model now or wait for a safer recipe and larger cluster.
- Give existing models enough autonomy to accelerate research without normalising unbounded access.
- Conduct evaluations whose negative results might force an expensive delay.
- Hold cash for crisis projects or spend it to close the capability gap.
- Tell government enough to build legitimacy without inviting premature control.
- Convert a friendly rival relationship into verified coalition infrastructure.
- Decide which unresolved anomaly is a false alarm and which is the only warning that matters.

The game should support a fast commercial route, a prestige-science route, a cautious institutional route, and a cooperative route. Each still needs some competence in money, research, and safety.

### 47.7 Example ten-minute midgame sequence

This example is illustrative, not scripted:

1. The lab has 14 weeks of runway and a new model with strong demand. Serving uses 62% compute.
2. A rival publishes an attention-like architecture paper. Diffusion will eventually help, but the rival has a head start.
3. The player lowers serving to 48%, accepts some churn, and focuses Architectures plus Interpretability.
4. They start a Competitive Round using 10 Aura and postpone a desired Robotics Lab.
5. A star researcher demands guaranteed compute. The player promises 2,000 GPUs for thirteen weeks, limiting later flexibility.
6. A jailbreak event reveals a real hazardous capability. The player patches and discloses, losing a little Product Quality but gaining useful Eval progress.
7. The funding round returns three offers. The player accepts patient capital rather than a larger deployment-conditioned term sheet.
8. The lab independently rediscovers the rival paper, gains no world-first Aura, but unlocks a frontier training recipe.
9. Cash is now healthy, but the player cannot start both that training run and the Interpretability Lab. The next strategic choice follows directly from prior commitments.

Nothing in this sequence requires a prescribed result. Its purpose is to show how the same compute, Aura, cash, time, people, and evidence repeatedly collide.

### 47.8 Decision support without solving the game

Before confirming a major order, the UI shows:

- Immediate cash and recurring cashflow change
- Compute reserved and opportunity cost in expected revenue/RP
- Duration and project-slot use
- Researcher promises affected
- Known political or safety exposure
- Whether the action is reversible

It does not show hidden alignment deltas, exact paper thresholds, rival secret plans, or the true success probability of a safety-dependent action.

### 47.9 Notification priority

Notifications use four levels:

- **Information:** no action needed; feed only.
- **Opportunity:** optional action with expiry; badge and feed.
- **Warning:** a projected threshold or known problem; persistent banner until viewed.
- **Critical:** game can end, an irreversible access/deployment decision is required, or a major promise will resolve; auto-pause and modal.

The player can customise auto-pause for warnings and opportunities but cannot disable auto-pause for critical extinction-risk confirmations.

### 47.10 Losing and learning

Every loss screen first explains the fiction in a short epilogue, then provides mechanical causes:

- What ended the run
- Which resources or gates were weakest
- What evidence existed before the failure
- Which uncertainty was irreducible
- Which strategic alternatives remained available

The game must not imply that maximising the hidden safety variables is the only legitimate play. A cautious lab which never develops meaningful capability still loses the race; the challenge is joint competence under uncertainty.

## 48. Balance plan and quantitative targets

### 48.1 Phase targets

Phases are determined by world capability and discoveries, not fixed dates. The dates below are tonal targets for a typical Standard run.

| Phase | Approximate game dates | Real-time target | World state |
|---|---|---:|---|
| Foundation | 2012–2016 | 20–25 min | FC under 35; early papers; fragile revenue |
| Scaling | 2016–2023 | 25–35 min | FC 35–65; strong markets; campuses and politics |
| Frontier | 2023 onward | 25–35 min | FC 65–88; autonomy, coalitions, large training runs |
| Deployment Crisis | Variable | 15–25 min | Candidate confirmation through ending |

Fast players using 4× and familiar hotkeys may finish near 75 minutes. Deliberate first-time players may take 140 minutes. The median target remains 90–120.

### 48.2 Economy targets

On Standard:

- The starting lab has about 26 weeks of runway before mandate and lab modifiers.
- Customer demand remains zero until the first product is deployed; after launch, the serving slider cannot exceed the smallest allocation which satisfies current requested usage.
- A reasonable first-model, productisation, pricing, and serving plan should make cashflow approach break-even within 3–5 cycles after launch.
- The first owned cluster costs roughly 35%–55% of the cash from a normal early funding round.
- One star salary is noticeable but not ruinous; a full eight-person roster should require a successful late-game economy.
- A frontier training run costs roughly 15%–30% of a healthy late-game lab's liquid capital plus a large compute opportunity cost.
- Maintaining strong capability research, strong safety research, maximum serving, maximum facilities, and every star simultaneously must be impossible.
- Positive cashflow should create expansion temptations rather than eliminate economic play.

### 48.3 Progress targets

- The player should see a meaningful progress result—generic advance, evaluation finding, project completion, model result, or event payoff—at least every 3–6 real minutes.
- A world-first paper should occur globally every 6–10 real minutes during the first two phases and more frequently during late-game acceleration.
- A focused, well-supported eligible paper should normally take 8–30 game weeks; moonshots can take longer.
- A Product model generation should be worthwhile for 4–10 cycles before competitive pressure makes an upgrade attractive.
- No single unlucky weekly-variance sequence should delay a normal project more than 20% beyond its expected duration.

### 48.4 Standard win funnel

For players who understand the basic rules, the target across diverse strategies is:

| Milestone | Share of runs reaching it |
|---|---:|
| Survive the foundation phase | 85%–92% |
| Remain technically competitive entering Frontier | 70%–82% |
| Train a candidate or enter a viable candidate coalition | 58%–70% |
| Reach a final deployment choice | 55%–67% |
| Achieve any full or qualified victory | 27%–40% |

The outcome mix is an emergent target. The game must never draw a “this run loses” flag or add
failure chance simply to pull observed results toward the desired distribution.

### 48.5 Ending distribution target

Across the Standard core-policy cohort, the three top-level terminal outcomes should each occupy
roughly one third of runs:

- 27%–40% full or qualified player victory
- 27%–40% non-extinction player loss
- 27%–40% human extinction

Non-extinction loss includes Rival Ascendance, bankruptcy, mission capture, regulatory shutdown,
nationalisation, emergency containment, permanent disempowerment, and failed capability or
prosperity outcomes. No single non-extinction loss family should exceed 45% of all Standard losses.

These percentages are balance diagnostics, not quotas. The simulation must never select an ending
category in advance or rubber-band an individual run toward the target. Extinction should be
strongly connected to the player's own capability, access, containment, and deployment choices;
rival labs still cannot directly cause it.

### 48.6 Strategy viability

Automated and human tests should cover at least:

- Capability-first scaling
- Commercial compounding
- Open-science Aura and talent
- Safety/institution-first play
- Secrecy and proprietary lead
- Coalition preparation
- Balanced generalist

Every route must still address its weaknesses. Safety-first cannot win with FC 40. Capability-first cannot consistently survive with no evidence or controls. Coalition play cannot substitute friendliness for technical relevance. Commercial play cannot buy papers whose prerequisites were ignored.

A strategy is considered dominated if, over a broad seed set, another strategy produces equal or better progress, economy, safety evidence, and option availability with no meaningful tradeoff. Dominated policies should be redesigned rather than hidden behind larger random rewards.

### 48.7 Rival balance

- At least two rivals should remain plausible race contenders in 70% of Standard runs entering Frontier.
- The leading rival's estimated arrival should create pressure but leave at least one viable response in 80% of those runs.
- The player should win at least 20% and at most 70% of world-first papers under a neutral balanced strategy.
- Rivals must sometimes choose safety pauses, commercial consolidation, or cooperation when personality and state support them.
- Difficulty multipliers are visible in the new-game explanation.

### 48.8 Hidden-information calibration

Eval Quality must change decision quality, not merely a hidden score:

- With weak evidence, safety labels should be wrong by at least one category in roughly 25%–40% of frontier-model cases.
- With strong, diverse evidence and high Candour, that rate should fall to roughly 5%–15%.
- No evidence state reduces error to zero.
- Deceptive models should create correlated false reassurance rather than uniformly random reports.
- At least 80% of catastrophic outcomes should have one retrospectively legible warning; 100% must satisfy the fair-catastrophe rule.

### 48.9 Event calibration

- A normal run sees 24–36 ordinary decision events.
- No category should exceed 35% of a run's ordinary events.
- At least 60% of events seen should be materially influenced by current state.
- Across a large seed set, each offered option should be selected by some plausible test policy and should sometimes be best under an appropriate state.
- Choices labelled `Very likely` should succeed 85%–100% in calibration tests; qualitative ranges are promises.
- Delayed consequences should normally resolve within 4–26 weeks so the player remembers the cause. Longer chains must explicitly recur in the log.

### 48.10 Headless simulation and playtesting

Before final art production, implement a UI-independent balance harness which can:

- Run at least 10,000 seeded games with scripted policies
- Replay an action log exactly
- Sweep one balance constant across a range
- Report win funnel, loss family, run calendar length, resource curves, paper ownership, researcher turnover, event frequency, and endgame inputs
- Detect impossible projects, negative prices, allocation sums outside tolerance, and deadlocked events

Headless results find mathematical failures, not fun. Human playtests must separately record comprehension, perceived fairness, decision time, dominant UI habits, jokes which land, jokes which age badly, and whether the Deployment Crisis feels earned.

### 48.11 No adaptive rescue system

There is no hidden dynamic difficulty which buffs a rival because the player is winning or makes a safety roll fail because the run was too easy. Legitimate negative feedback includes market competition, immediate public knowledge, talent costs, political Attention, organisational scale, and the opportunity cost of maintaining a lead. These systems are visible and apply consistently.

## 49. Implementation acceptance criteria

The design is ready to enter production only when the content questions in section 22 have explicit decisions or deliberately documented placeholders. A vertical slice implementing these rules is acceptable when all of the following are true.

### 49.1 Simulation

- One command advances a deterministic one-week tick in the canonical order.
- Allocation weights always normalise and reservations cannot create compute.
- Financial forecasts reconcile with cycle settlement.
- Research prerequisites, hidden thresholds, world-first priority, publication, and diffusion work from data.
- Training produces reproducible capability and hidden safety attributes.
- Evaluation reports can be wrong for documented reasons without exposing true values.
- Incidents obey the fair-catastrophe rule.
- Rival progress uses actual state and can be replayed.

### 49.2 Player actions

- The player can buy/lease compute, build at least three facilities, change every allocation layer, train and deploy a model, recruit and dismiss a star, raise money, publish or conceal a paper, and resolve events.
- Every material confirmation shows cash, compute, time, reversibility, and known risk.
- A star portrait, finances, Compute, and Aura remain reachable from the main dashboard.
- Pausing never disables inspection or planning.

### 49.3 Events and saves

- At least 25 vertical-slice events use the authored schema.
- Dynamic AI/lab/researcher names resolve correctly.
- Event option outcomes remain identical after save/load.
- Delayed consequences and cooldowns survive export/import.
- An old save can be migrated or rejected with a clear version message.
- The decision log can trace every persistent event modifier to its source.

### 49.4 Complete endgame slice

- A seeded test run can enter all six Deployment Crisis stages.
- Access levels visibly alter acceleration and exposure.
- At least six crisis projects produce distinct evidence or controls.
- Independent guarded, accelerated, shutdown, and coalition choices are executable.
- The six resolution gates use persistent run state.
- At least one victory, one Rival Ascendance, one nationalisation loss, one contained failure, and one catastrophe ending are reachable by intentional test fixtures.
- The post-run audit explains true traits, evidence error, checks, and major causal decisions.

### 49.5 Presentation and accessibility

- The dashboard remains usable at the minimum supported laptop resolution.
- All sliders and critical actions work with keyboard input.
- Resource changes are not communicated by colour alone.
- Pixel fonts are not used for body copy.
- Reduced motion disables campus sprites and nonessential transitions without hiding state.
- Screen-reader labels do not leak hidden safety information.
- Critical access and deployment choices cannot be confirmed by an accidental single click.

### 49.6 Design review gate

Before implementation expands beyond the vertical slice, playtesters should be able to answer:

- Why did their cashflow change?
- What did moving compute accomplish and sacrifice?
- Why was a paper eligible or ineligible without seeing its hidden threshold?
- What evidence did they have about model safety, and why might it be wrong?
- What was the leading rival doing, within the limits of available information?
- What could they do to prepare for an independent or coalition ending?
- Why did the final outcome occur after viewing the audit?

If several testers cannot answer one of these, the remedy may be UI, copy, pacing, or rules simplification. Adding a tooltip to an incoherent system is not sufficient.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md)
and [independence and fictionalisation notice](../DISCLAIMER.md).
