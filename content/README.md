# Neolab.ai content source

This directory holds authored game content before production code exists. See the [content-first production plan](../docs/content-production-plan.md) for targets, review states, and authoring order.

Files currently use `draftSchema: 1`. They are expected to evolve until the content compiler is implemented, but IDs should remain stable.

Current authored packs:

- `labs/launch.yaml` and `ai-levels.yaml`: five launch identities and the capability ladder.
- `research/domains.yaml` and `research/papers-a.yaml`: research-programme rules and the
  current 111-paper landmark catalogue (88 real works and 23 clearly fictional future works),
  including a safety canon spanning foundational arguments, technical safety research, and
  frontier alignment results.
- `researchers/rules.yaml`, `foundation.yaml`, `deep-learning.yaml`, `scaling.yaml`, and `frontier.yaml`: the complete twenty-four-person People Pack A.
- `hardware/gpu-generations.yaml`: physical GPU generations from real Kepler through Rubin plus three clearly fictional post-Rubin generations.
- `hardware/gpu-offers.yaml`: the four era-scaled purchase, lease, and cloud offer templates.
- `market/segments.yaml`: customer segments, capability-based compute demand and revenue, appeal weights, and static fallback rival comparisons.
- `facilities/core-stage-2.yaml`: the first construction-ready infrastructure definitions; later facility packs extend the same schema.
- `scoring.yaml`: the versioned run-score ledger and future leaderboard contract.

Content rules:

- YAML contains data and declarative rules only—never executable JavaScript.
- Real papers require authoritative sources and accurate educational copy.
- Fictional future papers must be visibly marked fictional.
- Safety papers are first-class landmarks. They use safety-programme levels and output, enter the
  same world-first race, and receive the same educational discovery treatment as capability
  papers. Operational safety branches remain separate: papers establish ideas and methods;
  branches turn them into repeatable lab practice.
- Living-person portrayals require sources, affectionate fictionalization, and explicit review status.
- Exact probabilities, prerequisites, outcomes, and delayed consequences belong in content records even when the player sees only uncertainty.
- Pure lab-feed flavour has no effects field.
- GPUs are always physical inventory. Generation factors are fictional balance coefficients used to derive workload throughput, never a second player-facing resource.
