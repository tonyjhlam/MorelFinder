import { useState, useEffect } from 'react'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/**
 * Fetches soil temperature forecast + recent past history from Open-Meteo for
 * the given lat/lng. Returns combined data for GDD calculation and display.
 *
 * Depths: 6 cm (~2.4") and 18 cm (~7") — bracketing the 4" morel target.
 */
export function useOpenMeteo(lat, lng) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (lat == null || lng == null) return

    let cancelled = false
    setLoading(true)
    setData(null)
    setError(null)

    const forecastUrl = new URL(FORECAST_URL)
    Object.entries({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      hourly: 'soil_temperature_6cm,soil_temperature_18cm',
      temperature_unit: 'fahrenheit',
      timezone: 'America/Los_Angeles',
      forecast_days: '7',
      past_days: '21',
    })
      .forEach(([k, v]) => forecastUrl.searchParams.set(k, v))

    fetch(forecastUrl.toString(), { signal: AbortSignal.timeout(12000) })
      .then(r => r.json())
      .then((forecast) => {
        if (cancelled) return
        setData({ forecast, lat, lng })
        setLoading(false)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [lat, lng])

  return { data, loading, error }
}

/**
 * Extract the current (most recent) soil temperature values from forecast data.
 * Returns { t6cm, t18cm, t10cm } all in °F, or nulls if unavailable.
 */
export function currentSoilTemp(forecastData) {
  if (!forecastData?.hourly) return { t6cm: null, t18cm: null, t10cm: null }

  const now = Date.now()
  const times = forecastData.hourly.time || []
  const t6arr = forecastData.hourly.soil_temperature_6cm || []
  const t18arr = forecastData.hourly.soil_temperature_18cm || []

  // Find closest past hour
  let bestIdx = 0
  let bestDiff = Infinity
  times.forEach((isoStr, i) => {
    const diff = Math.abs(now - new Date(isoStr).getTime())
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
  })

  const t6cm = t6arr[bestIdx] ?? null
  const t18cm = t18arr[bestIdx] ?? null
  const t10cm = (t6cm != null && t18cm != null)
    ? t6cm + (t18cm - t6cm) * (4 / 12)
    : null

  return { t6cm, t18cm, t10cm }
}

/**
 * Build daily forecast rows: [ { date, t6, t18, t10 }, … ] for 7 days.
 */
export function dailyForecast(forecastData) {
  if (!forecastData?.hourly) return []

  const times = forecastData.hourly.time || []
  const t6arr = forecastData.hourly.soil_temperature_6cm || []
  const t18arr = forecastData.hourly.soil_temperature_18cm || []

  // Group by date, take noon value
  const byDate = {}
  times.forEach((isoStr, i) => {
    const [date, time] = isoStr.split('T')
    if (!byDate[date] || time === '12:00') {
      byDate[date] = { t6: t6arr[i], t18: t18arr[i] }
    }
  })

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 7)
    .map(([date, { t6, t18 }]) => ({
      date,
      t6: t6 ?? null,
      t18: t18 ?? null,
      t10: (t6 != null && t18 != null) ? t6 + (t18 - t6) * (4 / 12) : null,
    }))
}
