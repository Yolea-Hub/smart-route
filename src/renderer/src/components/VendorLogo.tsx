import type { Vendor } from '../../../core/types'
import { brandLogo, brandLogoNight } from '../brandAssets'
import type { LogoKind } from '../brandLogos'
import { useI18n } from '../i18n/i18n'

/**
 * The official logo file of a vendor (or of one of its tools) from assets/brands/<vendor>/, exactly as supplied: no filter, no glow,
 * no recolouring on this element. The glow of a working node is on the node's container. Without a file, the vendor's name on a chip
 * that carries its colour on the border (first letter only with `short`).
 */
export function VendorLogo({ vendor, tool, size = 28, kind = 'mark', short = false }: { vendor: Vendor; tool?: string; size?: number; kind?: LogoKind; short?: boolean }) {
  const { t } = useI18n()
  const url = brandLogo(vendor, tool, kind)
  if (url) {
    // OpenAI supplies a Black and a White Blossom: Black on light surfaces (Day), White on dark ones (Night), both as supplied.
    const night = vendor === 'openai' ? brandLogoNight(vendor, tool, kind) : undefined
    const img = (src: string, cls: string) =>
      kind === 'mark' ? (
        <img className={`vlogo${cls}`} src={src} width={size} height={size} alt="" decoding="async" />
      ) : (
        <img className={`vlogo vlogo--wide${cls}`} src={src} height={size} alt="" decoding="async" />
      )
    return night ? (
      <>
        {img(url, ' vlogo--day')}
        {img(night, ' vlogo--night')}
      </>
    ) : (
      img(url, '')
    )
  }
  // `short`: where the name is printed right beside the logo (a node of the route), the chip keeps only its first letter.
  const name = t(`vendor.${vendor}`)
  return short ? (
    <span className={`vchip vchip--short v-${vendor}`} title={name} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  ) : (
    <span className={`vchip v-${vendor}`}>{name}</span>
  )
}

/**
 * The logo and the vendor's name, for the places that print the name beside the logo. When the logo file is missing, the chip already
 * shows the name, so the printed one becomes screen-reader text only (the name is never shown twice).
 */
export function VendorBadge({ vendor, tool, size = 20, nameClass }: { vendor: Vendor; tool?: string; size?: number; nameClass?: string }) {
  const { t } = useI18n()
  const has = brandLogo(vendor, tool) !== undefined
  return (
    <>
      <VendorLogo vendor={vendor} tool={tool} size={size} />
      <span className={has ? nameClass : 'sg-visually-hidden'}>{t(`vendor.${vendor}`)}</span>
    </>
  )
}
