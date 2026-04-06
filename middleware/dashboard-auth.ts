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

  /** Send OTP to the connected WhatsApp number */
  async sendOtp(_req: Request, res: Response) {
    // Rate limit OTP requests
    const now = Date.now()
    this.otpRequestTimestamps = this.otpRequestTimestamps.filter(t => now - t < OTP_RATE_WINDOW_MS)
    if (this.otpRequestTimestamps.length >= MAX_OTP_REQUESTS) {
      res.status(429).json({ error: 'Too many OTP requests. Try again in a few minutes.' })
      return
    }

    // Check if adapter is connected
    if (!this.adapter.isConnected()) {
      res.status(503).json({ error: 'WhatsApp is not connected. Use `npm run reconnect` to fix.' })
      return
    }

    // Generate 6-digit OTP
    const code = crypto.randomInt(100000, 999999).toString()
    this.currentOtp = {
      code,
      expiresAt: now + OTP_EXPIRY_MS,
      attempts: 0,
    }
    this.otpRequestTimestamps.push(now)

    // Get own JID and send OTP
    const ownJid = (this.adapter as any).getOwnJid?.()
    if (!ownJid) {
      res.status(503).json({ error: 'Could not determine WhatsApp number. Try reconnecting.' })
      return
    }

    try {
      await this.adapter.sendMessage(ownJid, `Your WA Companion dashboard login code: ${code}\n\nThis code expires in 5 minutes.`)
      console.log(`[auth] OTP sent to ${ownJid}`)
      res.json({ ok: true, message: 'OTP sent to your WhatsApp' })
    } catch (err) {
      console.error('[auth] Failed to send OTP:', err)
      res.status(500).json({ error: 'Failed to send OTP' })
    }
  }

  /** Verify OTP and issue JWT */
  verifyOtp(req: Request, res: Response) {
    const { code } = req.body
    if (!code) {
      res.status(400).json({ error: 'Missing code' })
      return
    }

    if (!this.currentOtp) {
      res.status(400).json({ error: 'No OTP pending. Request one first.' })
      return
    }

    // Check expiry
    if (Date.now() > this.currentOtp.expiresAt) {
      this.currentOtp = null
      res.status(400).json({ error: 'OTP expired. Request a new one.' })
      return
    }

    // Check attempts
    this.currentOtp.attempts++
    if (this.currentOtp.attempts > MAX_VERIFY_ATTEMPTS) {
      this.currentOtp = null
      res.status(429).json({ error: 'Too many attempts. Request a new OTP.' })
      return
    }

    // Verify code
    if (code !== this.currentOtp.code) {
      res.status(401).json({ error: 'Invalid code', attemptsRemaining: MAX_VERIFY_ATTEMPTS - this.currentOtp.attempts })
      return
    }

    // Success — clear OTP and issue JWT
    this.currentOtp = null
    const token = jwt.sign({ type: 'dashboard' }, this.jwtSecret, { expiresIn: JWT_EXPIRY })

    const isProduction = this.appEnv === 'prod' || this.appEnv === 'dev'
    res.cookie('wa_session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000, // 1 hour
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
