import { useState, useEffect } from 'react'

const LIVING_ATLAS = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services'
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services'
const PNW_BBOX = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }
const NATURE_PRESERVES_WHERE = "Des_Tp <> 'MIL' AND (UPPER(Unit_Nm) LIKE '%PRESERVE%' OR UPPER(Unit_Nm) LIKE '%RESERVE%' OR UPPER(Unit_Nm) LIKE '%NATURAL AREA%' OR UPPER(Loc_Nm) LIKE '%PRESERVE%' OR UPPER(Loc_Nm) LIKE '%RESERVE%' OR UPPER(Loc_Nm) LIKE '%NATURAL AREA%' OR UPPER(Des_Tp) LIKE '%PRESERVE%' OR UPPER(Des_Tp) LIKE '%RESERVE%' OR UPPER(Des_Tp) LIKE '%NATURAL AREA%')"

// Washington State bounds (lat_min,lon_min,lat_max,lon_max — Overpass order)
const WA_BBOX = '45.54,-124.8,49.1,-116.9'
// [out:json] + out geom; gives member-way geometries embedded in relations.
// Using json (not geojson) because Overpass's geojson output doesn't reliably
// convert type=boundary relations (Cougar Mtn, Tiger Mtn, etc.) to Polygon.
const WA_PARKS_QUERY = `
[out:json][timeout:60];
(
  way["boundary"="protected_area"]["name"](${WA_BBOX});
  way["leisure"="nature_reserve"]["name"](${WA_BBOX});
  relation["boundary"="protected_area"]["name"](${WA_BBOX});
  relation["leisure"="nature_reserve"]["name"](${WA_BBOX});
);
out geom;
`

// ─── OSM → GeoJSON ───────────────────────────────────────────────────────────

function approxEq(a, b) {
  return Math.abs(a[0] - b[0]) < 0.00005 && Math.abs(a[1] - b[1]) < 0.00005
}

// Greedily stitch an array of way-geometry arrays into one closed ring.
// Each way is [{lon,lat},...]. Returns [lon,lat][] ring or null.
function stitchWays(ways) {
  if (!ways.length) return null
  const segs = ways.map(w => w.geometry.map(p => [p.lon, p.lat]))
  if (segs.length === 1) {
    const r = [...segs[0]]
    if (!approxEq(r[0], r[r.length - 1])) r.push(r[0])
    return r.length >= 4 ? r : null
  }
  let ring = segs.shift()
  const rem = [...segs]
  let changed = true
  while (changed && rem.length) {
    changed = false
    for (let i = 0; i < rem.length; i++) {
      const s = rem[i]
      const tail = ring[ring.length - 1]
      if (approxEq(tail, s[0])) {
        ring = [...ring, ...s.slice(1)]; rem.splice(i, 1); changed = true; break
      }
      if (approxEq(tail, s[s.length - 1])) {
        ring = [...ring, ...[...s].reverse().slice(1)]; rem.splice(i, 1); changed = true; break
      }
    }
  }
  if (!approxEq(ring[0], ring[ring.length - 1])) ring.push(ring[0])
  return ring.length >= 4 ? ring : null
}

function osmToGeoJSON(osmJson) {
  const features = []
  for (const el of (osmJson.elements || [])) {
    const tags = el.tags || {}
    const name = tags.name || null
    if (!name) continue

    let geometry = null

    if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map(p => [p.lon, p.lat])
      if (!approxEq(coords[0], coords[coords.length - 1])) coords.push(coords[0])
      if (coords.length >= 4) geometry = { type: 'Polygon', coordinates: [coords] }

    } else if (el.type === 'relation') {
      const outers = (el.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry)
      const inners = (el.members || []).filter(m => m.type === 'way' && m.role === 'inner' && m.geometry)
      const outer = stitchWays(outers)
      if (!outer) continue
      const rings = [outer]
      for (const m of inners) {
        const r = m.geometry.map(p => [p.lon, p.lat])
        if (!approxEq(r[0], r[r.length - 1])) r.push(r[0])
        if (r.length >= 4) rings.push(r)
      }
      geometry = { type: 'Polygon', coordinates: rings }
    }

    if (geometry) {
      features.push({
        type: 'Feature',
        properties: { name, operator: tags.operator || null, designation: tags.designation || null },
        geometry,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// ─── Data loaders ────────────────────────────────────────────────────────────

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

async function fetchArcGisCollection(url, { where = '1=1', outFields = '*' } = {}) {
  try {
    const params = new URLSearchParams({
      where,
      geometryType: 'esriGeometryEnvelope',
      geometry: `${PNW_BBOX.xmin},${PNW_BBOX.ymin},${PNW_BBOX.xmax},${PNW_BBOX.ymax}`,
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields,
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: '4000',
    })
    const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return null
    const json = await res.json()
    if (json.error || !json.features?.length) return null
    return json
  } catch {
    return null
  }
}

function mergeCollections(collections) {
  const features = collections
    .filter(Boolean)
    .flatMap(collection => collection.features || [])
    .filter(feature => feature?.geometry)

  return features.length
    ? { type: 'FeatureCollection', features }
    : null
}

async function loadStateLocalPublicLandsLive() {
  const [stateLands, localLands] = await Promise.all([
    fetchArcGisCollection(`${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, {
      outFields: 'Unit_Nm,Des_Tp,Mang_Name,State_Nm,GIS_Acres',
    }),
    fetchArcGisCollection(`${LIVING_ATLAS}/USA_Protected_Areas_Local/FeatureServer/0/query`, {
      outFields: 'Unit_Nm,Des_Tp,Mang_Name,State_Nm,GIS_Acres',
    }),
  ])

  return mergeCollections([stateLands, localLands])
}

async function loadNaturePreservesLive() {
  return fetchArcGisCollection(`${PADUS}/Fee_Managers_PADUS/FeatureServer/0/query`, {
    where: NATURE_PRESERVES_WHERE,
    outFields: 'Unit_Nm,Loc_Nm,Des_Tp,Mang_Name,Own_Name,State_Nm,GIS_Acres',
  })
}

async function loadStateLocalPublicLands() {
  const stateLocalStatic = await loadStatic('state-local-public-lands')
  if (stateLocalStatic) return stateLocalStatic

  const waDnrStatic = await loadStatic('wa-dnr-lands')
  return (
    await loadStateLocalPublicLandsLive() ??
    waDnrStatic ??
    await loadWAParksFromOverpass()
  )
}

// Fetch WA state + county parks live from Overpass (CORS-enabled, no auth).
// Covers Cougar Mountain (King County), Squak Mountain (WA State Parks),
// Tiger Mountain (WA DNR), and all other named WA protected areas.
async function loadWAParksFromOverpass() {
  // Try two Overpass instances in case one is rate-limiting
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(WA_PARKS_QUERY)}`,
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) continue
      const json = await res.json()
      if (!json.elements?.length) continue
      const geojson = osmToGeoJSON(json)
      if (geojson.features.length) return geojson
    } catch {
      // try next endpoint
    }
  }
  return null
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const PUBLIC_LAND_LOADERS = {
  natForests: () => loadStatic('national-forests'),
  wilderness: () => loadStatic('wilderness'),
  natParks: () => loadStatic('national-parks'),
  blmLands: () => loadStatic('blm-lands'),
  naturePreserves: async () => {
    const staticData = await loadStatic('nature-preserves')
    return staticData ?? await loadNaturePreservesLive()
  },
  waDnrLands: loadStateLocalPublicLands,
}

export function usePublicLands(enabled = {}) {
  const [data, setData] = useState({
    natForests: null,
    wilderness: null,
    natParks: null,
    blmLands: null,
    naturePreserves: null,
    waDnrLands: null,
  })

  useEffect(() => {
    const requestedIds = Object.entries(enabled)
      .filter(([, isEnabled]) => !!isEnabled)
      .map(([id]) => id)
      .filter(id => !data[id])

    if (requestedIds.length === 0) return undefined

    let cancelled = false

    async function load() {
      const loadedEntries = await Promise.all(
        requestedIds.map(async (id) => [id, await PUBLIC_LAND_LOADERS[id]?.()] )
      )

      if (cancelled) return

      setData(prev => {
        const next = { ...prev }
        loadedEntries.forEach(([id, value]) => {
          next[id] = value
        })
        return next
      })
    }

    load()

    return () => { cancelled = true }
  }, [enabled, data])

  return data
}
