import { useState, useEffect } from 'react'

// ── Service URLs ─────────────────────────────────────────────────────────────

const NIFC = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'

// USFS Enterprise Data Warehouse — fire perimeter history on NFS lands.
// Different org/schema than NIFC but reliable fallback for Cascade fires.
const USFS_EDW = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_FirePerimeterHistory_01/MapServer/1/query'

function nifcServicesForYear(year) {
  return [
    `${NIFC}/WFIGS_Interagency_Perimeters_${year}/FeatureServer/0/query`,
    `${NIFC}/WFIGS_${year}_Interagency_Perimeters/FeatureServer/0/query`,
    `${NIFC}/WFIGS_Interagency_Perimeters/FeatureServer/0/query`,
    `${NIFC}/WFIGS_Interagency_Perimeters_YTD/FeatureServer/0/query`,
  ]
}

// ── PNW bounding box ─────────────────────────────────────────────────────────

const PNW = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

// Server-side bbox (used only in Pass 1 where we know the service supports it)
const PNW_BBOX = `${PNW.xmin},${PNW.ymin},${PNW.xmax},${PNW.ymax}`

// Client-side PNW filter — works on any GeoJSON feature
function isInPNW(feature) {
  if (!feature.geometry) return false
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

// ── Year field helpers ────────────────────────────────────────────────────────

const NIFC_YEAR_FIELDS  = ['attr_FireYear', 'FireYear', 'FIRE_YEAR', 'fireYear']
const USFS_YEAR_FIELDS  = ['FIRE_YEAR', 'FireYear', 'attr_FireYear']

function getYear(feature, fields) {
  const p = feature.properties || {}
  for (const f of fields) {
    if (p[f] != null) {
      const y = parseInt(p[f], 10)
      if (!isNaN(y)) return y
    }
  }
  return null
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function tryFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  const json = await res.json()
  if (json.error) {
    console.warn('[NIFC] service error:', json.error.message || JSON.stringify(json.error))
    return null
  }
  return json
}

function buildParams(overrides) {
  return new URLSearchParams({
    outFields: '*',
    f: 'geojson',
    resultRecordCount: '2000',
    ...overrides,
  })
}

// ── Main fetch logic ──────────────────────────────────────────────────────────

async function fetchPerimeters(year) {
  const nifcUrls = nifcServicesForYear(year)

  // ── Pass 1: server-side year + bbox filter ─────────────────────────────────
  // Fastest if the service supports the geometry parameter.
  for (const url of nifcUrls) {
    try {
      const json = await tryFetch(
        `${url}?${buildParams({
          where: `attr_FireYear = ${year}`,
          geometry: PNW_BBOX,
          geometryType: 'esriGeometryEnvelope',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
        })}`
      )
      if (json?.features?.length > 0) {
        console.log(`[NIFC] Pass 1 OK: ${json.features.length} features for ${year}`, url)
        return json
      }
    } catch (e) {
      console.warn('[NIFC] Pass 1 error:', e.message)
    }
  }

  // ── Pass 2: server-side year filter only, client-side bbox ─────────────────
  // Bypasses any geometry filter issues.
  for (const url of nifcUrls) {
    try {
      const json = await tryFetch(
        `${url}?${buildParams({ where: `attr_FireYear = ${year}` })}`
      )
      if (!json?.features?.length) continue
      console.log('[NIFC] Pass 2 raw count:', json.features.length,
        '| sample props:', Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f =>
        getYear(f, NIFC_YEAR_FIELDS) === year && isInPNW(f)
      )
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 2 OK: ${filtered.length} PNW features for ${year}`)
        return { ...json, features: filtered }
      }
    } catch (e) {
      console.warn('[NIFC] Pass 2 error:', e.message)
    }
  }

  // ── Pass 3: recent fires only (no year field assumption), client-side all ───
  // For services that use a different year field name.
  for (const url of nifcUrls) {
    try {
      const json = await tryFetch(
        `${url}?${buildParams({
          where: 'attr_TotalAcres >= 500',
          orderByFields: 'attr_FireYear DESC',
        })}`
      )
      if (!json?.features?.length) continue
      console.log('[NIFC] Pass 3 raw count:', json.features.length,
        '| sample props:', Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f =>
        getYear(f, NIFC_YEAR_FIELDS) === year && isInPNW(f)
      )
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 3 OK: ${filtered.length} features for ${year}`)
        return { ...json, features: filtered }
      }
    } catch (e) {
      console.warn('[NIFC] Pass 3 error:', e.message)
    }
  }

  // ── Pass 4: USFS EDW fallback ──────────────────────────────────────────────
  // Covers fires on National Forest System lands — the primary morel habitat.
  // Different schema (FIRE_YEAR not attr_FireYear).
  try {
    const json = await tryFetch(
      `${USFS_EDW}?${buildParams({ where: `FIRE_YEAR = ${year}` })}`
    )
    if (json?.features?.length > 0) {
      const filtered = json.features.filter(f =>
        getYear(f, USFS_YEAR_FIELDS) === year && isInPNW(f)
      )
      if (filtered.length > 0) {
        console.log(`[NIFC] Pass 4 USFS EDW OK: ${filtered.length} features for ${year}`)
        return { ...json, features: filtered }
      }
    }
  } catch (e) {
    console.warn('[NIFC] Pass 4 USFS error:', e.message)
  }

  console.warn(`[NIFC] All passes exhausted for year ${year}. ` +
    'Open DevTools → Network to check for CORS or 4xx errors on ArcGIS requests.')
  return { type: 'FeatureCollection', features: [] }
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

    fetchPerimeters(year)
      .then(geojson => {
        if (!cancelled) { setData(geojson); setLoading(false) }
      })
      .catch(err => {
        if (!cancelled) { setError(err.message); setLoading(false) }
      })

    return () => { cancelled = true }
  }, [year])

  return { data, loading, error }
}
