# App Manifest & Installation System

## The Gap

Currently the server has **app registration** — a developer manually creates
an app via the dashboard, gets an API key and webhook secret, and configures
permissions. This is a developer workflow.

What's missing is **app installation** — a user browses a catalog, finds an
app, clicks "Install," and the server handles registration automatically
behind the scenes. The user never sees API keys or webhook URLs.

These are two different workflows for two different people:
- Registration = developer-side ("I built an app, connect it to the API")
- Installation = user-side ("I found an app, make it work on my data")

## Build Order

1. **MCP server** — self-contained, no dependency on installation system
2. **Convert OTT ka OTP** — already running in prod on webhook + API.
   Write its manifest, build the installation system (Approach A: static
   manifests in repo) with OTT ka OTP as the real test case
3. **Build Daily Summary** — second app through the manifest flow,
   validates the pattern works for a different app shape
4. **Remaining first-party apps** — pattern is established, each one
   is faster

The rationale: OTT ka OTP already exists as a production external app.
No need to build multiple apps before designing the installation system —
a real app grounds the design in reality instead of theory. Building the
installation system early means every subsequent app goes through the
proper flow from day one.

## App Manifest Format

Each app publishes a manifest (JSON) that describes what it needs:

```typescript
interface AppManifest {
  // Identity
  name: string
  description: string
  version: string
  author: string
  icon?: string               // URL to app icon

  // Connection
  webhookUrl: string           // where the server sends events
  setupUrl?: string            // POST here with API key on install
  uiUrl: string                // link to app's own UI/dashboard
  settingsUrl?: string         // link to app's settings page (defaults to uiUrl)

  // Requirements
  requiredPermissions: Permission[]
  requiredEvents: string[]
  requiredScope: {
    chatTypes: ('dm' | 'group')[]
  }
}
```

Note: No `configSchema`. Apps own all their settings and host their own
settings UI. See `docs/app-settings-design.md` for rationale.

## Installation Flow

1. User finds app in catalog (or enters a manifest URL)
2. Server fetches and validates the manifest
3. Dashboard shows: app name, description, requested permissions, scope
4. User clicks "Install" and optionally adjusts scope (e.g., picks specific
   chats instead of all groups)
5. Server creates the registration automatically: generates API key + webhook
   secret, stores manifest metadata
6. Server POSTs credentials to the app's `setupUrl` so the app can save them:
   ```json
   { "apiKey": "wak_...", "webhookSecret": "whs_...", "serverUrl": "https://..." }
   ```
7. App is now live — receiving webhooks and able to call the API

## Uninstallation

1. User clicks "Uninstall" on the app card
2. Server revokes the API key, stops webhook delivery
3. Server POSTs to the app's `setupUrl` with `{ "action": "uninstall" }`
4. Registration record is deactivated (kept for logs, not deleted)

## Dashboard UI Changes

The existing "Apps" tab evolves into two views:

### Installed Apps (default view)
Shows each installed app as a card:
- Name, icon, description
- Health status (last webhook delivery success/failure)
- Permissions summary
- Scope (which chats)
- "Open" button → navigates to app's `uiUrl`
- "Settings" button → navigates to app's `settingsUrl`
- "Uninstall" button

### App Catalog (second view)
- Lists available apps from manifests (local first-party + future third-party)
- Each shows name, description, required permissions
- "Install" button → triggers installation flow

## Database Changes

New column on `apps`: `manifest_slug` (nullable) — links to catalog entry
New column on `apps`: `ui_url` (nullable) — for the "Open" button
New column on `apps`: `settings_url` (nullable) — for the "Settings" button
New column on `apps`: `installed_from_catalog` (boolean, default false)

## Implementation Order

1. Define manifest schema + validation
2. Add new columns to apps table (migration)
3. Build install endpoint: POST /dashboard-api/apps/install
4. Build uninstall endpoint: POST /dashboard-api/apps/:id/uninstall
5. Update dashboard Apps tab with installed apps cards + catalog view

## Status

Planned — depends on having at least one first-party app to test with.
