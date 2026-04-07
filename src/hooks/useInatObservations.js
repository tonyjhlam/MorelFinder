import { useState, useEffect } from 'react'

// Morchella genus taxon ID on iNaturalist
const MORCHELLA_TAXON_ID = 56830

// Pacific Northwest bounding box
const BBOX = { swlat: 44.5, swlng: -125, nelat: 49.5, nelng: -115 }

/**
 * Fetches recent research-grade Morchella observations in the Pacific Northwest
 * from the iNaturalist API. Returns up to 200 observations.
 */
export function useInatObservations() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const url = new URL('https://api.inaturalist.org/v1/observations')
    url.searchParams.set('taxon_id', MORCHELLA_TAXON_ID)
    url.searchParams.set('quality_grade', 'research')
    url.searchParams.set('swlat', BBOX.swlat)
    url.searchParams.set('swlng', BBOX.swlng)
    url.searchParams.set('nelat', BBOX.nelat)
    url.searchParams.set('nelng', BBOX.nelng)
    url.searchParams.set('per_page', '200')
    url.searchParams.set('order_by', 'observed_on')
    url.searchParams.set('order', 'desc')
    // Focus on recent seasons
    url.searchParams.set('d1', '2022-01-01')

    fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        setData(json.results || [])
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
