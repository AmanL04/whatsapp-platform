# WhatsApp Companion Platform — Connection Layer Research

> **Goal:** Build a personal WhatsApp companion platform with a plugin architecture — one place to keep building apps (Summary, Content Recap, Task List, Bots, etc.) for personal and business use, without needing to re-solve the WhatsApp connection problem for each plugin.

---

## TL;DR Decision Matrix

| Option | Personal WA? | Local/Private? | No extra infra? | ToS safe? | Effort to start | Best for |
|---|---|---|---|---|---|---|
| **Beeper Desktop API** | ✅ | ✅ | ✅ | ✅ | Low | Start here |
| **Baileys (TS/Node)** | ✅ | ✅ | ✅ | ⚠️ grey | Low-Medium | Full control, no deps |
| **whatsmeow (Go)** | ✅ | ✅ | ✅ | ⚠️ grey | Medium | Low-level, most power |
| **mautrix-whatsapp** | ✅ | ✅ | ❌ needs Matrix | ⚠️ grey | High | Escape hatch from Beeper |
| **Unipile** | ✅ | ❌ cloud | ✅ | ✅ | Low | SaaS builder, not personal |
| **Meta Cloud API** | ❌ business only | ❌ cloud | ✅ | ✅ | Medium | Business accounts only |
| **Unofficial REST wrappers** (Whapi, UltraMsg etc.) | ✅ | ❌ cloud | ✅ | ⚠️ grey | Low | Sending-heavy use cases |

**Recommended path:** Start with Beeper Desktop API → abstract the connection layer → swap to Baileys/whatsmeow when you need independence.

---

## Option 1: Beeper Desktop API ⭐ Recommended Starting Point

**What it is:** A fully local REST API and MCP server built into Beeper Desktop. Exposes your WhatsApp (and 12+ other networks) via a clean HTTP interface running at `localhost:23373`.

**GitHub:** https://github.com/beeper
**Docs:** https://developers.beeper.com/desktop-api
**SDKs:** TypeScript, Python, Go

### What you get

```
GET  /chats                  → list all chats
GET  /chats/{id}/messages    → message history
POST /messages/send          → send a message
GET  /messages/search        → search across all chats
GET  /assets/download        → download media
WS   /websocket              → live event stream (experimental)
```

- Built-in MCP server — wire Claude directly to your WhatsApp with zero extra code
- Read operations are entirely local and unlimited
- Covers WhatsApp, Telegram, Signal, iMessage (macOS), Instagram, Discord, Slack, LinkedIn, Google Messages

### The Dependencies (honest list)

1. **Beeper Desktop must be installed** — Electron app, ~200MB
2. **Beeper Desktop must be running** — API goes offline when app closes; kills scheduled tasks
3. **Beeper account required** — not anonymous, tied to an account
4. **Beeper the company** — acquired by Automattic (WordPress) in 2024; if they shut down or break the API, your platform breaks

### Quick Start

```typescript
import { BeeperClient } from '@beeper/desktop-api-sdk';

const client = new BeeperClient({ baseUrl: 'http://localhost:23373' });

// List chats
const chats = await client.chats.list();

// Get messages from a chat
const messages = await client.messages.list({ chatId: 'whatsapp_...' });

// Stream live events
client.ws.on('message', (event) => {
  // dispatch to plugin handlers
});
```

### Plugin interface on top of Beeper

```typescript
interface Plugin {
  name: string;
  subscribes: ('onMessage' | 'onMedia' | 'onGroupMessage')[];
  schedule?: string;          // cron for proactive plugins
  run: (context: PluginContext) => Promise<void>;
}

export default {
  name: 'daily-summary',
  subscribes: [],
  schedule: '0 9 * * *',
  run: async ({ client, notify }) => {
    const messages = await client.messages.list({ since: '24h' });
    const summary = await llm.summarize(messages);
    await notify(summary);
  }
}
```

### Community projects already built on it

- **f/deeper** (Swift) — macOS messaging analytics app
- **blqke/beepctl** (TypeScript) — CLI with AI-agent workflows
- **beeper/raycast** (TypeScript) — Raycast extension
- **adamanz/omnichannel-messenger** (TypeScript) — multi-platform unified send

---

## Option 2: Baileys (@whiskeysockets/baileys) — Full Independence, TypeScript

**What it is:** A pure TypeScript/WebSocket implementation of the WhatsApp Web multi-device protocol. No browser, no Selenium. Connects directly to WhatsApp servers via WebSocket as a linked device.

**GitHub:** https://github.com/WhiskeySockets/Baileys
**NPM:** `@whiskeysockets/baileys`
**Stars:** ~20k

> Note: The original repo was removed by its author; this community fork is the active continuation.

### What you get

- Full message send/receive (text, media, voice, reactions, replies)
- Group management (create, add/remove members, metadata)
- Contact presence, read receipts, typing indicators
- History sync on first connect
- Event-driven architecture — subscribe to `messages.upsert`, `chats.update`, etc.
- Messages stored locally in SQLite
- No external service dependency — runs entirely on your machine

### Architecture

```
Your Phone (WhatsApp)
      ↕ (multidevice protocol)
Baileys process (Node.js)
      ↕
Local SQLite DB  ←→  Your plugin runtime
```

### Quick Start

```typescript
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const plugin of plugins) {
      if (plugin.subscribes.includes('onMessage')) {
        await plugin.run({ message: messages[0], sock });
      }
    }
  });
}
```

### Tradeoffs

**Pros:**
- Zero external dependencies — your own process, your own data
- TypeScript-native, great for a Node-based plugin platform
- Most widely used unofficial WA library — large community, quick fixes when WA updates
- ~50MB RAM vs 300-600MB for browser-based alternatives

**Cons:**
- Against WhatsApp ToS — risk of account suspension (low for personal, read-heavy use)
- Can break when WhatsApp updates their protocol
- Production auth state needs custom implementation — built-in `useMultiFileAuthState` is demo-only
- Requires Node 17+

### When to use over Beeper

- You don't want users to install Beeper Desktop
- You need the platform to run headlessly (e.g. background daemon, server)
- You want to own the entire stack with no third-party app dependency

---

## Option 3: whatsmeow — Full Independence, Go

**What it is:** The Go library Beeper's own bridges are built on. Lower-level than Baileys but more stable and performant. Written by Tulir Asokan (same author as mautrix).

**GitHub:** https://github.com/tulir/whatsmeow
**Stars:** 4.5k
**Language:** Go

### What you get

- Direct WhatsApp Web multi-device protocol implementation
- Event-driven (same model as Baileys but in Go)
- End-to-end encryption handled natively (Signal protocol)
- SQLite or Postgres for session/message persistence
- More stable than Baileys historically — Go's type system catches protocol edge cases better

### Quick Start

```go
container, _ := sqlstore.New("sqlite3", "file:sessions.db", waLog.Stdout("DB", "WARN", true))
deviceStore, _ := container.GetFirstDevice()
client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "WARN", true))

client.AddEventHandler(func(evt interface{}) {
  switch v := evt.(type) {
  case *events.Message:
    // dispatch to plugins
  }
})
client.Connect()
```

### When to use over Baileys

- You prefer Go over TypeScript
- You want maximum stability (Go > Node for long-running processes)
- You want to eventually work with or fork mautrix bridges

---

## Option 4: mautrix-whatsapp — Self-Hosted, Matrix-Backed

**What it is:** A Matrix bridge that connects WhatsApp to the Matrix protocol. This is what Beeper runs internally. You self-host both the bridge and a Matrix homeserver (Synapse).

**GitHub:** https://github.com/mautrix/whatsapp
**Docs:** https://docs.mau.fi/bridges/go/setup.html?bridge=whatsapp
**Built on:** whatsmeow (Go)

### Setup requirements

```
┌─────────────────────────────────────┐
│  Your server / machine              │
│  ┌─────────────┐  ┌──────────────┐  │
│  │   Synapse   │  │  mautrix-    │  │
│  │  (Matrix HS)│←→│  whatsapp    │  │
│  └─────────────┘  └──────────────┘  │
│  ┌─────────────┐                    │
│  │  PostgreSQL │                    │
│  └─────────────┘                    │
└─────────────────────────────────────┘
```

Docker Compose snippet:

```yaml
services:
  synapse:
    image: matrixdotorg/synapse:latest
  mautrix-whatsapp:
    image: dock.mau.dev/mautrix/whatsapp:latest
    volumes:
      - ./whatsapp-data:/data
  postgres:
    image: postgres:16
```

### Tradeoffs

**Pros:**
- Zero dependency on Beeper or any third party
- Most future-proof option (Matrix is an open standard)
- Any Matrix integration works out of the box

**Cons:**
- High setup complexity — Synapse alone needs ~500MB RAM
- Not a good starting point — use as the escape hatch later

---

## Option 5: Unipile — Not Recommended for This Use Case

Cloud-based unified API (WhatsApp, LinkedIn, Instagram, Gmail etc.). QR-based auth, no Meta approval.

**Why it doesn't fit:** Your messages go to their servers. €49/month minimum. Built for SaaS products, not personal tooling. Only makes sense if you were building a B2B product for business customers.

---

## Option 6: Meta Cloud API — Not Relevant

Official WhatsApp Business Platform. Requires a Business Account, template approval, per-conversation pricing. No access to personal accounts or existing message history. Ruled out.

---

## Option 7: whatsapp-web.js — Inferior to Baileys

Uses Puppeteer (headless Chrome) to control WhatsApp Web. 300-600MB RAM vs ~50MB for Baileys. Slower, less stable. Only worth it if you need browser-level UI interaction, which you don't.

---

## Recommended Architecture

### Phase 1: Build for yourself with Beeper (now)

```
Beeper Desktop API (localhost:23373)
           ↓
    Plugin Runtime (Node/TS)
    ├── plugins/
    │   ├── daily-summary.ts      ← LLM summarize last 24h
    │   ├── content-recap.ts      ← Media gallery + swipe UI
    │   ├── task-extractor.ts     ← Intent extraction from messages
    │   └── group-digest.ts       ← Group chat highlights
    └── dashboard/ (web UI)
```

### Phase 2: Abstract the connection layer

```typescript
// Define your own adapter interface — plugins never touch Beeper or Baileys directly
interface WAAdapter {
  getChats(): Promise<Chat[]>;
  getMessages(chatId: string, opts: MessageOpts): Promise<Message[]>;
  sendMessage(chatId: string, content: string): Promise<void>;
  onMessage(handler: (msg: Message) => void): void;
  onMedia(handler: (media: Media) => void): void;
}

class BeeperAdapter implements WAAdapter { ... }   // today
class BaileysAdapter implements WAAdapter { ... }  // later, no Beeper needed
```

### Phase 3: Go independent with Baileys

- Drop Beeper dependency
- Baileys runs as a background daemon
- Users scan a QR code once, done
- Platform works without any third-party app installed

---

## Plugin Data Primitives

```typescript
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker';
  timestamp: Date;
  isFromMe: boolean;
  isGroup: boolean;
  groupName?: string;
  replyTo?: string;
  reactions?: Reaction[];
}

interface Media {
  id: string;
  chatId: string;
  type: 'image' | 'video' | 'audio' | 'document';
  localPath?: string;
  mimeType: string;
  caption?: string;
  timestamp: Date;
  senderName: string;
}

interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: Date;
  unreadCount: number;
  participants?: string[];
}
```

---

## App Ideas Mapped to Connection Options

| App | Beeper API | Baileys/whatsmeow | Notes |
|---|---|---|---|
| **Daily Summary** | ✅ `messages.list(since: '24h')` | ✅ history sync | Feed to LLM, output digest |
| **Content Recap** | ✅ `assets.download()` | ✅ `downloadMediaMessage()` | Or just read local media folder — zero API needed |
| **Task Extractor** | ✅ messages → LLM → extract | ✅ same | Score by emphasis: "definitely", "maybe" etc. |
| **Group Digest** | ✅ filter `isGroup: true` | ✅ same | Summarize per-group, cron at EOD |
| **Smart Bot** | ⚠️ write ops rate-sensitive | ✅ full send/receive | Beeper discourages heavy sending |
| **Contact Stats** | ✅ `contacts.list()` | ✅ group metadata | Who you talk to most, response times |

---

## Key Risks

### Protocol changes
All unofficial options depend on reverse-engineering WhatsApp's protocol. Meta updates it periodically. Beeper and mautrix teams patch quickly (within days) but there's always a window of breakage.

### Account ban risk
- Reading/searching messages — extremely low risk
- Sending programmatically — moderate; keep sends human-like in frequency
- Bulk messaging at scale — high risk, don't do this

### Beeper company risk
Acquired by Automattic in 2024. Desktop API actively developed as of early 2026. Abstract behind `WAAdapter` from day one so you're not locked in.

---

## Decision

For **personal companion platform, build for yourself first, open to others later:**

1. **Start on Beeper Desktop API** in TypeScript
2. **Abstract behind `WAAdapter`** from day one
3. **Build 2-3 plugins end-to-end** — Summary + Content Recap are easiest
4. **Swap to Baileys** when sharing with people who won't install Beeper

---

## References

- Beeper Desktop API docs: https://developers.beeper.com/desktop-api
- Beeper open source: https://developers.beeper.com/open-source
- Baileys: https://github.com/WhiskeySockets/Baileys
- Baileys docs: https://baileys.wiki
- whatsmeow: https://github.com/tulir/whatsmeow
- mautrix-whatsapp: https://github.com/mautrix/whatsapp
- mautrix bridge setup: https://docs.mau.fi/bridges/go/setup.html?bridge=whatsapp
- WhatsApp MCP (Baileys-based): https://github.com/jlucaso1/whatsapp-mcp-ts
- Unipile: https://unipile.com

---

*Last updated: April 2026*
