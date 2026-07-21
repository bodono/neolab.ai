# Neolab.ai content source

This directory holds authored game content before production code exists. See the [content-first production plan](../docs/content-production-plan.md) for targets, review states, and authoring order.

Files currently use `draftSchema: 1`. They are expected to evolve until the content compiler is implemented, but IDs should remain stable.

Content rules:

- YAML contains data and declarative rules only—never executable JavaScript.
- Real papers require authoritative sources and accurate educational copy.
- Fictional future papers must be visibly marked fictional.
- Living-person portrayals require sources, affectionate fictionalization, and explicit review status.
- Exact probabilities, prerequisites, outcomes, and delayed consequences belong in content records even when the player sees only uncertainty.
- Pure lab-feed flavour has no effects field.
