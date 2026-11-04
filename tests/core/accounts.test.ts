import { describe, expect, it } from 'vitest'
import { parseAgyModels, parseClaudeStatus, parseCodexStatus } from '../../src/core/accounts'

describe('status parsers', () => {
  it('claude: logged in / out / garbage', () => {
    expect(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}', 0)).toEqual({ state: 'connected', method: 'claude.ai' })
    expect(parseClaudeStatus('{"loggedIn":false}', 1)).toEqual({ state: 'disconnected' })
    expect(parseClaudeStatus('Not logged in. Run claude auth login', 1)).toEqual({ state: 'disconnected' })
    expect(parseClaudeStatus('weird', 0).state).toBe('unknown')
    expect(parseClaudeStatus('{broken', 0).state).toBe('unknown')
  })

  it('codex: logged in / out', () => {
    expect(parseCodexStatus('Logged in using ChatGPT\n', 0)).toEqual({ state: 'connected', method: 'ChatGPT' })
    expect(parseCodexStatus('Logged in using an API key - sk-***', 0).state).toBe('connected')
    expect(parseCodexStatus('Not logged in', 1)).toEqual({ state: 'disconnected' })
    expect(parseCodexStatus('', 1).state).toBe('unknown')
  })

  it('agy: model list when signed in, sign-in request otherwise', () => {
    expect(parseAgyModels('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n', 0).state).toBe('connected')
    expect(parseAgyModels('Please sign in to continue', 1)).toEqual({ state: 'disconnected' })
    expect(parseAgyModels('', 0).state).toBe('unknown')
  })

  it('never exposes anything but the method (no email, no token)', () => {
    const s = parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","token":"secret"}', 0)
    expect(JSON.stringify(s)).not.toContain('secret')
    expect(JSON.stringify(s)).not.toContain('a@b.c')
  })
})
