import { useState, useEffect } from 'react'

// ── Service URLs ─────────────────────────────────────────────────────────────
// Confirmed NIFC ArcGIS Online org: T4QMspbfLg3qTGWY
// Service names verified via NIFC open data portal search results.

const NIFC = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'

// Full history (all years — primary source for 2024/2025 completed seasons)
const HISTORY  = `${NIFC}/WFIGS_Interagency_Perimeters/FeatureServer/0/query`
// Year-to-date (confirmed service name — contains the current calendar year)
const YTD      = `${NIFC}/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query`
// USFS EDW — fires on National Forest System lands, independent fallback
const USFS_EDW = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_FirePerimeterHistory_01/MapServer/1/query'

// ── PNW state + bbox filters ──────────────────────────────────────────────────

// State-based filter is more reliable than a bbox geometry query.
// WA, OR, ID, MT covers the western Cascades and relevant east-slope fires.
const PNW_STATES = `'WA','OR','ID','MT'`

// Fallback: client-side bounding box check
const PNW = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

function isInPNW(feature) {
  const coords = firstCoord(feature.geometry)
  if (!coords) return false
  const [lng, lat] = coords
  return lng >= PNW.xmin && lng <= PNW.xmax && lat >= PNW.ymin && lat <= PNW.ymax
}

function firstCoord(geom) {
  if (!geom) return null
  if (geom.type === 'Point') return geom.coordinates
  if (geom.type === 'MultiPoint') return geom.coordinates[0]
  if (geom.type === 'Polygon') return geom.coordinates?.[0]?.[0]
  if (geom.type === 'MultiPolygon') return geom.coordinates?.[0]?.[0]?.[0]
  return null
}

// ── Field name helpers ────────────────────────────────────────────────────────

const YEAR_FIELDS = ['attr_FireYear', 'FireYear', 'FIRE_YEAR', 'fireYear']
const STATE_FIELDS = ['attr_POOState', 'POOState', 'STATE', 'state']

function getIntField(feature, fields) {
  const p = feature.properties || {}
  for (const f of fields) {
    if (p[f] != null) {
      const v = parseInt(p[f], 10)
      if (!isNaN(v)) return v
    }
  }
  return null
}

function getStrField(feature, fields) {
  const p = feature.properties || {}
  for (const f of fields) {
    if (p[f] != null) return String(p[f]).trim().toUpperCase()
  }
  return null
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function tryFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    console.warn(`[NIFC] HTTP ${res.status} from`, url)
    return null
  }
  const json = await res.json()
  if (json.error) {
    console.warn('[NIFC] query error:', json.error.message || JSON.stringify(json.error), '|', url)
    return null
  }
  return json
}

function qs(params) {
  return new URLSearchParams({
    outFields: '*',
    f: 'geojson',
    resultRecordCount: '2000',
    ...params,
  }).toString()
}

// ── Passes ────────────────────────────────────────────────────────────────────

async function fetchPerimeters(year) {
  // ── Pass 1: history service, state filter + year filter ────────────────────
  // Uses a SQL WHERE clause only (no geometry) — most reliable query form.
  // State filter restricts to PNW states; year filter targets the season.
  const p1q = qs({ where: `attr_FireYear = ${year} AND attr_POOState IN (${PNW_STATES})` })
  for (const url of [HISTORY, YTD]) {
    try {
      const json = await tryFetch(`${url}?${p1q}`)
      if (json?.features?.length > 0) {
        console.log(`[NIFC] Pass 1 OK (${json.features.length} features, year=${year}):`, url)
        return json
      }
      if (json) console.log('[NIFC] Pass 1: 0 features from', url)
    } catch (e) { console.warn('[NIFC] Pass 1 error:', e.message) }
  }

  // ── Pass 2: year filter only, no state/geo — client-side PNW filter ────────
  // In case attr_POOState doesn't exist or state values differ.
  const p2q = qs({ where: `attr_FireYear = ${year}`, resultRecordCount: '1000' })
  for (const url of [HISTORY, YTD]) {
    try {
      const json = await tryFetch(`${url}?${p2q}`)
      if (!json?.features?.length) {
        if (json) console.log('[NIFC] Pass 2: 0 raw features from', url)
        continue
      }
      console.log(`[NIFC] Pass 2 raw: ${json.features.length} features | sample props:`,
        Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f => isInPNW(f))
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 2 OK: ${filtered.length} PNW features for ${year}`)
        return { ...json, features: filtered }
      }
    } catch (e) { console.warn('[NIFC] Pass 2 error:', e.message) }
  }

  // ── Pass 3: try alternate year field names ─────────────────────────────────
  // Some schema versions use FireYear (no attr_ prefix).
  const p3q = qs({ where: `FireYear = ${year}` })
  for (const url of [HISTORY, YTD]) {
    try {
      const json = await tryFetch(`${url}?${p3q}`)
      if (!json?.features?.length) continue
      const filtered = json.features.filter(f =>
        getIntField(f, YEAR_FIELDS) === year && isInPNW(f)
      )
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 3 OK: ${filtered.length} features (FireYear field)`)
        return { ...json, features: filtered }
      }
    } catch (e) { console.warn('[NIFC] Pass 3 error:', e.message) }
  }

  // ── Pass 4: wide query, client-side everything ─────────────────────────────
  // Last resort: recent large fires, no server-side year/geo filter.
  const p4q = qs({ where: 'attr_TotalAcres >= 500', orderByFields: 'attr_FireYear DESC' })
  try {
    const json = await tryFetch(`${HISTORY}?${p4q}`)
    if (json?.features?.length > 0) {
      console.log(`[NIFC] Pass 4 wide raw: ${json.features.length} | props:`,
        Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f =>
        getIntField(f, YEAR_FIELDS) === year && isInPNW(f)
      )
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 4 OK: ${filtered.length} features for ${year}`)
        return { ...json, features: filtered }
      }
    }
  } catch (e) { console.warn('[NIFC] Pass 4 error:', e.message) }

  // ── Pass 5: USFS EDW (NFS lands only, different schema) ───────────────────
  const p5q = qs({ where: `FIRE_YEAR = ${year} AND STATE IN (${PNW_STATES})` })
  try {
    const json = await tryFetch(`${USFS_EDW}?${p5q}`)
    if (json?.features?.length > 0) {
      console.log(`[NIFC] Pass 5 USFS EDW OK: ${json.features.length} features for ${year}`)
      return json
    }
  } catch (e) { console.warn('[NIFC] Pass 5 USFS error:', e.message) }

  console.warn(`[NIFC] All passes failed for year=${year}. ` +
    'Open DevTools → Network to check for CORS errors on services3.arcgis.com requests.')
  return { type: 'FeatureCollection', features: [] }
}

// ── Static file loader (pre-downloaded at build time) ─────────────────────────

async function loadStaticFile(year) {
  const base = import.meta.env.BASE_URL ?? '/'
  const url = `${base}data/fires-${year}.geojson`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log(`[NIFC] No static file for ${year} (HTTP ${res.status})`); return null }
    const json = await res.json()
    if (!json?.features?.length) { console.log(`[NIFC] Static file for ${year} is empty`); return null }
    console.log(`[NIFC] Loaded static fires-${year}.geojson (${json.features.length} features)`)
    return json
  } catch (e) {
    console.log(`[NIFC] Static file fetch failed for ${year}:`, e.message)
    return null
  }
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useFirePerimeters(year) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      // Try pre-built static file first (served from public/data/ at build time)
      const staticData = await loadStaticFile(year)
      if (staticData) {
        if (!cancelled) { setData(staticData); setLoading(false) }
        return
      }
      // Fall back to live NIFC API (works in local dev, may fail on GitHub Pages due to CORS)
      fetchPerimeters(year)
        .then(geojson => {
          if (!cancelled) { setData(geojson); setLoading(false) }
        })
        .catch(err => {
          if (!cancelled) { setError(err.message); setLoading(false) }
        })
    })()

    return () => { cancelled = true }
  }, [year])

  return { data, loading, error }
}
