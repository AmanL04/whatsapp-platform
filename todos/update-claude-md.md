# Update CLAUDE.md

## What

CLAUDE.md is the context file Claude Code reads on every session. It was
written during the "build the server" phase. Now that the server is built
and the focus is shifting to MCP + apps + platform layer, it needs updating.

## What to include

- Current state: server is built and deployed, OTT ka OTP running in prod
- New focus areas: MCP server, app installation system, first-party apps
- Key principle: first-party apps are EXTERNAL services using webhook + API,
  not embedded in the dashboard or server
- Pointer to docs/decisions-and-constraints.md for architectural context
- Pointer to docs/open-questions.md for unresolved design questions
- Pointer to todos/ for the current workstream specs
- Build order: MCP → install system (using OTT ka OTP as test) → apps

## When

After the current round of planning docs stabilizes. No rush — better to
update it once with comprehensive context than update it twice.

## Status

Planned — low urgency, do before the next Claude Code session.
