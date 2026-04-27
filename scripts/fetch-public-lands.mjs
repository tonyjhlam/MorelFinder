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
 *   wilderness.geojson        — Wilderness areas
 *   national-parks.geojson    — NPS units (parks, monuments, recreation areas)
 *   blm-lands.geojson         — BLM-administered lands
 *   nature-preserves.geojson  — Nature preserves and reserves
 *   usfs-fire-closures.geojson — Active USFS Region 6 fire closure polygons
 *   state-local-public-lands.geojson — PNW state + county public lands
 *   wa-dnr-lands.geojson      — legacy WA-only state + county public lands
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
const PNW_BBOX_OVERPASS = '44,-126,50,-115'

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

function mergeCollections(collections) {
  const features = collections
    .filter(Boolean)
    .flatMap(collection => collection.features || [])
    .filter(feature => feature?.geometry)

  return features.length
    ? { type: 'FeatureCollection', features }
    : null
}

// ─── Overpass / OpenStreetMap helper ────────────────────────────────────────
// Using [out:geojson] so the Overpass API returns a proper GeoJSON
// FeatureCollection directly — no manual OSM→GeoJSON conversion needed.
// Relations become MultiPolygons with correctly-stitched member rings.

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
    const geojson = await res.json()
    if (!geojson.features?.length) { console.log('    ✗ 0 features'); return null }
    console.log(`    ✓ ${geojson.features.length} features (OSM)`)
    return geojson
  } catch (e) {
    console.log(`    ✗ ${e.message}`)
    return null
  }
}

// ─── Dataset definitions ─────────────────────────────────────────────────────

const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services'
const BLM_SMA = 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer'
const NPS_WILDERNESS = 'https://mapservices.nps.gov/arcgis/rest/services/Wilderness/Wilderness/FeatureServer/0/query'
const PADUS_WILDERNESS = 'https://services1.arcgis.com/ypdMhhEhrtBXLtQv/ArcGIS/rest/services/PADUS_Wilderness_Areas/FeatureServer/87/query'
const USFS_FIRE_CLOSURES = 'https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services/R06_FireClosureOrders_PublicView/FeatureServer/2/query'
const NATURE_PRESERVES_WHERE = "Des_Tp <> 'MIL' AND (UPPER(Unit_Nm) LIKE '%PRESERVE%' OR UPPER(Unit_Nm) LIKE '%RESERVE%' OR UPPER(Unit_Nm) LIKE '%NATURAL AREA%' OR UPPER(Loc_Nm) LIKE '%PRESERVE%' OR UPPER(Loc_Nm) LIKE '%RESERVE%' OR UPPER(Loc_Nm) LIKE '%NATURAL AREA%' OR UPPER(Des_Tp) LIKE '%PRESERVE%' OR UPPER(Des_Tp) LIKE '%RESERVE%' OR UPPER(Des_Tp) LIKE '%NATURAL AREA%')"

// Overpass queries — bbox is (lat_min,lon_min,lat_max,lon_max) — WA state only
// [out:geojson] makes Overpass return a proper GeoJSON FeatureCollection.
// Relations are automatically converted to (Multi)Polygon with correctly
// stitched member ways — no manual conversion needed.

const WA_PARKS_OVERPASS = `
[out:geojson][timeout:90];
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
[out:geojson][timeout:90];
(
  way["boundary"="national_forest"](${WA_BBOX_OVERPASS});
  way["operator"="US Forest Service"]["boundary"="protected_area"](${WA_BBOX_OVERPASS});
  relation["boundary"="national_forest"](${WA_BBOX_OVERPASS});
  relation["operator"="US Forest Service"]["boundary"="protected_area"](${WA_BBOX_OVERPASS});
);
out geom;
`

const PNW_NATURE_PRESERVES_OVERPASS = `
[out:geojson][timeout:90];
(
  way["leisure"="nature_reserve"]["name"](${PNW_BBOX_OVERPASS});
  relation["leisure"="nature_reserve"]["name"](${PNW_BBOX_OVERPASS});
  way["boundary"="protected_area"]["protect_class"="1"]["name"](${PNW_BBOX_OVERPASS});
  relation["boundary"="protected_area"]["protect_class"="1"]["name"](${PNW_BBOX_OVERPASS});
  way["boundary"="protected_area"]["designation"~"preserve|reserve", i]["name"](${PNW_BBOX_OVERPASS});
  relation["boundary"="protected_area"]["designation"~"preserve|reserve", i]["name"](${PNW_BBOX_OVERPASS});
);
out geom;
`

const DATASETS = [
  {
    name: 'national-forests',
    label: 'National Forests',
    attempts: [
      { url: `${BLM_SMA}/24/query`, outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${PADUS}/Federal_Fee_Managers_Authoritative_PADUS/FeatureServer/0/query`, where: "ManagerName = 'USFS'", outFields: 'ManagerName,BndryName,State_Nm' },
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
      { url: PADUS_WILDERNESS, outFields: 'Own_Name,Loc_Mang,Loc_Nm,State_Nm' },
      { url: NPS_WILDERNESS, outFields: 'WILDERNESSNAME,ADMINUNITCODE,ADMINUNITNAME' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/FeatureServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: `${PADUS}/Federal_Management_Agencies_PADUS/FeatureServer/0/query`, where: "Loc_Mang = 'USFS' AND Des_Tp = 'Wilderness Area'", outFields: 'BndryName,Des_Tp,Loc_Mang,State_Nm' },
    ],
  },
  {
    name: 'national-parks',
    label: 'National Parks & Monuments',
    attempts: [
      { url: `${BLM_SMA}/23/query`, outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/National_Park_Service_Boundaries/FeatureServer/0/query', outFields: 'UNIT_NAME,UNIT_TYPE,UNIT_CODE' },
      { url: `${PADUS}/Federal_Fee_Managers_Authoritative_PADUS/FeatureServer/0/query`, where: "ManagerName = 'NPS'", outFields: 'ManagerName,BndryName,State_Nm' },
    ],
  },
  {
    name: 'blm-lands',
    label: 'BLM Lands',
    attempts: [
      { url: `${BLM_SMA}/22/query`, outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${PADUS}/Federal_Fee_Managers_Authoritative_PADUS/FeatureServer/0/query`, where: "ManagerName = 'BLM'", outFields: 'ManagerName,BndryName,State_Nm' },
    ],
  },
  {
    name: 'nature-preserves',
    label: 'Nature Preserves',
    attempts: [
      { url: `${PADUS}/Fee_Managers_PADUS/FeatureServer/0/query`, where: NATURE_PRESERVES_WHERE, outFields: 'Unit_Nm,Loc_Nm,Des_Tp,Mang_Name,Own_Name,State_Nm,GIS_Acres' },
    ],
    overpassQuery: PNW_NATURE_PRESERVES_OVERPASS,
  },
  {
    name: 'usfs-fire-closures',
    label: 'USFS Fire Closures',
    attempts: [
      { url: USFS_FIRE_CLOSURES, where: "ClosureStatus = 'Active'", outFields: 'ForestUnit,District,FireName,ClosureOrderName,ClosureOrderNumber,ClosureDescription,ClosureStatus,ClosureStartDate,ClosureEndDate,ClosureURLlink' },
    ],
  },
  {
    name: 'state-local-public-lands',
    label: 'State & Local Public Lands',
    attempts: [
      { url: `${BLM_SMA}/29/query`, outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${BLM_SMA}/30/query`, outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${PADUS}/Fee_Managers_PADUS/FeatureServer/0/query`, where: "ManagerType IN ('State','Local Government')", outFields: 'ManagerName,ManagerType,BndryName,State_Nm' },
      { url: `${PADUS}/Manager_Type_PADUS/FeatureServer/0/query`, where: "ManagerType IN ('State','Local Government')", outFields: 'ManagerType,BndryName,State_Nm,Loc_Mang' },
    ],
    combine: true,
    overpassQuery: WA_PARKS_OVERPASS,
  },
  {
    name: 'wa-dnr-lands',
    label: 'WA State & County Public Lands (Legacy)',
    attempts: [
      { url: `${BLM_SMA}/29/query`, where: "ADMIN_ST = 'WA'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${BLM_SMA}/30/query`, where: "ADMIN_ST = 'WA'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_ST' },
      { url: `${PADUS}/Fee_Managers_PADUS/FeatureServer/0/query`, where: "State_Nm = 'Washington' AND ManagerType IN ('State','Local Government')", outFields: 'ManagerName,ManagerType,BndryName,State_Nm' },
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

    let data = ds.combine
      ? mergeCollections(await Promise.all(ds.attempts.map(attempt => tryAttempts([attempt]))))
      : await tryAttempts(ds.attempts)

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
