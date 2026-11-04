import { describe, expect, it } from 'vitest'
import { selectLogo, splitBrandPath } from '../../src/renderer/src/brandLogos'

const p = (vendor: string, file: string): [string, string] => [`../../../assets/brands/${vendor}/${file}`, `/assets/${file}`]
const files = Object.fromEntries([
  p('anthropic', 'ClaudeIcon-Rounded.svg'),
  p('anthropic', 'ClaudeIcon-Square.svg'),
  p('anthropic', 'Claude-logo---Ivory.svg'),
  p('anthropic', 'Claude-logo---Slate.svg'),
  p('anthropic', 'Claude-Code-logo---Slate.svg'),
  p('anthropic', 'Claude-Spark---Clay.svg'),
  p('google', 'antigravity-favicon.svg'),
  p('google', 'antigravity-logo-276.png'),
  p('google', 'gemini-sparkle.svg'),
  p('google', 'gemini-sparkle-512.png'),
  p('openai', 'OAI_OpenAI-Blossom_Black.svg'),
  p('openai', 'OAI_OpenAI-Blossom_White.svg'),
  p('openai', 'OAI_OpenAI-Blossom_Black.png'),
  p('openai', 'OAI_OpenAI-Blossom_White.png')
])

describe('selectLogo', () => {
  it('splits the bundled path into vendor folder and file', () => {
    expect(splitBrandPath('/x/assets/brands/openai/logo.svg')).toEqual(['openai', 'logo.svg'])
    expect(splitBrandPath('/x/other/logo.svg')).toBeNull()
  })

  it('picks the self-contained icon of a vendor, not a light wordmark', () => {
    expect(selectLogo(files, 'anthropic')).toBe('/assets/ClaudeIcon-Rounded.svg')
  })

  it('a vendor-level logo is not the logo of one of its tools, and a tool takes its own file', () => {
    expect(selectLogo(files, 'google')).toBe('/assets/gemini-sparkle.svg')
    expect(selectLogo(files, 'google', { tool: 'agy' })).toBe('/assets/antigravity-favicon.svg')
  })

  it('a wordmark request picks a wordmark, dark text before the ivory one', () => {
    expect(selectLogo(files, 'anthropic', { kind: 'wordmark' })).toBe('/assets/Claude-logo---Slate.svg')
  })

  it('a manifest wins over the file names, per tool or by default; an unknown file name is ignored', () => {
    const manifest = { anthropic: { default: 'Claude-Spark---Clay.svg', 'claude-code': 'Claude-Code-logo---Slate.svg' } }
    expect(selectLogo(files, 'anthropic', { manifest })).toBe('/assets/Claude-Spark---Clay.svg')
    expect(selectLogo(files, 'anthropic', { manifest, tool: 'claude-code' })).toBe('/assets/Claude-Code-logo---Slate.svg')
    expect(selectLogo(files, 'anthropic', { manifest: { anthropic: { default: 'missing.svg' } } })).toBe('/assets/ClaudeIcon-Rounded.svg')
  })

  it('OpenAI: the Black Blossom on light surfaces, the White one on dark (Night), never the PNG', () => {
    expect(selectLogo(files, 'openai')).toBe('/assets/OAI_OpenAI-Blossom_Black.svg')
    expect(selectLogo(files, 'openai', { dark: true })).toBe('/assets/OAI_OpenAI-Blossom_White.svg')
  })

  it('returns undefined when the vendor folder has no file (the chip with the name is shown)', () => {
    expect(selectLogo(files, 'nobody')).toBeUndefined()
    expect(selectLogo({}, 'anthropic')).toBeUndefined()
  })
})
