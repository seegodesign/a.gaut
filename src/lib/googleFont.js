const FALLBACK_FONT_STACK = "'Helvetica Neue', 'Avenir Next', 'Futura PT', sans-serif"

function normalizeGoogleFontFamily(value) {
  if (typeof value !== 'string') return ''

  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

export function createGoogleFontSettings(value) {
  const family = normalizeGoogleFontFamily(value)

  if (!family) {
    return {
      href: null,
      style: `--site-font-family: ${FALLBACK_FONT_STACK}`,
    }
  }

  const query = new URLSearchParams({ family, display: 'swap' })

  return {
    href: `https://fonts.googleapis.com/css2?${query}`,
    style: `--site-font-family: ${JSON.stringify(family)}, ${FALLBACK_FONT_STACK}`,
  }
}
