# First-Party Apps

## Principle

First-party apps are NOT embedded in the dashboard. They are separate services
that use the exact same webhook + REST API system as any third-party app would.
This proves the platform works and gives third-party developers a template.

Each app is its own repo/folder with its own lightweight UI and hosting. It
registers with WA Companion via the app manifest system. The user accesses it
at its own URL and the dashboard links to it via the "Open" button.

## Launch Apps (Priority Order)

### 1. Daily Summary (highest wow factor, fastest to build)
- Receives `message.received` webhooks for group chats
- Accumulates messages per group per day
- At a configurable time (default 9am), calls an LLM to summarize
- Serves a simple web UI showing today's summaries by group
- Config: summary time, which groups, LLM provider/key
- Permissions: messages.read, chats.read
- Scope: groups

### 2. Smart Search (solves universal pain point)
- Calls the REST API to search messages across all chats
- Provides a fast, filter-rich search UI (by sender, date, media type, chat)
- Much better than WhatsApp's built-in search
- Permissions: messages.read, chats.read, media.read
- Scope: all

### 3. Task Extractor (unique, AI-native)
- Receives `message.received` webhooks
- Uses LLM to detect commitments: "I'll send that by Friday", "Can you handle X?"
- Stores extracted tasks with confidence scores, due dates, assignees
- UI shows tasks grouped by chat, sortable by urgency/date
- Permissions: messages.read, chats.read
- Scope: all

### 4. Voice Note Transcriber (most-requested missing feature)
- Receives `media.received` webhooks for audio type
- Downloads voice note via REST API (media.download permission)
- Transcribes using Whisper or similar
- Stores transcription linked to original message
- UI shows voice notes with transcriptions, searchable
- Permissions: messages.read, media.read, media.download
- Scope: all

### 5. Content Recap (solves storage bloat)
- Receives `media.received` webhooks for images/videos
- Presents a swipeable gallery UI: right=keep, left=discard, up=star
- Helps users manage WhatsApp media without scrolling through chats
- Permissions: media.read, media.download
- Scope: all

### 6. Read Later Queue (low effort, high daily utility)
- Receives `message.received` webhooks
- Detects URLs (YouTube, articles, PDFs) in messages
- Aggregates into a feed UI with source chat, sender, and preview
- Permissions: messages.read, chats.read
- Scope: all

## Tech Stack (per app)

Each app is a lightweight Node.js/TypeScript service:
- Express or Hono for webhook receiver + API calls
- Simple frontend (React or plain HTML) for the UI
- SQLite or in-memory store for app-specific data
- Publishes an app manifest for the installation system

## Status

Planned — start with Daily Summary as the first proof-of-concept.
Build it as a template that other first-party apps follow.
