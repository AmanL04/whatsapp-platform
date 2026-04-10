# Decisions & Constraints

> Living document. Revisit periodically as WhatsApp protocol, Baileys, and
> Meta's enforcement evolve. Each entry is tagged as a **decision** (we chose
> this) or a **constraint** (the protocol/platform imposes this).

---

## 1. One WhatsApp account per server instance

**Type:** Decision

**What:** Each WA Companion server connects to exactly one WhatsApp account.
Multi-account means multiple server instances, not one server managing
multiple Baileys sessions.

**Why this holds:**
- Baileys maintains a single WebSocket per linked device session. Two
  accounts in one process = two sockets, two auth states, two event
  streams multiplexed through the same dispatcher. If one disconnects,
  reconnection logic can interfere with the other.
- Two sessions from the same IP is exactly the behavioral pattern Meta
  flags when detecting automation. One session per IP is the safest
  posture.
- The permission model, SQLite store, app scopes — everything assumes
  "this is one person's WhatsApp." That's the natural boundary.

**Multi-account path (if needed later):**
- Hosted/managed version: containers or VMs per user, not multi-session
  in one process
- Self-hosted power users: run two server instances on different ports,
  each with its own data directory and Baileys session

**Revisit when:** If there's strong user demand for "connect my personal
and business number in one dashboard." Even then, the answer is probably
a lightweight proxy that aggregates two server instances, not changing the
core to be multi-session.

---

## 2. No historical data beyond the initial sync window

**Type:** Constraint (WhatsApp linked device protocol)

**What:** When you first link a device via WhatsApp Web/Baileys, WhatsApp
syncs a window of recent message history — typically ~3 months of text,
less for media-heavy chats. After that initial sync, WA Companion captures
everything in real time going forward. You cannot retroactively pull "all
messages since 2019."

**Why this exists:**
- WhatsApp's linked device protocol treats the phone as the primary
  device and linked devices as secondary. The phone holds the full
  history; linked devices get a recent window plus live events.
- This is a fundamental protocol limitation, not a Baileys shortcoming.
  The official WhatsApp Web app has the same constraint.
- Meta has no incentive to change this — it reduces server load and
  keeps the phone as the canonical store.

**Impact on apps:**
- Most launch apps are fine: Daily Summary needs today, Task Extractor
  needs recent messages, Voice Note Transcriber processes new notes.
- Smart Search gets richer over time — after 6 months of uptime, you
  have 6 months of searchable history.
- The pitch should be honest: "WA Companion captures everything from
  the moment you connect. The data gets richer over time."

**Possible mitigations (future):**
- WhatsApp's "Export Chat" produces .txt files per chat. A backfill
  utility could parse these into the SQLite store, giving partial
  historical data. Nice-to-have, not a launch blocker.
- Android users: WhatsApp stores an unencrypted SQLite database on
  device (`msgstore.db`). A migration tool could import from this.
  iOS is harder (encrypted backups).

**Revisit when:** WhatsApp changes the linked device sync behavior.
Meta has gradually increased the sync window over the years — it used
to be much smaller. If they ever make full history available to linked
devices, this constraint disappears.

---

## 3. Message gaps during connection failures

**Type:** Constraint (WhatsApp linked device protocol) + Decision (how
we handle it)

**The constraint:**
When the server goes offline, messages still arrive on the phone. When the
linked device reconnects, WhatsApp delivers messages that were received
during the offline period — up to a point. Short disconnections (minutes
to hours) generally catch up fully. Long disconnections (days) may lose
messages. If the session is invalidated (~14 days of inactivity), the
linked device is delinked entirely and a re-scan is needed.

A full re-sync (pulling everything the phone has for the gap period) is
not possible via the linked device protocol. The phone is primary, the
linked device is secondary. This is fundamental and cannot be engineered
around.

**The decision (how to handle it):**
Rather than pretending gaps don't exist, surface them transparently:
- Detect reconnection events and log the disconnection window
  (disconnect_at, reconnect_at timestamps)
- Store gaps in a `connection_gaps` table
- Surface gaps in the dashboard: "Messages between April 5 3:00pm and
  7:00pm may be incomplete"
- Expose gaps via the API so apps can handle them (e.g., Daily Summary
  notes "partial data" for that period)

**TODO:** Build gap detection and transparency. See potential future todo.

**Revisit when:** Baileys or WhatsApp improves offline message delivery.
Also revisit if the hosted version introduces uptime guarantees — that
changes the gap frequency significantly.

---

## 4. Self-hosting as the default deployment model

**Type:** Decision

**What:** WA Companion is designed to run on the user's own machine (laptop,
home server, Raspberry Pi). A Railway deployment exists for convenience,
but the primary and recommended deployment is self-hosted.

**Why this holds:**

*Security & privacy:*
- The server reads every WhatsApp message. "Your data never leaves your
  machine" is a one-line pitch that removes the biggest trust objection.
- No third-party cloud provider ever sees the data.

*Anti-ban posture:*
- Self-hosted means the Baileys connection originates from the user's
  home IP — the same IP their phone and laptop use. To WhatsApp, this
  looks identical to a legitimate linked device.
- Cloud-hosted (AWS, Railway, DigitalOcean) uses datacenter IPs, which
  are known ranges and a red flag for automation detection.
- The Railway deployment works and is great for demos, but for long-term
  personal use, a home machine is meaningfully safer.

*Independence:*
- No recurring hosting costs for the user.
- No dependency on a cloud provider's uptime or pricing changes.
- Works offline / on local networks.

**The tradeoff:**
- Non-technical users can't self-host. This limits the initial audience
  to developers and technical users.
- That's fine for Phase 1-2. The hosted version (Phase 4) expands to
  everyone, and by then the official Business API adapter is available,
  which removes the IP concern entirely.

**Railway caveat:**
- The Railway deployment is technically cloud-hosted and does use a
  datacenter IP. The risk tradeoff should be documented clearly: Railway
  is great for demo/dev, self-hosting is safer for long-term personal use.

**Revisit when:**
- Demand for a hosted version grows. The answer isn't abandoning self-
  hosting — it's offering both, with clear risk communication.
- Meta's enforcement changes. If they stop caring about datacenter IPs
  (unlikely), the self-hosting advantage for anti-ban shrinks.
- The official Business API adapter is built. Business users on the
  Cloud API have no ban risk at all, making cloud hosting safe for them.

---

*Last updated: April 2026*
