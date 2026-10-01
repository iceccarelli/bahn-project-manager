#!/usr/bin/env bash
# Verifies that NO revision reachable from any ref contains the sensitive paths (run on a fresh mirror/clone AFTER the
# controlled history rewrite, and again against the public remote). Exit 1 if anything is found.
#   scripts/data/verify-history-clean.sh [<git-dir-or-clone>]
set -euo pipefail
cd "${1:-.}"
PATHS=(client/public/data.json client/public/schedule.json data/contacts.source.json data/contacts.report.json
       data/normalize-report.json data/schedule.report.json ChecklisteBeispiel.pdf)
bad=0
for p in "${PATHS[@]}"; do
  n=$(git log --all --oneline -- "$p" | wc -l)
  if [ "$n" -ne 0 ]; then echo "FOUND $p in $n commit(s):"; git log --all --format='  %H %s' -- "$p"; bad=1; fi
done
n=$(git log --all --oneline -- 'dist-*' | wc -l)
if [ "$n" -ne 0 ]; then echo "FOUND dist-* build output in $n commit(s):"; git log --all --format='  %H %s' -- 'dist-*'; bad=1; fi
# any ref that is not a branch/tag (e.g. refs/pull/*) also keeps old objects reachable on the host
extra=$(git for-each-ref --format='%(refname)' | grep -Ev '^refs/(heads|tags|remotes)/' || true)
[ -z "$extra" ] || { echo "NOTE: non-branch refs exist (ask the host to purge them):"; echo "$extra" | head; }
[ "$bad" -eq 0 ] && echo "history is clean of the listed paths" || exit 1
