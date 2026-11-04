'use strict'
const fs = require('node:fs')
const L = require('./_lib.js')
const args = process.argv.slice(2)
L.logArgs(args)

if (args[0] === 'login' && args[1] === 'status') {
  if ((process.env.FAKE_AUTH || 'in') === 'in') {
    L.out('Logged in using ChatGPT\n')
    process.exit(0)
  }
  L.out('Not logged in\n')
  process.exit(1)
}
if (args[0] === 'mcp') {
  L.out('[{"name":"ctx7","enabled":true},{"name":"bad name","enabled":true},{"name":"semgrep","enabled":true},{"name":"codex_app","enabled":false},{"name":"plugin_srv","enabled":true},{"name":"off_srv","enabled":false}]\n')
  process.exit(0)
}
if (args[0] === 'logout') {
  L.out('Logged out\n')
  process.exit(0)
}
if (args[0] === 'login') {
  L.out('login flow\n')
  process.exit(0)
}
if (args[0] === '--version') {
  L.out('codex-cli 0.166.0\n')
  process.exit(0)
}

let outFile = ''
let role = 'run'
args.forEach((a, i) => {
  if (args[i - 1] === '-o') outFile = a
  if (a === '--output-schema') role = 'review'
})
const mode = L.resolveMode(L.modeFor(role), role)

if (mode === 'epipe') process.exit(1)
L.writeStdinDump()

const event = () => L.out('{"type":"item.completed","item":{"type":"agent_message","text":"codex working"}}\n')
const write = (s) => fs.writeFileSync(outFile, s)

switch (mode) {
  case 'success': event(); write('OK from codex'); break
  case 'pass_text': event(); write('PASS all tests pass, ship it'); break
  case 'verdict_pass': event(); write('{"pass":true,"issues":[]}'); break
  case 'verdict_fail': event(); write('{"pass":false,"issues":["codex found a bug"]}'); break
  case 'verdict_prose': event(); write('Here is my verdict: {"pass":true,"issues":[]} thanks'); break
  case 'verdict_invalid': event(); write('{"pass":"maybe"}'); break
  case 'fail': L.err('boom\n'); process.exit(3); break
  case 'badjson': L.out('garbage\n'); write('text still written'); break
  case 'empty': event(); break
  case 'huge': event(); write('x'.repeat(300000)); break
  case 'hang': L.hang(); break
  case 'stubborn': L.stubborn(); break
  case 'network': L.err(L.NETWORK_NOISE); process.exit(1); break
  case 'network_once':
    if (L.bump('net') === 1) {
      L.err('dial tcp: i/o timeout\n')
      process.exit(1)
    }
    event()
    write('OK from codex')
    break
  case 'badconfig':
    if (args.join(' ').includes('mcp_servers.')) {
      L.err('Error loading config.toml: invalid transport in `mcp_servers.codex_app`\n')
      process.exit(1)
    }
    event()
    write('OK from codex')
    break
  case 'notlogged': L.err('Not logged in. Run codex login\n'); process.exit(1); break
  default: event(); write('OK from codex')
}
