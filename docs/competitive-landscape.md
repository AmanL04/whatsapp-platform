# Competitive Landscape

## Overview

WA Companion sits in a gap that no existing product fills: an app platform
for WhatsApp with a permission model, webhook dispatch, app registry, and
marketplace ambition. Competitors exist in adjacent lanes but not this one.

## The Three Lanes

### Lane A: Official WhatsApp Business API Providers
Respond.io, Wati, Twilio, Infobip, Gupshup, and 20+ others.
- Built on Meta's official Business API
- Require a Business Account, charge per conversation, template approval
- No access to personal accounts or existing message history
- Aimed at enterprises: support bots, bulk messaging, CRM integrations
- **Not competing with WA Companion** — different API, different audience,
  different use case (outbound business comms vs. personal data platform)

### Lane B: Self-Hosted Unofficial WhatsApp HTTP APIs
WAHA (6k+ stars) and OpenWA (newer).
- Raw API wrappers: HTTP endpoints for send/receive messages
- Docker-based, self-hosted, Baileys or whatsapp-web.js under the hood
- **No app model, no permissions, no webhook fan-out to multiple apps,
  no marketplace.** They're plumbing — you'd build WA Companion ON TOP
  of something like WAHA, not instead of it.
- WAHA Plus ($19/mo) adds multi-session, dashboard, S3 storage

### Lane C: AI Assistants Using WhatsApp as a Channel
OpenClaw (150k+ stars), various ChatGPT-on-WhatsApp bots.
- Single AI agent that talks to you through WhatsApp
- OpenClaw uses Baileys for WhatsApp, supports 50+ integrations
- Has skills/plugins — but they extend the one agent, not the platform
- **Not competing with WA Companion** — it's one of the thousand apps
  that COULD be built on top of WA Companion. Infrastructure vs. agent.

## WA Companion vs. OpenClaw (the most common comparison)

| Dimension | WA Companion | OpenClaw |
|---|---|---|
| What it is | Infrastructure server | AI agent |
| WhatsApp role | Data source for N apps | Channel for 1 agent |
| Multi-app | Yes, N apps simultaneously | No, single agent |
| Permissions | Scoped per app | Full access |
| Data store | Persistent SQLite, indexed, queryable | Agent memory only |
| App UIs | Each app has its own UI | Chat responses only |
| Developer model | External services via webhooks/API | Skills (internal plugins) |
| Marketplace potential | Yes (app catalog) | No (skill store at best) |

Key insight: OpenClaw could be an app running ON WA Companion.
The reverse is not possible.

## Meta Enforcement Status (as of April 2026)

- Jan 2026: Meta banned general-purpose AI chatbots from Business API
- Baileys enforcement is behavioral: bulk senders get banned, passive
  listeners generally don't
- Bans have increased (Oct 2025 wave), but read-heavy personal use
  remains low-risk
- WA Companion's adapter pattern is the insurance: swap to official
  Business API adapter if Baileys gets harder to use

## Last Updated

April 2026
