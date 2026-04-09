# Claude Code — Project Context

## Project

WhatsApp Companion Platform — a self-hosted WhatsApp infrastructure server with external app registration via webhooks and scoped REST API.

## Self-Testing Strategy

After implementing changes, Claude Code can self-test the full stack end-to-end without human intervention, as long as a Baileys session already exists in `data/auth/`.

### Prerequisites

- `data/auth/` has saved WhatsApp session credentials (from a prior QR scan)
- `data/whatsapp.db` exists (created by migrations on first `npm run start`)
- `.env` has required secrets (`JWT_SECRET`, `DB_ENCRYPTION_SECRET`)

### Test Loop

1. **Typecheck** — `npm run typecheck` after every step. Must pass with zero errors.

2. **Server boots** — `npm run start` (runs migrations first, then starts server). Verify logs show:
   - `[migrations] found N migration files, ...`
   - `[baileys] connected` (auto-reconnects using saved session, no QR needed)
   - `[api] listening on http://localhost:6745`
   - No crash or unhandled errors

3. **SQLite schema** — Query the DB directly to confirm tables exist and schema is correct:
   ```bash
   sqlite3 data/whatsapp.db ".tables"
   sqlite3 data/whatsapp.db ".schema apps"
   ```

4. **Messages flowing** — After Baileys connects, incoming messages appear in the DB:
   ```bash
   sqlite3 data/whatsapp.db "SELECT id, sender_name, content FROM messages ORDER BY timestamp DESC LIMIT 5"
   ```

5. **OTP auth loop** — Fully testable without human:
   - Call `POST /dashboard/auth/send-otp` — server sends OTP to your WhatsApp number via Baileys
   - Since Baileys is also listening, the sent message lands in `messages.upsert`
   - Read the OTP code from DB or server logs
   - Call `POST /dashboard/auth/verify-otp` with the code
   - Confirm JWT cookie is returned

6. **Webhook dispatch** — Register a test app whose webhook URL points to an endpoint on the same server:
   - Add a `POST /test/webhook` endpoint that logs received payloads
   - Register it as an app via `POST /dashboard/api/apps` with webhook URL `http://localhost:6745/test/webhook`
   - Wait for a WhatsApp message to arrive (or check if one came in during connect)
   - Verify `webhook_deliveries` table has a `delivered` row
   - Verify the test endpoint received the payload with correct HMAC signature

7. **Scoped API** — Use the test app's API key:
   ```bash
   curl -H "Authorization: Bearer <api_key>" http://localhost:6745/api/chats
   ```
   - Confirm response is filtered to the app's registered scope
   - Confirm out-of-scope requests return 403

8. **Dashboard build** — `cd dashboard && npx vite build`. Must succeed with no errors.

9. **Health check** — `curl http://localhost:6745/health`. Confirm `{ "status": "ok", "connected": true }`.

### What Still Needs Human Testing

- **First-ever QR scan** — if `data/auth/` is empty, someone must scan the QR code
- **OTP delivery to phone** — the self-test reads the OTP from DB/logs, but verifying it actually arrives as a WhatsApp message on the phone requires a human
- **Dashboard UI interactions** — clicking through tabs, registering apps via the form, visual verification
