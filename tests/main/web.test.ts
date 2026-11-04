import { delimiter, join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ALLOWED_CHANNELS } from '../../src/core/channels'
import { VENDOR_HOME } from '../../src/core/webPolicy'
import { Store } from '../../src/main/store'
import { createIpcHandlers, type IpcContext } from '../../src/main/ipc'
import { BIN } from './helpers'

type Handler = (...args: never[]) => unknown
const created: FakeWc[] = []

class FakeWc {
  handlers = new Map<string, Handler[]>()
  openHandler: ((d: { url: string }) => { action: string }) | null = null
  loadURL = vi.fn(async () => undefined)
  close = vi.fn()
  focus = vi.fn()
  on(ev: string, fn: Handler): this {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn])
    return this
  }
  setWindowOpenHandler(fn: (d: { url: string }) => { action: string }): void {
    this.openHandler = fn
  }
  /** Fires a navigation event; returns whether preventDefault was called. */
  nav(ev: 'will-navigate' | 'will-redirect', url: string): boolean {
    const e = { prevented: false, preventDefault(): void { this.prevented = true } }
    for (const h of this.handlers.get(ev) ?? []) (h as (e: unknown, u: string) => void)(e, url)
    return e.prevented
  }
}

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
  WebContentsView: class {
    webContents = new FakeWc()
    constructor() {
      created.push(this.webContents)
    }
    setBounds(): void {}
  }
}))

const { WebPanels, isGoogleSignInUrl, isReturnShortcut } = await import('../../src/main/web')

function setup() {
  const win = { contentView: { addChildView() {}, removeChildView() {} } }
  const external: string[] = []
  const blocked: string[] = []
  const panels = new WebPanels(win as never, (u) => external.push(u), (v) => blocked.push(v))
  return { panels, external, blocked }
}

beforeEach(() => {
  created.length = 0
})

describe('Google sign-in in a panel', () => {
  it('isGoogleSignInUrl matches only https accounts.google.com', () => {
    expect(isGoogleSignInUrl('https://accounts.google.com/signin/oauth/legacy/consent')).toBe(true)
    expect(isGoogleSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(true)
    expect(isGoogleSignInUrl('https://gemini.google.com/app')).toBe(false)
    expect(isGoogleSignInUrl('https://accounts.google.com.evil.com/')).toBe(false)
    expect(isGoogleSignInUrl('http://accounts.google.com/')).toBe(false)
    expect(isGoogleSignInUrl('nonsense')).toBe(false)
  })

  it('cancels will-navigate and will-redirect to accounts.google.com and emits the event, for every vendor', () => {
    for (const vendor of ['anthropic', 'openai', 'google'] as const) {
      const { panels, external, blocked } = setup()
      panels.show(vendor, { x: 0, y: 0, width: 10, height: 10 })
      const wc = created[created.length - 1] as FakeWc
      expect(wc.nav('will-navigate', 'https://accounts.google.com/signin/oauth/legacy/consent')).toBe(true)
      expect(wc.nav('will-redirect', 'https://accounts.google.com/o/oauth2/auth')).toBe(true)
      expect(blocked).toEqual([vendor, vendor])
      expect(external).toEqual([]) // never pushed to the system browser by itself
    }
  })

  it('pop-up opening on Google is denied; a pop-up that navigates to Google is closed', () => {
    const { panels, blocked } = setup()
    panels.show('anthropic', { x: 0, y: 0, width: 10, height: 10 })
    const wc = created[0] as FakeWc
    expect(wc.openHandler?.({ url: 'https://accounts.google.com/o/oauth2/auth' })).toEqual({ action: 'deny' })
    expect(blocked).toEqual(['anthropic'])

    const child = { webContents: new FakeWc(), isDestroyed: () => false, close: vi.fn() }
    for (const h of wc.handlers.get('did-create-window') ?? []) (h as (c: unknown) => void)(child)
    expect(child.webContents.nav('will-redirect', 'https://accounts.google.com/signin')).toBe(true)
    expect(child.close).toHaveBeenCalledTimes(1)
    expect(blocked).toEqual(['anthropic', 'anthropic'])
  })

  it('a vendor page only sends https URLs to the system browser (no http, no other scheme)', () => {
    const { panels, external } = setup()
    panels.show('openai', { x: 0, y: 0, width: 10, height: 10 })
    const wc = created[created.length - 1] as FakeWc
    for (const u of ['http://example.org/', 'ftp://example.org/', 'mailto:a@b.c', 'file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@example.org/']) {
      expect(wc.nav('will-navigate', u), u).toBe(true)
      expect(wc.openHandler?.({ url: u })).toEqual({ action: 'deny' })
    }
    expect(external).toEqual([])
    wc.nav('will-navigate', 'https://example.org/ok')
    wc.openHandler?.({ url: 'https://example.org/popup' })
    expect(external).toEqual(['https://example.org/ok', 'https://example.org/popup'])
  })

  it('other vendors sign-in stays allowed: claude.ai e-mail login, auth.openai.com', () => {
    const a = setup()
    a.panels.show('anthropic', { x: 0, y: 0, width: 10, height: 10 })
    const wcA = created[0] as FakeWc
    expect(wcA.nav('will-navigate', 'https://claude.ai/login')).toBe(false)
    expect(wcA.openHandler?.({ url: 'https://claude.ai/login' })).toMatchObject({ action: 'allow' })
    const o = setup()
    o.panels.show('openai', { x: 0, y: 0, width: 10, height: 10 })
    const wcO = created[1] as FakeWc
    expect(wcO.nav('will-navigate', 'https://auth.openai.com/log-in')).toBe(false)
    expect(wcO.nav('will-redirect', 'https://chatgpt.com/api/auth/callback')).toBe(false)
    expect(a.blocked).toEqual([])
    expect(o.blocked).toEqual([])
    // unrelated hosts still go to the system browser, as before
    expect(wcO.nav('will-navigate', 'https://example.org/')).toBe(true)
    expect(o.external).toEqual(['https://example.org/'])
  })
})

describe('web:openInBrowser', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sr-web-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  function ctx(opened: string[]): IpcContext {
    const env = { PATH: `${BIN}${delimiter}${process.env.PATH}`, HOME: dir, NO_COLOR: '1' }
    return {
      store: new Store(join(dir, 'ud')),
      env,
      workRoot: join(dir, 'work'),
      pickFolder: async () => dir,
      openExternal: (u) => void opened.push(u),
      web: { show() {}, hide() {}, insertBrief: async () => undefined, captureSelection: async () => '', isVisible: () => true },
      sendRunEvent: () => undefined,
      sendAccountUpdate: () => undefined
    }
  }

  it('opens only the catalog URL of the vendor', async () => {
    const opened: string[] = []
    const { handlers } = createIpcHandlers(ctx(opened))
    await handlers['web:openInBrowser']({ vendor: 'anthropic' })
    await handlers['web:openInBrowser']({ vendor: 'openai' })
    await handlers['web:openInBrowser']({ vendor: 'google' })
    expect(opened).toEqual(['https://claude.ai', 'https://chatgpt.com', 'https://gemini.google.com'])
    expect(opened).toEqual([VENDOR_HOME.anthropic, VENDOR_HOME.openai, VENDOR_HOME.google])
  })

  it('rejects any renderer-supplied URL or unknown vendor (schema), and is not in the web bridge allow-list', async () => {
    const { IPC_SCHEMAS } = await import('../../src/core/schemas')
    const schema = IPC_SCHEMAS['web:openInBrowser']
    expect(schema.safeParse({ vendor: 'anthropic' }).success).toBe(true)
    expect(schema.safeParse({ vendor: 'evil', url: 'https://evil.com' }).success).toBe(false)
    expect(schema.safeParse({ url: 'https://evil.com' }).success).toBe(false)
    expect((WEB_ALLOWED_CHANNELS as readonly string[]).includes('web:openInBrowser')).toBe(false)
  })
})

describe('keyboard way out of a panel (WCAG 2.1.2)', () => {
  const input = (key: string, extra: Record<string, unknown> = {}) => ({ type: 'keyDown', key, ...extra })

  /** Fires before-input-event; returns whether the page was prevented from seeing the key. */
  function press(wc: FakeWc, i: ReturnType<typeof input>): boolean {
    const e = { prevented: false, preventDefault(): void { this.prevented = true } }
    for (const h of wc.handlers.get('before-input-event') ?? []) (h as (e: unknown, i: unknown) => void)(e, i)
    return e.prevented
  }

  it('isReturnShortcut: F6 key down, with or without Ctrl/Shift, but not with Alt or Meta, not on key up', () => {
    expect(isReturnShortcut(input('F6'))).toBe(true)
    expect(isReturnShortcut(input('F6', { control: true, shift: true }))).toBe(true)
    expect(isReturnShortcut(input('F6', { alt: true }))).toBe(false)
    expect(isReturnShortcut(input('F6', { meta: true }))).toBe(false)
    expect(isReturnShortcut({ type: 'keyUp', key: 'F6' })).toBe(false)
    expect(isReturnShortcut(input('F5'))).toBe(false)
    expect(isReturnShortcut(input('Tab'))).toBe(false)
  })

  it('F6 in a panel is kept from the page, focuses the window and tells the renderer which vendor', () => {
    for (const vendor of ['anthropic', 'openai', 'google'] as const) {
      const focus = vi.fn()
      const returned: string[] = []
      const win = { isDestroyed: () => false, webContents: { focus }, contentView: { addChildView() {}, removeChildView() {} } }
      const panels = new WebPanels(win as never, () => undefined, () => undefined, (v) => returned.push(v))
      panels.show(vendor, { x: 0, y: 0, width: 10, height: 10 })
      const wc = created[created.length - 1] as FakeWc
      expect(press(wc, input('F6'))).toBe(true)
      expect(focus).toHaveBeenCalledTimes(1)
      expect(returned).toEqual([vendor])
    }
  })

  it('every other key reaches the page untouched', () => {
    const focus = vi.fn()
    const win = { isDestroyed: () => false, webContents: { focus }, contentView: { addChildView() {}, removeChildView() {} } }
    const panels = new WebPanels(win as never, () => undefined, () => undefined, () => undefined)
    panels.show('openai', { x: 0, y: 0, width: 10, height: 10 })
    const wc = created[created.length - 1] as FakeWc
    for (const k of ['Tab', 'Escape', 'F5', 'F7', 'a']) expect(press(wc, input(k)), k).toBe(false)
    expect(press(wc, input('F6', { alt: true }))).toBe(false)
    expect(focus).not.toHaveBeenCalled()
  })

  it('does nothing when the window is already destroyed', () => {
    const focus = vi.fn()
    const returned: string[] = []
    const win = { isDestroyed: () => true, webContents: { focus }, contentView: { addChildView() {}, removeChildView() {} } }
    const panels = new WebPanels(win as never, () => undefined, () => undefined, (v) => returned.push(v))
    panels.show('anthropic', { x: 0, y: 0, width: 10, height: 10 })
    press(created[created.length - 1] as FakeWc, input('F6'))
    expect(focus).not.toHaveBeenCalled()
    expect(returned).toEqual([])
  })

  it('focus(vendor) moves the keyboard into the visible panel only', () => {
    const { panels } = setup()
    panels.show('anthropic', { x: 0, y: 0, width: 10, height: 10 })
    const wc = created[created.length - 1] as FakeWc
    panels.focus('openai')
    expect(wc.focus).not.toHaveBeenCalled()
    panels.focus('anthropic')
    expect(wc.focus).toHaveBeenCalledTimes(1)
  })

  it('web:focus is validated, refused when the panel is hidden, never offered to a browser socket', async () => {
    const { IPC_SCHEMAS } = await import('../../src/core/schemas')
    expect(IPC_SCHEMAS['web:focus'].safeParse({ vendor: 'google' }).success).toBe(true)
    expect(IPC_SCHEMAS['web:focus'].safeParse({ vendor: 'evil' }).success).toBe(false)
    expect((WEB_ALLOWED_CHANNELS as readonly string[]).includes('web:focus')).toBe(false)
    const dir = await mkdtemp(join(tmpdir(), 'sr-webf-'))
    try {
      const focused: string[] = []
      let visible = false
      const mk = (): IpcContext => ({
        store: new Store(join(dir, 'ud')),
        env: { PATH: `${BIN}${delimiter}${process.env.PATH}`, HOME: dir, NO_COLOR: '1' },
        workRoot: join(dir, 'work'),
        pickFolder: async () => dir,
        openExternal: () => undefined,
        web: { show() {}, hide() {}, insertBrief: async () => undefined, captureSelection: async () => '', isVisible: () => visible, focus: (v) => void focused.push(v) },
        sendRunEvent: () => undefined,
        sendAccountUpdate: () => undefined
      })
      const { handlers } = createIpcHandlers(mk())
      await expect(handlers['web:focus']({ vendor: 'anthropic' })).rejects.toThrow(/^err\./)
      visible = true
      await handlers['web:focus']({ vendor: 'anthropic' })
      expect(focused).toEqual(['anthropic'])
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})
