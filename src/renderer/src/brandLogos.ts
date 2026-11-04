// Choosing the official logo file of a vendor: pure. The files are the owner's, as supplied, never redrawn.

export type LogoKind = 'mark' | 'wordmark'
/** Optional `assets/brands/manifest.json`: per vendor folder, a file name for `default` or for a tool id. */
export type BrandManifest = Record<string, Record<string, string>>

const TOOL_WORDS: Record<string, RegExp> = {
  'claude-code': /claude[-_ ]?code/i,
  codex: /codex/i,
  agy: /antigravity|agy/i,
  cowork: /cowork/i
}
const MARK_WORDS = /icon|mark|symbol|spark|glyph|blossom|favicon/i
const WORDMARK_WORDS = /logo|wordmark|lockup/i
// Light variants are made for dark grounds: the app's ground is mostly white, so they come last.
const LIGHT_VARIANT = /ivory|white|reversed|light/i
const FLAT_VARIANT = /one[-_ ]?color|mono|outline/i

function score(file: string, tool: string | undefined, kind: LogoKind, dark: boolean): number {
  const name = file.replace(/\.[a-z0-9]+$/i, '')
  let s = 0
  if (kind === 'mark') {
    if (MARK_WORDS.test(name)) s += 50
    if (/rounded/i.test(name)) s += 20
    if (/square/i.test(name)) s += 10
  } else if (WORDMARK_WORDS.test(name) && !MARK_WORDS.test(name)) s += 50
  if (tool && TOOL_WORDS[tool]?.test(name)) s += 30
  // A logo of a vendor as a whole is not the logo of one of its tools (Gemini is not Antigravity).
  if (!tool && Object.values(TOOL_WORDS).some((rx) => rx.test(name))) s -= 30
  // On a dark ground the light variant is the right one; on a light ground it is the last choice.
  if (LIGHT_VARIANT.test(name)) s += dark ? 40 : -40
  if (FLAT_VARIANT.test(name)) s -= 10
  if (/\.svg$/i.test(file)) s += 1
  return s
}

/** Folder of a bundled asset path: `.../assets/brands/<vendor>/<file>` gives `[vendor, file]`. */
export function splitBrandPath(path: string): [string, string] | null {
  const m = /\/brands\/([^/]+)\/([^/]+)$/.exec(path)
  return m ? [m[1] as string, m[2] as string] : null
}

/**
 * The URL of the best logo for `vendor` (and `tool`, when the tool has its own), or undefined when the folder has none.
 * `files` maps a bundled asset path to its URL. A manifest entry wins over the file-name scoring.
 */
export function selectLogo(
  files: Record<string, string>,
  vendor: string,
  opts: { tool?: string; kind?: LogoKind; manifest?: BrandManifest | null; dark?: boolean } = {}
): string | undefined {
  const kind = opts.kind ?? 'mark'
  const own: [string, string][] = []
  for (const [path, url] of Object.entries(files)) {
    const parts = splitBrandPath(path)
    if (parts && parts[0] === vendor) own.push([parts[1], url])
  }
  if (own.length === 0) return undefined
  const entry = opts.dark ? undefined : opts.manifest?.[vendor]
  const wanted = (opts.tool ? entry?.[opts.tool] : undefined) ?? entry?.['default']
  if (wanted) {
    const hit = own.find(([file]) => file === wanted)
    if (hit) return hit[1]
  }
  let best: [string, string] | undefined
  let bestScore = -Infinity
  for (const item of own.sort((a, b) => a[0].localeCompare(b[0]))) {
    const sc = score(item[0], opts.tool, kind, opts.dark === true)
    if (sc > bestScore) {
      best = item
      bestScore = sc
    }
  }
  return best?.[1]
}
