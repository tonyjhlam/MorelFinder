import { useState, useEffect } from 'react'

const ORG = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'

// Service URL candidates per year, tried in order.
// NIFC uses two naming conventions across seasons, so we try both.
function serviceUrlsForYear(year) {
  return [
    // Year-suffix pattern (e.g. WFIGS_Interagency_Perimeters_2024)
    `${ORG}/WFIGS_Interagency_Perimeters_${year}/FeatureServer/0/query`,
    // Year-prefix pattern (e.g. WFIGS_2024_Interagency_Perimeters)
    `${ORG}/WFIGS_${year}_Interagency_Perimeters/FeatureServer/0/query`,
    // Full history service — updated annually by NIFC
    `${ORG}/WFIGS_Interagency_Perimeters/FeatureServer/0/query`,
    // YTD service — only relevant if year === current calendar year
    `${ORG}/WFIGS_Interagency_Perimeters_YTD/FeatureServer/0/query`,
  ]
}

// Pacific Northwest bounding box (xmin,ymin,xmax,ymax EPSG:4326)
const PNW_BBOX = '-126,44,-115,50'

// Possible field names for fire year across WFIGS schema versions
const YEAR_FIELDS = ['attr_FireYear', 'FireYear', 'FIRE_YEAR', 'fireYear']

function buildYearQuery(serviceUrl, year) {
  const params = new URLSearchParams({
    where: `attr_FireYear = ${year}`,
    geometry: PNW_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    f: 'geojson',
    resultRecordCount: '2000',
  })
  return `${serviceUrl}?${params.toString()}`
}

// Broad fallback: recent years only, ordered descending so 2024/2025
// appear before older entries within the resultRecordCount window.
function buildBboxQuery(serviceUrl) {
  const params = new URLSearchParams({
    where: 'attr_FireYear >= 2024',
    geometry: PNW_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    orderByFields: 'attr_FireYear DESC',
    f: 'geojson',
    resultRecordCount: '2000',
  })
  return `${serviceUrl}?${params.toString()}`
}

// Widest fallback: no year filter, just bbox + recent ordering.
// Used when attr_FireYear field doesn't exist (different schema version).
function buildWideQuery(serviceUrl) {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: PNW_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    f: 'geojson',
    resultRecordCount: '2000',
  })
  return `${serviceUrl}?${params.toString()}`
}

// Returns year as integer, handles numeric/string/float variants.
function getFeatureYear(feature) {
  const p = feature.properties || {}
  for (const field of YEAR_FIELDS) {
    if (p[field] != null) {
      const y = parseInt(p[field], 10)
      if (!isNaN(y)) return y
    }
  }
  return null
}

async function tryFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  const json = await res.json()
  if (json.error) {
    console.warn('[NIFC] query error:', json.error.message || JSON.stringify(json.error))
    return null
  }
  return json
}

async function fetchPerimeters(year) {
  const urls = serviceUrlsForYear(year)

  // Pass 1 — year-filtered WHERE clause against each service
  for (const serviceUrl of urls) {
    try {
      const json = await tryFetch(buildYearQuery(serviceUrl, year))
      if (json?.features?.length > 0) {
        console.log(`[NIFC] ${json.features.length} features for ${year} via year-filter:`, serviceUrl)
        return json
      }
    } catch (e) {
      console.warn('[NIFC] fetch error (pass 1):', e.message)
    }
  }

  // Pass 2 — WHERE attr_FireYear >= 2024, filter client-side by exact year.
  // Handles cases where the year-specific service doesn't exist but the
  // history service has recent data.
  for (const serviceUrl of urls) {
    try {
      const json = await tryFetch(buildBboxQuery(serviceUrl))
      if (!json?.features?.length) continue
      // Log property keys of first feature to aid debugging
      console.log('[NIFC] pass 2 sample props:', Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f => getFeatureYear(f) === year)
      if (filtered.length > 0) {
        console.log(`[NIFC] ${filtered.length} features for ${year} via client-filter:`, serviceUrl)
        return { ...json, features: filtered }
      }
    } catch (e) {
      console.warn('[NIFC] fetch error (pass 2):', e.message)
    }
  }

  // Pass 3 — widest possible query, client-side year filter.
  // Handles alternative schema versions that don't have attr_FireYear.
  for (const serviceUrl of urls) {
    try {
      const json = await tryFetch(buildWideQuery(serviceUrl))
      if (!json?.features?.length) continue
      console.log('[NIFC] pass 3 sample props:', Object.keys(json.features[0].properties || {}))
      const filtered = json.features.filter(f => getFeatureYear(f) === year)
      if (filtered.length > 0) {
        console.log(`[NIFC] ${filtered.length} features for ${year} via wide filter:`, serviceUrl)
        return { ...json, features: filtered }
      }
    } catch (e) {
      console.warn('[NIFC] fetch error (pass 3):', e.message)
    }
  }

  console.warn(`[NIFC] no perimeters found for year ${year}. Check console for CORS errors or service availability.`)
  return { type: 'FeatureCollection', features: [] }
}

/**
 * Fetches NIFC/WFIGS fire perimeters for the given year within the Pacific Northwest.
 * Returns a GeoJSON FeatureCollection.
 */
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
        if (!cancelled) {
          setData(geojson)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [year])

  return { data, loading, error }
}
