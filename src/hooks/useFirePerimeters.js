import { useState, useEffect } from 'react'

// NIFC/WFIGS ArcGIS Online org ID
const ORG = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'

// Service URL candidates per year, tried in order.
// NIFC typically archives each fire season into a year-specific service
// (e.g. WFIGS_Interagency_Perimeters_2024) and the full history service.
// The YTD service contains the current calendar year only.
function serviceUrlsForYear(year) {
  return [
    // Year-specific archive (most reliable for completed seasons)
    `${ORG}/WFIGS_Interagency_Perimeters_${year}/FeatureServer/0/query`,
    // Full history service (may lag a season behind)
    `${ORG}/WFIGS_Interagency_Perimeters/FeatureServer/0/query`,
    // YTD service (only works if year === current calendar year)
    `${ORG}/WFIGS_Interagency_Perimeters_YTD/FeatureServer/0/query`,
  ]
}

// Pacific Northwest bounding box (xmin,ymin,xmax,ymax EPSG:4326)
const PNW_BBOX = '-126,44,-115,50'

// Possible field names for fire year across WFIGS schema versions
const YEAR_FIELDS = ['attr_FireYear', 'FireYear', 'FIRE_YEAR', 'fireYear']

function buildQuery(serviceUrl, year) {
  const params = new URLSearchParams({
    // Try attr_FireYear first; if the service has a different schema the
    // fallback query (below) catches it with client-side filtering.
    where: `attr_FireYear = ${year}`,
    geometry: PNW_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',   // fetch all fields — resilient to schema changes
    f: 'geojson',
    resultRecordCount: '2000',
  })
  return `${serviceUrl}?${params.toString()}`
}

// Broad fallback: no year filter, just bbox — we filter client-side
function buildBboxQuery(serviceUrl) {
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

// Extract a feature's fire year from whichever field exists
function getFeatureYear(feature) {
  const p = feature.properties || {}
  for (const field of YEAR_FIELDS) {
    if (p[field] != null) return String(p[field])
  }
  return null
}

async function tryFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  const json = await res.json()
  // ArcGIS returns HTTP 200 with an error object when the query fails
  if (json.error) {
    console.warn('NIFC query error:', json.error.message || json.error)
    return null
  }
  return json
}

async function fetchPerimeters(year) {
  const urls = serviceUrlsForYear(year)

  // Pass 1: year-filtered query against each service URL
  for (const serviceUrl of urls) {
    try {
      const json = await tryFetch(buildQuery(serviceUrl, year))
      if (json?.features?.length > 0) {
        console.log(`NIFC: loaded ${json.features.length} features for ${year} from ${serviceUrl}`)
        return json
      }
    } catch (e) {
      console.warn('NIFC fetch failed:', e.message)
    }
  }

  // Pass 2: broad bbox query + client-side year filter (handles schema differences)
  for (const serviceUrl of urls) {
    try {
      const json = await tryFetch(buildBboxQuery(serviceUrl))
      if (!json?.features) continue
      const filtered = json.features.filter(f => getFeatureYear(f) === String(year))
      if (filtered.length > 0) {
        console.log(`NIFC: client-filtered ${filtered.length} features for ${year} from ${serviceUrl}`)
        return { ...json, features: filtered }
      }
    } catch (e) {
      console.warn('NIFC broad fetch failed:', e.message)
    }
  }

  console.warn(`NIFC: no fire perimeters found for year ${year} in PNW bbox`)
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
