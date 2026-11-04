// The pages of the Smart Route site the app may open in the system browser: exact URLs, per language, nothing else.
// The footer and the About panel name an id; the main process looks the URL up here (it never opens a string from the page).
export type SiteLangId = 'fr' | 'en'

export const SITE_LINKS = {
  support: { fr: 'https://smartroute.yolea.ai/soutenir/', en: 'https://smartroute.yolea.ai/en/support/' },
  site: { fr: 'https://smartroute.yolea.ai/', en: 'https://smartroute.yolea.ai/en/' },
  legal: { fr: 'https://smartroute.yolea.ai/mentions-legales/', en: 'https://smartroute.yolea.ai/en/legal-notice/' },
  privacy: { fr: 'https://smartroute.yolea.ai/confidentialite/', en: 'https://smartroute.yolea.ai/en/privacy/' },
  yolea: { fr: 'https://yolea.ai/', en: 'https://yolea.ai/en/' },
  linkedin: { fr: 'https://www.linkedin.com/in/thierrymemel/', en: 'https://www.linkedin.com/in/thierrymemel/' }
} as const satisfies Record<string, Record<SiteLangId, string>>

export type SiteLinkId = keyof typeof SITE_LINKS
export const SITE_LINK_IDS = Object.keys(SITE_LINKS) as [SiteLinkId, ...SiteLinkId[]]

export function siteLinkUrl(id: SiteLinkId, lang: SiteLangId): string {
  return SITE_LINKS[id][lang]
}
