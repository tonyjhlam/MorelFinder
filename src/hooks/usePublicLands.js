import { useState, useEffect } from 'react'

// WA state bounds for Overpass — tighter than full PNW
const WA_BBOX = '45.54,-124.8,49.1,-116.9' // lat_min,lon_min,lat_max,lon_max

const WA_PARKS_QUERY = `
[out:geojson][timeout:60];
(
  way["boundary"="protected_area"]["name"](${WA_BBOX});
  way["leisure"="nature_reserve"]["name"](${WA_BBOX});
  relation["boundary"="protected_area"]["name"](${WA_BBOX});
  relation["leisure"="nature_reserve"]["name"](${WA_BBOX});
);
out geom;
`

// Load a static GeoJSON from public/data/ (downloaded at CI build time)
async function loadStatic(name) {
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

// Fetch WA state + county parks live from Overpass (OpenStreetMap).
// Overpass supports CORS — works directly from the browser.
// Covers Cougar Mountain (King County), Squak Mountain (WA State Parks),
// Tiger Mountain (WA DNR), and all other named WA protected areas.
async function loadWAParksFromOverpass() {
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(WA_PARKS_QUERY)}`,
      signal: AbortSignal.timeout(60000),
    })
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
    async function load() {
      // Load all layers in parallel; wa-dnr-lands falls back to Overpass if the
      // static file is missing or empty (CI download may have failed).
      const [natForests, wilderness, natParks, blmLands, waDnrStatic] = await Promise.all([
        loadStatic('national-forests'),
        loadStatic('wilderness'),
        loadStatic('national-parks'),
        loadStatic('blm-lands'),
        loadStatic('wa-dnr-lands'),
      ])

      const waDnrLands = waDnrStatic ?? await loadWAParksFromOverpass()

      setData({ natForests, wilderness, natParks, blmLands, waDnrLands })
    }

    load()
  }, [])

  return data
}
