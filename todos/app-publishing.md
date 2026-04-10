# App Publishing — Approach A Implementation

> Implement static manifest-based app catalog. See
> `docs/app-publishing-approaches.md` for the full comparison of approaches
> and `docs/app-settings-design.md` for the settings ownership decision.

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
  uiUrl: string                   // link to app's main UI
  settingsUrl?: string            // link to app's settings page (defaults to uiUrl)

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
       "serverUrl": "https://..."
     }
     ```
   - Returns: app ID, installed status

4. **Uninstall endpoint:** `POST /dashboard-api/apps/:id/uninstall`
   - Deactivates app registration (revokes API key, stops webhooks)
   - POSTs `{ "action": "uninstall" }` to `setupUrl`
   - Keeps registration record for delivery log history

## Database Changes

New migration:
- New columns on `apps` table: `manifest_slug` (nullable), `ui_url`
  (nullable), `settings_url` (nullable), `installed_from_catalog`
  (boolean, default false)

## Dashboard Changes

- **Public catalog page** (`/catalog`, no auth): Browse available apps,
  see descriptions and required permissions, "Install" button redirects
  to dashboard with auth check
- **Dashboard installed apps** (`/apps`, behind auth): Cards showing
  installed apps with health status, permissions, scope, "Open" button
  (links to app's uiUrl), "Settings" button (links to app's settingsUrl),
  "Uninstall" button

## Implementation Order

1. Define manifest JSON schema + validation utility
2. Create `catalog/` directory with OTT ka OTP manifest
3. Add startup catalog loader (read + validate + cache)
4. Database migration: new apps columns (manifest_slug, ui_url, settings_url)
5. Build install endpoint (`POST /dashboard-api/apps/install`)
6. Build uninstall endpoint (`POST /dashboard-api/apps/:id/uninstall`)
7. Dashboard: installed apps cards view
8. Dashboard: public catalog page
9. Test end-to-end with OTT ka OTP manifest

## Status

Planned — start after MCP server is shipped.
