# API & MCP Audit Logging

## Problem

No visibility into who is using the MCP server or app APIs. Requests are fire-and-forget — no record of which tools are called, by which client, how often.

## Scope

- MCP tool calls: tool name, client_id (from OAuth token), timestamp, success/failure
- App API requests: endpoint, app_id, timestamp, response status
- Dashboard API requests: endpoint, timestamp (already behind OTP auth)

## Options

### A. Console logging (minimal)
`console.log` on each request. Searchable via server logs. No storage overhead.

### B. DB table (queryable)
```sql
CREATE TABLE api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,  -- 'mcp', 'api', 'dashboard'
  client_id TEXT,        -- OAuth client_id or app_id
  endpoint TEXT NOT NULL, -- tool name or route
  status INTEGER,        -- HTTP status or success/error
  created_at INTEGER NOT NULL
);
```
Queryable, can show in dashboard. Needs cleanup cron (like webhook deliveries).

### C. Both
Console for real-time, DB for historical queries + dashboard UI.

## Recommendation

Option C. Console logging is near-zero effort. DB logging adds visibility in the dashboard. Cleanup same pattern as `cleanOldDeliveries`.

## Current state

Basic MCP client visibility exists — dashboard MCP tab shows registered clients with active token counts. No request-level logging yet.

## Enhancements (future)

- Per-request logging: which MCP tools called, when, by which client
- App API request logging: endpoint, app_id, timestamp, response status
- Dashboard UI: timeline view of API/MCP usage
- Cleanup cron for old log entries (same pattern as webhook deliveries)
- **Cleanup cron for expired OAuth data:** `mcp_auth_codes` (expired after 5 min) and `mcp_tokens` (expired access tokens after 1h, refresh tokens after 30d) accumulate stale rows. Add cleanup to the daily cron alongside `cleanOldDeliveries`.

## Status

Deferred — basic MCP client visibility shipped, full audit logging later.
