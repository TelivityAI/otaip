#!/usr/bin/env bash
#
# Recurrence guard for the routing-disambiguation handoff incident.
#
# Internal / pre-release artifacts (the downstream router's eval data,
# corpus, version cadence, and codename) must never land in the public
# OTAIP repo. This fails the build if any forbidden reference appears in a
# tracked file — turning "remember to check" into "can't merge it".
#
# Override a legitimate hit by adding the marker `internal-ref-allow` on the
# same line (e.g. regulatory "tarmac delays" — note that is lowercase and is
# NOT matched by the case-sensitive `Tarmac` pattern below anyway).
#
# Run locally: pnpm run check:no-internal-refs
set -euo pipefail

# Restrict the scan to tracked files, excluding this script (it necessarily
# names the patterns) and the lockfile.
exclude=(':(exclude)scripts/check-no-internal-refs.sh' ':(exclude)pnpm-lock.yaml')

# Case-sensitive proper noun: the router codename. Kept case-sensitive so the
# regulatory phrase "tarmac delays" (lowercase) does not false-positive.
cs_patterns=('Tarmac')

# Case-insensitive internal tokens — specific enough to carry no false positives.
ci_patterns=(
  'eval-runs'
  'routing_truth'
  'routing_accuracy'
  'generate_v06'
  'v0_6_'
  '018_routing_disambiguation'
)

found=0

scan() {
  local flags="$1" pattern="$2" hits
  # `|| true` so a no-match (git grep exit 1) doesn't trip `set -e`.
  hits=$(git grep $flags -nI -e "$pattern" -- "${exclude[@]}" 2>/dev/null || true)
  # Drop explicitly allow-listed lines.
  hits=$(printf '%s\n' "$hits" | grep -v 'internal-ref-allow' || true)
  if [ -n "$hits" ]; then
    echo "::error::Forbidden internal reference '$pattern' found:"
    printf '%s\n' "$hits"
    found=1
  fi
}

for p in "${cs_patterns[@]}"; do scan "" "$p"; done
for p in "${ci_patterns[@]}"; do scan "-i" "$p"; done

if [ "$found" -ne 0 ]; then
  echo ""
  echo "Internal/pre-release references must not land in the public OTAIP repo."
  echo "If a hit is genuinely legitimate, add 'internal-ref-allow' on that line"
  echo "or narrow the pattern in scripts/check-no-internal-refs.sh."
  exit 1
fi

echo "check:no-internal-refs — clean"
