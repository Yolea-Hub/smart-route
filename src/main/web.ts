import { WebContentsView, session, type BrowserWindow } from 'electron'
import { isAllowedNavigation, isPermissionAllowed, popupWebPreferences, isHttpsExternalUrl, VENDOR_HOME, VENDOR_PARTITION } from '../core/webPolicy'
import type { Vendor } from '../core/types'
import { clampSelection } from './webText'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Google refuses OAuth sign-in inside embedded app browsers. We do not disguise the panel: the sign-in navigation is
 * cancelled and the renderer tells the person to use e-mail sign-in or their usual browser.
 */
export function isGoogleSignInUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 'accounts.google.com'
  } catch {
    return false
  }
}

/** The few fields of an Electron `Input` the return shortcut looks at. */
export interface KeyInputLike {
  type: string
  key: string
  alt?: boolean
  meta?: boolean
}

/**
 * Accessibility (WCAG 2.1.2, no keyboard trap): a web panel is a separate page that keeps the keyboard once it has focus, so F6
 * (also Ctrl+F6 or Ctrl+Shift+F6) always brings the focus back to Smart Route. Alt or Meta with F6 are left to the page.
 */
export function isReturnShortcut(input: KeyInputLike): boolean {
  return input.type === 'keyDown' && input.key === 'F6' && input.alt !== true && input.meta !== true
}

/** Isolated world id used to read the user's text selection (never the page's own JS world). */
const SELECTION_WORLD = 1001

/**
 * Embedded vendor web panels (Cowork / claude.ai, ChatGPT, Gemini). Thin Electron wrapper:
 * every decision lives in core/webPolicy.ts. Panels are sandboxed, have no preload and no Node.
 */
export class WebPanels {
  private readonly views = new Map<Vendor, WebContentsView>()
  private visible: Vendor | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly openExternal: (url: string) => void,
    /** Called when a Google sign-in navigation was cancelled in a panel (main -> renderer `web:signinBlocked`). */
    private readonly onSigninBlocked: (vendor: Vendor) => void = () => undefined,
    /** Called when F6 took the keyboard out of a panel and back to the window (main -> renderer `web:focusReturned`). */
    private readonly onFocusReturned: (vendor: Vendor) => void = () => undefined
  ) {}

  private ensure(vendor: Vendor): WebContentsView {
    const existing = this.views.get(vendor)
    if (existing) return existing
    const partition = VENDOR_PARTITION[vendor]
    const ses = session.fromPartition(partition)
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isPermissionAllowed(permission)))
    ses.setPermissionCheckHandler((_wc, permission) => isPermissionAllowed(permission))

    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
        // no preload on purpose
      }
    })
    const wc = view.webContents
    const guard = (event: Electron.Event, url: string, popup?: BrowserWindow): void => {
      if (isGoogleSignInUrl(url)) {
        event.preventDefault()
        if (popup && !popup.isDestroyed()) popup.close()
        this.onSigninBlocked(vendor)
        return
      }
      if (isAllowedNavigation(vendor, url)) return
      event.preventDefault()
      if (isHttpsExternalUrl(url)) this.openExternal(url)
    }
    wc.setWindowOpenHandler(({ url }) => {
      if (isGoogleSignInUrl(url)) {
        this.onSigninBlocked(vendor)
        return { action: 'deny' }
      }
      if (isAllowedNavigation(vendor, url)) {
        // Sign-in pop-ups (OAuth) need window.opener: allow them, locked to the same partition.
        return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: popupWebPreferences(vendor) } }
      }
      if (isHttpsExternalUrl(url)) this.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('did-create-window', (child) => {
      const cwc = child.webContents
      cwc.setWindowOpenHandler(() => ({ action: 'deny' }))
      cwc.on('will-navigate', (e, url) => guard(e, url, child))
      cwc.on('will-redirect', (e, url) => guard(e, url, child))
    })
    wc.on('will-navigate', (e, url) => guard(e, url))
    wc.on('will-redirect', (e, url) => guard(e, url))
    // The way out of the panel for a keyboard user: the page never sees F6.
    wc.on('before-input-event', (event, input) => {
      if (!isReturnShortcut(input)) return
      event.preventDefault()
      this.returnFocus(vendor)
    })
    void wc.loadURL(VENDOR_HOME[vendor])
    this.views.set(vendor, view)
    return view
  }

  show(vendor: Vendor, bounds: Bounds): void {
    this.hide()
    const view = this.ensure(vendor)
    this.win.contentView.addChildView(view)
    view.setBounds(bounds)
    this.visible = vendor
  }

  /** Move the keyboard into the visible panel (the way in; F6 is the way out). */
  focus(vendor: Vendor): void {
    if (this.visible !== vendor) return
    this.views.get(vendor)?.webContents.focus()
  }

  /** Give the keyboard back to the application window and tell its page, which puts the focus on a control of its own. */
  returnFocus(vendor: Vendor): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.focus()
    this.onFocusReturned(vendor)
  }

  isVisible(vendor: Vendor): boolean {
    return this.visible === vendor
  }

  hide(): void {
    if (!this.visible) return
    const view = this.views.get(this.visible)
    if (view) this.win.contentView.removeChildView(view)
    this.visible = null
  }

  /** Focus the panel and type the brief at the cursor. The user reviews and presses send. */
  async insertBrief(vendor: Vendor, text: string): Promise<void> {
    const view = this.ensure(vendor)
    view.webContents.focus()
    await view.webContents.insertText(text)
  }

  /** Read only the user's current text selection, capped at 50 KB. */
  async captureSelection(vendor: Vendor): Promise<string> {
    const view = this.ensure(vendor)
    const raw: unknown = await view.webContents.executeJavaScriptInIsolatedWorld(SELECTION_WORLD, [
      { code: 'String(window.getSelection() ?? "")' }
    ])
    return clampSelection(raw)
  }

  destroy(): void {
    this.hide()
    for (const v of this.views.values()) v.webContents.close()
    this.views.clear()
  }
}
