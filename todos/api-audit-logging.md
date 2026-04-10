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

## Status

Deferred — ship MCP first, add observability after.
