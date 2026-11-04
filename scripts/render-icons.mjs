// Renders every raster brand asset from the hand-written SVGs with @resvg/resvg-js (pinned in package.json).
// Usage: pnpm icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = join(root, 'assets', 'brand')
const font = join(root, 'assets', 'fonts', 'InterVariable.ttf')
const read = (p) => readFileSync(join(root, p), 'utf8')

const OASIS_DEEP = '#0A3F3B'
const OASIS = '#0E6A62'

/** Rasterise an SVG string to a PNG buffer `width` px wide. */
function png(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [font], loadSystemFonts: false, defaultFontFamily: 'Inter Variable' }
  })
  return r.render().asPng()
}
function out(rel, buf) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, buf)
  console.log(rel, buf.length, 'bytes')
}

// 0. The two lockups (mark + « Smart Route »), written here so that they stay in step. « par Yolea » is NOT drawn in them: in the
// interface it is text from the i18n files next to the Yolea logo (docs/IDENTITE-PRODUIT); only the raster Open Graph image prints it.
const FONT_STACK = "Inter Variable, Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
function lockupSvg(stroke, text) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 96" width="380" height="96" role="img" aria-labelledby="t">
  <title id="t">Smart Route</title>
  <g fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20C34 20 38 48 62 48"/><path d="M8 48H62"/><path d="M8 76C34 76 38 48 62 48"/><path d="M62 48H90"/></g>
  <circle cx="62" cy="48" r="11" fill="#F0A437"/>
  <text x="112" y="59" font-family="${FONT_STACK}" font-weight="600" font-size="40" letter-spacing="-0.8" fill="${text}">Smart Route</text>
</svg>
`
}
out('assets/brand/smart-route-lockup.svg', Buffer.from(lockupSvg('#0A3F3B', '#13242B')))
out('assets/brand/smart-route-lockup-reversed.svg', Buffer.from(lockupSvg('#FFFFFF', '#FFFFFF')))

const appIcon = read('assets/brand/smart-route-app-icon.svg')

// 1. Desktop icons (electron-builder derives .ico/.icns from build/icon.png)
out('build/icon.png', png(appIcon, 1024))
for (const n of [16, 32, 48, 64, 128, 256, 512]) out(`build/icons/${n}.png`, png(appIcon, n))

// 2. Site favicons (apple-touch is full-bleed: the OS rounds it)
out('assets/brand/favicon-32.png', png(appIcon, 32))
out('assets/brand/apple-touch-180.png', png(appIcon.replace('rx="224"', 'rx="0"'), 180))

// 3. Open Graph image 1200x630, layout from Sogoma kit/og/og.svg (Sky band at 3.333x). One sun only: the lockup's disc; the Sky band carries no disc.
const lockup = read('assets/brand/smart-route-lockup-reversed.svg')
const inner = lockup.replace(/^[\s\S]*?<title[^>]*>.*?<\/title>/, '').replace(/<\/svg>\s*$/, '')
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <title>Smart Route par Yolea</title>
  <rect width="1200" height="630" fill="${OASIS_DEEP}"/>
  <rect x="0" y="153.33" width="1200" height="6.67" fill="${OASIS}"/>
  <g transform="translate(150 214) scale(2.6)">${inner}</g>
  <text x="446" y="426" font-family="Inter Variable, Inter, sans-serif" font-weight="500" font-size="42" fill="#A6B8B4">par Yolea</text>
  <text x="600" y="548" text-anchor="middle" font-family="Inter Variable, Inter, sans-serif" font-weight="500" font-size="44" fill="#FFFFFF">smartroute.yolea.ai</text>
</svg>
`
out('assets/brand/og.svg', Buffer.from(og))
const ogPng = png(og, 1200)
out('assets/brand/og.png', ogPng)

// 4. Contact sheet for review
const b64 = (b) => b.toString('base64')
const img = (buf, x, y, w) => `<image x="${x}" y="${y}" width="${w}" height="${w}" href="data:image/png;base64,${b64(buf)}"/>`
const label = (x, y, t) => `<text x="${x}" y="${y}" font-family="Inter Variable" font-size="14" fill="#4B5D63">${t}</text>`
const strip = (file) => read(file).replace(/^[\s\S]*?(<title)/, '$1').replace(/<\/svg>\s*$/, '')
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 960" width="1240" height="960">
  <rect width="1240" height="960" fill="#F4F7F6"/>
  ${label(20, 28, 'App icon 16 / 32 / 128 / 512 (rendered PNG, actual pixels)')}
  ${img(png(appIcon, 16), 20, 50, 16)}
  ${img(png(appIcon, 32), 60, 50, 32)}
  ${img(png(appIcon, 128), 120, 50, 128)}
  ${img(png(appIcon, 512), 280, 50, 512)}
  ${label(820, 28, 'Mark on white / on Oasis deep')}
  <rect x="820" y="50" width="180" height="180" fill="#FFFFFF" stroke="#D6E3E0"/>
  <svg x="840" y="70" width="140" height="140" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark.svg')}</svg>
  <rect x="1020" y="50" width="180" height="180" fill="${OASIS_DEEP}"/>
  <svg x="1040" y="70" width="140" height="140" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark-reversed.svg')}</svg>
  ${label(820, 262, 'Mark at 16 / 24 / 32 px on white and on Oasis deep')}
  <rect x="820" y="276" width="190" height="56" fill="#FFFFFF" stroke="#D6E3E0"/>
  <rect x="1020" y="276" width="190" height="56" fill="${OASIS_DEEP}"/>
  <svg x="832" y="292" width="16" height="16" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark.svg')}</svg>
  <svg x="866" y="288" width="24" height="24" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark.svg')}</svg>
  <svg x="908" y="284" width="32" height="32" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark.svg')}</svg>
  <svg x="1032" y="292" width="16" height="16" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark-reversed.svg')}</svg>
  <svg x="1066" y="288" width="24" height="24" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark-reversed.svg')}</svg>
  <svg x="1108" y="284" width="32" height="32" viewBox="0 0 96 96">${strip('assets/brand/smart-route-mark-reversed.svg')}</svg>
  ${label(820, 372, 'Lockup (light) / lockup reversed')}
  <rect x="820" y="386" width="380" height="120" fill="#FFFFFF" stroke="#D6E3E0"/>
  <svg x="820" y="398" width="380" height="96" viewBox="0 0 380 96">${strip('assets/brand/smart-route-lockup.svg')}</svg>
  <rect x="820" y="520" width="380" height="120" fill="${OASIS_DEEP}"/>
  <svg x="820" y="532" width="380" height="96" viewBox="0 0 380 96">${strip('assets/brand/smart-route-lockup-reversed.svg')}</svg>
  ${label(20, 600, 'Open Graph 1200x630 (scaled 50 %)')}
  <image x="20" y="620" width="600" height="315" href="data:image/png;base64,${b64(ogPng)}"/>
  ${label(640, 700, 'Favicon 32 + apple-touch 180')}
  ${img(png(appIcon, 32), 640, 720, 32)}
  ${img(png(appIcon.replace('rx="224"', 'rx="0"'), 180), 700, 720, 180)}
</svg>
`
out('assets/brand/preview.png', png(sheet, 1240))
