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

  // Requirements
  requiredPermissions: Permission[]
  requiredEvents: string[]
  requiredScope: {
    chatTypes: ('dm' | 'group')[]
  }

  // Optional: app-specific settings the user can configure
  configSchema?: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'select'
      label: string
      default: any
      options?: string[]      // for select type
    }
  }
}
```

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

## App Config Storage

If the manifest includes a `configSchema`, the server stores user-set config
values per app in a new `app_config` table. Apps can read their config via a
new API endpoint: `GET /api/config` (scoped to the calling app's own config).

## Dashboard UI Changes

The existing "Apps" tab evolves into two views:

### Installed Apps (default view)
Shows each installed app as a card:
- Name, icon, description
- Health status (last webhook delivery success/failure)
- Permissions summary
- Scope (which chats)
- "Open" button → navigates to app's `uiUrl`
- "Settings" button → renders configSchema form
- "Uninstall" button

### App Catalog (second view)
- Lists available apps from manifests (local first-party + future third-party)
- Each shows name, description, required permissions
- "Install" button → triggers installation flow

## Database Changes

New table: `app_manifests` — stores fetched manifest JSON per app
New table: `app_config` — key/value pairs per app for user settings
New column on `apps`: `manifest_url` (nullable) — links to source manifest
New column on `apps`: `ui_url` (nullable) — for the "Open" button

## Implementation Order

1. Define manifest schema + validation
2. Add manifest_url and ui_url columns to apps table (migration)
3. Build install endpoint: POST /dashboard-api/apps/install
4. Build uninstall endpoint: POST /dashboard-api/apps/:id/uninstall
5. Add app_config table + GET /api/config endpoint
6. Update dashboard Apps tab with installed apps cards + catalog view

## Status

Planned — depends on having at least one first-party app to test with.
