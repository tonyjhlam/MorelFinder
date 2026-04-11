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
 *   wa-dnr-lands.geojson      — WA DNR managed state lands
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'data')

// PNW bounding box (WGS84)
const BBOX = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

async function queryService(url, extra = {}) {
  const params = new URLSearchParams({
    where: '1=1',
    geometryType: 'esriGeometryEnvelope',
    geometry: `${BBOX.xmin},${BBOX.ymin},${BBOX.xmax},${BBOX.ymax}`,
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '2000',
    ...extra,
  })
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
  if (!json.features?.length) throw new Error('0 features returned')
  return json
}

async function tryUrls(urls, extra, label) {
  for (const url of urls) {
    try {
      console.log(`  → ${url.replace(/^https?:\/\/[^/]+/, '')}`)
      const data = await queryService(url, extra)
      console.log(`    ✓ ${data.features.length} features`)
      return data
    } catch (e) {
      console.log(`    ✗ ${e.message}`)
    }
  }
  return null
}

const DATASETS = [
  {
    name: 'national-forests',
    label: 'National Forests',
    urls: [
      'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/FeatureServer/1/query',
      'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/1/query',
    ],
    extra: { outFields: 'FORESTNAME,REGION,GIS_ACRES' },
  },
  {
    name: 'wilderness',
    label: 'Wilderness Areas',
    urls: [
      'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/FeatureServer/0/query',
      'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer/0/query',
    ],
    extra: { outFields: 'NAME,AREAID,GIS_ACRES' },
  },
  {
    name: 'national-parks',
    label: 'National Parks & Monuments',
    urls: [
      'https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/2/query',
    ],
    extra: { outFields: 'UNIT_NAME,UNIT_TYPE' },
  },
  {
    name: 'blm-lands',
    label: 'BLM Lands',
    urls: [
      'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query',
      'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/0/query',
    ],
    extra: { outFields: 'AREANAME,AREAID,GIS_ACRES' },
  },
  {
    name: 'wa-dnr-lands',
    label: 'WA DNR Lands',
    urls: [
      'https://gis.dnr.wa.gov/site3/rest/services/Public_Boundaries/WADNR_PUBLIC_Managed_Lands/MapServer/0/query',
      'https://gis.dnr.wa.gov/site3/rest/services/Public_Boundaries/WADNR_PUBLIC_Cadastre_OpenData/MapServer/0/query',
    ],
    extra: { outFields: 'LABEL,MANAGING_AGENCY,ACRES' },
  },
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  for (const ds of DATASETS) {
    console.log(`\nFetching ${ds.label}…`)
    const outFile = join(OUT_DIR, `${ds.name}.geojson`)
    const data = await tryUrls(ds.urls, ds.extra || {}, ds.label)

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
