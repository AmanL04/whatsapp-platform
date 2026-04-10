# App Publishing Approaches

> Reference document. Four approaches to how apps get into the catalog and
> become installable, from simplest to most sophisticated. See
> `todos/app-publishing.md` for the implementation plan for Approach A.

---

## Approach A — Static Manifests in the Repo (Current Choice)

The server ships with a `catalog/` directory containing manifest JSON files.
On startup, the server reads these files, validates them, and populates the
catalog. Adding an app = adding a JSON file and redeploying. Removing =
deleting the file.

```
catalog/
  ott-ka-otp.json
  daily-summary.json
  smart-search.json
```

**Pros:** Version-controlled, reviewable in PRs, trivially auditable, zero
infrastructure beyond what already exists. Good enough for Phase 1-2.

**Cons:** Adding an app requires a server redeploy. Only you can publish.

**When to move past this:** When a third-party developer wants to publish
an app without submitting PRs to your repo, or when the catalog grows
beyond ~20 apps and static files become unwieldy.

---

## Approach B — Remote Manifest URL Registry

Apps publish their manifest at a well-known URL:
```
https://daily-summary-app.com/.well-known/wa-companion.json
```

The server maintains a list of manifest URLs in SQLite. A background job
fetches and caches them periodically (e.g., every 6 hours). To add an app,
enter its manifest URL in the dashboard. The server fetches, validates,
and adds it to the catalog.

**Pros:** Decouples app publishing from server deployments. Developers can
update manifests (new version, new config fields) without touching your repo.

**Cons:** Requires trust in external URLs. Need cache invalidation logic.
App availability depends on external server uptime.

**When to use:** Phase 3 — when third-party developers are building apps.

---

## Approach C — GitHub-Based Registry

A public GitHub repo acts as the app registry:
```
wa-companion-apps/
  apps/
    ott-ka-otp/
      manifest.json
      README.md
      screenshots/
    daily-summary/
      manifest.json
      README.md
```

Developers submit apps via PR. Maintainers review and merge. The server
pulls from this repo on startup or via a webhook on push.

**Pros:** Review control, version history, community contributions via PRs.
This is how Homebrew, Raycast extensions, and many community catalogs work.

**Cons:** Operational overhead. Requires PR review process. Only worth it
when you have external contributors.

**When to use:** Phase 3-4 — when you have community contributors and want
governance.

---

## Approach D — Full Marketplace API

A hosted registry service with app submission, review workflow, versioning
with rollback, ratings and reviews, install counts and analytics, revenue
sharing for paid apps.

This is Shopify App Store / Chrome Web Store territory.

**When to use:** Phase 4+ — only at significant scale with paying users.

---

## Comparison

| Approach | Publisher | Discovery | Update flow | Phase |
|---|---|---|---|---|
| A. Static manifests | You only | Browse catalog/ dir | Redeploy server | 1-2 |
| B. Remote URLs | Any developer | Dashboard catalog | Developer updates URL | 3 |
| C. GitHub registry | PR contributors | Repo + dashboard | Merge PR | 3-4 |
| D. Marketplace API | Self-service | Full marketplace UI | Submission flow | 4+ |

---

## App Settings & Config (applies to all approaches)

### The model

The **app defines** what settings it needs via `configSchema` in its manifest.
The **server stores** the user's chosen values. The **app reads** its config
via the API.

```
App manifest (defines schema) → User sets values (dashboard UI) →
Server stores values (SQLite) → App reads values (GET /api/config)
```

### Storage

A single `app_config` table in the WA Companion SQLite database:

```sql
CREATE TABLE app_config (
  app_id    TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,  -- JSON-encoded value
  PRIMARY KEY (app_id, key),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);
```

Config values are stored as JSON strings. The server doesn't interpret
them — it stores what the user sets and returns it when the app asks.

### No app-specific migrations

Apps do NOT have their own database tables or migrations inside the WA
Companion server. The `app_config` table is generic — it works for every
app via key-value pairs. This is deliberate:

- Apps are external services. They should not modify the server's schema.
- A generic key-value store is flexible enough for any config shape.
- If an app needs complex structured storage, it maintains its own
  database in its own service.

### Schema evolution (what happens when config changes)

**New field added** (e.g., v2 adds `timezone`):
- Server compares stored config against the new manifest schema
- Missing keys get populated with the default from the manifest
- No migration needed — defaults fill the gap
- Dashboard shows the new field on the settings page

**Field removed** (e.g., v2 drops `legacySetting`):
- Server ignores stored keys not in the current schema
- Old values stay in the database (harmless) but don't appear in the UI
- `GET /api/config` only returns keys from the current schema
- No migration needed — orphaned keys are invisible

**Field type changed** (e.g., `timeout` from number to select):
- Server validates stored value against the new type
- If incompatible, resets to the new default
- Dashboard surfaces a notice: "Setting X was reset due to an app update"

**Bottom line:** No app-specific migrations ever. The config schema in the
manifest is the source of truth. Schema evolution is handled by defaults
and validation, not migrations.

### How apps read config

New API endpoint, scoped to the calling app:

```
GET /api/config
Authorization: Bearer wak_...

Response:
{
  "otpRetentionMinutes": 10,
  "notifyOnDetection": true
}
```

The server looks up the app by API key, reads config from `app_config`,
filters through the current manifest schema (dropping orphaned keys,
filling defaults for missing keys), and returns the result.

### Stored, not fetched in real-time

The server stores config in SQLite and serves it via the API. It does NOT
call out to the app to fetch config — that would create a circular
dependency and add latency to every config read.

The flow is one-directional:
1. User changes a setting in the dashboard
2. Server writes to `app_config`
3. App reads it next time it calls `GET /api/config`

If the app needs to know about config changes immediately (not just on
next poll), the server can optionally deliver a `config.updated` webhook
event. Nice-to-have, not a launch requirement.

---

*Last updated: April 2026*
