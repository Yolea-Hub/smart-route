// Writes site/licences-deps.json: the production dependencies of the application (name, version, licence, URL), for the site "Licences" page.
//   pnpm export:licences            (node scripts/export-licences.mjs [output-file])
// Source: `pnpm licenses list --prod --json --long` (installed packages; run `pnpm install` first). Sorted, so the output is stable.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, 'site', 'licences-deps.json'))

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--long'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
const byLicence = JSON.parse(raw)
const rows = []
for (const [licence, pkgs] of Object.entries(byLicence)) {
  for (const p of pkgs) {
    for (const version of p.versions ?? []) {
      const url = typeof p.homepage === 'string' && /^https:\/\//.test(p.homepage) ? p.homepage : `https://www.npmjs.com/package/${p.name}`
      rows.push({ name: p.name, version, licence, url })
    }
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
if (rows.length === 0) throw new Error('export-licences: pnpm returned no production dependency')
writeFileSync(out, JSON.stringify(rows, null, 2) + '\n')
console.log(`export-licences: ${rows.length} packages -> ${out}`)
