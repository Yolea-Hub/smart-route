// Run: node --test site/tests/site-downloads.test.mjs  (no dependency: a tiny fake DOM and a stubbed fetch drive public/site.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/site.js'), 'utf8')
const P = 'https://github.com/Yolea-Hub/smart-route/releases/download/v0.1.0/'

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.textContent = ''; this.hidden = false; this.q = {} }
  appendChild(c) { this.children.push(c); return c }
  removeChild(c) { this.children = this.children.filter((x) => x !== c) }
  get firstChild() { return this.children[0] || null }
  setAttribute(k, v) { this.attrs[k] = v }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k] }
  querySelector(sel) { return this.q[sel] || null }
  all(out = []) { for (const c of this.children) { out.push(c); c.all(out) } return out }
  text() { return [this.textContent, ...this.children.map((c) => c.text())].join(' ') }
}

function page() {
  const root = new El('div')
  const status = new El('p'); const primary = new El('a'); const meta = new El('p')
  root.q['[data-dl-status]'] = status; root.q['[data-dl-primary]'] = primary; root.q['[data-dl-meta]'] = meta
  const cards = {}
  for (const os of ['linux', 'windows', 'mac']) {
    const card = new El('div'); const list = new El('ul'); const soon = new El('p'); const tag = new El('span')
    card.q['[data-files]'] = list; card.q['[data-soon]'] = soon; card.q['[data-tag]'] = tag
    root.q[`[data-os="${os}"]`] = card; root.appendChild(card); card.appendChild(list); cards[os] = { card, list, soon }
  }
  const hero = new El('a')
  const doc = {
    documentElement: { lang: 'en' },
    createElement: (t) => new El(t),
    createTextNode: (t) => { const n = new El('#text'); n.textContent = t; return n },
    querySelector: (sel) => (sel === '[data-dl]' ? root : sel === '[data-dl-hero]' ? hero : null),
    querySelectorAll: (sel) => (sel === '[data-sha-row]' ? [root, ...root.all()].filter((n) => n.attrs['data-sha-row']) : []),
    getElementById: () => null,
    addEventListener() {}
  }
  return { doc, root, status, primary, cards, hero }
}

function run(responses, ua = 'Mozilla/5.0 (X11; Linux x86_64)') {
  const p = page()
  const calls = []
  const fetch = (url) => {
    calls.push(url)
    const r = responses[url]
    if (!r) return Promise.reject(new TypeError('network'))
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => r.text })
  }
  const window = { navigator: { userAgent: ua, platform: 'Linux x86_64' }, fetch, isSecureContext: true, __SR_TEST__: {} }
  const ctx = { window, document: p.doc, fetch, URL, Intl, setTimeout, clearTimeout, console }
  vm.runInNewContext(SRC, ctx)
  return { ...p, calls, hooks: window.__SR_TEST__.hooks }
}
const tick = () => new Promise((r) => setTimeout(r, 20))

const asset = (name, size = 1048576 * 90) => ({ name, size, browser_download_url: P + name })
const release = () => ({
  tag_name: 'v0.1.0', published_at: '2026-11-05T10:00:00Z', draft: false, prerelease: false,
  assets: [
    asset('Smart-Route-0.1.0-linux-x86_64.AppImage'), asset('Smart-Route-0.1.0-linux-amd64.deb'),
    asset('Smart-Route-0.1.0-win-x64.exe'), asset('Smart-Route-0.1.0-mac-arm64.dmg'), asset('Smart-Route-0.1.0-mac-x64.dmg'),
    asset('SHA256SUMS', 400)
  ]
})
const API = 'https://api.github.com/repos/Yolea-Hub/smart-route/releases/latest'

test('maps the five installers, shows size, version and date', async () => {
  const r = run({ [API]: { status: 200, json: release() }, [P + 'SHA256SUMS']: { status: 500 } })
  await tick()
  assert.equal(r.cards.linux.list.children.length, 2)
  assert.equal(r.cards.windows.list.children.length, 1)
  assert.equal(r.cards.mac.list.children.length, 2)
  assert.equal(r.cards.linux.soon.hidden, true)
  assert.match(r.primary.attrs.download, /linux-x86_64\.AppImage$/)
  assert.match(r.primary.textContent, /Linux \(90 MB\)/)
  assert.match(r.root.q['[data-dl-meta]'].textContent, /^Version 0\.1\.0, /)
})

test('SHA256SUMS fetched: the hash replaces the link', async () => {
  const hex = 'a'.repeat(64)
  const sums = `${hex}  Smart-Route-0.1.0-win-x64.exe\n${'b'.repeat(64)} *Smart-Route-0.1.0-linux-amd64.deb\n`
  const r = run({ [API]: { status: 200, json: release() }, [P + 'SHA256SUMS']: { status: 200, text: sums } })
  await tick()
  const txt = r.cards.windows.list.text()
  assert.ok(txt.includes(hex))
  assert.ok(r.cards.linux.list.text().includes('b'.repeat(64)))
  assert.ok(r.cards.mac.list.text().includes('SHA256SUMS'), 'files without a line keep the link')
})

test('SHA256SUMS unreachable (CORS): link to SHA256SUMS stays', async () => {
  const r = run({ [API]: { status: 200, json: release() } })
  await tick()
  assert.ok(r.cards.windows.list.text().includes('SHA-256 checksums'))
})

test('404 = no release yet: coming soon', async () => {
  const r = run({ [API]: { status: 404 } })
  await tick()
  assert.match(r.status.textContent, /^Coming soon\. The files are not published yet\.$/)
  assert.equal(r.cards.linux.list.children.length, 0)
})

test('403 rate limit: coming soon with a link to the releases page', async () => {
  const r = run({ [API]: { status: 403 } })
  await tick()
  assert.match(r.status.textContent, /^Coming soon/)
  const link = r.status.children.find((c) => c.tag === 'a')
  assert.equal(link.href, 'https://github.com/Yolea-Hub/smart-route/releases')
})

test('rejects assets outside the project release URL, odd names, drafts, prereleases', () => {
  const { hooks } = run({})
  const bad = release()
  bad.assets = [
    { ...asset('Smart-Route-0.1.0-win-x64.exe'), browser_download_url: 'https://evil.example/Smart-Route-0.1.0-win-x64.exe' },
    { ...asset('Smart-Route-0.1.0-win-x64.exe'), browser_download_url: 'https://github.com/other/repo/releases/download/v1/Smart-Route-0.1.0-win-x64.exe' },
    { ...asset('Smart-Route-0.1.0-win-x64.exe'), browser_download_url: P + 'x.exe?token=1' },
    asset('Smart-Route-0.1.0-win-x64.exe.zip'), asset('notes.txt'),
    { ...asset('Smart-Route-0.1.0-win-x64.exe'), size: -1 }
  ]
  assert.equal(hooks.validData(bad), null)
  assert.equal(hooks.validData({ ...release(), draft: true }), null)
  assert.equal(hooks.validData({ ...release(), prerelease: true }), null)
  assert.equal(hooks.validData(null), null)
})

// ---- /dl/latest.json (mirror on this site) first, GitHub as the fallback
const MAN = '/dl/latest.json'
const HEX = (c) => c.repeat(64)
const manifest = () => ({
  version: '0.2.1', date: '2026-11-04',
  files: [
    ['linux', 'x64', 'AppImage', 'Smart-Route-0.2.1-linux-x86_64.AppImage', 'a'], ['linux', 'x64', 'deb', 'Smart-Route-0.2.1-linux-amd64.deb', 'b'],
    ['windows', 'x64', 'exe', 'Smart-Route-0.2.1-win-x64.exe', 'c'], ['mac', 'arm64', 'dmg', 'Smart-Route-0.2.1-mac-arm64.dmg', 'd'], ['mac', 'x64', 'dmg', 'Smart-Route-0.2.1-mac-x64.dmg', 'e']
  ].map(([os, arch, kind, name, c]) => ({ os, arch, kind, name, url: `/dl/v0.2.1/${name}`, size: 1048576 * 100, sha256: HEX(c) }))
})

test('R2 manifest used: same-origin links, sizes and SHA-256 shown inline, GitHub never asked', async () => {
  const r = run({ [MAN]: { status: 200, json: manifest() } })
  await tick()
  assert.deepEqual(r.calls, [MAN])
  assert.equal(r.cards.linux.list.children.length, 2)
  assert.equal(r.cards.mac.list.children.length, 2)
  assert.match(r.primary.attrs.download, /linux-x86_64\.AppImage$/)
  assert.equal(r.primary.href, '/dl/v0.2.1/Smart-Route-0.2.1-linux-x86_64.AppImage')
  assert.match(r.primary.textContent, /Linux \(100 MB\)/)
  assert.match(r.root.q['[data-dl-meta]'].textContent, /^Version 0\.2\.1, /)
  assert.ok(r.cards.windows.list.text().includes(HEX('c')))
  assert.ok(r.cards.linux.list.text().includes(HEX('b')))
  const links = r.cards.linux.list.all().filter((n) => n.tag === 'a').map((n) => n.href)
  assert.ok(links.every((h) => h.startsWith('/dl/v0.2.1/')), links.join())
})

test('manifest missing (404 or network): falls back to the GitHub API', async () => {
  for (const responses of [{ [MAN]: { status: 404 } }, {}]) {
    const r = run({ ...responses, [API]: { status: 200, json: release() }, [P + 'SHA256SUMS']: { status: 500 } })
    await tick()
    assert.deepEqual(r.calls.slice(0, 2), [MAN, API])
    assert.equal(r.cards.linux.list.children.length, 2)
    assert.ok(r.cards.linux.list.all().some((n) => n.tag === 'a' && n.href.startsWith(P)))
  }
})

test('manifest invalid: falls back to GitHub (and coming soon when GitHub has nothing)', async () => {
  const bad = manifest(); bad.files[0].url = 'https://evil.example/x'
  const r = run({ [MAN]: { status: 200, json: bad }, [API]: { status: 404 } })
  await tick()
  assert.ok(r.calls.includes(API))
  assert.match(r.status.textContent, /^Coming soon/)
})

test('manifest strictness: odd URLs, names, versions, hashes, sizes, shapes', () => {
  const { hooks } = run({})
  assert.ok(hooks.validManifest(manifest()))
  const mut = (f) => { const m = manifest(); f(m); return hooks.validManifest(m) }
  assert.equal(mut((m) => { m.files[0].url = '/dl/v0.2.1/x.exe' }), null)
  assert.equal(mut((m) => { m.files[0].url += '?a=1' }), null)
  assert.equal(mut((m) => { m.files[0].url = 'https://smartroute.yolea.ai' + m.files[0].url }), null)
  assert.equal(mut((m) => { m.files[0].url = m.files[0].url.replace('/dl/', '//evil.example/dl/') }), null)
  assert.equal(mut((m) => { m.version = '0.2.2' }), null, 'file versions must equal the manifest version')
  assert.equal(mut((m) => { m.files[0].sha256 = 'zz' }), null)
  assert.equal(mut((m) => { m.files[0].size = 0 }), null)
  assert.equal(mut((m) => { m.files[0].name = 'Smart-Route-0.2.1-linux-amd64.zip' }), null)
  assert.equal(mut((m) => { m.files = [] }), null)
  assert.equal(mut((m) => { m.version = '0.2' }), null)
  assert.equal(hooks.validManifest(null), null)
  assert.equal(hooks.validManifest([]), null)
  assert.equal(mut((m) => { m.date = 'tomorrow' }).date, '')
})
