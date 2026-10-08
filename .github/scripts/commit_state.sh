#!/usr/bin/env bash
# Commit state/ (AV budget, local sqlite when DATABASE_URL is unset) back to the repo.
set -euo pipefail
JOB="${1:-job}"
git config user.name "swing-bot"
git config user.email "swing-bot@users.noreply.github.com"
git add -A state/ || true
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
