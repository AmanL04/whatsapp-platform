# App Publishing — Approach A Implementation

> Implement static manifest-based app catalog. See
> `docs/app-publishing-approaches.md` for the full comparison of approaches
> and the config storage design.

## What

Ship a `catalog/` directory in the repo containing manifest JSON files.
The server reads these on startup, validates them, and makes them available
to the dashboard. Users browse the catalog, click "Install," and the server
handles registration automatically.

## Manifest Schema

```typescript
interface AppManifest {
  // Identity
  name: string
  slug: string                    // unique, URL-safe identifier
  version: string
  description: string
  author: string
  icon?: string                   // URL to app icon

  // Connection
  webhookUrl: string              // where the server sends events
  setupUrl?: string               // POST here with credentials on install
  uiUrl: string                   // link to app's own UI

  // Requirements
  requiredPermissions: Permission[]
  requiredEvents: string[]
  requiredScope: {
    chatTypes: ('dm' | 'group')[]
  }

  // Optional: user-configurable settings
  configSchema?: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'select'
      label: string
      description?: string
      default: any
      options?: string[]          // for select type
    }
  }
}
```

## File Structure

```
catalog/
  ott-ka-otp.json               ← first test case (already running in prod)
  daily-summary.json            ← second test case
```

## Server Changes

1. **Startup:** Read `catalog/*.json`, validate against schema, cache in
   memory. Optionally store in a `catalog_entries` SQLite table for the
   dashboard to query.

2. **New endpoint:** `GET /dashboard-api/catalog` — returns available apps
   (name, description, icon, required permissions, installed status).

3. **Install endpoint:** `POST /dashboard-api/apps/install`
   - Accepts: `{ slug, scopeOverrides? }`
   - Reads manifest from catalog by slug
   - Creates app registration (API key, webhook secret, permissions, scope)
   - POSTs credentials to `setupUrl` if defined:
     ```json
     {
       "action": "install",
       "apiKey": "wak_...",
       "webhookSecret": "whs_...",
       "serverUrl": "https://...",
       "config": { ...defaults from manifest }
     }
     ```
   - Returns: app ID, installed status

4. **Uninstall endpoint:** `POST /dashboard-api/apps/:id/uninstall`
   - Deactivates app registration (revokes API key, stops webhooks)
   - POSTs `{ "action": "uninstall" }` to `setupUrl`
   - Keeps registration record for delivery log history

5. **Config endpoint:** `GET /api/config` (app-scoped)
   - Returns current config values for the calling app
   - Filters through manifest schema (defaults for missing, drops orphaned)

6. **Config update:** `PUT /dashboard-api/apps/:id/config`
   - Accepts: `{ key: value, ... }`
   - Validates against manifest's configSchema
   - Stores in `app_config` table

## Database Changes

New migration:
- `app_config` table (app_id, key, value — see docs for schema)
- New columns on `apps` table: `manifest_slug` (nullable), `ui_url`
  (nullable), `installed_from_catalog` (boolean, default false)

## Dashboard Changes

- **Public catalog page** (`/catalog`, no auth): Browse available apps,
  see descriptions and required permissions, "Install" button redirects
  to dashboard with auth check
- **Dashboard installed apps** (`/apps`, behind auth): Cards showing
  installed apps with health status, permissions, scope, "Open" button
  (links to app's uiUrl), "Settings" button (renders configSchema form),
  "Uninstall" button

## Implementation Order

1. Define manifest JSON schema + validation utility
2. Create `catalog/` directory with OTT ka OTP manifest
3. Add startup catalog loader (read + validate + cache)
4. Database migration: app_config table, new apps columns
5. Build `GET /api/config` endpoint
6. Build install endpoint (`POST /dashboard-api/apps/install`)
7. Build uninstall endpoint (`POST /dashboard-api/apps/:id/uninstall`)
8. Build config update endpoint (`PUT /dashboard-api/apps/:id/config`)
9. Dashboard: installed apps cards view
10. Dashboard: public catalog page
11. Test end-to-end with OTT ka OTP manifest

## Status

Planned — start after MCP server is shipped.
