# Yolea product identity: how a product shows Yolea and its own name

Reusable rules for every Yolea product (desktop app, web app, site). Model: the house site, yolea.ai (`yolea-landing`, classes `m-sky`, `m-footer`, `m-founder`), on Sogoma 4.0.2. Full example: Smart Route (this repository). French version: `IDENTITE-PRODUIT.fr.md`.

## 1. What is house-level, what is product-level

| Level | Content | Where it lives |
|---|---|---|
| House (Yolea) | The Yolea logo, the sentence "Yolea, from Abidjan.", "Yolea, Abidjan.", the founder's bio (approved text), tokens, fonts, the Sky, the grid | `kit/` (vendored, never edited), yolea.ai content keys |
| Product | The name, its mark (symbol), its message, its pages, its third-party vendor colours, its "Support" link | The product's repository |

A product never redraws the Yolea logo and never invents a brand colour: it uses Sogoma tokens.

## 2. The Sky (header)

Left to right, on the Oasis deep band:

1. **The Yolea logo made for the Sky**: `kit/logos/yolea-lockup-on-sky.svg`, 28 px high (about 100 px wide), as supplied. On the site it leads to yolea.ai; in an application it is not a link.
2. **A thin divider**: 1 px, `--on-oasis-deep`, opacity 0.5, the band's height minus `--space-12` on each side.
3. **The product**: its symbol in the dark-ground version (28 px, hidden below 480 px wide), then two lines of **HTML text**: the name (Inter 600, `max(--floor-act, 1.0625rem)`) and below it **"par Yolea" / "by Yolea"** (Inter 400, 13 px, `--on-oasis-deep`). This text is **always text from the language files**, never drawn in an image: it translates with the language, stays legible and selectable. The product's `*-lockup*.svg` files therefore carry only the symbol and the name.
4. **The section name** (applications only, hidden below 600 px).
5. **On the right**: the language switch and the theme button.
   - Language: **one control that names the other language** (FR or EN), as on yolea.ai; explicit `aria-label` ("EN Use … in English").
   - Theme: the Sogoma button (`sg-theme`) drawn as the half-lit disc (ring, half disc, empty ring on Day, full disc on Night); its words stay for a screen reader, the kit script writes them. Touch size at least `--size-touch`.
6. At Night the Sky goes to `--oasis-900` (darker than the page), as on the house site.
7. The Line (`sg-line`) closes the Sky. On an application's working screens the sun disc may stay; on a compact site header it is absent.

Phone (360 px): the Yolea logo, the divider, the name and "by Yolea", the language and the menu fit on one line; the product symbol hides below 480 px.

## 3. The product name

- The name is not translated and is written the same in both languages ("Smart Route").
- Signature format: **product name, then "par Yolea" in FR / "by Yolea" in EN** (language key `shell.by`). The only legal form: "Yolea, Abidjan."
- Page title: "Name · short hook". The Open Graph image carries the name, "par Yolea" and the address (baked image: the text "par Yolea" is written there by the render script, it is a picture).

## 4. The footer

Modelled on `m-footer`:

1. **The Yolea logo**: `yolea-lockup.svg` on Day, `yolea-lockup-reversed.svg` on Night (two images, one hidden per theme, as the charter's logos require: a Day file is never recoloured), 36 px high.
2. **The sentence**: "Yolea, depuis Abidjan." / "Yolea, from Abidjan." (Newsreader, 1.375 rem).
3. **The links**: **Support the product** ("Soutenir Smart Route" / "Support Smart Route") first, then legal notice, privacy, accessibility, licences. One calm link: no window, no nag.
4. **The languages**: "Français / English" list, the current one marked `aria-current`.
5. The "Help us improve this page" link (site), the third-party trademark line (application and licences page), then **"Yolea, Abidjan."**.

In a desktop application a footer link opens the browser by an id from the catalog (`src/core/siteLinks.ts`, channel `link:open`), never by a string from the page. In the browser build it is an ordinary link (`rel="noopener noreferrer"`).

## 5. The founder

- Site: an "About" section near the end, copied from the `m-founder` block: round portrait (`thierry-memel.200.webp` and `.400.webp`, rights cleared 1 Nov 2026), name, title, **approved text** (yolea.ai `home.founder.*` keys, copied word for word), LinkedIn link, plus one sentence on why the product exists.
- Application: the same text, **no photo** (images rule: never a person on a working screen), in Settings, "About" section, with the "Support" link.
- The house quote and "bio" paragraph are not copied when they point to context the product does not have ("these courses").

## 6. Third-party logos

- Folder `assets/brands/<vendor>/`, one `SOURCE.md` (URL, date, sha256, terms), never redrawn, never recoloured, no filter or glow on the logo: a working tool's glow is on its container.
- A black-ink logo on a transparent ground (OpenAI, the blossom) stands on a light tile (`--oasis-100`) at Night.
- A third party's logo is not the product's brand: it names a tool the product works with, never alongside that party's wordmark.

## 7. Colours and type

Sogoma tokens only. Exceptions are declared in `YOLEA.md` (vendor colours while their tool works). Fonts served by the product itself. French first, complete English in the same delivery; French punctuation (narrow no-break space U+202F before `; : ! ?` and inside « »).

## 8. Checklist for a new product

1. `kit/` vendored, `YOLEA.md` at the root, `sogoma-check` green.
2. Sky: Yolea logo, divider, symbol + name + "par Yolea" as text, language, theme.
3. Footer: Yolea logo (Day and Night), sentence, links including "Support", languages, "Yolea, Abidjan.".
4. Founder: approved text copied (site), no photo in the application.
5. FR / EN key parity (`tests/core/i18n.test.ts`); 360 px, keyboard only and Night looked at.
