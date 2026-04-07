import { useState, useEffect } from 'react'

// WFIGS Interagency Fire Perimeters — full history (covers 2024 + 2025 archive)
const HISTORY_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Interagency_Perimeters/FeatureServer/0/query'

// WFIGS Year-To-Date — try as fallback for most recent year
const YTD_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Interagency_Perimeters_YTD/FeatureServer/0/query'

// Pacific Northwest bounding box (EPSG:4326)
const PNW_BBOX = '-126,44,-115,50'

const FIELDS = [
  'attr_IncidentName',
  'attr_TotalAcres',
  'attr_FireYear',
  'attr_PercentContained',
  'attr_ContainmentDateTime',
  'attr_POOState',
  'attr_POOCounty',
].join(',')

function buildQuery(serviceUrl, year) {
  const params = new URLSearchParams({
    where: `attr_FireYear = ${year}`,
    geometry: PNW_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: FIELDS,
    f: 'geojson',
    resultRecordCount: '2000',
  })
  return `${serviceUrl}?${params.toString()}`
}

async function fetchPerimeters(year) {
  // Try history service first, fall back to YTD
  for (const serviceUrl of [HISTORY_URL, YTD_URL]) {
    try {
      const res = await fetch(buildQuery(serviceUrl, year), { signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const json = await res.json()
      if (json.features && json.features.length > 0) {
        return json
      }
    } catch {
      // try next service
    }
  }
  return { type: 'FeatureCollection', features: [] }
}

/**
 * Fetches NIFC fire perimeters for the given year within the Pacific Northwest.
 * Returns GeoJSON FeatureCollection.
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
