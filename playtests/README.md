# Human playtest evidence

This folder holds the human evidence required by GDD §49.6 and implementation-plan S9.7. It is not
a substitute for the automated balance matrix, and an empty folder must never be described as a
passed playtest gate.

## Run a session

1. Build or run one fixed commit and note the compiled content hash from `content:check`.
2. Give the tester the game with no coaching beyond the normal controls. Use a pseudonym; do not
   record their name, email, employer, account, IP address, or free-form personal details.
3. Observe decision time and dominant UI habits. Record perceived fairness, jokes that landed or
   failed, and whether the Deployment Crisis felt earned if it was reached.
4. Ask every GDD §49.6 question in the tester's own words and without a leading hint. Ask the final
   outcome question only after they have viewed **What Actually Happened**.
5. Copy `templates/session-template.json` into `sessions/<session-id>.json`, replace every placeholder,
   set `status` to `complete`, and triage each issue as UI, copy, pacing, rules, content,
   accessibility, performance, or bug.
6. Run `pnpm playtest:report`. Invalid evidence fails; valid but insufficient evidence reports a
   blocked status without pretending the gate passed.

`pnpm playtest:gate` is the fail-closed candidate check. By default it requires at least five
completed sessions on the same commit and content hash, all seven answers clear in every session,
and no unresolved issue. Its strongest result is `ready-for-manual-review`, not automatic approval.
The human reviewer must still decide whether the cohort and remediation are adequate before checking
S9.7.

## Triage rule

If two or more testers give a `partial` or `unclear` answer to the same question, the report marks a
repeated comprehension failure. Create a concrete implementation-plan task and choose the smallest
credible remedy: UI, copy, pacing, or rules simplification. A tooltip alone is not sufficient when
the underlying system is incoherent. After a fix, use new same-build sessions; do not rewrite old
evidence.
