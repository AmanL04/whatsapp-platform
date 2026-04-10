# Open Questions

> Things that need discussion, decisions, or just thinking time. Not todos
> with clear specs — more like "we should talk about this before it bites us."

---

## Open

### How do apps communicate back to the user?

**Context:** Apps receive data (webhooks) and query data (REST API). But the
Daily Summary app needs to *deliver* the summary somewhere. The Task Extractor
needs to notify you about detected tasks. What's the delivery surface?

**Options to consider:**
- **WhatsApp message via `messages.send`** — powerful, everything stays in
  WhatsApp. But noisy: the user gets bot messages in their own chat. Also
  requires `messages.send` permission, which is the most sensitive one.
- **App's own UI only** — the user checks the app's dashboard. Clean
  separation, no noise. But the user has to remember to check 6 different
  dashboards. Low engagement.
- **Push notification from the app** — app sends browser/mobile notifications
  independently. Requires the app to implement its own notification system.
- **Dashboard notification center** — a unified notification feed in the
  WA Companion dashboard that apps can post to via a new API endpoint
  (`POST /api/notifications`). One place to check. Adds an API surface.
- **Email digest** — app sends a daily email. Low friction, familiar, but
  requires email configuration.

**Likely answer:** Combination. The API should support `messages.send` for
apps that want to reply in WhatsApp. The dashboard should have a lightweight
notification feed for apps that want to surface things without being noisy.
Apps choose which delivery method fits their use case.

**Decision needed:** Before building the first app that needs to talk back.

---

### Product naming

**Context:** "WA Companion" is descriptive but generic — sounds like a
utility, not a platform. It won't stick in someone's memory after a pitch
conversation. It also has a WhatsApp trademark adjacency risk if it ever
gets big enough for Meta to notice.

**Properties a good name should have:**
- Short, memorable, distinctive
- Doesn't include "WhatsApp" or "WA" (trademark risk)
- Suggests extensibility/platform, not just a single tool
- Domain availability
- Not already taken by a major product

**Not urgent.** Fine for development and early users. Should be resolved
before any public launch, landing page, or developer marketing.

**Decision needed:** Before public launch / landing page.

---

### Webhook + API stress testing

**Context:** OTT ka OTP is running in production and validates the core
webhook + API flow. However, it's a single app with a specific use pattern.
Things worth testing with multiple concurrent apps:

- High-frequency message bursts: 50 messages in 10 seconds with 3 apps
  subscribed. Does the dispatcher handle concurrent POSTs without drops?
- Slow webhook receivers: one app takes 8 seconds to respond. Does it
  block delivery to others? (Promise.allSettled should prevent this.)
- Payload size for media events: large metadata causing receiver timeouts?
- API rate limiting: 100 req/min is per-app, but is the global server
  capacity sufficient when 5 apps each hit 80 req/min?
- Webhook retry storms: app goes down, all 3 retries fire for every
  message. Does the backlog grow unboundedly during extended downtime?
- Scope filtering performance: does `getSubscribedApps()` (iterates all
  apps per message) become a bottleneck as app count grows?

**Not blocking launch.** Worth running a deliberate stress test before
adding the 4th or 5th concurrent app.

---

### setupUrl reliability during installation

**Context:** When a user clicks "Install," the server creates a registration
and POSTs credentials to the app's `setupUrl`. What happens if that URL is
unreachable?

**Options:**
- **Fail the installation entirely** — safest. User sees "App unreachable,
  try again later." No orphaned registrations. But frustrating if the app
  is temporarily slow.
- **Install but mark as "pending setup"** — registration is created, but
  the app is flagged as not yet configured. Server retries the setupUrl
  POST in the background. Dashboard shows "Waiting for app to respond."
  App starts receiving webhooks only after setup succeeds.
- **Install and let the app pull credentials** — instead of pushing
  credentials to setupUrl, the app fetches them via a one-time token.
  Avoids the reachability problem entirely but requires the app to know
  how to pull credentials (more complex manifest).

**Decision needed:** Before building the install endpoint.

---

### App version updates and permission changes

**Context:** Config schema evolution is covered (defaults fill gaps, orphaned
keys are invisible). But what about the app itself changing its `webhookUrl`,
`requiredPermissions`, or `requiredEvents` between versions?

**Questions:**
- Does the user need to uninstall and reinstall?
- Can the server detect a manifest version bump (in Approach A, when the
  JSON file changes on redeploy) and prompt the user to approve?
- If an app adds `messages.send` permission in v2 that it didn't need in
  v1, should the server auto-grant or require explicit user approval?
- What about `webhookUrl` changes? Silent update or user confirmation?

**Not urgent for Approach A** (you control all manifests and can manually
handle updates). Becomes important the moment third-party apps exist.

**Decision needed:** Before opening to third-party developers (Phase 3).

---

### config.updated webhook event

**Context:** When a user changes an app's settings in the dashboard, the
new values are stored in SQLite. The app reads them next time it calls
`GET /api/config`. But if the app needs to react immediately (e.g., change
summary schedule time), it has to poll.

**Option:** Deliver a `config.updated` webhook event to the app whenever
the user changes a setting. The payload includes the full updated config.

**Trade-off:** Adds an event type and dispatch logic. But it's a small
addition and prevents apps from having to poll for config changes.

**Decision needed:** Before building the config API. Likely a "yes, include
it" — low cost, high value.

---

## Resolved

### App catalog: public page vs dashboard-only

**Decided:** Split into two surfaces:
- Public catalog page at `/catalog` (no auth) for browsing and discovery
- Dashboard `/apps` (behind auth) for management of installed apps
- "Install" button on public page redirects to dashboard with auth check

---

*Last updated: April 2026*
