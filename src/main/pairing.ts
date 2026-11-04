import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Crockford base32: no I, L, O, U. 8 characters = 40 bits. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 8
export const CODE_TTL_MS = 5 * 60_000
/** Failed code attempts after which the current code is cancelled. */
export const MAX_CODE_FAILURES = 10
/** Global attempts allowed per window. */
export const RATE_LIMIT = 5
export const RATE_WINDOW_MS = 60_000
export const SESSION_IDLE_MS = 12 * 3_600_000

export type AuthFailure = 'rate' | 'bad' | 'expired' | 'session'
export type AuthResult =
  | { ok: true; kind: 'code'; token: string; tokenHash: string }
  | { ok: true; kind: 'token'; tokenHash: string }
  | { ok: false; reason: AuthFailure }

export interface PairingOptions {
  now?: () => number
  /** Source of random bytes (tests). */
  random?: (n: number) => Buffer
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/** Uppercase, drop spaces and hyphens, read O as 0 and I or L as 1 (Crockford). Null when the result is not 8 valid characters. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== CODE_LENGTH) return null
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null
  return s
}

/** Display form: `ABCD-EFGH`. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

interface Session {
  hash: Buffer
  hashHex: string
  lastSeen: number
}

/**
 * Pairing code, token and session logic, pure: no sockets, no timers. The code is valid once, for 5 minutes. A valid code
 * returns a random 256-bit token; only its SHA-256 is kept. Sessions live in memory (a restart means pairing again) and
 * expire after 12 h without use.
 */
export class PairingManager {
  private readonly now: () => number
  private readonly random: (n: number) => Buffer
  private code: { value: string; expiresAt: number } | null = null
  private failures = 0
  private attempts: number[] = []
  private sessions = new Map<string, Session>()

  constructor(opts: PairingOptions = {}) {
    this.now = opts.now ?? Date.now
    this.random = opts.random ?? randomBytes
  }

  /** A fresh code replaces the previous one and resets its failure count. */
  newCode(): { code: string; expiresAt: number } {
    const bytes = this.random(5)
    let n = 0n
    for (const b of bytes) n = (n << 8n) | BigInt(b)
    let value = ''
    for (let i = 7; i >= 0; i--) value += CROCKFORD[Number((n >> BigInt(i * 5)) & 31n)]
    this.code = { value, expiresAt: this.now() + CODE_TTL_MS }
    this.failures = 0
    return { code: value, expiresAt: this.code.expiresAt }
  }

  /** The code that can still be used, or null (expired, cancelled, used). */
  currentCode(): { code: string; expiresAt: number } | null {
    if (!this.code) return null
    if (this.now() >= this.code.expiresAt) {
      this.code = null
      return null
    }
    return { code: this.code.value, expiresAt: this.code.expiresAt }
  }

  /** Records an attempt; false when more than RATE_LIMIT happened in the last RATE_WINDOW_MS. */
  private allowAttempt(): boolean {
    const t = this.now()
    this.attempts = this.attempts.filter((a) => t - a < RATE_WINDOW_MS)
    if (this.attempts.length >= RATE_LIMIT) return false
    this.attempts.push(t)
    return true
  }

  /**
   * Checks a pairing code. Every call counts toward the global rate limit. A wrong code counts as a failure; the
   * MAX_CODE_FAILURES-th cancels the code. A right code is used up.
   */
  redeemCode(input: string): AuthResult {
    if (!this.allowAttempt()) return { ok: false, reason: 'rate' }
    const current = this.currentCode()
    if (!current) return { ok: false, reason: 'expired' }
    const given = normalizeCode(input)
    const ok = given !== null && safeEqual(Buffer.from(given, 'utf8'), Buffer.from(current.code, 'utf8'))
    if (!ok) {
      this.failures++
      if (this.failures >= MAX_CODE_FAILURES) this.code = null
      return { ok: false, reason: 'bad' }
    }
    this.code = null
    this.failures = 0
    const token = this.random(32).toString('base64url')
    const hashHex = sha256Hex(token)
    this.sessions.set(hashHex, { hash: Buffer.from(hashHex, 'hex'), hashHex, lastSeen: this.now() })
    return { ok: true, kind: 'code', token, tokenHash: hashHex }
  }

  /**
   * Checks a token (a reconnecting browser). Unknown or idle-expired tokens fail with 'session'; failures count toward
   * the global rate limit, successes do not.
   */
  checkToken(token: string): AuthResult {
    const r = this.lookup(token)
    if (r.ok) return r
    if (!this.allowAttempt()) return { ok: false, reason: 'rate' }
    return r
  }

  private lookup(token: string): AuthResult {
    const given = Buffer.from(sha256Hex(token), 'hex')
    let found: Session | undefined
    for (const s of this.sessions.values()) if (safeEqual(s.hash, given)) found = s
    if (!found) return { ok: false, reason: 'session' }
    if (this.now() - found.lastSeen > SESSION_IDLE_MS) {
      this.sessions.delete(found.hashHex)
      return { ok: false, reason: 'session' }
    }
    found.lastSeen = this.now()
    return { ok: true, kind: 'token', tokenHash: found.hashHex }
  }

  /** Keeps a session alive and tells whether it still exists (false once revoked or idle for 12 h). */
  touch(tokenHash: string): boolean {
    const s = this.sessions.get(tokenHash)
    if (!s) return false
    if (this.now() - s.lastSeen > SESSION_IDLE_MS) {
      this.sessions.delete(tokenHash)
      return false
    }
    s.lastSeen = this.now()
    return true
  }

  /** Drops the sessions idle for more than 12 h; returns their hashes. */
  sweep(): string[] {
    const gone: string[] = []
    for (const [h, s] of this.sessions) {
      if (this.now() - s.lastSeen > SESSION_IDLE_MS) {
        this.sessions.delete(h)
        gone.push(h)
      }
    }
    return gone
  }

  sessionCount(): number {
    return this.sessions.size
  }

  /** Forgets every session and cancels the current code. */
  revokeAll(): void {
    this.sessions.clear()
    this.code = null
    this.failures = 0
  }
}
