#!/usr/bin/env bash
# Optional leftover: AV budget JSON if anything still writes it. Journal is Neon, not sqlite.
set -euo pipefail
JOB="${1:-job}"
git config user.name "swing-bot"
git config user.email "swing-bot@users.noreply.github.com"
git add state/av_budget.json 2>/dev/null || true
if git diff --cached --quiet; then
  echo "no state changes"
  exit 0
fi
git commit -m "state: ${JOB} $(date -u +%Y-%m-%dT%H:%MZ) [skip ci]"
for i in 1 2 3; do
  if git push; then exit 0; fi
  echo "push failed (attempt $i); rebasing"
  git pull --rebase -X theirs || true
done
git push
