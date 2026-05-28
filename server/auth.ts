import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto'
import type { Request, Response, NextFunction, RequestHandler } from 'express'

// ── Password hashing (scrypt — no external deps) ─────────────────────────────

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64

export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [scheme, nStr, rStr, pStr, saltB64, keyB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    const candidate = scryptSync(plain, salt, expected.length, {
      N: parseInt(nStr, 10), r: parseInt(rStr, 10), p: parseInt(pStr, 10),
    })
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

// ── User list (parsed once from ENV) ─────────────────────────────────────────

interface AuthUser { email: string; hash: string }

let cachedUsers: AuthUser[] | null = null
function getUsers(): AuthUser[] {
  if (cachedUsers) return cachedUsers
  const raw = process.env.AUTH_USERS
  if (!raw) { cachedUsers = []; return cachedUsers }
  try {
    const parsed = JSON.parse(raw) as AuthUser[]
    cachedUsers = parsed.map((u) => ({ email: u.email.toLowerCase().trim(), hash: u.hash }))
    return cachedUsers
  } catch {
    console.error('AUTH_USERS env var is not valid JSON — auth disabled')
    cachedUsers = []
    return cachedUsers
  }
}

// ── Session token (HMAC-signed cookie, no JWT lib) ──────────────────────────

const SESSION_COOKIE = 'heron_session'
const SESSION_TTL_SEC = 60 * 60 * 24 * 7 // 7 days

function b64urlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function getSecret(): string | null {
  return process.env.AUTH_SECRET || null
}

function signToken(payload: { email: string; exp: number }): string {
  const secret = getSecret()
  if (!secret) throw new Error('AUTH_SECRET not set')
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = b64urlEncode(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

function verifyToken(token: string | undefined): { email: string } | null {
  if (!token) return null
  const secret = getSecret()
  if (!secret) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64urlEncode(createHmac('sha256', secret).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as { email: string; exp: number }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return { email: payload.email }
  } catch {
    return null
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(v.join('='))
  }
  return out
}

function buildCookie(value: string, maxAgeSec: number): string {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ]
  if (isProd) attrs.push('Secure')
  return attrs.join('; ')
}

// ── Public: is auth enabled? ─────────────────────────────────────────────────

export function isAuthEnabled(): boolean {
  return getUsers().length > 0 && !!getSecret()
}

// ── Middleware ───────────────────────────────────────────────────────────────

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!isAuthEnabled()) return next()
  const cookies = parseCookies(req.headers.cookie)
  const session = verifyToken(cookies[SESSION_COOKIE])
  if (!session) {
    res.status(401).json({ error: 'Nicht angemeldet' })
    return
  }
  ;(req as Request & { user?: { email: string } }).user = session
  next()
}

// ── Route handlers ───────────────────────────────────────────────────────────

export function handleLogin(req: Request, res: Response): void {
  if (!isAuthEnabled()) {
    res.status(503).json({ error: 'Auth nicht konfiguriert' })
    return
  }
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ error: 'E-Mail und Passwort erforderlich' })
    return
  }
  const normalized = email.toLowerCase().trim()
  const user = getUsers().find((u) => u.email === normalized)
  // Always run scrypt to avoid timing leak of which emails exist
  const dummy = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const ok = verifyPassword(password, user?.hash ?? dummy) && !!user
  if (!ok) {
    res.status(401).json({ error: 'Ungültige Anmeldedaten' })
    return
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC
  const token = signToken({ email: normalized, exp })
  res.setHeader('Set-Cookie', buildCookie(token, SESSION_TTL_SEC))
  res.json({ email: normalized })
}

export function handleLogout(_req: Request, res: Response): void {
  res.setHeader('Set-Cookie', buildCookie('', 0))
  res.json({ ok: true })
}

export function handleMe(req: Request, res: Response): void {
  if (!isAuthEnabled()) {
    res.json({ authEnabled: false })
    return
  }
  const cookies = parseCookies(req.headers.cookie)
  const session = verifyToken(cookies[SESSION_COOKIE])
  if (!session) {
    res.status(401).json({ authEnabled: true, error: 'Nicht angemeldet' })
    return
  }
  res.json({ authEnabled: true, email: session.email })
}

export function mountAuthRoutes(app: import('express').Express): void {
  app.post('/api/auth/login', handleLogin)
  app.post('/api/auth/logout', handleLogout)
  app.get('/api/auth/me', handleMe)
}
