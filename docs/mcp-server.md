# MCP Server

Expose your WhatsApp data to AI assistants (Claude, Cursor, or any MCP-compatible tool) via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Setup

### Claude Code (CLI) — recommended

```bash
claude mcp add --transport http whatsapp http://localhost:3111/mcp
```

On first use, Claude opens your browser for WhatsApp OTP login. After authenticating, tools are available immediately.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/whatsapp"
    }
  }
}
```

This uses stdio transport (local, read-only — `send_message` not available).

### claude.ai (Web)

Go to **Settings → Connectors → Add MCP Server**, enter `https://your-domain.com/mcp`. OAuth flow handles authentication.

### Remote / Railway

```bash
claude mcp add --transport http whatsapp https://your-domain.com/mcp
```

Requires HTTPS. The server handles OAuth discovery, client registration, and token exchange automatically.

## Authentication

The HTTP endpoint (`/mcp`) is protected by OAuth 2.1:

1. MCP client discovers `/.well-known/oauth-authorization-server`
2. Client registers via `POST /register` (dynamic client registration)
3. Browser opens → WhatsApp OTP login (same flow as dashboard)
4. Authorization code exchanged for access token (PKCE S256)
5. Access tokens expire after 1 hour, refresh tokens after 30 days

Stdio transport (`npm run mcp`) has no auth — it's a local process.

## Available Tools

| Tool | Description | Params |
|---|---|---|
| `list_chats` | List chats with unread counts | `type?` (dm/group), `search?`, `limit?` |
| `get_messages` | Get messages from a chat | `chatId`, `limit?`, `before?`, `after?`, `search?` |
| `search_messages` | Full-text search across all chats | `query`, `limit?`, `before?`, `after?` |
| `get_media` | List media files | `type?`, `sender?`, `source?` (chat/story), `limit?` |
| `get_chat_info` | Chat details + participants (groups) | `chatId` |
| `send_message` | Send a text message | `chatId`, `content` |

`send_message` is marked as destructive — MCP clients will ask for confirmation before executing. Only available via HTTP transport (requires live WhatsApp connection).

## Example Prompts

After connecting, try:

- "List my unread WhatsApp group chats"
- "Search my WhatsApp messages for 'restaurant'"
- "Show me images sent in the last week"
- "What did Aman say in the OTT group today?"
- "Send 'On my way' to the Family group"

## Architecture

```
MCP Client (Claude/Cursor)
  │
  ├─ HTTP transport ──→ /mcp (Express) ──→ OAuth bearer auth ──→ createMcpServer()
  │                                                                    │
  └─ stdio transport ──→ npm run mcp ──→ createMcpServer()             │
                                              │                        │
                                              └── WAAdapter ───→ SQLite store
```

Both transports share the same `createMcpServer()` factory. HTTP transport uses the live adapter (supports `send_message`). Stdio uses a read-only shim.
