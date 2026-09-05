# itch.io restricted alpha deployment

The itch.io alpha is the same compiled application as the local game, rebuilt with Vite's
base set to `./`. Every JavaScript, CSS and audio URL is therefore relative to the build's
location inside itch.io's HTML CDN iframe.

## One-time itch.io setup

1. Create the Neolab.ai project at <https://itch.io/game/new>. Butler cannot create the
   project page.
2. Set **Kind of project** to **HTML** / **HTML Game**.
3. Keep the project **Restricted** while it is an alpha. Configure the page's password or
   access list before connecting automated uploads.
4. The first time a build reaches the channel, mark that channel **HTML5 / Playable in
   browser** on the itch.io edit page.
5. Prefer **Click to launch in fullscreen** for the dashboard. If using an in-page embed,
   start around 1500×900, enable scrollbars, and retain **Click to play** so audio begins
   with a player gesture.
6. Put this notice in the page description, above the fold:

   > Neolab.ai is an independent work of fiction and satire created in a personal capacity.
   > It is not affiliated with, sponsored by, or endorsed by Google, Google DeepMind, or any
   > person or organisation depicted, referenced, parodied, or used as inspiration. Its views
   > and scenarios do not represent Google or the creator's employer.

   Link to the packaged `DISCLAIMER.md` for the complete fictionalisation notice.

## Connect GitHub Actions

The **Build and deploy itch.io alpha** workflow can be started manually. Once `ITCH_TARGET`
is configured, it also runs on every push to `main`. Every active run builds and retains
`neolab-ai-itch.zip`; it uploads to itch.io only when both settings below exist:

- Actions secret `BUTLER_API_KEY`: the itch.io API key from
  <https://itch.io/user/settings/api-keys>. Treat it like a password.
- Actions repository variable `ITCH_TARGET`: `<account>/<game-slug>:<channel>`, for example
  `bodono/neolab-ai:html5`.

They can be configured in **Repository settings → Secrets and variables → Actions**, or with
GitHub CLI:

```sh
gh secret set BUTLER_API_KEY
gh variable set ITCH_TARGET --body '<account>/neolab-ai:html5'
```

After both are set, manually dispatch the workflow once. Thereafter every relevant `main`
push replaces the same itch.io channel automatically. There are no release tags, semantic
versions, or Butler `--userversion` values in this alpha path. A newer push cancels an older
in-progress alpha build.

Butler receives `apps/web/dist` directly, rather than the ZIP. This is deliberate: repeated
pushes to one channel use Butler's block-level patching and normally upload only changed
data. The stable ZIP is still retained as a GitHub Actions artifact for manual testing.

The alpha workflow intentionally takes the short path: dependency install, content compile,
relative production build, archive validation, ZIP, upload. Normal CI continues separately;
the alpha uploader does not wait for the full test matrix.

Without `ITCH_TARGET`, automatic push runs are skipped; a manual dispatch still builds the
ZIP. With a target but no API key, the build remains green, retains the ZIP, and reports that
deployment was skipped. It does not activate GitHub Pages.

## Local rapid upload

Install Butler, run `butler login` once, then:

```sh
ITCH_TARGET='<account>/neolab-ai:html5' pnpm deploy:itch
```

For non-interactive local automation, set `BUTLER_API_KEY` instead of using the login file.
The script builds the current tree and pushes the directory to the same channel, with no
version argument.

To create only the fast ZIP:

```sh
NEOLAB_SOURCE_COMMIT="$(git rev-parse HEAD)" pnpm package:itch:alpha
```

This produces:

- `artifacts/itch/neolab-ai-itch.zip` — the upload file, with `index.html` at its root;
- `artifacts/itch/itch-package.json` — source/content identity, ZIP SHA-256 and measured
  limits.

The packager applies the static-site budgets, enforces itch.io's current HTML limits (at
most 1,000 files, 240-character paths, 500 MiB extracted and 200 MiB per file), and
normalises ZIP metadata. Re-running it replaces the local alpha ZIP.

For the slower pre-release audit path, use `pnpm package:itch`; it adds authored-content
checks, branch coverage, and the release audit.

## Draft preview checklist

- The title screen renders without a 403 or console error.
- Start muted → choose Stan Altmann → enter the lab → Step one week reaches Week 2.
- The sound control can start music after a click; no audio is fetched before interaction.
- All six workspaces and the campus strip scroll within the iframe without page-level
  horizontal overflow.
- Save, reload, Continue, export and import work in the itch.io origin's IndexedDB.
- A second browser profile starts with no saves or high scores, confirming records are local.
- DevTools shows no request that escapes the game's assigned CDN subdirectory and no mixed
  HTTP content.
- The ZIP SHA-256 matches `itch-package.json`.
- `DISCLAIMER.md` is present at the ZIP root and the title-screen link opens it.
- Test fullscreen desktop, 1280×720 laptop, 820px tablet and 390px narrow layouts.
- Keep the project restricted until the owner separately authorises a public release.

Official references: [HTML5 archive requirements](https://itch.io/docs/creators/html5),
[Butler push and patching](https://itch.io/docs/butler/pushing.html),
[CI authentication](https://itch.io/docs/butler/login.html), and
[automation-friendly Butler installation](https://itch.io/docs/butler/installing.html).

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md)
and [independence and fictionalisation notice](../DISCLAIMER.md).
