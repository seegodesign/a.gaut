const DEFAULT_STOPS = {
  overheadLight: { color: '#ffffff', opacity: 98 },
  edgeVignette: { color: '#cfccc2', opacity: 16 },
  gradientTop: { color: '#fafaf8', opacity: 100 },
  gradientMiddle: { color: '#f7f7f4', opacity: 100 },
  gradientBottom: { color: '#deddd3', opacity: 100 },
}

const CSS_VARIABLES = {
  overheadLight: '--background-overhead-light',
  edgeVignette: '--background-edge-vignette',
  gradientTop: '--background-gradient-top',
  gradientMiddle: '--background-gradient-middle',
  gradientBottom: '--background-gradient-bottom',
}

function normalizeHex(value, fallback) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return /^#[\da-f]{6}$/i.test(candidate) ? candidate : fallback
}

function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

function resolveStop(settings, name) {
  const fallback = DEFAULT_STOPS[name]
  const color = normalizeHex(settings?.[name]?.color, fallback.color)
  const parsedOpacity = Number(settings?.[name]?.opacity)
  const opacity = Number.isFinite(parsedOpacity)
    ? Math.min(100, Math.max(0, parsedOpacity)) / 100
    : fallback.opacity / 100
  const [red, green, blue] = hexToRgb(color)

  return {
    color,
    cssColor: `rgba(${red}, ${green}, ${blue}, ${opacity})`,
  }
}

export function createBackgroundStyle(settings) {
  return Object.keys(DEFAULT_STOPS)
    .map((name) => `${CSS_VARIABLES[name]}: ${resolveStop(settings, name).cssColor}`)
    .join('; ')
}

export function getBackgroundThemeColor(settings) {
  return resolveStop(settings, 'gradientTop').color
}
