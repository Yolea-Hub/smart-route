'use strict'
const L = require('./_lib.js')
const args = process.argv.slice(2)
L.logArgs(args)

if (args[0] === 'auth') {
  if (args[1] === 'status') {
    if ((process.env.FAKE_AUTH || 'in') === 'in') {
      L.out('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}\n')
      process.exit(0)
    }
    L.out('{"loggedIn":false}\n')
    process.exit(1)
  }
  if (args[1] === 'login') {
    L.out('login flow\n')
    process.exit(0)
  }
  if (args[1] === 'logout') {
    L.out('logged out\n')
    process.exit(0)
  }
}
if (args[0] === '--version') {
  L.out('2.1.317 (Claude Code)\n')
  process.exit(0)
}

const role = args.includes('--json-schema') ? 'review' : 'run'
const mode = L.resolveMode(L.modeFor(role), role)

if (mode === 'epipe') process.exit(1)
L.writeStdinDump()

const emit = (result, structured) => {
  L.out('{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}\n')
  const ev = { type: 'result', subtype: 'success', is_error: false, result }
  if (structured !== undefined) ev.structured_output = structured
  L.out(JSON.stringify(ev) + '\n')
}

switch (mode) {
  case 'success': emit('OK from claude'); break
  case 'pass_text': emit('PASS all tests pass, ship it'); break
  case 'verdict_pass': emit('verdict', { pass: true, issues: [] }); break
  case 'verdict_fail': emit('verdict', { pass: false, issues: ['missing edge case', 'no test'] }); break
  case 'verdict_invalid': emit('verdict', { pass: 'maybe' }); break
  case 'fail': L.err('boom\n'); process.exit(3); break
  case 'badjson': L.out('this is not json at all\n{broken\n'); break
  case 'empty': emit(''); break
  case 'huge': L.out(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x'.repeat(300000) }) + '\n'); break
  case 'hang': L.hang(); break
  case 'stubborn': L.stubborn(); break
  case 'verdict_textonly': emit('{"pass":true,"issues":[]}'); break
  case 'network': L.err(L.NETWORK_NOISE); process.exit(1); break
  case 'network_once':
    if (L.bump('net') === 1) {
      L.err('dial tcp: i/o timeout\n')
      process.exit(1)
    }
    emit('OK from claude')
    break
  case 'notlogged':
    L.err('Not logged in\n')
    L.out('{"type":"result","subtype":"error","is_error":true,"result":"Not logged in - Please run /login"}\n')
    process.exit(1)
    break
  default: emit('OK from claude')
}
