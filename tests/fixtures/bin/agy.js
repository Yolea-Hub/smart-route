'use strict'
const fs = require('node:fs')
const L = require('./_lib.js')
const args = process.argv.slice(2)
L.logArgs(args)

if (args[0] === 'models') {
  if ((process.env.FAKE_AUTH || 'in') === 'in') {
    L.out('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n')
    process.exit(0)
  }
  L.err('Please sign in to continue\n')
  process.exit(1)
}
if (args[0] === '--version') {
  L.out('agy 1.4.12\n')
  process.exit(0)
}

// --settings takes a JSON object (inline) like the real CLI; a bad value is rejected.
const si = args.indexOf('--settings')
if (si >= 0) {
  try {
    const v = JSON.parse(args[si + 1] || '')
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
  } catch (e) {
    L.err('Error: --settings must be a JSON object of settings.json keys: ' + e.message + '\n')
    process.exit(2)
  }
}

const role = args.includes('--json-schema') ? 'review' : 'run'
const mode = L.resolveMode(L.modeFor(role), role)

// agy print mode: the prompt is the VALUE of -p/--print. Reproduce the real CLI: "-p --model ..." is rejected.
let prompt = ''
let havePrompt = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith('--print=') || a.startsWith('-p=')) {
    prompt = a.slice(a.indexOf('=') + 1)
    havePrompt = true
  } else if (a === '-p' || a === '--print') {
    const nxt = args[i + 1] === undefined ? '' : args[i + 1]
    if (nxt.startsWith('--')) {
      L.err(`Error: -p took "${nxt}" as its prompt, so the intended prompt was left as an argument and ignored. Attach the prompt to the flag (-p='your prompt') and move --model elsewhere on the command line.\n`)
      process.exit(2)
    }
    prompt = nxt
    havePrompt = true
    i++
  }
}
if (!havePrompt) {
  L.err('Error: no prompt\n')
  process.exit(2)
}
fs.writeFileSync(L.f('.fake-prompt-arg'), prompt)

// Real agy 1.4.12 stream-json shape (captured from a live call).
const emitStream = (text, status = 'SUCCESS', extra = {}, tool = false) => {
  L.out(JSON.stringify({ event: 'init', conversation_id: 'c1', init: { model: 'fake', cwd: process.cwd(), tools: [], permission_mode: 'request-review' } }) + '\n')
  if (tool) L.out('{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"run_command"}}\n')
  L.out(JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: text } }) + '\n')
  L.out(JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: '\n', duration_seconds: 2.5 } }) + '\n')
  L.out(JSON.stringify({ event: 'result', result: { status, response: text, duration_seconds: 3.1, num_turns: 1, ...extra } }) + '\n')
}

switch (mode) {
  case 'success': emitStream('OK from agy'); break
  case 'success_tool': emitStream('OK from agy', 'SUCCESS', {}, true); break
  case 'verdict_pass': emitStream('{"pass":true,"issues":[]}'); break
  case 'verdict_fail': emitStream('{"pass":false,"issues":["agy found a bug"]}'); break
  case 'verdict_structured': emitStream('see structured', 'SUCCESS', { structured: { pass: false, issues: ['agy structured'] } }); break
  case 'verdict_textonly': emitStream('Here is my verdict: {"pass":true,"issues":[]} thanks'); break
  case 'status_error': emitStream('boom', 'ERROR'); break
  case 'status_error_network': emitStream('error sending request for url (https://x)', 'ERROR'); break
  case 'fail': L.err('boom\n'); process.exit(3); break
  case 'badjson': L.out('{broken\n'); break
  case 'empty': emitStream(''); break
  case 'hang': L.hang(); break
  case 'warn':
    L.err('warning: --mode plan has no effect while slash command expansion is disabled.\n')
    emitStream('OK from agy')
    break
  case 'network': L.err(L.NETWORK_NOISE); process.exit(1); break
  case 'network_once':
    if (L.bump('net') === 1) {
      L.err('dial tcp: i/o timeout\n')
      process.exit(1)
    }
    emitStream('OK from agy')
    break
  case 'tool_permission':
    L.err('jetski: no output produced \u2014 a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g. command(<target>)). Alternatively, re-run with --dangerously-skip-permissions\n')
    process.exit(1)
    break
  case 'tool_permission_result':
    emitStream('jetski: no output produced \u2014 a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.', 'ERROR')
    break
  case 'notlogged': L.err('Please sign in\n'); process.exit(1); break
  default: emitStream('OK from agy')
}
