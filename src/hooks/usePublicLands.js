import { useState, useEffect } from 'react'

const LAYERS = [
  'national-forests',
  'wilderness',
  'national-parks',
  'blm-lands',
  'wa-dnr-lands',
]

async function load(name) {
  const base = import.meta.env.BASE_URL ?? '/'
  try {
    const res = await fetch(`${base}data/${name}.geojson`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const json = await res.json()
    return json?.features?.length ? json : null
  } catch {
    return null
  }
}

export function usePublicLands() {
  const [data, setData] = useState({
    natForests: null,
    wilderness: null,
    natParks: null,
    blmLands: null,
    waDnrLands: null,
  })

  useEffect(() => {
    Promise.all(LAYERS.map(load)).then(([natForests, wilderness, natParks, blmLands, waDnrLands]) => {
      setData({ natForests, wilderness, natParks, blmLands, waDnrLands })
    })
  }, [])

  return data
}
