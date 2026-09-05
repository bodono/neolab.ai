# Static deployment and rollback

Neolab.ai has no application server. GitHub Pages serves an immutable Vite artifact, and
each player's browser runs the simulation and stores saves/high scores locally. The same
artifact can later move to another static host without adding game CPUs.

## GitHub Pages workflow

`.github/workflows/deploy-pages.yml` runs on every `main` push and can also be dispatched
manually. While Pages is unavailable, it still performs the complete validation/build/budget
path and retains the rollback artifact; upload, deployment and public smoke are gated by the
repository variable `NEOLAB_ENABLE_PAGES_DEPLOYMENT`. The normal enabled path:

1. reads the configured Pages base path using GitHub's official `configure-pages` action;
2. validates content, lint, types and deterministic tests;
3. builds Vite with `/neolab.ai/` for the project site or `/` after a custom domain is
   configured;
4. rejects a site above 900 MiB, a file above 20 MiB, an unhashed `assets/` file, an
   absolute-path leak, or a compressed first load above 15 MiB (gesture-loaded audio is
   excluded from first load);
5. writes `release-manifest.json`, including the source commit, content hash, every file
   hash and the measured budgets;
6. uploads only `apps/web/dist` to GitHub Pages;
7. retains a reproducible tarball, manifest and content hash for 90 days;
8. deploys through the protected `github-pages` environment; and
9. runs Chromium against the returned public URL: title screen → fixed seed → one tick,
   followed by a HEAD check for every file in the release manifest.

GitHub Pages does not provide repository-controlled per-file `Cache-Control` headers. Vite
therefore content-hashes every file under `assets/`; those URLs are safe for long-lived
caching where the host permits it. `index.html` and `release-manifest.json` remain stable
unhashed URLs and are the revalidation boundary. If the artifact later moves to a host with
header configuration, apply `public, max-age=31536000, immutable` to `assets/*` and
`no-cache` to the two revalidation files.

## Initial repository setup

The repository is currently private, and GitHub's API reports that the account plan does not
support Pages for this private repository. Do not enable the deployment variable yet: doing
so would turn the workflow red at `configure-pages`.

To activate the prepared deployment, either make the repository public or move it to a plan
that supports private-repository Pages. Then:

1. set **Pages → Build and deployment → Source** to **GitHub Actions** (or create the Pages
   site with REST `build_type: workflow`);
2. add the Actions repository variable `NEOLAB_ENABLE_PAGES_DEPLOYMENT=true`; and
3. dispatch **Deploy GitHub Pages** once, leaving `rollback_run_id` blank.

The workflow creates and targets the `github-pages` environment. The initial URL is
`https://bodono.github.io/neolab.ai/`.

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
