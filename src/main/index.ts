import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSafeExternalUrl } from '../core/webPolicy'
import { Broadcaster } from './broadcaster'
import { createBridge, defaultWebRoot, type BridgeControl } from './bridge'
import { buildChildEnv } from './env'
import { registerIpc } from './ipc'
import { killAllLiveGroups } from './runner'
import { shutdownRuns, type ShutdownDeps } from './shutdown'
import { Store } from './store'
import { WebPanels } from './web'

const SMOKE = process.env['SMART_ROUTE_SMOKE'] === '1'
const SMOKE_TIMEOUT_MS = 60_000
const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const RENDERER_FILE = join(__dirname, '../renderer/index.html')
const APP_ORIGIN_PREFIX = DEV_URL ?? pathToFileURL(RENDERER_FILE).href

const CSP_PROD = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
// Vite's dev server needs inline scripts (React refresh) and a websocket.
const CSP_DEV = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*"

let mainWindow: BrowserWindow | null = null
let panels: WebPanels | null = null
let shutdownDeps: Pick<ShutdownDeps, 'activeRuns' | 'abortAll' | 'whenIdle'> | null = null
let quitting = false
let bridge: (BridgeControl & { port(): number | null }) | null = null

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return mainWindow !== null && event.sender === mainWindow.webContents && url.startsWith(APP_ORIGIN_PREFIX)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Smart Route',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  win.once('ready-to-show', () => {
    if (!SMOKE) win.show()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN_PREFIX)) event.preventDefault()
  })
  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(RENDERER_FILE)
  return win
}

// Release smoke test: loads the renderer exactly like production in a hidden window and checks it rendered.
// A blank window (renderer file not loadable) must fail it. No single-instance lock, so it runs next to a normal instance.
function runSmoke(win: BrowserWindow): void {
  const fail = (reason: string): void => {
    console.error(`smart-route ${app.getVersion()} renderer-fail: ${reason}`)
    app.exit(1)
  }
  setTimeout(() => fail(`timeout after ${SMOKE_TIMEOUT_MS} ms`), SMOKE_TIMEOUT_MS).unref()
  win.webContents.on('did-fail-load', (_e, code, description, url) => fail(`load error ${code} ${description} ${url}`))
  win.webContents.on('did-finish-load', () => {
    const probe = `new Promise((resolve) => {
      const started = Date.now()
      const check = () => {
        const root = document.querySelector('#root')
        const text = (document.body.innerText || '').trim()
        if (root && root.childElementCount > 0 && text.length > 0) resolve('ok')
        else if (Date.now() - started > 20000) resolve('renderer root empty')
        else setTimeout(check, 100)
      }
      check()
    })`
    win.webContents
      .executeJavaScript(probe)
      .then((r: unknown) => {
        if (r === 'ok') {
          console.log(`smart-route ${app.getVersion()} renderer-ok`)
          app.exit(0)
        } else fail(String(r))
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
  })
}

if (SMOKE) {
  // Throwaway profile: the smoke test must never touch the user's data.
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'smart-route-smoke-')))
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // No <webview>, no other window can ever be attached.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  void app.whenReady().then(() => {
    const csp = DEV_URL ? CSP_DEV : CSP_PROD
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    mainWindow = createWindow()
    const win = mainWindow
    if (SMOKE) runSmoke(win)
    panels = new WebPanels(
      win,
      (url) => void shell.openExternal(url),
      // Window only (not the browser sockets: they have no web panels).
      (vendor) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('web:signinBlocked', { vendor })
      },
      // F6 in a panel: the keyboard is back in the window, its page moves the focus to a control (WCAG 2.1.2).
      (vendor) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('web:focusReturned', { vendor })
      }
    )
    const userData = app.getPath('userData')
    // Every push (run events, account updates) goes to the window and to the authenticated browser sockets.
    const broadcaster = new Broadcaster()
    broadcaster.addSink((channel, data) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, data)
    })
    // The bridge needs the handlers that registerIpc creates, and the handlers need the bridge controls: late binding.
    const bridgeControl: BridgeControl = {
      status: () => bridge?.status() ?? { enabled: false, port: null, url: null, code: null, codeExpiresAt: null, sessions: 0 },
      start: async () => (bridge as NonNullable<typeof bridge>).start(),
      stop: async () => (bridge as NonNullable<typeof bridge>).stop(),
      newCode: () => (bridge as NonNullable<typeof bridge>).newCode(),
      revokeAll: () => (bridge as NonNullable<typeof bridge>).revokeAll()
    }
    const registered = registerIpc(
      ipcMain,
      {
        store: new Store(userData),
        env: buildChildEnv(),
        workRoot: join(userData, 'work'),
        pickFolder: async () => {
          const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
          return r.canceled || r.filePaths.length === 0 ? null : (r.filePaths[0] as string)
        },
        saveFile: async (defaultName, text) => {
          const r = await dialog.showSaveDialog(win, {
            defaultPath: join(app.getPath('documents'), defaultName),
            filters: [{ name: 'Markdown', extensions: ['md'] }]
          })
          if (r.canceled || !r.filePath) return false
          await writeFile(r.filePath, text, { encoding: 'utf8' })
          return true
        },
        showFolder: (path) => shell.showItemInFolder(path),
        openExternal: (url) => {
          if (isSafeExternalUrl(url)) void shell.openExternal(url)
        },
        web: panels,
        sendRunEvent: (e) => broadcaster.runEvent(e),
        sendAccountUpdate: (u) => broadcaster.accountUpdate(u),
        bridge: bridgeControl
      },
      isTrustedSender
    )
    bridge = createBridge({ handlers: registered.handlers, broadcaster, webRoot: defaultWebRoot(__dirname) })
    shutdownDeps = registered
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    if (!shutdownDeps) return
    event.preventDefault()
    void bridge?.stop().catch(() => undefined)
    void shutdownRuns({ ...shutdownDeps, killAllLive: killAllLiveGroups, graceMs: 5000 }).finally(() => {
      panels?.destroy()
      app.exit(0)
    })
  })
  app.on('window-all-closed', () => app.quit())
}
