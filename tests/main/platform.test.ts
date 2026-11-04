import { EventEmitter } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCommandFileBody, connectCli, shellQuote } from '../../src/main/accounts'
import { findOnPath, parseCmdShim, resolveLaunch, windowsExtensions } from '../../src/main/detect'
import { buildChildEnv, extraToolDirs } from '../../src/main/env'
import { AGY_MAX_PROMPT_CHARS_WIN32, killAllLiveGroups, liveProcessGroups, runStep, taskkillArgs, taskkillPath } from '../../src/main/runner'
import { BIN, makeSandbox, mkStep, runnerDeps, sleep, type Sandbox } from './helpers'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sr-plat-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('no shell anywhere in src/main', () => {
  it('never spawns through a shell (no shell: true / shell:true)', () => {
    const root = resolve(__dirname, '../../src/main')
    const files = readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8')
      expect(/shell\s*:\s*true/.test(text), `${f} must not use a shell`).toBe(false)
    }
  })
})

describe('Windows PATHEXT walk', () => {
  it('prefers .exe, then .com, .cmd, .bat; ignores the bare name and unusable extensions', () => {
    expect(windowsExtensions('.COM;.EXE;.BAT;.CMD;.VBS;.JS')).toEqual(['.exe', '.com', '.bat', '.cmd'])
    expect(windowsExtensions(undefined)).toEqual(['.exe', '.com', '.cmd', '.bat'])
    writeFileSync(join(tmp, 'claude'), '')
    writeFileSync(join(tmp, 'claude.cmd'), '')
    expect(findOnPath('claude', tmp, [], 'win32', '.COM;.EXE;.BAT;.CMD')).toBe(join(tmp, 'claude.cmd'))
    writeFileSync(join(tmp, 'claude.exe'), '')
    expect(findOnPath('claude', tmp, [], 'win32', '.COM;.EXE;.BAT;.CMD')).toBe(join(tmp, 'claude.exe'))
    rmSync(join(tmp, 'claude.exe'))
    rmSync(join(tmp, 'claude.cmd'))
    expect(findOnPath('claude', tmp, [], 'win32')).toBeUndefined()
  })

  it('uses ";" as the PATH separator and walks extra dirs after PATH', () => {
    const a = join(tmp, 'a')
    const b = join(tmp, 'b')
    mkdirSync(a)
    mkdirSync(b)
    writeFileSync(join(b, 'codex.exe'), '')
    expect(findOnPath('codex', `${a};${tmp}`, [b], 'win32')).toBe(join(b, 'codex.exe'))
  })
})

describe('npm cmd-shim resolution', () => {
  const shim = (target: string): string =>
    [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
      ''
    ].join('\r\n')

  it('parses the standard shim into node + entry.js', () => {
    const dir = join(tmp, 'npm')
    mkdirSync(join(dir, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), '')
    writeFileSync(join(dir, 'node.exe'), '')
    const l = parseCmdShim(shim('node_modules\\@openai\\codex\\bin\\codex.js'), join(dir, 'codex.cmd'), { platform: 'win32' })
    expect(l).toEqual({ file: join(dir, 'node.exe'), args: [join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')] })
  })

  it('uses node from PATH when the shim directory has none, and gives up when there is no node', () => {
    const dir = join(tmp, 'npm')
    const nodeDir = join(tmp, 'nodejs')
    mkdirSync(dir)
    mkdirSync(nodeDir)
    writeFileSync(join(dir, 'cli.js'), '')
    writeFileSync(join(nodeDir, 'node.exe'), '')
    const text = shim('cli.js')
    expect(parseCmdShim(text, join(dir, 'x.cmd'), { platform: 'win32', pathEnv: nodeDir })?.file).toBe(join(nodeDir, 'node.exe'))
    expect(parseCmdShim(text, join(dir, 'x.cmd'), { platform: 'win32', pathEnv: join(tmp, 'none') })).toBeUndefined()
  })

  it('resolves a shim that points at a native exe, and refuses a missing entry', () => {
    const dir = join(tmp, 'npm')
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'bin', 'claude.exe'), '')
    expect(parseCmdShim(shim('bin\\claude.exe'), join(dir, 'claude.cmd'), { platform: 'win32' })).toEqual({ file: join(dir, 'bin', 'claude.exe'), args: [] })
    expect(parseCmdShim(shim('missing\\cli.js'), join(dir, 'claude.cmd'), { platform: 'win32' })).toBeUndefined()
    expect(parseCmdShim('@echo hello', join(dir, 'x.cmd'), { platform: 'win32' })).toBeUndefined()
  })

  it('the repository fake .cmd (npm-style shim) resolves to node + claude.js', () => {
    const dir = join(tmp, 'bin')
    mkdirSync(dir)
    for (const f of ['claude.cmd', 'claude.js', '_lib.js']) copyFileSync(join(BIN, f), join(dir, f))
    writeFileSync(join(dir, 'node.exe'), '')
    expect(resolveLaunch(join(dir, 'claude.cmd'), { platform: 'win32' })).toEqual({ file: join(dir, 'node.exe'), args: [join(dir, 'claude.js')] })
  })

  it('resolveLaunch: POSIX = the file itself; Windows .exe direct; unknown extension refused', () => {
    expect(resolveLaunch('/usr/bin/claude', { platform: 'linux' })).toEqual({ file: '/usr/bin/claude', args: [] })
    expect(resolveLaunch('C:\\Tools\\claude.exe', { platform: 'win32' })).toEqual({ file: 'C:\\Tools\\claude.exe', args: [] })
    expect(resolveLaunch('C:\\Tools\\claude.ps1', { platform: 'win32' })).toBeUndefined()
    expect(resolveLaunch('C:\\Tools\\claude', { platform: 'win32' })).toBeUndefined()
  })
})

describe('platform environment', () => {
  it('Windows keeps the variables a CLI needs to start, case-insensitively, and nothing else', () => {
    const env = buildChildEnv(
      { Path: 'C:\\Windows\\System32;C:\\Tools', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\u', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'L', TEMP: 'T', TMP: 'T', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\u', NODE_OPTIONS: '--x', OPENAI_API_KEY: 'sk-secret' },
      'C:\\Users\\u',
      'win32'
    )
    expect(env.PATH?.split(';')).toEqual(['C:\\Windows\\System32', 'C:\\Tools', 'C:\\Users\\u\\.local\\bin', 'C:\\Users\\u\\AppData\\Roaming\\npm'])
    for (const k of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'HOMEDRIVE', 'HOMEPATH']) expect(env[k], k).toBeTruthy()
    expect(JSON.stringify(env)).not.toContain('sk-secret')
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('macOS adds Homebrew, /usr/local/bin, the npm global bin and ~/.local/bin to a minimal PATH', () => {
    const env = buildChildEnv({ PATH: '/usr/bin:/bin' }, '/Users/u', 'darwin')
    expect(env.PATH?.split(':')).toEqual(['/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/bin', '/Users/u/.npm-global/bin', '/Users/u/.local/bin'])
    expect(extraToolDirs('linux', '/h')).toEqual(['/h/.local/bin'])
    expect(env.USERPROFILE).toBeUndefined()
  })
})

describe('Windows process handling (platform injected)', () => {
  let sb: Sandbox
  beforeEach(async () => {
    sb = await makeSandbox()
  })
  afterEach(async () => {
    await sb.cleanup()
  })

  interface FakeChild extends EventEmitter {
    pid: number
    exitCode: number | null
    signalCode: string | null
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
  }
  function fakeSpawn(): { spawnFn: never; calls: Array<{ file: string; args: string[]; opts: Record<string, unknown> }>; child: FakeChild } {
    const calls: Array<{ file: string; args: string[]; opts: Record<string, unknown> }> = []
    const child = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null, signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }) as FakeChild
    const spawnFn = ((file: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ file, args, opts })
      return child
    }) as never
    return { spawnFn, calls, child }
  }

  it('spawns without shell, hidden, not detached; cancel runs taskkill /T /F on the pid; quit kills synchronously', async () => {
    const { spawnFn, calls, child } = fakeSpawn()
    const killed: number[] = []
    const ac = new AbortController()
    const deps = runnerDeps(sb, { platform: 'win32', spawnFn, killTree: (pid) => void killed.push(pid), toolPaths: { 'claude-code': 'C:\\Tools\\claude.exe' } })
    const p = runStep(mkStep('claude-code', 'single'), 'hi', sb.cwd, ac.signal, () => undefined, deps)
    await vi.waitFor(() => expect(liveProcessGroups()).toContain(4242))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('C:\\Tools\\claude.exe')
    expect(calls[0]?.opts).toMatchObject({ shell: false, detached: false, windowsHide: true })
    ac.abort()
    await vi.waitFor(() => expect(killed).toContain(4242))
    child.exitCode = 1
    child.emit('close', 1)
    expect((await p).error).toBe('cancelled')

    const sync: number[] = []
    const second = fakeSpawn()
    const deps2 = runnerDeps(sb, { platform: 'win32', spawnFn: second.spawnFn, killGraceMs: 60_000, killTree: () => undefined, toolPaths: { 'claude-code': 'C:\\Tools\\claude.exe' } })
    const ac2 = new AbortController()
    void runStep(mkStep('claude-code', 'single'), 'hi', sb.cwd, ac2.signal, () => undefined, deps2)
    await vi.waitFor(() => expect(liveProcessGroups()).toContain(4242))
    killAllLiveGroups({ platform: 'win32', taskkillSync: (pid) => void sync.push(pid) })
    expect(sync).toEqual([4242])
    expect(liveProcessGroups()).toEqual([])
    ac2.abort()
    second.child.exitCode = 1
    second.child.emit('close', 1)
  })

  it('taskkill is called by absolute path with the documented arguments', () => {
    expect(taskkillArgs(77)).toEqual(['/PID', '77', '/T', '/F'])
    expect(taskkillPath({ SystemRoot: 'C:\\Windows' })).toMatch(/System32.taskkill\.exe$/)
  })

  it('a .cmd that cannot be resolved is reported as not installed, never started through a shell', async () => {
    const { spawnFn, calls } = fakeSpawn()
    const r = await runStep(mkStep('codex', 'single'), 'x', sb.cwd, new AbortController().signal, () => undefined, runnerDeps(sb, { platform: 'win32', spawnFn, toolPaths: { codex: join(tmp, 'codex.cmd') } }))
    expect(r.error).toBe('not_installed')
    expect(calls).toHaveLength(0)
  })

  it('agy prompt is capped at 30 000 characters on Windows only', async () => {
    const { spawnFn, calls, child } = fakeSpawn()
    const p = runStep(mkStep('agy', 'single'), 'a'.repeat(50_000), sb.cwd, new AbortController().signal, () => undefined, runnerDeps(sb, { platform: 'win32', spawnFn, toolPaths: { agy: 'C:\\Tools\\agy.exe' } }))
    await sleep(100)
    const arg = calls[0]?.args.find((a) => a.startsWith('--print=')) as string
    expect(arg.length).toBe('--print='.length + AGY_MAX_PROMPT_CHARS_WIN32)
    child.exitCode = 0
    child.emit('close', 0)
    await p
  })
})

describe('sign-in terminal per platform', () => {
  const base = { env: { PATH: '/usr/bin:/opt/homebrew/bin', HOME: '/h' } as NodeJS.ProcessEnv }

  it('Windows: spawns the exe itself, with a visible console, no terminal lookup', () => {
    const calls: Array<[string, string[], NodeJS.ProcessEnv, { windowsHide?: boolean } | undefined]> = []
    const ok = connectCli('anthropic', { ...base, platform: 'win32', toolPaths: { 'claude-code': 'C:\\Tools\\claude.exe' }, pathEnv: '', openTerminal: (f, a, e, o) => calls.push([f, a, e, o]) })
    expect(ok).toBe(true)
    expect(calls[0]?.slice(0, 2)).toEqual(['C:\\Tools\\claude.exe', ['auth', 'login', '--claudeai']])
    expect(calls[0]?.[3]).toEqual({ windowsHide: false })
    expect(connectCli('anthropic', { ...base, platform: 'win32', toolPaths: { 'claude-code': 'C:\\Tools\\claude.ps1' }, openTerminal: () => undefined })).toBe(false)
  })

  it('macOS: writes a private .command file with quoted absolute paths and opens it with /usr/bin/open', () => {
    const calls: Array<[string, string[]]> = []
    const exe = "/Users/o'brien/bin/claude"
    const ok = connectCli('anthropic', { ...base, platform: 'darwin', tmpDir: tmp, toolPaths: { 'claude-code': exe }, openTerminal: (f, a) => calls.push([f, a]) })
    expect(ok).toBe(true)
    expect(calls[0]?.[0]).toBe('/usr/bin/open')
    const file = calls[0]?.[1][0] as string
    expect(file.endsWith('.command')).toBe(true)
    if (process.platform !== 'win32') {
      // Windows has no POSIX file modes (stat reports 0o666 / 0o777).
      expect(statSync(file).mode & 0o777).toBe(0o700)
      expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700)
    }
    const body = readFileSync(file, 'utf8')
    expect(body.startsWith('#!/bin/bash\n')).toBe(true)
    expect(body).toContain(`exec '/Users/o'\\''brien/bin/claude' 'auth' 'login' '--claudeai'`)
    expect(body).toContain("export PATH='/usr/bin:/opt/homebrew/bin'")
  })

  it('shellQuote neutralises quotes, spaces and substitutions', () => {
    expect(shellQuote("a b'c$(x)`y`")).toBe(`'a b'\\''c$(x)\`y\`'`)
    expect(buildCommandFileBody(['/a b/claude'], undefined)).not.toContain('export PATH')
  })
})
