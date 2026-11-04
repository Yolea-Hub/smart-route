// The only place that reads the brand folder: Vite lists the files at build time, so a missing folder gives an empty map.
import { selectLogo, type BrandManifest, type LogoKind } from './brandLogos'

const files = import.meta.glob('../../../assets/brands/*/*.{svg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const manifests = import.meta.glob('../../../assets/brands/manifest.json', { eager: true, import: 'default' }) as Record<string, BrandManifest>
const manifest: BrandManifest | null = Object.values(manifests)[0] ?? null

/** Official logo URL of a vendor (or of one of its tools), undefined when the owner has not supplied one. */
export function brandLogo(vendor: string, tool?: string, kind: LogoKind = 'mark'): string | undefined {
  return selectLogo(files, vendor, { tool, kind, manifest })
}

/** The variant made for a dark surface (Night), when the vendor supplies one (OpenAI: Blossom White), else undefined. */
export function brandLogoNight(vendor: string, tool?: string, kind: LogoKind = 'mark'): string | undefined {
  const night = selectLogo(files, vendor, { tool, kind, manifest, dark: true })
  return night !== undefined && night !== brandLogo(vendor, tool, kind) ? night : undefined
}

const logo = (g: Record<string, string>): string | undefined => Object.values(g)[0]

// The Sky is Oasis deep. Left: the Yolea lockup made for the Sky (kit file, as supplied). Then the Smart Route mark in its reversed
// version; the product name and « par Yolea » are text from the i18n files, not drawing (docs/IDENTITE-PRODUIT).
const yoleaOnSky = import.meta.glob('../../../kit/logos/yolea-lockup-on-sky.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const srMark = import.meta.glob('../../../assets/brand/smart-route-mark-reversed.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
/** The Yolea lockup for the Sky, undefined until the file exists (the name « Yolea » is shown then). */
export const YOLEA_SKY_URL: string | undefined = logo(yoleaOnSky)
/** The Smart Route mark for the Sky. */
export const MARK_URL: string | undefined = logo(srMark)

// The footer sits on the page ground: Day takes the ink lockup, Night the reversed one (on its own plate), both kit files untouched.
const yoleaDay = import.meta.glob('../../../kit/logos/yolea-lockup.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const yoleaNight = import.meta.glob('../../../kit/logos/yolea-lockup-reversed.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
export const YOLEA_DAY_URL: string | undefined = logo(yoleaDay)
export const YOLEA_NIGHT_URL: string | undefined = logo(yoleaNight)
