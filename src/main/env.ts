import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const pathModule = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? (win32 as unknown as typeof posix) : posix)

/** Case-insensitive environment lookup on Windows (`Path`, `SystemRoot`...), exact elsewhere. */
function getVar(src: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return src[key]
  if (src[key] !== undefined) return src[key]
  const upper = key.toUpperCase()
  const hit = Object.keys(src).find((k) => k.toUpperCase() === upper)
  return hit === undefined ? undefined : src[hit]
}

/**
 * Directories where the CLIs usually live but that a desktop-launched app does not have on its PATH.
 * Linux: ~/.local/bin. macOS: Homebrew (Apple Silicon and Intel), npm global bin, ~/.local/bin.
 * Windows: ~/.local/bin (native installers) and %APPDATA%\npm (npm global).
 */
export function extraToolDirs(platform: NodeJS.Platform = process.platform, home: string = homedir(), src: NodeJS.ProcessEnv = process.env): string[] {
  const p = pathModule(platform)
  const local = p.join(home, '.local', 'bin')
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.npm-global', 'bin'), local]
  if (platform === 'win32') {
    const appData = getVar(src, 'APPDATA', platform)
    return [local, ...(appData ? [p.join(appData, 'npm')] : [])]
  }
  return [local]
}

const WINDOWS_PASSTHROUGH = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'HOMEDRIVE', 'HOMEPATH'] as const

/**
 * Environment given to every child CLI: PATH (+ the platform's usual tool directories), HOME, LANG, USER, NO_COLOR=1.
 * Windows adds the few variables the CLIs and `node` need to start (USERPROFILE, APPDATA, SystemRoot...).
 * Nothing else is inherited: never ELECTRON_RUN_AS_NODE, NODE_OPTIONS, API keys of the app, etc.
 */
export function buildChildEnv(
  src: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const sep = platform === 'win32' ? ';' : ':'
  const pathParts = (getVar(src, 'PATH', platform) ?? '').split(sep).filter(Boolean)
  for (const dir of extraToolDirs(platform, home, src)) {
    if (!pathParts.includes(dir)) pathParts.push(dir)
  }
  const env: NodeJS.ProcessEnv = {
    PATH: pathParts.join(sep),
    HOME: src.HOME ?? home,
    NO_COLOR: '1'
  }
  if (src.LANG) env.LANG = src.LANG
  if (src.USER) env.USER = src.USER
  // agy reads its keyring over D-Bus; the XDG variables locate the session bus and the CLIs' config.
  for (const k of PASSTHROUGH) {
    const v = src[k]
    if (v) env[k] = v
  }
  if (platform === 'win32') {
    for (const k of WINDOWS_PASSTHROUGH) {
      const v = getVar(src, k, platform)
      if (v) env[k] = v
    }
  }
  return env
}

const PASSTHROUGH = ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'] as const

/** Environment for a system terminal: the child env plus what a terminal needs to open a window. */
export function buildTerminalEnv(childEnv: NodeJS.ProcessEnv, src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...childEnv }
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const) {
    const v = src[k]
    if (v) env[k] = v
  }
  return env
}
