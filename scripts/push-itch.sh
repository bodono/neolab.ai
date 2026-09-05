#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

if [[ -z "${ITCH_TARGET:-}" ]]; then
  echo "ITCH_TARGET is required (for example: account/neolab-ai:html5)." >&2
  exit 2
fi

if ! command -v butler >/dev/null 2>&1; then
  echo "Butler is not installed. See https://itch.io/docs/butler/installing.html" >&2
  exit 2
fi

source_commit="${NEOLAB_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
NEOLAB_SOURCE_COMMIT="${source_commit}" pnpm package:itch:alpha

# Push the directory rather than the ZIP so Butler can upload only changed blocks.
# Authentication comes from `butler login` locally or BUTLER_API_KEY in automation.
butler push apps/web/dist "${ITCH_TARGET}"
