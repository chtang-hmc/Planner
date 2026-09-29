#!/usr/bin/env bash
# Runs at the start of every Claude Code session (SessionStart hook in
# .claude/settings.json), and does something only in a cloud session — one
# started from claude.ai/code or the Claude phone app, which clones the repo
# into a fresh VM with no node_modules.
#
# Locally it exits at once: the Mac already has its packages, and a hook that
# ran `npm ci` there would wipe and reinstall them on every session.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

if [ ! -d node_modules ]; then
  # stdout of a SessionStart hook is added to Claude's context, so the
  # install's own output goes to stderr and one line says what happened.
  npm ci --no-audit --no-fund >&2
  echo "cloud-setup: installed packages with npm ci"
fi
