# MCP Server

## What

An MCP (Model Context Protocol) server that exposes WA Companion's data to any
MCP-compatible AI tool — Claude, Cursor, custom agents. Users point their AI
assistant at the server and query WhatsApp data in natural language without
building a full app.

## Why

- **Pitch demo:** Show someone Claude pulling live WhatsApp data during a
  conversation. The product sells itself.
- **Zero-friction entry point:** Developers don't need to build a webhook
  handler. They connect an MCP client and start querying immediately.
- **Future-proofs for AI era:** Every AI tool is adopting MCP. Shipping this
  on day one makes WA Companion a native data source for the entire ecosystem.

## MCP Tools to Expose

### Read tools
- `list_chats` — returns chats with last message, unread count, participant
  count. Supports filters: type (dm/group), has_unread, search by name.
- `get_messages` — returns messages for a chat. Params: chatId, limit, since,
  before, search. Returns sender name, content, timestamp, type.
- `search_messages` — full-text search across all chats. Returns matches with
  chat context, sender, timestamp.
- `get_media` — list media metadata with filters: type (image/video/audio/doc),
  chat, sender, date range. Returns URLs or local paths for download.
- `get_chat_info` — detailed info about a specific chat: participants, creation
  date, description (for groups), message count.

### Write tools (opt-in, require explicit permission)
- `send_message` — send a text message to a chat. Requires user confirmation
  in the MCP client before executing.

### Resource endpoints
- `whatsapp://chats` — list of all chats as a resource
- `whatsapp://chat/{id}/messages` — messages in a specific chat

## Auth

The MCP server runs alongside the main server on a separate port (e.g., 6746).
It reads directly from the SQLite store — no webhook registration needed.
Auth options:
- **Local:** no auth (same machine, localhost only)
- **Remote:** Bearer token (reuse the dashboard JWT or a dedicated MCP token)

## Implementation Notes

- Use the official `@modelcontextprotocol/sdk` package
- Transport: stdio for local use, SSE for remote/hosted
- The MCP server is a thin read layer on top of the existing SQLite store —
  it does NOT go through the app registration system. It's a first-party
  privileged consumer of the data, not an "app."
- Rate limit: 100 requests/minute (same as app API)

## Status

Planned — high priority, ship before or alongside first-party apps.
