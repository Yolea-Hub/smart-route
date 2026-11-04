#!/usr/bin/env node
// Accessibility audit with axe-core (WCAG 2.0 / 2.1 / 2.2, levels A and AA) over the Chrome DevTools Protocol.
//
// It launches nothing. You start the thing to audit, with a remote-debugging port, then run this script:
//
//   Desktop app (every view, Day and Night):
//     pnpm dev -- --remote-debugging-port=9222        (or: electron . --remote-debugging-port=9222)
//     pnpm a11y app --port 9222
//
//   Pages served locally (the site, the browser build), Day and Night, one or more widths:
//     python3 -m http.server 8080 --directory site/dist &
//     chromium --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-profile about:blank &
//     pnpm a11y urls http://127.0.0.1:8080/ http://127.0.0.1:8080/en/ --port 9222 --widths 1280,320
//
// Options
//   --port N            DevTools port (default 9222)
//   --host H            DevTools host (default 127.0.0.1; only a local host is accepted)
//   --views a,b,c       app mode: task,plan,run,history,accounts,settings,recipes,atlas (default: all that can be reached)
//   --themes day,night  default both; sets <html data-theme> before each run
//   --widths 1280,320   urls mode: viewport widths in CSS px (default: the current window)
//   --fail-on LEVEL     minor | moderate | serious | critical (default serious): exit 1 on a violation of this level or worse
//   --json              print one JSON document instead of the text report
//   --no-focus-check    app mode: do not fail when a view change leaves the focus on <body>
//   --target TEXT       choose the DevTools page whose URL or title contains TEXT
//
// Exit code: 0 clean, 1 violations at or above --fail-on (or a focus failure), 2 usage or connection error.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const LEVELS = ['minor', 'moderate', 'serious', 'critical']
const APP_VIEWS = ['task', 'plan', 'run', 'history', 'accounts', 'settings', 'recipes', 'atlas']

// ---- Arguments --------------------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { mode: null, urls: [], port: 9222, host: '127.0.0.1', views: null, themes: ['day', 'night'], widths: [], failOn: 'serious', json: false, focusCheck: true, target: null }
  const rest = [...argv]
  const take = (name) => {
    const v = rest.shift()
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`)
    return v
  }
  while (rest.length > 0) {
    const a = rest.shift()
    if (a === 'app' || a === 'urls') out.mode = a
    else if (a === '--port') out.port = Number(take(a))
    else if (a === '--host') out.host = take(a)
    else if (a === '--views') out.views = take(a).split(',').filter(Boolean)
    else if (a === '--themes') out.themes = take(a).split(',').filter(Boolean)
    else if (a === '--widths') out.widths = take(a).split(',').filter(Boolean).map(Number)
    else if (a === '--fail-on') out.failOn = take(a)
    else if (a === '--json') out.json = true
    else if (a === '--no-focus-check') out.focusCheck = false
    else if (a === '--target') out.target = take(a)
    else if (a === '--help' || a === '-h') out.help = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else if (out.mode === 'urls') out.urls.push(a)
    else throw new Error(`unexpected argument ${a}`)
  }
  if (out.help) return out
  if (!out.mode) throw new Error('say what to audit: "app" or "urls <url>..."')
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error('--port must be 1 to 65535')
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(out.host)) throw new Error('--host must be a local host (127.0.0.1, localhost, ::1)')
  if (!LEVELS.includes(out.failOn)) throw new Error(`--fail-on must be one of ${LEVELS.join(', ')}`)
  for (const t of out.themes) if (t !== 'day' && t !== 'night') throw new Error('--themes accepts day and night')
  for (const w of out.widths) if (!Number.isInteger(w) || w < 200 || w > 4000) throw new Error('--widths takes integers from 200 to 4000')
  if (out.views) for (const v of out.views) if (!APP_VIEWS.includes(v)) throw new Error(`unknown view ${v} (known: ${APP_VIEWS.join(', ')})`)
  if (out.mode === 'urls') {
    if (out.urls.length === 0) throw new Error('urls mode needs at least one URL')
    for (const u of out.urls) {
      let parsed
      try {
        parsed = new URL(u)
      } catch {
        throw new Error(`not a URL: ${u}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') throw new Error(`only http, https and file URLs: ${u}`)
    }
  }
  return out
}

/** True when `impact` is `failOn` or worse. */
export function atLeast(impact, failOn) {
  return LEVELS.indexOf(impact ?? 'minor') >= LEVELS.indexOf(failOn)
}

/** Reduce an axe result to the lines worth printing. */
export function summarise(result, failOn) {
  const violations = (result.violations ?? []).map((v) => ({
    id: v.id,
    impact: v.impact ?? 'minor',
    help: v.help,
    helpUrl: v.helpUrl,
    count: v.nodes.length,
    targets: v.nodes.slice(0, 4).map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target)))
  }))
  return { violations, failing: violations.filter((v) => atLeast(v.impact, failOn)) }
}

// ---- Chrome DevTools Protocol, minimal ---------------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else p.resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'))
      this.pending.clear()
    })
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot open ${wsUrl}`)), { once: true })
    })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  once(method) {
    return new Promise((resolve) => {
      const fn = (p) => {
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((x) => x !== fn))
        resolve(p)
      }
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn])
    })
  }
  /** Evaluate an expression in the page and return its value (JSON-serialisable). Throws the page exception. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  close() {
    this.ws.close()
  }
}

async function pickTarget(host, port, wanted) {
  let list
  try {
    const res = await fetch(`http://${host}:${port}/json`)
    list = await res.json()
  } catch (e) {
    throw new Error(`no DevTools on ${host}:${port} (${e.message}). Start the app or the browser with --remote-debugging-port=${port}.`)
  }
  const pages = list.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
  const chosen = wanted ? pages.find((t) => `${t.url} ${t.title}`.includes(wanted)) : pages[0]
  if (!chosen) throw new Error(`no page to audit among ${pages.length} DevTools page(s)${wanted ? ` matching "${wanted}"` : ''}`)
  return chosen
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cdp, expression, timeoutMs = 8000) {
  const t0 = Date.now()
  for (;;) {
    if (await cdp.eval(expression).catch(() => false)) return true
    if (Date.now() - t0 > timeoutMs) return false
    await sleep(120)
  }
}

async function injectAxe(cdp) {
  const present = await cdp.eval('typeof window.axe === "object"')
  if (present) return
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  await cdp.eval(source) // Runtime.evaluate: not subject to the page's Content-Security-Policy
}

async function runAxe(cdp, failOn) {
  await injectAxe(cdp)
  const result = await cdp.eval(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations'] }).then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({ target: n.target })) })) }))`
  )
  return summarise(result, failOn)
}

async function setTheme(cdp, theme) {
  await cdp.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`)
  await sleep(150)
}

// ---- App views ---------------------------------------------------------------------------------------------------------

const click = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`
const H1 = { task: '#task-h', plan: '#plan-h', run: '#run-h', history: '#hist-h', accounts: '#accounts-h', settings: '#set-h', recipes: '#recipes-h', atlas: '#atlas-h' }

/** Where the focus is: "BODY" is the failure (a keyboard or screen-reader user is lost). */
const FOCUS = `(() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') : 'none' })()`

const STEPS = {
  task: async (c) => (await c.eval(click('#tab-task'))) && (await waitFor(c, `!!document.querySelector('#task-h')`)),
  history: async (c) => (await c.eval(click('#tab-history'))) && (await waitFor(c, `!!document.querySelector('#hist-h')`)),
  accounts: async (c) => (await c.eval(click('#tab-accounts'))) && (await waitFor(c, `!!document.querySelector('#accounts-h')`)),
  settings: async (c) => (await c.eval(click('#tab-settings'))) && (await waitFor(c, `!!document.querySelector('#set-h')`)),
  recipes: async (c) => {
    if (!(await STEPS.task(c))) return false
    return (await c.eval(click('#home-all-recipes'))) && (await waitFor(c, `!!document.querySelector('#recipes-h')`))
  },
  atlas: async (c) => {
    if (!(await STEPS.task(c))) return false
    return (await c.eval(click('#home-open-atlas'))) && (await waitFor(c, `!!document.querySelector('#atlas-h')`))
  },
  plan: async (c) => {
    if (!(await STEPS.task(c))) return false
    // With « Run without asking » on, Analyse would start a real run: the plan screen is then not audited.
    const auto = await c.eval(`window.smartRoute ? window.smartRoute.invoke('settings:get').then(s => s.auto === true) : false`).catch(() => false)
    if (auto) return 'skipped: automatic runs are on (Analyse would start a real run)'
    await c.eval(
      `(() => { const t = document.querySelector('#task-text'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Write a unit test for a sorting function'); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
    await sleep(150)
    if (!(await c.eval(click('.console button[type="submit"]')))) return false
    return await waitFor(c, `!!document.querySelector('#plan-h')`, 15000)
  },
  run: async (c) => {
    // The run screen exists once a run has started: it is reached through the breadcrumb of the task screen. A run is never started here.
    if (!(await STEPS.task(c))) return false
    const clicked = await c.eval(`(() => { const items = [...document.querySelectorAll('.flow-steps li')]; const b = items[items.length - 1]?.querySelector('button'); if (!b) return false; b.click(); return true })()`)
    if (!clicked) return 'skipped: no run on screen (start one in the app, then audit again)'
    return await waitFor(c, `!!document.querySelector('#run-h')`)
  }
}

async function auditApp(opts, cdp) {
  const views = opts.views ?? APP_VIEWS
  const rows = []
  for (const theme of opts.themes) {
    await setTheme(cdp, theme)
    for (const view of views) {
      const was = await cdp.eval(`document.querySelector('main h1')?.id ?? ''`)
      const reached = await STEPS[view](cdp)
      if (typeof reached === 'string') {
        rows.push({ where: `app / ${view} / ${theme}`, skipped: reached })
        continue
      }
      if (!reached) {
        rows.push({ where: `app / ${view} / ${theme}`, skipped: 'skipped: the view did not open (selector missing)' })
        continue
      }
      await sleep(350) // animations of the view settle
      await setTheme(cdp, theme) // a view change never resets it, but this keeps the run honest
      const focus = await cdp.eval(FOCUS)
      const now = await cdp.eval(`document.querySelector('main h1')?.id ?? ''`)
      const r = await runAxe(cdp, opts.failOn)
      // Only a real view change must move the focus: staying on the view the app opened on is not a change.
      const focusFail = opts.focusCheck && was !== now && (focus === 'BODY' || focus === 'none')
      rows.push({ where: `app / ${view} / ${theme}`, focus, focusFail, ...r })
    }
  }
  return rows
}

// ---- URLs --------------------------------------------------------------------------------------------------------------

async function auditUrls(opts, cdp) {
  const rows = []
  await cdp.send('Page.enable')
  const widths = opts.widths.length > 0 ? opts.widths : [null]
  for (const url of opts.urls) {
    for (const width of widths) {
      if (width) await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
      else await cdp.send('Emulation.clearDeviceMetricsOverride')
      const loaded = cdp.once('Page.loadEventFired')
      await cdp.send('Page.navigate', { url })
      await loaded
      await sleep(400)
      for (const theme of opts.themes) {
        await setTheme(cdp, theme)
        const r = await runAxe(cdp, opts.failOn)
        // Reflow (WCAG 1.4.10): no horizontal scroll of the page at this width.
        const overflow = await cdp.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`)
        rows.push({ where: `${url}${width ? ` @${width}px` : ''} / ${theme}`, reflowFail: Boolean(width) && overflow, ...r })
      }
    }
  }
  if (widths.some(Boolean)) await cdp.send('Emulation.clearDeviceMetricsOverride')
  return rows
}

// ---- Report ------------------------------------------------------------------------------------------------------------

function report(rows, opts) {
  let failed = false
  const lines = []
  for (const row of rows) {
    if (row.skipped) {
      lines.push(`SKIP  ${row.where}  ${row.skipped}`)
      continue
    }
    const bad = row.failing.length > 0 || row.focusFail === true || row.reflowFail === true
    failed ||= bad
    lines.push(`${bad ? 'FAIL' : 'ok  '}  ${row.where}  ${row.violations.length} violation(s)${row.focus ? `, focus on ${row.focus}` : ''}${row.reflowFail ? ', HORIZONTAL SCROLL' : ''}`)
    if (row.focusFail) lines.push('      focus is on <body> after the view change (a keyboard user is lost)')
    for (const v of row.violations) lines.push(`      [${v.impact}] ${v.id}: ${v.help} (${v.count} node${v.count > 1 ? 's' : ''})${atLeast(v.impact, opts.failOn) ? '' : ' (below --fail-on)'}\n        ${v.targets.join('\n        ')}`)
  }
  const n = rows.filter((r) => !r.skipped).length
  const skipped = rows.filter((r) => r.skipped).length
  lines.push('', `${n} page state(s) audited, ${skipped} skipped, rules: ${TAGS.join(', ')}, fail on ${opts.failOn} or worse: ${failed ? 'FAILED' : 'clean'}`)
  return { text: lines.join('\n'), failed }
}

// ---- Main --------------------------------------------------------------------------------------------------------------

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`a11y-audit: ${e.message}\nRun with --help for usage.`)
    return 2
  }
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 32).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return 0
  }
  let cdp
  try {
    const target = await pickTarget(opts.host, opts.port, opts.target)
    cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    const rows = opts.mode === 'app' ? await auditApp(opts, cdp) : await auditUrls(opts, cdp)
    const { text, failed } = report(rows, opts)
    console.log(opts.json ? JSON.stringify({ rules: TAGS, failOn: opts.failOn, failed, rows }, null, 2) : text)
    return failed ? 1 : 0
  } catch (e) {
    console.error(`a11y-audit: ${e.message}`)
    return 2
  } finally {
    cdp?.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main())
}
