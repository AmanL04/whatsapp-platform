# Open Questions

> Things that need discussion, decisions, or just thinking time. Not todos
> with clear specs — more like "we should talk about this before it bites us."

---

## How do apps communicate back to the user?

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

## Product naming

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

## Webhook + API stress testing

**Context:** OTT ka OTP is running in production and uses the webhook + API
interface successfully. This validates the core flow. However, OTT ka OTP
is a single app with a specific use pattern. Things worth testing with
multiple concurrent apps:

**Potential issues to probe:**
- High-frequency message bursts: what happens when a group chat gets 50
  messages in 10 seconds and 3 apps are subscribed? Does the dispatcher
  handle concurrent POSTs without dropping events?
- Slow webhook receivers: if one app's endpoint takes 8 seconds to respond,
  does it block delivery to other apps? (Current impl uses Promise.allSettled,
  so it shouldn't — but worth confirming under load.)
- Payload size for media events: are large media metadata payloads causing
  timeouts on the receiving end?
- API rate limiting with multiple apps: 100 req/min is per-app, but is the
  global server capacity sufficient when 5 apps each hit 80 req/min?
- Webhook retry storms: if an app goes down and all 3 retries fire for every
  message, does the retry backlog grow unboundedly during extended downtime?
- Scope filtering performance: as the number of apps grows, does
  `getSubscribedApps()` (which iterates all apps on every message) become
  a bottleneck?

**Not blocking launch** — OTT ka OTP proves the happy path works. But worth
running a deliberate stress test before adding the 4th or 5th concurrent app.

---

## App catalog: public page vs dashboard-only

**Context:** Discussed in this conversation. The recommendation is:
- Public catalog page at `/catalog` (no auth) for browsing and discovery
- Dashboard `/apps` (behind auth) for management of installed apps
- "Install" on the public page redirects to dashboard with auth check

**Decision needed:** Before building the installation UI. Mostly a routing
and auth question, not a deep architecture one.

---

*Last updated: April 2026*
