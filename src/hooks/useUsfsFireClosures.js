import { useState, useEffect } from 'react'

const R06_CLOSURES = 'https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services/R06_FireClosureOrders_PublicView/FeatureServer/2/query'

async function loadStaticFile() {
  const base = import.meta.env.BASE_URL ?? '/'
  const url = `${base}data/usfs-fire-closures.geojson`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const json = await res.json()
    return json?.features?.length ? json : null
  } catch {
    return null
  }
}

async function fetchLive() {
  try {
    const params = new URLSearchParams({
      where: "ClosureStatus = 'Active'",
      geometryType: 'esriGeometryEnvelope',
      geometry: '-126,44,-115,50',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ForestUnit,District,FireName,ClosureOrderName,ClosureOrderNumber,ClosureDescription,ClosureStatus,ClosureStartDate,ClosureEndDate,ClosureURLlink',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: '2000',
    })
    const res = await fetch(`${R06_CLOSURES}?${params}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const json = await res.json()
    if (json.error || !json.features?.length) return null
    return json
  } catch {
    return null
  }
}

export function useUsfsFireClosures(enabled = true) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setLoading(false)
      return () => { cancelled = true }
    }

    setLoading(true)

    ;(async () => {
      const staticData = await loadStaticFile()
      if (staticData) {
        if (!cancelled) { setData(staticData); setLoading(false) }
        return
      }

      const liveData = await fetchLive()
      if (!cancelled) { setData(liveData); setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [enabled])

  return { data, loading }
}
