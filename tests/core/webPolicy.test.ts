import { describe, expect, it } from 'vitest'
import { isAllowedNavigation, isPermissionAllowed, isSafeExternalUrl, popupWebPreferences } from '../../src/core/webPolicy'

describe('web allow-list', () => {
  it('accepts vendor and sign-in domains', () => {
    expect(isAllowedNavigation('anthropic', 'https://claude.ai/new')).toBe(true)
    expect(isAllowedNavigation('anthropic', 'https://console.anthropic.com/x')).toBe(true)
    expect(isAllowedNavigation('openai', 'https://chatgpt.com/')).toBe(true)
    expect(isAllowedNavigation('openai', 'https://auth.openai.com/log-in')).toBe(true)
    expect(isAllowedNavigation('google', 'https://gemini.google.com/app')).toBe(true)
    expect(isAllowedNavigation('google', 'https://accounts.google.com/signin')).toBe(true)
  })

  it('rejects other domains, lookalikes, other vendors, non-https and credentials in URL', () => {
    expect(isAllowedNavigation('anthropic', 'https://evil.com')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'https://claude.ai.evil.com')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'https://notclaude.ai')).toBe(false)
    expect(isAllowedNavigation('openai', 'https://claude.ai')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'http://claude.ai')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'https://claude.ai@evil.com')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'https://user:pw@claude.ai')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'file:///etc/passwd')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'javascript:alert(1)')).toBe(false)
    expect(isAllowedNavigation('anthropic', 'not a url')).toBe(false)
  })

  it('identity providers: Google for Claude/ChatGPT; Apple and Microsoft for ChatGPT only', () => {
    expect(isAllowedNavigation('anthropic', 'https://accounts.google.com/o/oauth2/auth')).toBe(false)
    expect(isAllowedNavigation('openai', 'https://accounts.google.com/o/oauth2/auth')).toBe(false)
    for (const u of ['https://appleid.apple.com/auth', 'https://login.microsoftonline.com/common', 'https://login.live.com/oauth20']) {
      expect(isAllowedNavigation('openai', u)).toBe(true)
      expect(isAllowedNavigation('anthropic', u)).toBe(false)
      expect(isAllowedNavigation('google', u)).toBe(false)
    }
  })

  it('google is narrowed to Gemini and the Google account host', () => {
    expect(isAllowedNavigation('google', 'https://www.google.com/search?q=x')).toBe(false)
    expect(isAllowedNavigation('google', 'https://drive.google.com')).toBe(false)
    expect(isAllowedNavigation('google', 'https://accounts.google.com/signin')).toBe(true)
    expect(isAllowedNavigation('google', 'https://gemini.google.com/app')).toBe(true)
  })

  it('sign-in pop-ups keep the vendor partition, sandbox and no preload', () => {
    for (const v of ['anthropic', 'openai', 'google'] as const) {
      const p = popupWebPreferences(v)
      expect(p).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
      expect(p.partition).toMatch(/^persist:/)
      expect('preload' in p).toBe(false)
    }
    expect(popupWebPreferences('anthropic').partition).toBe('persist:claude')
  })

  it('only http(s) may be opened in the system browser', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('denies every permission request', () => {
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read']) expect(isPermissionAllowed(p)).toBe(false)
  })
})
