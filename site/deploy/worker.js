// Smart Route site Worker: serves the installers mirrored in R2 under /dl/*, everything else is the static site.
// wrangler.jsonc runs this script first only for /dl/*; any other path goes straight to the static assets (and keeps its _headers).
// GitHub Releases stay the source of truth: scripts/mirror-release.sh copies a release into the bucket and writes latest.json last.
// Checked against the Cloudflare docs (R2 Workers API: get(key, { range: Headers, onlyIf: Headers }), writeHttpMetadata, httpEtag, R2ObjectBody.range).

const FILE_RE = /^Smart-Route-(\d+\.\d+\.\d+)-(?:linux-(?:x86_64\.AppImage|amd64\.deb)|win-x64\.exe|mac-(?:arm64|x64)\.dmg)$/
const PATH_RE = /^\/dl\/v(\d+\.\d+\.\d+)\/([^/]+)$/
const VERSION_DIR_RE = /^\d+\.\d+\.\d+$/

// Security headers set here because _headers does not apply to a response made by the Worker (same values as site/public/_headers).
const SECURITY = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Content-Security-Policy': "default-src 'none'; sandbox",
	'Cross-Origin-Opener-Policy': 'same-origin',
	'X-Frame-Options': 'DENY'
}

/**
 * Pure path check for a /dl/ request. Returns { key, filename, immutable } for something we serve, or null (-> 404).
 * Accepts only /dl/latest.json and /dl/v<semver>/<installer or SHA256SUMS>, with the version in the file name equal to the folder's.
 * Any query string or fragment is refused: the URLs are fixed, nothing legitimate adds one.
 */
export function parseDlPath(pathname, search = '') {
	if (typeof pathname !== 'string' || search) return null
	if (pathname === '/dl/latest.json') return { key: 'latest.json', filename: null, immutable: false }
	const m = PATH_RE.exec(pathname)
	if (!m) return null
	const version = m[1]
	const name = m[2]
	if (!VERSION_DIR_RE.test(version)) return null
	if (name === 'SHA256SUMS') return { key: `v${version}/${name}`, filename: null, immutable: true }
	const f = FILE_RE.exec(name)
	if (!f || f[1] !== version) return null
	return { key: `v${version}/${name}`, filename: name, immutable: true }
}

function baseHeaders(extra) {
	const h = new Headers(SECURITY)
	for (const [k, v] of Object.entries(extra || {})) h.set(k, v)
	return h
}

function plain(status, text, extra) {
	return new Response(text, { status, headers: baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }) })
}

function objectHeaders(object, target) {
	const h = baseHeaders()
	object.writeHttpMetadata(h)
	h.set('ETag', object.httpEtag)
	h.set('Accept-Ranges', 'bytes')
	if (target.key === 'latest.json') {
		h.set('Content-Type', 'application/json; charset=utf-8')
		h.set('Cache-Control', 'public, max-age=60')
	} else {
		if (!h.get('Content-Type')) h.set('Content-Type', target.key.endsWith('SHA256SUMS') ? 'text/plain; charset=utf-8' : 'application/octet-stream')
		h.set('Cache-Control', 'public, max-age=31536000, immutable')
	}
	if (target.filename) h.set('Content-Disposition', `attachment; filename="${target.filename}"`)
	return h
}

// R2 reports the served range as { offset, length } or { suffix }; turn it into absolute first/last bytes.
function absoluteRange(range, size) {
	if (!range) return null
	let offset = range.offset
	let length = range.length
	if (range.suffix !== undefined) {
		length = Math.min(range.suffix, size)
		offset = size - length
	} else {
		offset = offset ?? 0
		length = Math.min(length ?? size - offset, size - offset)
	}
	return { first: offset, last: offset + length - 1, length }
}

async function serveDl(request, env, target) {
	if (request.method === 'HEAD') {
		const head = await env.DL.head(target.key)
		if (!head) return plain(404, 'Not found')
		const h = objectHeaders(head, target)
		h.set('Content-Length', String(head.size))
		return new Response(null, { status: 200, headers: h })
	}
	let object
	try {
		object = await env.DL.get(target.key, { range: request.headers, onlyIf: request.headers })
	} catch (err) {
		// A Range header R2 cannot satisfy (past the end, malformed) is the client's mistake; anything else is ours.
		if (request.headers.has('Range')) return plain(416, 'Range not satisfiable')
		throw err
	}
	if (object === null) return plain(404, 'Not found')
	const h = objectHeaders(object, target)
	if (!('body' in object) || !object.body) {
		// Preconditions failed: no body. A cache validator (If-None-Match / If-Modified-Since) means 304, otherwise 412.
		const validator = request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since')
		return new Response(null, { status: validator ? 304 : 412, headers: h })
	}
	const abs = absoluteRange(object.range, object.size)
	if (abs && abs.length <= 0) return plain(416, 'Range not satisfiable', { 'Content-Range': `bytes */${object.size}` })
	if (abs) {
		h.set('Content-Range', `bytes ${abs.first}-${abs.last}/${object.size}`)
		h.set('Content-Length', String(abs.length))
		return new Response(object.body, { status: 206, headers: h })
	}
	h.set('Content-Length', String(object.size))
	return new Response(object.body, { status: 200, headers: h })
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		if (!url.pathname.startsWith('/dl/')) return env.ASSETS.fetch(request)
		if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method not allowed', { Allow: 'GET, HEAD' })
		const target = parseDlPath(url.pathname, url.search)
		if (!target || url.hash) return plain(404, 'Not found')
		return serveDl(request, env, target)
	}
}
