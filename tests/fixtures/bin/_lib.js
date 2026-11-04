'use strict'
// Shared helpers for the fake CLIs (Node, so they run on Linux, macOS and Windows). Behaviour is controlled
// by "<cwd>/.fake-mode" (key=value lines):
//   default=<mode>   used when no role key matches
//   run=<mode>       non-review calls          review=<mode>   review calls (structured verdict requested)
// Every call appends its arguments (space-joined) to "<cwd>/.fake-args".
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const FAKE_DIR = process.cwd()
const f = (name) => path.join(FAKE_DIR, name)

function logArgs(args) {
  if (fs.existsSync(f('.fake-mode'))) fs.appendFileSync(f('.fake-args'), args.join(' ') + '\n')
}

function modeFor(role) {
  let m = ''
  if (fs.existsSync(f('.fake-mode'))) {
    const lines = fs.readFileSync(f('.fake-mode'), 'utf8').split(/\r?\n/)
    const last = (key) => {
      const hits = lines.filter((l) => l.startsWith(key + '='))
      return hits.length ? hits[hits.length - 1].slice(key.length + 1) : ''
    }
    m = last(role) || last('default')
  }
  return m || 'success'
}

// bump(name) -> the new count (1 for the first call)
function bump(name) {
  const file = f('.fake-count-' + name)
  let n = 0
  try {
    n = Number(fs.readFileSync(file, 'utf8').trim()) || 0
  } catch {
    n = 0
  }
  n += 1
  fs.writeFileSync(file, String(n) + '\n')
  return n
}

// Long-lived grandchild in our process group; both pids are recorded.
function spawnChild() {
  const c = spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  fs.appendFileSync(f('.fake-pids'), c.pid + '\n' + process.pid + '\n')
}

function hang() {
  spawnChild()
  setInterval(() => {}, 1000)
}

function stubborn() {
  process.on('SIGTERM', () => {})
  spawnChild()
  setInterval(() => {}, 1000)
}

function resolveMode(mode, role) {
  switch (mode) {
    case 'fail_once':
      return bump(role) === 1 ? 'fail' : 'success'
    case 'verdict_fail_then_pass':
      return bump(role) === 1 ? 'verdict_fail' : 'verdict_pass'
    default:
      return mode
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function writeStdinDump() {
  fs.writeFileSync(f('.fake-stdin'), readStdin())
}

const out = (s) => process.stdout.write(s)
const err = (s) => process.stderr.write(s)
const NETWORK_NOISE = 'WARN mcp ctx7 starting\n\n\nERROR error sending request for url (https://chatgpt.com/backend-api)\n'

module.exports = { FAKE_DIR, f, logArgs, modeFor, bump, spawnChild, hang, stubborn, resolveMode, readStdin, writeStdinDump, out, err, NETWORK_NOISE }
