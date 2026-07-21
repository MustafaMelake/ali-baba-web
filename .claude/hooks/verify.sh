#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Stop-hook verification gate — Ali Baba platform.
#
# Runs `npm run typecheck` + `npm test` when the turn actually touched
# TypeScript, and reports failures BACK to the model (exit 2) instead of
# letting a turn end on an unverified "done". Green runs are silent.
#
# Deliberately skipped when no .ts/.tsx changed — a question-only turn should
# not pay for a full typecheck + suite run.
#
# Lint is NOT in this gate: `npm run lint` currently reports pre-existing
# errors unrelated to any given change, so gating on it would block every
# turn on inherited debt. Run it manually via `npm run verify`.
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# No TypeScript touched (tracked-modified or untracked) → nothing to verify.
if [ -z "$(git status --porcelain -- '*.ts' '*.tsx' 2>/dev/null)" ]; then
  exit 0
fi

report=""
failed=0

if ! tc_out=$(npm run typecheck 2>&1); then
  report="${report}--- npm run typecheck FAILED ---
$(printf '%s' "$tc_out" | tail -40)

"
  failed=1
fi

if ! test_out=$(npm test 2>&1); then
  report="${report}--- npm test FAILED ---
$(printf '%s' "$test_out" | tail -40)

"
  failed=1
fi

[ "$failed" -eq 0 ] && exit 0

# Exit 2 on a Stop hook = blocking error; stderr is fed back to the model.
printf 'Verification gate failed — do not report this work as complete until it passes:\n\n%s' "$report" >&2
exit 2
