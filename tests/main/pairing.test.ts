import { describe, expect, it } from 'vitest'
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  CROCKFORD,
  MAX_CODE_FAILURES,
  PairingManager,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SESSION_IDLE_MS,
  formatCode,
  normalizeCode,
  sha256Hex
} from '../../src/main/pairing'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

describe('pairing code', () => {
  it('is 8 Crockford base32 characters, 40 bits, different each time', () => {
    const pm = new PairingManager()
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const { code } = pm.newCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const ch of code) expect(CROCKFORD).toContain(ch)
      seen.add(code)
    }
    expect(seen.size).toBe(50)
    expect(CROCKFORD).toHaveLength(32)
    expect(CROCKFORD).not.toMatch(/[ILOU]/)
  })

  it('maps 5 random bytes to the 8 characters, 5 bits each (fixed bytes)', () => {
    const pm = new PairingManager({ random: () => Buffer.from([0, 0, 0, 0, 0]) })
    expect(pm.newCode().code).toBe('00000000')
    const pm2 = new PairingManager({ random: () => Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]) })
    expect(pm2.newCode().code).toBe('ZZZZZZZZ')
  })

  it('normalizes what a person types: case, spaces, hyphen, O/0 and I/L/1', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH')
    expect(normalizeCode(' ab cd ef gh ')).toBe('ABCDEFGH')
    expect(normalizeCode('0O1IL234')).toBe('00111234')
    expect(normalizeCode('ABCDEFG')).toBeNull()
    expect(normalizeCode('ABCDEFGHJ')).toBeNull()
    expect(normalizeCode('ABCDEFGU')).toBeNull()
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH')
  })

  it('is valid 5 minutes, then gone', () => {
    const c = clock()
    const pm = new PairingManager(c)
    const { code } = pm.newCode()
    c.advance(CODE_TTL_MS - 1)
    expect(pm.currentCode()?.code).toBe(code)
    c.advance(1)
    expect(pm.currentCode()).toBeNull()
    expect(pm.redeemCode(code)).toEqual({ ok: false, reason: 'expired' })
  })

  it('is used up by a good redeem, and the token is 256 bits, kept only as SHA-256', () => {
    const pm = new PairingManager()
    const { code } = pm.newCode()
    const r = pm.redeemCode(code.toLowerCase())
    expect(r.ok).toBe(true)
    if (!r.ok || r.kind !== 'code') throw new Error('expected a token')
    expect(Buffer.from(r.token, 'base64url')).toHaveLength(32)
    expect(r.tokenHash).toBe(sha256Hex(r.token))
    expect(r.tokenHash).not.toContain(r.token)
    expect(pm.currentCode()).toBeNull()
    expect(pm.redeemCode(code)).toEqual({ ok: false, reason: 'expired' })
    expect(pm.sessionCount()).toBe(1)
    expect(pm.checkToken(r.token)).toMatchObject({ ok: true, kind: 'token', tokenHash: r.tokenHash })
    expect(pm.checkToken(r.token + 'x')).toEqual({ ok: false, reason: 'session' })
  })
})

describe('failures and rate limit', () => {
  it('the 10th wrong code cancels the code, even the right one then fails', () => {
    const c = clock()
    const pm = new PairingManager(c)
    const { code } = pm.newCode()
    for (let i = 0; i < MAX_CODE_FAILURES; i++) {
      expect(pm.redeemCode('ZZZZZZZZ' === code ? 'YYYYYYYY' : 'ZZZZZZZZ')).toEqual({ ok: false, reason: 'bad' })
      if (i % RATE_LIMIT === RATE_LIMIT - 1) c.advance(RATE_WINDOW_MS) // stay under the rate limit (and inside the 5 minutes)
    }
    expect(pm.currentCode()).toBeNull()
    expect(pm.redeemCode(code)).toEqual({ ok: false, reason: 'expired' })
  })

  it('allows 5 attempts a minute for the whole app, the 6th is refused even with the right code', () => {
    const c = clock()
    const pm = new PairingManager(c)
    const { code } = pm.newCode()
    const wrong = code === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ'
    for (let i = 0; i < RATE_LIMIT; i++) expect(pm.redeemCode(wrong)).toEqual({ ok: false, reason: 'bad' })
    expect(pm.redeemCode(code)).toEqual({ ok: false, reason: 'rate' })
    c.advance(RATE_WINDOW_MS)
    expect(pm.redeemCode(code).ok).toBe(true)
  })

  it('a new code resets the failure count', () => {
    const c = clock()
    const pm = new PairingManager(c)
    pm.newCode()
    for (let i = 0; i < 9; i++) {
      pm.redeemCode('ZZZZZZZZ')
      if (i % RATE_LIMIT === RATE_LIMIT - 1) c.advance(RATE_WINDOW_MS)
    }
    c.advance(RATE_WINDOW_MS)
    const { code } = pm.newCode()
    expect(pm.redeemCode(code).ok).toBe(true)
  })
})

describe('sessions', () => {
  function paired(c = clock()) {
    const pm = new PairingManager(c)
    const r = pm.redeemCode(pm.newCode().code)
    if (!r.ok || r.kind !== 'code') throw new Error('pairing failed')
    return { pm, c, token: r.token, hash: r.tokenHash }
  }

  it('expires after 12 h without use, and use keeps it alive', () => {
    const { pm, c, token, hash } = paired()
    c.advance(SESSION_IDLE_MS - 1)
    expect(pm.touch(hash)).toBe(true)
    c.advance(SESSION_IDLE_MS - 1)
    expect(pm.touch(hash)).toBe(true)
    c.advance(SESSION_IDLE_MS + 1)
    expect(pm.checkToken(token)).toEqual({ ok: false, reason: 'session' })
    expect(pm.touch(hash)).toBe(false)
    expect(pm.sessionCount()).toBe(0)
  })

  it('sweep drops idle sessions', () => {
    const { pm, c, hash } = paired()
    c.advance(SESSION_IDLE_MS + 1)
    expect(pm.sweep()).toEqual([hash])
    expect(pm.sessionCount()).toBe(0)
  })

  it('revokeAll forgets every session and cancels the code', () => {
    const { pm, token } = paired()
    pm.newCode()
    pm.revokeAll()
    expect(pm.sessionCount()).toBe(0)
    expect(pm.currentCode()).toBeNull()
    expect(pm.checkToken(token)).toEqual({ ok: false, reason: 'session' })
  })

  it('failed token tries count toward the rate limit, good ones do not', () => {
    const { pm, c, token } = paired()
    c.advance(RATE_WINDOW_MS)
    for (let i = 0; i < 20; i++) expect(pm.checkToken(token).ok).toBe(true)
    for (let i = 0; i < RATE_LIMIT; i++) expect(pm.checkToken('nope')).toEqual({ ok: false, reason: 'session' })
    expect(pm.checkToken('nope')).toEqual({ ok: false, reason: 'rate' })
  })
})
