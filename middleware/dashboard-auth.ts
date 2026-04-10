import type { Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import jwt from 'jsonwebtoken'
import type { WAAdapter } from '../core/adapter'

const OTP_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const JWT_EXPIRY = '1h'
const MAX_OTP_REQUESTS = 3
const OTP_RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5

interface OtpRecord {
  code: string
  expiresAt: number
  attempts: number
}

export class DashboardAuth {
  private jwtSecret: string
  private adapter: WAAdapter
  private appEnv: string
  private currentOtp: OtpRecord | null = null
  private otpRequestTimestamps: number[] = []

  constructor(jwtSecret: string, adapter: WAAdapter, appEnv: string) {
    this.jwtSecret = jwtSecret
    this.adapter = adapter
    this.appEnv = appEnv
  }

  // ─── Reusable OTP methods (used by dashboard + OAuth authorize) ────────────

  /** Generate and send OTP. Returns result without touching Express response. */
  async generateAndSendOtp(): Promise<{ ok: boolean; error?: string; status?: number }> {
    const now = Date.now()
    this.otpRequestTimestamps = this.otpRequestTimestamps.filter(t => now - t < OTP_RATE_WINDOW_MS)
    if (this.otpRequestTimestamps.length >= MAX_OTP_REQUESTS) {
      return { ok: false, error: 'Too many OTP requests. Try again in a few minutes.', status: 429 }
    }

    if (!this.adapter.isConnected()) {
      return { ok: false, error: 'WhatsApp is not connected. Use `npm run reconnect` to fix.', status: 503 }
    }

    const code = crypto.randomInt(100000, 999999).toString()
    this.currentOtp = { code, expiresAt: now + OTP_EXPIRY_MS, attempts: 0 }
    this.otpRequestTimestamps.push(now)

    const ownJid = (this.adapter as any).getOwnJid?.()
    if (!ownJid) {
      return { ok: false, error: 'Could not determine WhatsApp number. Try reconnecting.', status: 503 }
    }

    try {
      await this.adapter.sendMessage(ownJid, `Your WA Companion login code: ${code}\n\nThis code expires in 5 minutes.`)
      console.log(`[auth] OTP sent to ${ownJid}`)
      return { ok: true }
    } catch (err) {
      console.error('[auth] Failed to send OTP:', err)
      return { ok: false, error: 'Failed to send OTP', status: 500 }
    }
  }

  /** Verify an OTP code. Returns result without touching Express response. */
  verifyOtpCode(code: string): { valid: boolean; error?: string; status?: number; attemptsRemaining?: number } {
    if (!code) return { valid: false, error: 'Missing code', status: 400 }
    if (!this.currentOtp) return { valid: false, error: 'No OTP pending. Request one first.', status: 400 }

    if (Date.now() > this.currentOtp.expiresAt) {
      this.currentOtp = null
      return { valid: false, error: 'OTP expired. Request a new one.', status: 400 }
    }

    this.currentOtp.attempts++
    if (this.currentOtp.attempts > MAX_VERIFY_ATTEMPTS) {
      this.currentOtp = null
      return { valid: false, error: 'Too many attempts. Request a new OTP.', status: 429 }
    }

    if (code !== this.currentOtp.code) {
      return { valid: false, error: 'Invalid code', status: 401, attemptsRemaining: MAX_VERIFY_ATTEMPTS - this.currentOtp.attempts }
    }

    this.currentOtp = null
    return { valid: true }
  }

  // ─── Express route handlers (delegate to reusable methods) ─────────────────

  /** Send OTP to the connected WhatsApp number */
  async sendOtp(_req: Request, res: Response) {
    const result = await this.generateAndSendOtp()
    if (!result.ok) {
      res.status(result.status ?? 500).json({ error: result.error })
      return
    }
    res.json({ ok: true, message: 'OTP sent to your WhatsApp' })
  }

  /** Verify OTP and issue JWT */
  verifyOtp(req: Request, res: Response) {
    const result = this.verifyOtpCode(req.body.code)
    if (!result.valid) {
      res.status(result.status ?? 400).json({ error: result.error, attemptsRemaining: result.attemptsRemaining })
      return
    }

    const token = jwt.sign({ type: 'dashboard' }, this.jwtSecret, { expiresIn: JWT_EXPIRY })
    const isProduction = this.appEnv === 'prod' || this.appEnv === 'dev'
    res.cookie('wa_session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000,
    })
    res.json({ ok: true })
  }

  /** Check if the current session is valid */
  checkSession(req: Request, res: Response) {
    const token = req.cookies?.wa_session
    if (!token) {
      res.json({ authenticated: false })
      return
    }

    try {
      jwt.verify(token, this.jwtSecret)
      res.json({ authenticated: true })
    } catch {
      res.json({ authenticated: false })
    }
  }

  /** Middleware — verify JWT on every dashboard request */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Allow auth endpoints through without checking
      if (req.path.startsWith('/auth/')) {
        next()
        return
      }

      const token = req.cookies?.wa_session
      if (!token) {
        res.status(401).json({ error: 'Not authenticated' })
        return
      }

      try {
        jwt.verify(token, this.jwtSecret)
        next()
      } catch {
        res.status(401).json({ error: 'Session expired. Please log in again.' })
      }
    }
  }
}
