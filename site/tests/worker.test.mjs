// Run: node --test site/tests/worker.test.mjs  (no dependency: a fake R2 bucket and a fake ASSETS binding drive site/deploy/worker.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { parseDlPath } from '../deploy/worker.js'

const DEB = 'Smart-Route-0.2.1-linux-amd64.deb'

test('accepts latest.json, the five installers and SHA256SUMS', () => {
  assert.deepEqual(parseDlPath('/dl/latest.json'), { key: 'latest.json', filename: null, immutable: false })
  for (const n of ['Smart-Route-0.2.1-linux-x86_64.AppImage', DEB, 'Smart-Route-0.2.1-win-x64.exe', 'Smart-Route-0.2.1-mac-arm64.dmg', 'Smart-Route-0.2.1-mac-x64.dmg']) {
    assert.deepEqual(parseDlPath(`/dl/v0.2.1/${n}`), { key: `v0.2.1/${n}`, filename: n, immutable: true })
  }
  assert.deepEqual(parseDlPath('/dl/v0.2.1/SHA256SUMS'), { key: 'v0.2.1/SHA256SUMS', filename: null, immutable: true })
})

test('refuses traversal, other names, other versions, query strings', () => {
  const bad = [
    '/dl/../x', '/dl/v0.2.1/../v0.1.0/' + DEB, '/dl/v0.2.1/%2e%2e/' + DEB, '/dl/v0.2.1//' + DEB, '/dl/', '/dl', '/dl/v0.2.1/', '/dl/v0.2.1',
    '/dl/v0.2.1/Smart-Route-0.2.0-linux-amd64.deb', // version in the name differs from the folder
    '/dl/v0.2/Smart-Route-0.2-linux-amd64.deb', '/dl/v0.2.1-rc1/Smart-Route-0.2.1-rc1-linux-amd64.deb',
    '/dl/v0.2.1/Smart-Route-0.2.1-linux-amd64.deb.zip', '/dl/v0.2.1/Smart-Route-0.2.1-win-arm64.exe', '/dl/v0.2.1/notes.txt',
    '/dl/v0.2.1/sha256sums', '/dl/latest.json/', '/dl/Latest.json', '/dl/v0.2.1/a/b', '/dl/v0.2.1/%2FSHA256SUMS', '/dl/v0.2.1/' + DEB + '%00', '/other/latest.json'
  ]
  for (const p of bad) assert.equal(parseDlPath(p), null, p)
  assert.equal(parseDlPath('/dl/latest.json', '?x=1'), null)
  assert.equal(parseDlPath('/dl/v0.2.1/' + DEB, '?token=1'), null)
  assert.equal(parseDlPath(undefined), null)
})

// ---- the handler, with a fake bucket
const BYTES = Buffer.from('0123456789abcdefghij')
function fakeObject(key, withBody, range) {
  const o = {
    key, size: BYTES.length, httpEtag: '"abc"',
    writeHttpMetadata(h) { h.set('Content-Type', key === 'latest.json' ? 'application/json' : 'application/octet-stream') }
  }
  if (withBody) {
    const part = range ? BYTES.subarray(range.offset, range.offset + range.length) : BYTES
    o.body = new Response(part).body
    if (range) o.range = range
  }
  return o
}
function env(store = { 'latest.json': 1, [`v0.2.1/${DEB}`]: 1, 'v0.2.1/SHA256SUMS': 1 }) {
  const calls = []
  return {
    calls,
    DL: {
      async head(key) { return store[key] ? fakeObject(key, false) : null },
      async get(key, opts) {
        calls.push({ key, opts })
        if (!store[key]) return null
        const h = opts.onlyIf
        if (h.get('If-None-Match') === '"abc"') return fakeObject(key, false)
        if (h.get('If-Match') && h.get('If-Match') !== '"abc"') return fakeObject(key, false)
        const m = /^bytes=(\d+)-(\d+)$/.exec(opts.range.get('Range') || '')
        if (opts.range.get('Range') && !m) throw new Error('bad range')
        return fakeObject(key, true, m ? { offset: +m[1], length: +m[2] - +m[1] + 1 } : undefined)
      }
    },
    ASSETS: { async fetch(req) { return new Response('static ' + new URL(req.url).pathname, { status: 200 }) } }
  }
}
const req = (path, init) => new Request('https://smartroute.yolea.ai' + path, init)

test('full download: 200, length, validators, attachment, immutable cache, security headers', async () => {
  const r = await worker.fetch(req('/dl/v0.2.1/' + DEB), env())
  assert.equal(r.status, 200)
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), BYTES.toString())
  assert.equal(r.headers.get('Content-Length'), '20')
  assert.equal(r.headers.get('Accept-Ranges'), 'bytes')
  assert.equal(r.headers.get('ETag'), '"abc"')
  assert.equal(r.headers.get('Content-Disposition'), `attachment; filename="${DEB}"`)
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains')
})

test('range request: 206 with Content-Range and the right bytes', async () => {
  const e = env()
  const r = await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { Range: 'bytes=5-9' } }), e)
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('Content-Range'), 'bytes 5-9/20')
  assert.equal(r.headers.get('Content-Length'), '5')
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), '56789')
  assert.ok(e.calls[0].opts.range instanceof Headers, 'the request headers go to R2')
})

test('suffix range reported by R2 becomes absolute bytes', async () => {
  const e = env()
  e.DL.get = async () => ({ ...fakeObject('v0.2.1/' + DEB, true, undefined), range: { suffix: 4 }, body: new Response('ghij').body })
  const r = await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { Range: 'bytes=-4' } }), e)
  assert.equal(r.headers.get('Content-Range'), 'bytes 16-19/20')
  assert.equal(r.headers.get('Content-Length'), '4')
})

test('unsatisfiable range: 416; conditional request: 304; failed precondition: 412', async () => {
  assert.equal((await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { Range: 'bytes=abc' } }), env())).status, 416)
  assert.equal((await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { 'If-None-Match': '"abc"' } }), env())).status, 304)
  assert.equal((await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { 'If-Match': '"zzz"' } }), env())).status, 412)
})

test('HEAD: headers and length without a body; missing object: 404', async () => {
  const r = await worker.fetch(req('/dl/v0.2.1/' + DEB, { method: 'HEAD' }), env())
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('Content-Length'), '20')
  assert.equal(await r.text(), '')
  assert.equal((await worker.fetch(req('/dl/v0.2.1/Smart-Route-0.2.1-win-x64.exe'), env())).status, 404)
})

test('latest.json: JSON, one minute cache', async () => {
  const r = await worker.fetch(req('/dl/latest.json'), env())
  assert.equal(r.status, 200)
  assert.match(r.headers.get('Content-Type'), /^application\/json/)
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=60')
  assert.equal(r.headers.get('Content-Disposition'), null)
})

test('wrong method: 405 with Allow; bad paths under /dl/: 404 and R2 untouched', async () => {
  const e = env()
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await worker.fetch(req('/dl/v0.2.1/' + DEB, { method: m, body: m === 'DELETE' ? undefined : 'x' }), e)
    assert.equal(r.status, 405)
    assert.equal(r.headers.get('Allow'), 'GET, HEAD')
  }
  for (const p of ['/dl/v9.9.9/' + DEB, '/dl/x', '/dl/v0.2.1/' + DEB + '?a=1', '/dl/v0.2.1/Smart-Route-0.2.0-linux-amd64.deb']) {
    assert.equal((await worker.fetch(req(p), e)).status, 404, p)
  }
  assert.equal(e.calls.length, 0)
})

test('everything else goes to the static assets untouched', async () => {
  const r = await worker.fetch(req('/en/'), env())
  assert.equal(await r.text(), 'static /en/')
})

test('a range starting past the end is 416 with Content-Range */size', async () => {
  const e = env()
  e.DL.get = async () => ({ ...fakeObject('v0.2.1/' + DEB, true, undefined), range: { offset: 99999 } })
  const r = await worker.fetch(req('/dl/v0.2.1/' + DEB, { headers: { Range: 'bytes=99999-' } }), e)
  assert.equal(r.status, 416)
  assert.equal(r.headers.get('Content-Range'), 'bytes */20')
})
