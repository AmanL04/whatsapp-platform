# App Settings: Design Discussion & Decision

> How should app settings be managed? Should the platform store them,
> should apps own them, or something in between?

---

## The Two Kinds of Settings

Any app has two fundamentally different kinds of configuration:

### Kind 1: User preferences for the app
"Send my summary at 9am." "Include these 3 groups." "Use detailed mode."

These are things the user configures. They're simple, predictable, and
the schema is defined by the app. They change rarely and don't require
complex migration logic.

### Kind 2: App-internal configuration
"Which LLM to use." "My OpenAI API key." "Database connection string."
"Processing pipeline settings." "Retention policy."

These are the app's own business. They may be sensitive, they change
with the app's internal architecture, and they may require complex
migration logic. The platform has no reason to know about them.

The question is: who manages each kind?

---

## Option 1: Platform stores user preferences (configSchema approach)

The manifest declares a `configSchema`. The dashboard renders a settings
form. The server stores values in an `app_config` table. The app reads
them via `GET /api/config`.

**Pros:**
- Consistent settings UX across all apps in the dashboard
- User manages everything from one place
- No auth needed between dashboard and app settings pages
- Simple apps get a settings UI for free

**Cons:**
- Platform now renders forms, validates inputs, handles schema evolution,
  syncs state between server and app, maintains a config API
- Every new field type (color picker, chat multi-select, time range, cron
  expression) is a feature request on the platform
- When an app needs settings that don't fit the schema (OAuth flow,
  complex wizard, API key entry), the model breaks and you need the
  redirect anyway
- Adds `app_config` table, `GET /api/config` endpoint, `PUT` endpoint,
  schema validation, and optionally a `config.updated` webhook event

## Option 2: Platform stores only scope/permissions, redirects to app

The manifest declares required permissions and scope. No `configSchema`.
The dashboard shows the app card with "Open" and "Settings" buttons that
link to the app's own URLs. The app handles all its own settings.

**Pros:**
- Dramatically simpler to build — no config API, no `app_config` table,
  no form renderer, no schema evolution logic
- Apps have full control — can build OAuth flows, wizards, rich UIs
- This is what Shopify, Slack, iOS, and Android do (proven model)
- Forces the right separation: platform manages access, app manages state

**Cons:**
- Every app builds its own settings UI (inconsistent across apps)
- Users leave the dashboard to configure apps (more fragmented)
- Simple apps that need one toggle still need a whole settings page

---

## How Major Marketplaces Handle This

The pattern is remarkably consistent:

**Shopify:** Platform stores the install record (which shop, which scopes,
OAuth tokens). Does NOT store app settings. When a merchant clicks
"Settings" on a Shopify app, they load the app's own page embedded via
App Bridge. The app stores everything itself.

**Slack:** Platform stores the install record (workspace, scopes, OAuth
token). Does NOT store app config. If a Slack app has settings like
"post reminders at 9am in #engineering," that's in the app developer's
own database.

**Chrome Extensions:** Chrome provides `chrome.storage.sync` (~100KB) for
lightweight user preferences. But any extension needing real data uses
its own backend. Chrome has no concept of extension migrations — the
extension handles schema changes in its own update code.

**iOS / Android:** Platform manages install record, permissions, billing.
Stores zero app settings. Every app manages its own data. Schema
migrations between versions are the app's responsibility.

**The universal pattern:** The platform manages three things: the install
record (who installed what), the permission grant (what the app can
access), and the credential exchange (API keys, OAuth tokens). Everything
else is the app developer's responsibility.

---

## Decision: Option 2

Start with Option 2. The platform stores only the install record (scope,
permissions, API key, webhook secret) and redirects to the app for all
settings.

**What the platform manages per app:**
- Install record (app ID, name, version)
- Permissions granted
- Scope (chat types, specific chats)
- API key and webhook secret
- `uiUrl` — where the app's main UI lives
- `settingsUrl` — where the app's settings page lives (optional,
  defaults to `uiUrl`)

**What the platform does NOT manage:**
- App configuration values
- App-internal state
- App database migrations
- User preferences for the app

**Dashboard behavior:**
- "Open" button → navigates to app's `uiUrl`
- "Settings" button → navigates to app's `settingsUrl`
- No config forms rendered by the dashboard
- No `app_config` table
- No `GET /api/config` or `PUT` config endpoints

## Future Evolution (if needed)

If evidence shows that 80% of apps just need one or two simple toggles
and building a whole settings page for each is painful, add `configSchema`
as an **optional** enhancement:

"If your app has simple settings, declare them in the manifest and the
dashboard will render them for you. If you need something richer, use
your own settings page."

This is additive, not a rewrite. Build it based on real evidence from
shipping apps, not speculation.

A further evolution (Phase 3-4) could be something like Shopify's App
Bridge — a way for apps to render their own rich settings UI embedded
inside the dashboard. But that's infrastructure that only makes sense
with a significant number of third-party apps.

---

*Last updated: April 2026*
*See also: `docs/app-publishing-approaches.md` for publishing mechanisms*
