// Writes site/recipes.json from src/core/recipes.ts and src/core/atlas.ts, so the site shows the same recipes as the application.
//   pnpm export:recipes            (node scripts/export-recipes.mjs [output-file])
// The two TypeScript files are bundled in memory with Vite (already a dev dependency) and run from a temporary file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, 'site', 'recipes.json'))

const entry = `export { RECIPES } from ${JSON.stringify(join(root, 'src/core/recipes.ts'))}\nexport { ATLAS } from ${JSON.stringify(join(root, 'src/core/atlas.ts'))}\nexport { USER_ROLES } from ${JSON.stringify(join(root, 'src/core/types.ts'))}\n`
const tmp = mkdtempSync(join(tmpdir(), 'sr-export-'))
try {
  writeFileSync(join(tmp, 'entry.ts'), entry)
  const res = await build({
    root: tmp,
    configFile: false,
    logLevel: 'silent',
    build: { ssr: join(tmp, 'entry.ts'), write: false, minify: false, rollupOptions: { output: { format: 'esm' } } }
  })
  const chunks = (Array.isArray(res) ? res : [res]).flatMap((r) => r.output ?? [])
  const code = chunks.find((c) => c.type === 'chunk' && c.isEntry)?.code
  if (!code) throw new Error('export-recipes: the bundle has no entry')
  writeFileSync(join(tmp, 'bundle.mjs'), code)
  const mod = await import(pathToFileURL(join(tmp, 'bundle.mjs')).href)
  // Names of jobs and tools come from the application's own i18n files, so the site cannot drift from them.
  const dict = (lang) => JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n', `${lang}.json`), 'utf8'))
  const names = { fr: dict('fr'), en: dict('en') }
  const pick = (key) => ({ fr: names.fr[key], en: names.en[key] })
  const data = {
    roles: mod.USER_ROLES.map((id) => ({ id, name: pick(`profile.${id}`), hint: pick(`profile.${id}.hint`) })),
    tools: Object.fromEntries(mod.ATLAS.map((e) => [e.tool, pick(`tool.${e.tool}`)])),
    recipes: mod.RECIPES.map((r) => ({
      id: r.id,
      role: r.role,
      title: r.title,
      desc: r.desc,
      steps: r.steps.map((s) => ({ tool: s.tool, role: s.role, tier: s.tier, instruction: s.instruction }))
    })),
    atlas: mod.ATLAS.map((e) => ({ tool: e.tool, vendor: e.vendor, strengths: e.strengths }))
  }
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
  console.log(`export-recipes: ${data.recipes.length} recipes, ${data.atlas.length} tools -> ${out}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
