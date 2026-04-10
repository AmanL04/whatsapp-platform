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

## App Settings

**Decision:** The platform does NOT store or manage app settings. Apps own
all their configuration. The dashboard links to the app's own settings page
via `settingsUrl`.

See `docs/app-settings-design.md` for the full discussion, marketplace
precedents, and rationale.

---

*Last updated: April 2026*
