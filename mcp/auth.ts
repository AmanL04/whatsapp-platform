import * as crypto from 'crypto'
import type { Response } from 'express'
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type Database from 'better-sqlite3'
import type { DashboardAuth } from '../middleware/dashboard-auth'

const AUTH_CODE_EXPIRY_S = 5 * 60        // 5 minutes
const ACCESS_TOKEN_EXPIRY_S = 60 * 60    // 1 hour
const REFRESH_TOKEN_EXPIRY_S = 30 * 24 * 60 * 60 // 30 days

// ─── Client Store ───────────────────────────────────────────────────────────

class SqliteClientStore implements OAuthRegisteredClientsStore {
  constructor(private db: Database.Database) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_clients WHERE client_id = ?').get(clientId) as any
    if (!row) return undefined
    return {
      client_id: row.client_id,
      client_secret: row.client_secret,
      client_id_issued_at: row.client_id_issued_at,
      client_secret_expires_at: row.client_secret_expires_at ?? 0,
      ...JSON.parse(row.metadata || '{}'),
    }
  }

  registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): OAuthClientInformationFull {
    const clientId = crypto.randomUUID()
    const clientSecret = crypto.randomBytes(32).toString('hex')
    const now = Math.floor(Date.now() / 1000)

    // Strip client_id from metadata to avoid collision with our generated ID
    const { client_id: _discardId, client_id_issued_at: _discardIssuedAt, redirect_uris, client_name, client_uri, grant_types, response_types, token_endpoint_auth_method, scope, ...rest } = client as any
    const metadata = JSON.stringify({ redirect_uris, client_name, client_uri, grant_types, response_types, token_endpoint_auth_method, scope, ...rest })

    this.db.prepare(
      'INSERT INTO mcp_clients (client_id, client_secret, client_id_issued_at, client_secret_expires_at, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(clientId, clientSecret, now, 0, metadata)

    return {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: now,
      client_secret_expires_at: 0,
      ...JSON.parse(metadata),
    }
  }
}

// ─── OAuth Provider ─────────────────────────────────────────────────────────

export class WhatsAppOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore
  private db: Database.Database
  private dashboardAuth: DashboardAuth

  constructor(db: Database.Database, dashboardAuth: DashboardAuth) {
    this.db = db
    this.clientsStore = new SqliteClientStore(db)
    this.dashboardAuth = dashboardAuth
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    // Store pending auth request so the callback can find it
    const requestId = crypto.randomBytes(16).toString('hex')
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(
      'INSERT INTO mcp_auth_codes (code, client_id, code_challenge, redirect_uri, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(requestId, client.client_id, params.codeChallenge, params.redirectUri, JSON.stringify(params.scopes ?? []), now, now + AUTH_CODE_EXPIRY_S)

    // Serve the authorization page
    const html = this.renderAuthorizePage(requestId, client.client_name ?? client.client_id, params.state)
    res.type('html').send(html)
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = this.db.prepare('SELECT code_challenge FROM mcp_auth_codes WHERE code = ?').get(authorizationCode) as { code_challenge: string } | undefined
    if (!row) throw new Error('Invalid authorization code')
    return row.code_challenge
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const row = this.db.prepare('SELECT * FROM mcp_auth_codes WHERE code = ?').get(authorizationCode) as any
    if (!row) throw new Error('Invalid authorization code')

    const now = Math.floor(Date.now() / 1000)
    if (now > row.expires_at) {
      this.db.prepare('DELETE FROM mcp_auth_codes WHERE code = ?').run(authorizationCode)
      throw new Error('Authorization code expired')
    }
    if (row.client_id !== client.client_id) throw new Error('Client mismatch')
    if (redirectUri && row.redirect_uri !== redirectUri) throw new Error('Redirect URI mismatch')

    // Delete used code
    this.db.prepare('DELETE FROM mcp_auth_codes WHERE code = ?').run(authorizationCode)

    // Generate tokens
    const accessToken = crypto.randomBytes(32).toString('hex')
    const refreshToken = crypto.randomBytes(32).toString('hex')

    this.db.prepare(
      'INSERT INTO mcp_tokens (token, client_id, scopes, created_at, expires_at, refresh_token) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(accessToken, client.client_id, row.scopes, now, now + ACCESS_TOKEN_EXPIRY_S, refreshToken)

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_EXPIRY_S,
      refresh_token: refreshToken,
      scope: JSON.parse(row.scopes || '[]').join(' '),
    }
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    const row = this.db.prepare('SELECT * FROM mcp_tokens WHERE refresh_token = ?').get(refreshToken) as any
    if (!row) throw new Error('Invalid refresh token')
    if (row.client_id !== client.client_id) throw new Error('Client mismatch')

    const now = Math.floor(Date.now() / 1000)

    // Check refresh token isn't too old (30 days from original creation)
    if (now > row.created_at + REFRESH_TOKEN_EXPIRY_S) {
      this.db.prepare('DELETE FROM mcp_tokens WHERE refresh_token = ?').run(refreshToken)
      throw new Error('Refresh token expired')
    }

    // Delete old token
    this.db.prepare('DELETE FROM mcp_tokens WHERE token = ?').run(row.token)

    // Issue new tokens
    const newAccessToken = crypto.randomBytes(32).toString('hex')
    const newRefreshToken = crypto.randomBytes(32).toString('hex')
    const tokenScopes = scopes ? JSON.stringify(scopes) : row.scopes

    this.db.prepare(
      'INSERT INTO mcp_tokens (token, client_id, scopes, created_at, expires_at, refresh_token) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newAccessToken, client.client_id, tokenScopes, now, now + ACCESS_TOKEN_EXPIRY_S, newRefreshToken)

    return {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_EXPIRY_S,
      refresh_token: newRefreshToken,
      scope: JSON.parse(tokenScopes || '[]').join(' '),
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db.prepare('SELECT * FROM mcp_tokens WHERE token = ?').get(token) as any
    if (!row) throw new Error('Invalid token')

    const now = Math.floor(Date.now() / 1000)
    if (now > row.expires_at) {
      this.db.prepare('DELETE FROM mcp_tokens WHERE token = ?').run(token)
      throw new Error('Token expired')
    }

    return {
      token,
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes || '[]'),
      expiresAt: row.expires_at,
    }
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.db.prepare('DELETE FROM mcp_tokens WHERE token = ? OR refresh_token = ?').run(request.token, request.token)
  }

  // ─── OTP authorize page + callback ──────────────────────────────────────

  /** Handle OTP send request from authorize page */
  async handleAuthSendOtp(): Promise<{ ok: boolean; error?: string }> {
    return this.dashboardAuth.generateAndSendOtp()
  }

  /** Handle OTP verify + generate auth code */
  handleAuthVerifyOtp(code: string, requestId: string, state?: string): { redirect?: string; error?: string } {
    const result = this.dashboardAuth.verifyOtpCode(code)
    if (!result.valid) return { error: result.error }

    // Look up the pending auth request
    const row = this.db.prepare('SELECT * FROM mcp_auth_codes WHERE code = ?').get(requestId) as any
    if (!row) return { error: 'Authorization request not found or expired' }

    const now = Math.floor(Date.now() / 1000)
    if (now > row.expires_at) return { error: 'Authorization request expired' }

    // Generate a new auth code (replace the requestId placeholder)
    const authCode = crypto.randomBytes(32).toString('hex')
    this.db.prepare(
      'UPDATE mcp_auth_codes SET code = ? WHERE code = ?'
    ).run(authCode, requestId)

    // Build redirect URL
    const redirectUrl = new URL(row.redirect_uri)
    redirectUrl.searchParams.set('code', authCode)
    if (state) redirectUrl.searchParams.set('state', state)

    return { redirect: redirectUrl.toString() }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  private renderAuthorizePage(requestId: string, clientName: string, state?: string): string {
    const safeClientName = this.escapeHtml(clientName)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize — WA Companion</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Space Grotesk', system-ui, sans-serif; background: #FAF8F5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 2px solid #1A1816; border-radius: 16px; padding: 40px; max-width: 400px; width: 100%; box-shadow: 4px 4px 0 #1A1816; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 8px; }
    .client { font-size: 14px; color: #6B6560; margin-bottom: 24px; }
    input { width: 100%; padding: 12px 16px; border: 2px solid #1A1816; border-radius: 8px; font-size: 16px; font-family: inherit; margin-bottom: 12px; }
    button { width: 100%; padding: 12px; border: 2px solid #1A1816; border-radius: 8px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; }
    .btn-primary { background: #F59E0B; color: #fff; }
    .btn-primary:hover { background: #D97706; }
    .btn-secondary { background: #fff; color: #1A1816; margin-bottom: 12px; }
    .btn-secondary:hover { background: #F0ECE6; }
    .status { font-size: 13px; color: #6B6560; margin-top: 12px; min-height: 20px; }
    .error { color: #DC2626; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to WA Companion</h1>
    <p class="client"><strong>${safeClientName}</strong> wants to access your WhatsApp data.</p>

    <div id="step-otp">
      <button class="btn-primary" onclick="sendOtp()">Send OTP to WhatsApp</button>
      <div id="otp-status" class="status"></div>
    </div>

    <div id="step-verify" class="hidden">
      <input id="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code" autocomplete="one-time-code" />
      <button class="btn-primary" onclick="verifyOtp()">Verify & Authorize</button>
      <button class="btn-secondary" onclick="sendOtp()">Resend OTP</button>
      <div id="verify-status" class="status"></div>
    </div>
  </div>

  <script>
    const REQUEST_ID = '${requestId}';
    const STATE = ${state ? `'${state}'` : 'null'};

    async function sendOtp() {
      document.getElementById('otp-status').textContent = 'Sending...';
      try {
        const r = await fetch('/auth/mcp/send-otp', { method: 'POST' });
        const data = await r.json();
        if (data.ok) {
          document.getElementById('step-otp').classList.add('hidden');
          document.getElementById('step-verify').classList.remove('hidden');
          document.getElementById('otp-input').focus();
        } else {
          document.getElementById('otp-status').textContent = data.error || 'Failed';
          document.getElementById('otp-status').classList.add('error');
        }
      } catch (e) {
        document.getElementById('otp-status').textContent = 'Network error';
        document.getElementById('otp-status').classList.add('error');
      }
    }

    async function verifyOtp() {
      const code = document.getElementById('otp-input').value.trim();
      if (!code) return;
      document.getElementById('verify-status').textContent = 'Verifying...';
      try {
        const r = await fetch('/auth/mcp/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, requestId: REQUEST_ID, state: STATE }),
        });
        const data = await r.json();
        if (data.redirect) {
          window.location.href = data.redirect;
        } else {
          document.getElementById('verify-status').textContent = data.error || 'Verification failed';
          document.getElementById('verify-status').classList.add('error');
        }
      } catch (e) {
        document.getElementById('verify-status').textContent = 'Network error';
        document.getElementById('verify-status').classList.add('error');
      }
    }

    document.getElementById('otp-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyOtp();
    });
  </script>
</body>
</html>`
  }
}
