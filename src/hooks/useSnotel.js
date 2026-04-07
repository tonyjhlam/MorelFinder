import { useState, useEffect } from 'react'

const AWDB_BASE = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1'

/**
 * Fetches the list of active WA SNOTEL stations.
 * Returns array of { triplet, name, latitude, longitude, elevation, county }.
 */
export function useSnotel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const url = new URL(`${AWDB_BASE}/stations`)
    url.searchParams.set('activeOnly', 'true')
    url.searchParams.set('stateCds', 'WA')
    url.searchParams.set('networkCds', 'SNTL')
    url.searchParams.set('returnForecastPointData', 'false')

    fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
      .then(r => r.json())
      .then(stations => {
        if (cancelled) return
        const mapped = stations.map(s => ({
          triplet: s.stationTriplet,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          elevation: s.elevation,   // feet
          county: s.countyName,
          state: s.stateName,
        }))
        setData(mapped)
        setLoading(false)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

/**
 * Fetches current data for a specific SNOTEL station on demand.
 * Returns { swe, snowDepth, soilTemp, date } when resolved.
 */
export async function fetchSnotelData(triplet) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 7)

  const fmt = d => d.toISOString().split('T')[0]

  const url = new URL(`${AWDB_BASE}/data`)
  url.searchParams.set('stationTriplets', triplet)
  url.searchParams.set('elementCd', 'WTEQ,SNWD,STO')  // SWE, snow depth, soil temp
  url.searchParams.set('duration', 'DAILY')
  url.searchParams.set('beginDate', fmt(start))
  url.searchParams.set('endDate', fmt(today))
  url.searchParams.set('periodRef', 'END')
  url.searchParams.set('ordinal', '1')

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`SNOTEL API error: ${res.status}`)
  const json = await res.json()

  // json is an array of element records
  const result = { swe: null, snowDepth: null, soilTemp: null, date: null }
  if (!Array.isArray(json)) return result

  for (const record of json) {
    const values = record.values || []
    // Get the last non-null value
    const last = [...values].reverse().find(v => v != null && v !== -9999)
    if (last == null) continue
    if (record.stationElement?.elementCd === 'WTEQ') result.swe = last
    if (record.stationElement?.elementCd === 'SNWD') result.snowDepth = last
    if (record.stationElement?.elementCd === 'STO') result.soilTemp = last
  }

  result.date = fmt(today)
  return result
}
