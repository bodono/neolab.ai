# Static deployment and rollback

Neolab.ai has no application server. GitHub Pages serves an immutable Vite artifact, and
each player's browser runs the simulation and stores saves/high scores locally. The same
artifact can later move to another static host without adding game CPUs.

## GitHub Pages workflow

`.github/workflows/deploy-pages.yml` publishes on a `v*` tag push and can also be
dispatched manually. Tagging is the publish signal rather than every `main` push, which
cost a ~35 minute job on all ~600 pushes a month and repeated work the CI gate had
already done on the same commit. The deployment path:

1. waits for, and requires, a green CI run on the tagged commit instead of repeating its
   lint, type-check and unit work;
2. reads the configured Pages base path using GitHub's official `configure-pages` action;
3. compiles content and runs the Chromium end-to-end suite, which the fast CI gate does
   not cover;
4. builds Vite with `/neolab.ai/` for the project site or `/` after a custom domain is
   configured;
5. rejects a site above 900 MiB, a file above 20 MiB, an unhashed `assets/` file, an
   absolute-path leak, or a compressed first load above 15 MiB (gesture-loaded audio is
   excluded from first load);
6. writes `release-manifest.json`, including the source commit, content hash, every file
   hash and the measured budgets;
7. audits release security, privacy, licences and bundle composition;
8. retains a reproducible tarball, manifest and content hash for 90 days;
9. uploads only `apps/web/dist` to GitHub Pages;
10. deploys through the protected `github-pages` environment; and
11. runs Chromium against the returned public URL: title screen → fixed seed → one tick,
    followed by a HEAD check for every file in the release manifest.

GitHub Pages does not provide repository-controlled per-file `Cache-Control` headers. Vite
therefore content-hashes every file under `assets/`; those URLs are safe for long-lived
caching where the host permits it. `index.html` and `release-manifest.json` remain stable
unhashed URLs and are the revalidation boundary. If the artifact later moves to a host with
header configuration, apply `public, max-age=31536000, immutable` to `assets/*` and
`no-cache` to the two revalidation files.

## Repository and Pages configuration

The repository is public, **Pages → Build and deployment → Source** is **GitHub Actions**,
and the site is live at `https://bodono.github.io/neolab.ai/`. The workflow creates and
targets the protected `github-pages` environment.

To publish, push a `v*` tag at a commit CI has already passed, or dispatch **Deploy GitHub
Pages** leaving `rollback_run_id` blank. There is no activation switch: deployment was once
gated behind an Actions repository variable, `NEOLAB_ENABLE_PAGES_DEPLOYMENT`, which was
never set, so the workflow built and uploaded an artifact on every push and then skipped the
deploy. The workflow now enables deployment directly and no longer reads that variable.

`play.neolab.ai` is supported without a code change: after the domain is owned and its DNS
record points to `bodono.github.io`, add it under **Pages → Custom domain** and enforce HTTPS.
On the next deployment, `configure-pages` reports an empty base path, Vite emits root URLs,
and the same smoke test runs against the custom-domain deployment. Do not add a `CNAME` file
or switch the Pages setting while the name still resolves to a registrar/parking service.

## Rollback

Every successful prepare job uploads an artifact named
`neolab-pages-<source-commit>-<content-hash-prefix>`. To roll back within its 90-day
retention window:

1. open the successful historical **Deploy GitHub Pages** run and record its numeric run ID;
2. dispatch the current **Deploy GitHub Pages** workflow;
3. enter that ID in `rollback_run_id`;
4. verify the run summary identifies the intended source commit and content hash.

The rollback path downloads the historical artifact from that run, verifies the archive
SHA-256, verifies every file against the embedded release manifest, refuses a base-path
mismatch, uploads the exact historical `dist/`, deploys it and repeats the public smoke test.
It does not rebuild historical source with current dependencies.

Tagged public builds are attached to a GitHub Release during S10.5 so their artifacts do not
depend on Actions retention. A rollback rehearsal must be recorded before the first public
tag.

## Local project-site rehearsal

```sh
pnpm content:build
NEOLAB_BASE_PATH=/neolab.ai/ pnpm --filter @neolab/web build
pnpm release:check-static -- \
  --dist apps/web/dist \
  --base /neolab.ai/ \
  --content packages/content/generated/content.bundle.json \
  --source local-rehearsal \
  --write-manifest
NEOLAB_BASE_PATH=/neolab.ai/ pnpm --filter @neolab/web preview --port 4174
NEOLAB_DEPLOYMENT_URL=http://127.0.0.1:4174/neolab.ai/ \
  NEOLAB_EXPECTED_COMMIT=local-rehearsal \
  pnpm test:deployment
```

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
