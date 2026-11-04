import type { Vendor } from './types'

/**
 * Domains each vendor panel may navigate to (vendor site + the identity providers it signs in with).
 * Subdomains included. Only top-level navigations and pop-ups are filtered here: sub-resources such as
 * ssl.gstatic.com load without a navigation, so they need no entry. Google is kept to Gemini + the
 * Google account host (no bare google.com). A Google sign-in is cancelled before this list is consulted
 * (isGoogleSignInUrl), so the other vendors do not list accounts.google.com.
 */
export const VENDOR_DOMAINS: Record<Vendor, readonly string[]> = {
  anthropic: ['claude.ai', 'anthropic.com'],
  openai: ['chatgpt.com', 'openai.com', 'appleid.apple.com', 'login.microsoftonline.com', 'login.live.com'],
  google: ['gemini.google.com', 'accounts.google.com']
}

export const VENDOR_PARTITION: Record<Vendor, string> = {
  anthropic: 'persist:claude',
  openai: 'persist:chatgpt',
  google: 'persist:gemini'
}

export const VENDOR_HOME: Record<Vendor, string> = {
  anthropic: 'https://claude.ai',
  openai: 'https://chatgpt.com',
  google: 'https://gemini.google.com'
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

/** True when `rawUrl` is https and its host belongs to the vendor's allow-list. */
export function isAllowedNavigation(vendor: Vendor, rawUrl: string): boolean {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  return VENDOR_DOMAINS[vendor].some((d) => hostMatches(host, d))
}

/** True when the URL may be handed to the system browser (http/https only). */
export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  } catch {
    return false
  }
}

/** True when a page shown in a vendor panel may hand the URL to the system browser: https only (no http, no other scheme). */
export function isHttpsExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

/** Web panels never get camera, microphone, notifications or any other permission. */
export function isPermissionAllowed(_permission: string): boolean {
  return false
}

/**
 * webPreferences forced on a sign-in pop-up opened by a vendor panel: same session partition,
 * sandboxed, no preload, no Node.
 */
export function popupWebPreferences(vendor: Vendor): {
  partition: string
  sandbox: true
  contextIsolation: true
  nodeIntegration: false
  webSecurity: true
} {
  return { partition: VENDOR_PARTITION[vendor], sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
}
