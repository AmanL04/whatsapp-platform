# App Catalog & Installation

> Implement Approach A (static manifest-based catalog) for app discovery and
> one-click installation. See `docs/app-publishing-approaches.md` for the
> full comparison of approaches A–D and `docs/app-settings-design.md` for
> the settings ownership decision.

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
   Write its manifest, build the installation system with OTT ka OTP as
   the real test case
3. **Build Daily Summary** — second app through the manifest flow,
   validates the pattern works for a different app shape
4. **Remaining first-party apps** — pattern is established, each one
   is faster

The rationale: OTT ka OTP already exists as a production external app.
No need to build multiple apps before designing the installation system —
a real app grounds the design in reality instead of theory. Building the
installation system early means every subsequent app goes through the
proper flow from day one.

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
   { "action": "install", "apiKey": "wak_...", "webhookSecret": "whs_...", "serverUrl": "https://..." }
   ```
7. App is now live — receiving webhooks and able to call the API

## Uninstallation

1. User clicks "Uninstall" on the app card
2. Server revokes the API key, stops webhook delivery
3. Server POSTs to the app's `setupUrl` with `{ "action": "uninstall" }`
4. Registration record is deactivated (kept for logs, not deleted)

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
   - POSTs credentials to `setupUrl` if defined
   - Returns: app ID, installed status

4. **Uninstall endpoint:** `POST /dashboard-api/apps/:id/uninstall`
   - Deactivates app registration (revokes API key, stops webhooks)
   - POSTs `{ "action": "uninstall" }` to `setupUrl`
   - Keeps registration record for delivery log history

## Database Changes

New migration — new columns on `apps` table:
- `manifest_slug` (nullable) — links to catalog entry
- `ui_url` (nullable) — for the "Open" button
- `settings_url` (nullable) — for the "Settings" button
- `installed_from_catalog` (boolean, default false)

## Dashboard Changes

### Installed Apps (default `/apps` view, behind auth)
Cards showing installed apps with:
- Name, icon, description
- Health status (last webhook delivery success/failure)
- Permissions summary and scope (which chats)
- "Open" button → navigates to app's `uiUrl`
- "Settings" button → navigates to app's `settingsUrl`
- "Uninstall" button

### Public Catalog (`/catalog`, no auth)
- Lists available apps from manifests (local first-party + future third-party)
- Each shows name, description, required permissions
- "Install" button → redirects to dashboard with auth check

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
