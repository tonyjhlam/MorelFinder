/**
 * Color utilities for the MorelFinder map.
 */

/**
 * Map a soil temperature (°F) to a hex color for display.
 * Blue (cold) → teal (optimal 50–55°F) → orange/red (too hot).
 */
export function soilTempColor(tempF) {
  if (tempF == null || isNaN(tempF)) return '#6e7681'
  if (tempF < 40)  return '#74c0fc'
  if (tempF < 48)  return '#a9d8f5'
  if (tempF < 50)  return '#b8e8b0'
  if (tempF <= 55) return '#2ecc71'
  if (tempF <= 62) return '#f5a623'
  return '#e74c3c'
}

/**
 * Returns fill/outline colors for fire perimeters by year.
 */
export function fireColors(year) {
  if (year === 2025 || year === '2025') {
    return { fill: '#E63946', outline: '#B71C2C', opacity: 0.38 }
  }
  // 2024 and earlier
  return { fill: '#FF8C00', outline: '#E65C00', opacity: 0.32 }
}

/**
 * Notable fires with special highlighting.
 * Keys are lowercased fire name substrings.
 */
export const NOTABLE_FIRES = {
  'bear gulch':      { year: 2025, priority: 'HIGH',   label: 'Bear Gulch — Best 2026 west-side target' },
  'retreat':         { year: 2024, priority: 'HIGH',   label: 'Retreat Fire — White Pass' },
  'pioneer':         { year: 2024, priority: 'MEDIUM', label: 'Pioneer Fire — Lake Chelan' },
  'williams mine':   { year: 2024, priority: 'MEDIUM', label: 'Williams Mine — Mt. Adams' },
  'miners complex':  { year: 2024, priority: 'MEDIUM', label: 'Miners Complex — Mt. Baker-Snoqualmie NF' },
  'lower sugarloaf': { year: 2025, priority: 'MEDIUM', label: 'Lower Sugarloaf — Leavenworth' },
  'labor mountain':  { year: 2025, priority: 'MEDIUM', label: 'Labor Mountain — Cle Elum' },
  'wildcat':         { year: 2025, priority: 'MEDIUM', label: 'Wildcat — William O. Douglas Wilderness' },
}

export function getNotableFire(name) {
  if (!name) return null
  const lower = name.toLowerCase()
  for (const [key, val] of Object.entries(NOTABLE_FIRES)) {
    if (lower.includes(key)) return val
  }
  return null
}

/**
 * SWE (snow water equivalent, inches) to a display color.
 */
export function sweColor(sweInches) {
  if (sweInches == null || sweInches <= 0) return '#4ecca3'  // no snow
  if (sweInches < 3)  return '#a9d8f5'
  if (sweInches < 10) return '#74c0fc'
  if (sweInches < 24) return '#4895ef'
  return '#2b5ea7'
}
