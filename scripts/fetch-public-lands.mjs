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
 *   wa-dnr-lands.geojson      — WA state-managed lands (DNR state forests)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'data')

// PNW bounding box (WGS84)
const BBOX = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

// Each attempt = { url, where?, outFields? }
// The function tries each in order, returning first success.
async function tryAttempts(attempts, label) {
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
      console.log(`  → ${shortUrl} | ${where.slice(0, 50)}`)
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

// ESRI Living Atlas org — CORS-enabled, publicly accessible
const LIVING_ATLAS = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services'

const DATASETS = [
  {
    name: 'national-forests',
    label: 'National Forests',
    attempts: [
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='FS' AND STATE='WA'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,GIS_ACRES' },
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "ADMIN_AGENCY_CODE='FS'", outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/FeatureServer/1/query', outFields: 'FORESTNAME,REGION,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/1/query', outFields: 'FORESTNAME,REGION,GIS_ACRES' },
    ],
  },
  {
    name: 'wilderness',
    label: 'Wilderness Areas',
    attempts: [
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/FeatureServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer/0/query', outFields: 'NAME,AREAID,GIS_ACRES' },
      { url: `${LIVING_ATLAS}/USA_Federal_Lands/FeatureServer/0/query`, where: "DESIGNATION='Wilderness'", outFields: 'ADMIN_UNIT_NAME,DESIGNATION,GIS_ACRES' },
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
    // gis.dnr.wa.gov blocks GitHub Actions; use ESRI Living Atlas USA_Protected_Areas_State
    // which contains full PAD-US data: DNR forests, state parks, county/regional parks.
    // Cougar Mountain (King County), Squak Mountain (WA State Parks), Tiger Mountain (DNR)
    // all appear under State_Nm='Washington' — query broadly first, DNR-only as fallback.
    attempts: [
      // Broadest WA filter first — catches DNR, State Parks, King County parks, etc.
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='Washington'", outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='WA'",        outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      // DNR-specific fallbacks
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='Washington' AND Mang_Name='WADNR'",  outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "State_Nm='Washington' AND Mang_Name='WA DNR'", outFields: 'Unit_Nm,Des_Tp,Mang_Name,GIS_Acres' },
      // Broadest: all state/local lands in PNW bbox (may include OR/ID)
      { url: `${LIVING_ATLAS}/USA_Protected_Areas_State/FeatureServer/0/query`, where: "1=1", outFields: 'Unit_Nm,Des_Tp,Mang_Name,State_Nm,GIS_Acres' },
    ],
  },
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  for (const ds of DATASETS) {
    console.log(`\nFetching ${ds.label}…`)
    const outFile = join(OUT_DIR, `${ds.name}.geojson`)
    const data = await tryAttempts(ds.attempts, ds.label)

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
