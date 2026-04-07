/**
 * Growing Degree Day (GDD) calculation for morel prediction.
 *
 * Based on research by Mihail (University of Missouri): accumulated soil
 * temperature above 32°F over a 20-day window. ~410 GDD triggers first
 * appearance; 300–500 is prime season.
 */

const BASE_TEMP_F = 32
const PRIME_THRESHOLD = 410
const WINDOW_DAYS = 20

/**
 * Calculate GDD from an array of hourly soil temperature values (°F).
 * Groups into 24-hour days, computes daily mean, accumulates degree days.
 */
export function computeGDD(hourlyTemps) {
  if (!hourlyTemps || hourlyTemps.length === 0) return 0

  const dailyMeans = []
  const hoursPerDay = 24
  for (let i = 0; i < hourlyTemps.length; i += hoursPerDay) {
    const chunk = hourlyTemps.slice(i, i + hoursPerDay).filter(t => t != null && !isNaN(t))
    if (chunk.length >= 12) {
      dailyMeans.push(chunk.reduce((a, b) => a + b, 0) / chunk.length)
    }
  }

  // Use the most recent WINDOW_DAYS days
  const window = dailyMeans.slice(-WINDOW_DAYS)
  return window.reduce((sum, t) => sum + Math.max(0, t - BASE_TEMP_F), 0)
}

/**
 * Returns a display descriptor for a GDD value.
 */
export function gddStatus(gdd) {
  if (gdd < 50)  return { label: 'Too Early',    color: '#4a90d9', pct: (gdd / PRIME_THRESHOLD) * 100 }
  if (gdd < 200) return { label: 'Approaching',  color: '#f5c542', pct: (gdd / PRIME_THRESHOLD) * 100 }
  if (gdd < 300) return { label: 'Getting Close',color: '#a8d86e', pct: (gdd / PRIME_THRESHOLD) * 100 }
  if (gdd < 500) return { label: 'Prime Window', color: '#2ecc71', pct: Math.min(100, (gdd / PRIME_THRESHOLD) * 100) }
  return { label: 'Late Season', color: '#e67e22', pct: 100 }
}

/**
 * Returns a status descriptor for a soil temperature value (°F).
 */
export function soilTempStatus(tempF) {
  if (tempF == null || isNaN(tempF)) return { label: 'No data', color: '#6e7681' }
  if (tempF < 40) return { label: 'Too cold',  color: '#74c0fc' }
  if (tempF < 48) return { label: 'Warming',   color: '#a9d8f5' }
  if (tempF < 50) return { label: 'Near range',color: '#a8d86e' }
  if (tempF <= 55) return { label: 'Optimal',  color: '#2ecc71' }
  if (tempF <= 62) return { label: 'Warm',     color: '#f5a623' }
  return { label: 'Too hot', color: '#e74c3c' }
}

/**
 * Interpolate soil temperature at 10 cm from 6 cm and 18 cm readings.
 * Linear interpolation: 10cm is 1/3 of the way from 6cm to 18cm.
 */
export function interpolate10cm(t6, t18) {
  if (t6 == null || t18 == null) return null
  return t6 + (t18 - t6) * (4 / 12) // 4 cm span out of 12 cm range
}

export { PRIME_THRESHOLD, WINDOW_DAYS }
