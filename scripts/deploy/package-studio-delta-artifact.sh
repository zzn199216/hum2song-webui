#!/usr/bin/env bash
# Test and package a Studio delta against an explicit production base commit.
set -euo pipefail

BASE_COMMIT=""
STUDIO_VERSION=""

usage() {
  cat <<'EOF'
package-studio-delta-artifact.sh

Usage:
  package-studio-delta-artifact.sh --base <deployed-commit> --version <cache-version>

The helper runs the complete frontend suite, rejects dirty tracked files and
delete/rename deltas, verifies one cache version, and writes a manifest-bearing
artifact under .deploy-artifacts/.
EOF
}

die() { printf '[package-studio-delta] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[package-studio-delta] %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_COMMIT="${2:?}"; shift 2 ;;
    --version) STUDIO_VERSION="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "${BASE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]] || die "--base must be a Git commit hash"
[[ "${STUDIO_VERSION}" =~ ^[A-Za-z0-9._-]+$ ]] || die "--version is invalid"
git rev-parse --verify "${BASE_COMMIT}^{commit}" >/dev/null 2>&1 || die "base commit does not exist"
git merge-base --is-ancestor "${BASE_COMMIT}" HEAD || die "base commit is not an ancestor of HEAD"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "tracked working tree changes are present; commit first"

HEAD_COMMIT="$(git rev-parse HEAD)"
HEAD_SHORT="$(git rev-parse --short HEAD)"
BASE_SHORT="$(git rev-parse --short "${BASE_COMMIT}")"
[[ "${HEAD_COMMIT}" != "$(git rev-parse "${BASE_COMMIT}")" ]] || die "HEAD and base commit are identical"

unsafe_changes="$(git diff --name-status "${BASE_COMMIT}"..HEAD | awk '$1 ~ /^[DR]/ { print }')"
[[ -z "${unsafe_changes}" ]] || {
  printf '%s\n' "${unsafe_changes}" >&2
  die "delta contains deletes or renames; use a full release workflow"
}

grep -Fq "H2S_STUDIO_ASSET_VERSION = '${STUDIO_VERSION}'" static/pianoroll/studio_asset_version.js \
  || die "studio_asset_version.js does not match ${STUDIO_VERSION}"
for asset in \
  studio_asset_version.js h2s_startup_perf.js i18n.js \
  audio_worker_conversion_client.js audio_worker_separation_client.js \
  app.js cloud_project_bridge.js cloud_materials_panel.js; do
  grep -Fq "${asset}?v=${STUDIO_VERSION}" static/pianoroll/index.html \
    || die "${asset} does not use cache version ${STUDIO_VERSION}"
done

log "Running complete Studio frontend suite"
node scripts/test-changed.js run --base "${BASE_COMMIT}" --release --full

mapfile -d '' changed_paths < <(git diff --name-only -z "${BASE_COMMIT}"..HEAD)
[[ "${#changed_paths[@]}" -gt 0 ]] || die "no changed files to package"

work_dir="$(mktemp -d)"
cleanup() { rm -rf -- "${work_dir}"; }
trap cleanup EXIT
mkdir -p "${work_dir}/root" .deploy-artifacts
git archive --format=tar -o "${work_dir}/delta.tar" HEAD -- "${changed_paths[@]}"
tar -xf "${work_dir}/delta.tar" -C "${work_dir}/root"
node scripts/build-startup-bundles.js "${work_dir}/root"
cat > "${work_dir}/root/ARTIFACT_MANIFEST.txt" <<EOF
artifact=studio-delta
commit=${HEAD_COMMIT}
baseCommit=$(git rev-parse "${BASE_COMMIT}")
studioVersion=${STUDIO_VERSION}
createdAtUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

artifact_path=".deploy-artifacts/studio-${HEAD_SHORT}-from-${BASE_SHORT}-${STUDIO_VERSION}.tar.gz"
tar -czf "${artifact_path}" -C "${work_dir}/root" .
log "Artifact ready: ${artifact_path}"
