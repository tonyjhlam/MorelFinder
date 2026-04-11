import { useState, useEffect } from 'react'

// WADNR Public Wildfire MapServer:
// Layer 0 = Washington Large Fires 1973-2025 (polygons, history)
// Layer 1 = Current DNR Fire Statistics (points, current year — "Jurisdiction Fires by Point")
const WADNR_URL = 'https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildFire_Data/MapServer/1/query'

async function loadStaticFile(year) {
  const base = import.meta.env.BASE_URL ?? '/'
  const url = `${base}data/wadnr-fires-${year}.geojson`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log(`[WADNR] No static file for ${year} (HTTP ${res.status})`); return null }
    const json = await res.json()
    if (!json?.features?.length) { console.log(`[WADNR] Static file for ${year} is empty`); return null }
    console.log(`[WADNR] Loaded static wadnr-fires-${year}.geojson (${json.features.length} features)`)
    return json
  } catch (e) {
    console.log(`[WADNR] Static file failed for ${year}:`, e.message)
    return null
  }
}

async function fetchLive(year) {
  const queries = [
    `FIRE_YEAR = ${year}`,
    `FireYear = ${year}`,
    `1=1`, // fallback: all current records
  ]
  for (const where of queries) {
    try {
      const params = new URLSearchParams({
        where,
        outFields: '*',
        f: 'geojson',
        resultRecordCount: '2000',
      })
      console.log(`[WADNR] Trying: ${where}`)
      const res = await fetch(`${WADNR_URL}?${params}`, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) { console.log(`[WADNR] HTTP ${res.status}`); continue }
      const json = await res.json()
      if (json.error) { console.log(`[WADNR] API error:`, json.error.message); continue }
      if (!json.features?.length) { console.log(`[WADNR] 0 features`); continue }
      console.log(`[WADNR] Live fetch OK: ${json.features.length} features`)
      return json
    } catch (e) {
      console.log(`[WADNR] Fetch error:`, e.message)
    }
  }
  return null
}

export function useWADNRFirePoints(year) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const staticData = await loadStaticFile(year)
      if (staticData) {
        if (!cancelled) { setData(staticData); setLoading(false) }
        return
      }
      const liveData = await fetchLive(year)
      if (!cancelled) { setData(liveData); setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [year])

  return { data, loading }
}
