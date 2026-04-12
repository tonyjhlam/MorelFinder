#!/usr/bin/env node
/**
 * scripts/fetch-public-lands.mjs
 *
 * Downloads public lands boundaries for the PNW region at CI build time.
 * Saves GeoJSON to public/data/ so the app can render them as vector layers
 * without any browser-side CORS dependency.
 *
 * Layers:
 *   national-forests.geojson  — USFS National Forest System boundaries
 *   wilderness.geojson        — USFS Wilderness Areas
 *   national-parks.geojson    — NPS units (parks, monuments, recreation areas)
 *   blm-lands.geojson         — BLM Surface Management Agency
 *   wa-dnr-lands.geojson      — WA state + county public lands (DNR, State Parks, King County, etc.)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'data')

// PNW bounding box (WGS84) — used for ArcGIS queries
const BBOX = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

// Washington State bounds for Overpass (tighter than full PNW)
const WA_BBOX_OVERPASS = '45.54,-124.8,49.1,-116.9' // lat_min,lon_min,lat_max,lon_max

// ─── ArcGIS REST helper ──────────────────────────────────────────────────────

async function tryAttempts(attempts) {
  for (const { url, where = '1=1', outFields = '*', extra = {} } of attempts) {
    const params = new URLSearchParams({
      where,
      geometryType: 'esriGeometryEnvelope',
      geometry: `${BBOX.xmin},${BBOX.ymin},${BBOX.xmax},${BBOX.ymax}`,
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields,
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: '2000',
      ...extra,
    })
    try {
      const shortUrl = url.replace(/^https?:\/\/[^/]+/, '')
      console.log(`  → ArcGIS ${shortUrl.slice(0, 60)} | ${where.slice(0, 50)}`)
      const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) { console.log(`    ✗ HTTP ${res.status}`); continue }
      const json = await res.json()
      if (json.error) { console.log(`    ✗ API: ${json.error.message}`); continue }
      if (!json.features?.length) { console.log('    ✗ 0 features'); continue }
      console.log(`    ✓ ${json.features.length} features`)
      return json
    } catch (e) {
      console.log(`    ✗ ${e.message}`)
    }
  }
  return null
}

// ─── Overpass / OpenStreetMap helper ────────────────────────────────────────
// Overpass is the most reliable fallback: no auth, global coverage, includes
// county parks (Cougar Mountain), state parks (Squak Mountain), DNR forests
// (Tiger Mountain) — all in one query.

function osmToGeoJSON(osmJson) {
  const features = []

  function makeRing(geomArray) {
    if (!geomArray || geomArray.length < 3) return null
    const coords = geomArray.map(p => [p.lon, p.lat])
    // Close the ring if not already closed
    const first = coords[0], last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first)
    return coords.length >= 4 ? coords : null
  }

  for (const el of (osmJson.elements || [])) {
    let geometry = null
    const tags = el.tags || {}
    const name = tags.name || tags['name:en'] || null
    if (!name) continue // skip unnamed features

    if (el.type === 'way' && el.geometry) {
      // A closed way = polygon
      const ring = makeRing(el.geometry)
      if (ring) geometry = { type: 'Polygon', coordinates: [ring] }

    } else if (el.type === 'relation') {
      // Collect outer and inner member ways (members get geometry via `out geom`)
      const outerWays = (el.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry)
      const innerWays = (el.members || []).filter(m => m.type === 'way' && m.role === 'inner' && m.geometry)
      if (outerWays.length === 0) continue

      // Stitch outer ways into one ring (simplified — concatenates in order)
      const outerCoords = outerWays.flatMap(m => m.geometry).map(p => [p.lon, p.lat])
      if (outerCoords.length < 3) continue
      const first = outerCoords[0], last = outerCoords[outerCoords.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) outerCoords.push(first)
      if (outerCoords.length < 4) continue

      const rings = [outerCoords]
      for (const m of innerWays) {
        const inner = makeRing(m.geometry)
        if (inner) rings.push(inner)
      }
      geometry = { type: 'Polygon', coordinates: rings }
    }

    if (geometry) {
      features.push({
        type: 'Feature',
        properties: {
          name,
          designation: tags.designation || tags.protect_class || null,
          operator: tags.operator || null,
          osm_id: el.id,
        },
        geometry,
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

async function tryOverpass(query) {
  console.log(`  → Overpass API (OpenStreetMap)`)
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(90000),
    })
    if (!res.ok) { console.log(`    ✗ HTTP ${res.status}`); return null }
    const json = await res.json()
    const geojson = osmToGeoJSON(json)
    if (!geojson.features.length) { console.log('    ✗ 0 features'); return null }
    console.log(`    ✓ ${geojson.features.length} features (OSM)`)
    return geojson
  } catch (e) {
    console.log(`    ✗ ${e.message}`)
    return null
  }
}

// ─── Dataset definitions ─────────────────────────────────────────────────────

// ESRI Living Atlas org — CORS-enabled, publicly accessible
const LIVING_ATLAS = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services'

// Overpass queries — bbox is (lat_min,lon_min,lat_max,lon_max) — WA state only
const WA_PARKS_OVERPASS = `
[out:json][timeout:90];
(
  way["boundary"="protected_area"]["name"](${WA_BBOX_OVERPASS});
  way["leisure"="nature_reserve"]["name"](${WA_BBOX_OVERPASS});
  way["boundary"="national_park"]["name"](${WA_BBOX_OVERPASS});
  relation["boundary"="protected_area"]["name"](${WA_BBOX_OVERPASS});
  relation["leisure"="nature_reserve"]["name"](${WA_BBOX_OVERPASS});
  relation["boundary"="national_park"]["name"](${WA_BBOX_OVERPASS});
);
out geom;
`

const PNW_FORESTS_OVERPASS = `
[out:json][timeout:90];
(
  way["boundary"="national_forest"](${WA_BBOX_OVERPASS});
  way["operator"="US Forest Service"]["boundary"="protected_area"](${WA_BBOX_OVERPASS});
  relation["boundary"="national_forest"](${WA_BBOX_OVERPASS});
  relation["operator"="US Forest Service"]["boundary"="protected_area"](${WA_BBOX_OVERPASS});
);
out geom;
`

const DATASETS = [
  {
    name: 'national-forests',
    label: 'National Forests',
    attempts: [
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='FS'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/FeatureServer/0/query', outFields: 'FORESTNAME,REGION,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/FeatureServer/1/query', outFields: 'FORESTNAME,REGION,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/1/query', outFields: 'FORESTNAME,REGION,GIS_ACRES' },
    ],
    overpassQuery: PNW_FORESTS_OVERPASS,
  },
  {
    name: 'wilderness',
    label: 'Wilderness Areas',
    attempts: [
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/FeatureServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='FS' AND DESIGNATION='Wilderness'", outFields: 'ADMIN_UNIT_NAME,DESIGNATION,GIS_ACRES' },
    ],
  },
  {
    name: 'national-parks',
    label: 'National Parks & Monuments',
    attempts: [
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='NPS'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,GIS_ACRES' },
      { url: 'https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/2/query', outFields: 'UNIT_NAME,UNIT_TYPE' },
    ],
  },
  {
    name: 'blm-lands',
    label: 'BLM Lands',
    attempts: [
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='BLM'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,GIS_ACRES' },
      { url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query', outFields: 'AREANAME,AREAID,GIS_ACRES' },
      { url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/0/query', outFields: 'AREANAME,AREAID,GIS_ACRES' },
    ],
  },
  {
    name: 'wa-dnr-lands',
    label: 'WA State & County Public Lands',
    // Primary: ESRI Living Atlas PAD-US (state-managed lands)
    // Fallback: OpenStreetMap via Overpass — comprehensive, includes county parks
    //   Cougar Mountain (King County), Squak Mountain (WA State Parks),
    //   Tiger Mountain (WA DNR) — all tagged boundary=protected_area in OSM
    attempts: [
      // USA_Protected_Areas_State = PAD-US state-managed lands
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='Washington'", outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='WA'",        outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      // USA_Protected_Areas_Local = PAD-US local/county government lands (Cougar Mtn)
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_Local/FeatureServer/0/query`,  where: "State_Nm='Washington'", outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      // Broader fallbacks
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "1=1", outFields: 'Unit_Nm,Des_Tp,Mang_Name,State_Nm,GIS_Acres' },
    ],
    overpassQuery: WA_PARKS_OVERPASS,
  },
]

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  for (const ds of DATASETS) {
    console.log(`\nFetching ${ds.label}…`)
    const outFile = join(OUT_DIR, `${ds.name}.geojson`)

    let data = await tryAttempts(ds.attempts)

    // If ArcGIS attempts all failed, try Overpass (OpenStreetMap)
    if (!data && ds.overpassQuery) {
      data = await tryOverpass(ds.overpassQuery)
    }

    if (data) {
      writeFileSync(outFile, JSON.stringify(data))
      const kb = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)
      console.log(`  Saved ${ds.name}.geojson (${data.features.length} features, ${kb} KB)`)
    } else if (existsSync(outFile)) {
      console.log(`  Keeping existing ${ds.name}.geojson`)
    } else {
      console.warn(`  Writing empty placeholder for ${ds.name}.geojson`)
      writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: [] }))
    }
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(0) // never fail the build
})
