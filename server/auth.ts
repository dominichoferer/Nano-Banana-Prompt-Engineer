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

/**
 * In welchem Zustand ist die Anmeldung?
 *
 *  aktiv  — Benutzer und Geheimnis stehen, es wird geprüft.
 *  aus    — beides fehlt vollständig. Gewollt beim lokalen Entwickeln.
 *  kaputt — es wurde etwas gesetzt, aber es taugt nicht: kaputtes JSON, kein
 *           Array, leere Liste, Einträge ohne scrypt$-Hash, fehlendes Geheimnis.
 *
 * Der Unterschied zwischen „aus" und „kaputt" ist der Kern dieser Datei.
 * Vorher gab es ihn nicht: Ein Tippfehler in AUTH_USERS führte zu einer leeren
 * Benutzerliste, damit galt die Anmeldung als abgeschaltet, und requireAuth
 * liess **jede** Anfrage durch. Die Seite stand offen im Netz und jeder fremde
 * Aufruf ging auf das API-Kontingent — ohne eine einzige Fehlermeldung. Eine
 * falsch geschriebene Umgebungsvariable darf niemals die Tür öffnen.
 */
export type AuthLage = 'aktiv' | 'aus' | 'kaputt'

let cachedUsers: AuthUser[] | null = null
let usersKaputt = false
function getUsers(): AuthUser[] {
  if (cachedUsers) return cachedUsers
  const raw = process.env.AUTH_USERS?.trim()
  if (!raw) { cachedUsers = []; return cachedUsers }
  try {
    const parsed = JSON.parse(raw) as AuthUser[]
    if (!Array.isArray(parsed)) throw new Error('kein Array')
    const sauber = parsed
      .filter((u) => u && typeof u.email === 'string' && typeof u.hash === 'string' && u.hash.startsWith('scrypt$'))
      .map((u) => ({ email: u.email.toLowerCase().trim(), hash: u.hash }))
    if (sauber.length === 0) throw new Error('keine brauchbaren Einträge')
    cachedUsers = sauber
    return cachedUsers
  } catch (e) {
    // Gesetzt, aber unbrauchbar: als kaputt merken, NICHT als abgeschaltet.
    usersKaputt = true
    console.error('[auth] AUTH_USERS ist gesetzt, aber unbrauchbar '
      + `(${e instanceof Error ? e.message : 'Fehler'}) — Zugriff wird gesperrt`)
    cachedUsers = []
    return cachedUsers
  }
}

/** Läuft das hier auf Vercel? Dort ist eine offene Seite nie hinnehmbar. */
function istBetrieb(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
}

export function authLage(): AuthLage {
  const users = getUsers()
  const secret = getSecret()
  const etwasGesetzt = Boolean(process.env.AUTH_USERS?.trim()) || Boolean(secret)
  if (usersKaputt) return 'kaputt'
  if (users.length > 0 && !secret) {
    console.error('[auth] AUTH_USERS steht, aber AUTH_SECRET fehlt — Zugriff wird gesperrt')
    return 'kaputt'
  }
  if (users.length === 0 && etwasGesetzt) {
    console.error('[auth] Anmeldung halb konfiguriert — Zugriff wird gesperrt')
    return 'kaputt'
  }
  if (users.length === 0) return 'aus'
  // Kurzes Geheimnis ist ein Mangel, aber kein Grund zur Aussperrung mitten im
  // Betrieb — deshalb laut warnen statt sperren.
  if (secret && secret.length < 32) {
    console.warn(`[auth] AUTH_SECRET ist nur ${secret.length} Zeichen lang — mindestens 32 empfohlen`)
  }
  return 'aktiv'
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
    if (!k) continue
    const roh = v.join('=')
    // decodeURIComponent wirft bei ungültigen Prozentzeichen ("%E0%A4%A").
    // Ungefangen wurde daraus ein 500er, den jeder Fremde mit einem einzigen
    // Kopfzeilenwert auslösen konnte. Ein unlesbares Cookie ist einfach keines.
    try {
      out[k] = decodeURIComponent(roh)
    } catch {
      out[k] = roh
    }
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
  return authLage() === 'aktiv'
}

// ── Middleware ───────────────────────────────────────────────────────────────

export const requireAuth: RequestHandler = (req, res, next) => {
  const lage = authLage()

  // Halb oder falsch konfiguriert: zu. Immer, überall. Lieber eine Seite, die
  // nicht funktioniert, als eine, die offen im Netz steht und fremde Aufrufe
  // auf das API-Kontingent bucht.
  if (lage === 'kaputt') {
    res.status(503).json({
      error: 'Anmeldung ist fehlerhaft konfiguriert. Der Zugriff bleibt gesperrt, '
        + 'bis AUTH_USERS und AUTH_SECRET stimmen.',
    })
    return
  }

  // Gar nicht konfiguriert: lokal beim Entwickeln in Ordnung, im Betrieb nie.
  if (lage === 'aus') {
    if (istBetrieb()) {
      console.error('[auth] Kein AUTH_USERS/AUTH_SECRET im Betrieb — Zugriff gesperrt')
      res.status(503).json({
        error: 'Anmeldung ist nicht eingerichtet. Der Zugriff bleibt gesperrt, bis '
          + 'AUTH_USERS und AUTH_SECRET gesetzt sind.',
      })
      return
    }
    return next()
  }

  const cookies = parseCookies(req.headers.cookie)
  const session = verifyToken(cookies[SESSION_COOKIE])
  if (!session) {
    res.status(401).json({ error: 'Nicht angemeldet' })
    return
  }
  ;(req as Request & { user?: { email: string } }).user = session
  next()
}

// ── Bremse gegen das Durchprobieren von Passwörtern ──────────────────────────
//
// scrypt kostet rund 100 ms je Versuch, das allein bremst nur den Einzelnen.
// Wer parallel anfragt, probiert trotzdem Tausende Passwörter — und jeder
// Versuch kostet Rechenzeit auf der Function.
//
// Grenze dieser Lösung, damit sie niemand überschätzt: Der Zähler lebt im
// Arbeitsspeicher der jeweiligen Instanz. Vercel startet mehrere davon, und
// jede kalte Instanz beginnt bei null. Das ist eine Bremse, keine Mauer. Wer
// es wirklich dicht braucht, hängt einen gemeinsamen Speicher (KV, Redis) oder
// Vercel Firewall davor.
// Zwei Grenzen, mit Absicht verschieden hoch:
//   Herkunft  — eng. Wer von einer Adresse achtmal danebenliegt, wartet.
//   Konto     — weit. Sonst könnte ein Fremder dich aussperren, indem er
//               einfach dauernd falsche Passwörter zu deiner Adresse schickt.
//               Die Kontogrenze soll nur verteiltes Durchprobieren stoppen,
//               nicht als Waffe gegen den rechtmässigen Nutzer taugen.
const VERSUCHE_MAX_HERKUNFT = 8
const VERSUCHE_MAX_KONTO = 40
const VERSUCHE_FENSTER_MS = 15 * 60 * 1000
const versuche = new Map<string, { anzahl: number; bis: number }>()

function herkunft(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  const roh = Array.isArray(fwd) ? fwd[0] : fwd
  return (roh?.split(',')[0].trim()) || req.socket?.remoteAddress || 'unbekannt'
}

function gesperrt(schluessel: string): number {
  const e = versuche.get(schluessel)
  if (!e) return 0
  if (Date.now() > e.bis) { versuche.delete(schluessel); return 0 }
  const grenze = schluessel.startsWith('ip:') ? VERSUCHE_MAX_HERKUNFT : VERSUCHE_MAX_KONTO
  return e.anzahl >= grenze ? Math.ceil((e.bis - Date.now()) / 1000) : 0
}

function merkeFehlversuch(schluessel: string): void {
  const jetzt = Date.now()
  const e = versuche.get(schluessel)
  if (!e || jetzt > e.bis) {
    versuche.set(schluessel, { anzahl: 1, bis: jetzt + VERSUCHE_FENSTER_MS })
  } else {
    e.anzahl++
    e.bis = jetzt + VERSUCHE_FENSTER_MS
  }
  // Die Karte darf nicht unbegrenzt wachsen.
  if (versuche.size > 5000) {
    for (const [k, v] of versuche) if (jetzt > v.bis) versuche.delete(k)
  }
}

// ── Route handlers ───────────────────────────────────────────────────────────

export function handleLogin(req: Request, res: Response): void {
  if (!isAuthEnabled()) {
    res.status(503).json({
      error: authLage() === 'kaputt'
        ? 'Anmeldung ist fehlerhaft konfiguriert — bitte AUTH_USERS und AUTH_SECRET prüfen.'
        : 'Auth nicht konfiguriert',
    })
    return
  }
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ error: 'E-Mail und Passwort erforderlich' })
    return
  }
  const normalized = email.toLowerCase().trim()

  // Nach Herkunft UND nach Benutzername bremsen: Ersteres hält einen einzelnen
  // Angreifer auf, Letzteres schützt ein bestimmtes Konto auch dann, wenn die
  // Versuche aus vielen Richtungen kommen.
  const schluessel = [`ip:${herkunft(req)}`, `user:${normalized}`]
  for (const k of schluessel) {
    const rest = gesperrt(k)
    if (rest > 0) {
      res.status(429)
        .setHeader('Retry-After', String(rest))
        .json({ error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(rest / 60)} Minuten erneut versuchen.` })
      return
    }
  }

  const user = getUsers().find((u) => u.email === normalized)
  // Always run scrypt to avoid timing leak of which emails exist
  const dummy = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const ok = verifyPassword(password, user?.hash ?? dummy) && !!user
  if (!ok) {
    for (const k of schluessel) merkeFehlversuch(k)
    console.warn(`[auth] Fehlversuch für "${normalized}" von ${herkunft(req)}`)
    res.status(401).json({ error: 'Ungültige Anmeldedaten' })
    return
  }
  // Nach erfolgreicher Anmeldung ist die Bremse für dieses Konto gelöst.
  for (const k of schluessel) versuche.delete(k)
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
  if (authLage() === 'kaputt') {
    res.status(503).json({ authEnabled: true, error: 'Anmeldung ist fehlerhaft konfiguriert' })
    return
  }
  if (!isAuthEnabled()) {
    // Im Betrieb ist eine abgeschaltete Anmeldung selbst der Fehler.
    if (istBetrieb()) {
      res.status(503).json({ authEnabled: true, error: 'Anmeldung ist nicht eingerichtet' })
      return
    }
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
