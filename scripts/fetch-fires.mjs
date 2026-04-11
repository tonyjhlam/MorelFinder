#!/usr/bin/env node
/**
 * scripts/fetch-fires.mjs
 *
 * Downloads 2024 and 2025 NIFC fire perimeters for WA/OR/ID/MT,
 * writes them to public/data/fires-{year}.geojson.
 *
 * Runs in GitHub Actions before `npm run build` so the app always
 * has current data without relying on client-side CORS requests.
 * Uses continue-on-error in the workflow so a failed download
 * doesn't break the deploy — existing files are used instead.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'data')

const NIFC = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'
const SERVICES = [
  `${NIFC}/WFIGS_Interagency_Perimeters/FeatureServer/0/query`,
  `${NIFC}/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query`,
]

// PNW states — keeps file sizes manageable, covers all morel targets
const PNW_STATES = `'WA','OR','ID','MT'`
const PNW = { xmin: -126, ymin: 44, xmax: -115, ymax: 50 }

// Fields to keep — drops heavy geometry-adjacent metadata we don't need
const FIELDS = [
  'attr_IncidentName',
  'attr_TotalAcres',
  'attr_FireYear',
  'attr_PercentContained',
  'attr_ContainmentDateTime',
  'attr_POOState',
  'attr_POOCounty',
].join(',')

async function fetchFromService(serviceUrl, year) {
  // Try 1: year + state filter (most specific)
  // Try 2: year filter only (client-side state filter)
  const queries = [
    { where: `attr_FireYear = ${year} AND attr_POOState IN (${PNW_STATES})` },
    { where: `attr_FireYear = ${year}` },
    { where: `FireYear = ${year} AND STATE IN (${PNW_STATES})` }, // alt schema
  ]

  for (const extra of queries) {
    const params = new URLSearchParams({
      outFields: FIELDS,
      f: 'geojson',
      resultRecordCount: '2000',
      ...extra,
    })
    const url = `${serviceUrl}?${params}`

    try {
      console.log(`  → ${new URL(serviceUrl).pathname} | ${extra.where.slice(0, 60)}`)
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) { console.log(`    HTTP ${res.status}`); continue }

      const json = await res.json()
      if (json.error) { console.log(`    API error: ${json.error.message}`); continue }
      if (!json.features?.length) { console.log('    0 features'); continue }

      // Client-side PNW filter for queries without state clause
      let features = json.features
      if (!extra.where.includes('POOState') && !extra.where.includes('STATE')) {
        features = features.filter(f => isInPNW(f))
      }

      console.log(`    ✓ ${features.length} PNW features`)
      return { type: 'FeatureCollection', features }
    } catch (e) {
      console.log(`    Error: ${e.message}`)
    }
  }
  return null
}

function isInPNW(feature) {
  const geom = feature.geometry
  if (!geom) return false
  let c
  if (geom.type === 'Polygon') c = geom.coordinates?.[0]?.[0]
  else if (geom.type === 'MultiPolygon') c = geom.coordinates?.[0]?.[0]?.[0]
  if (!c) return false
  return c[0] >= PNW.xmin && c[0] <= PNW.xmax && c[1] >= PNW.ymin && c[1] <= PNW.ymax
}

async function downloadYear(year) {
  console.log(`\nFetching ${year} fire perimeters…`)
  for (const svc of SERVICES) {
    const result = await fetchFromService(svc, year)
    if (result?.features?.length > 0) return result
  }
  console.warn(`  ⚠ No data found for ${year}`)
  return null
}

// ── WADNR fire points (Layer 1 = Current DNR Fire Statistics) ────────────────

// Public FeatureServer confirmed: services.arcgis.com/4x406oNViizbGo13
const WADNR_URL = 'https://services.arcgis.com/4x406oNViizbGo13/arcgis/rest/services/WADNR_Jurisdiction_Fire_Points_2025/FeatureServer/0/query'

async function downloadWADNRFires(year) {
  console.log(`\nFetching WADNR fire points for ${year}…`)
  // Single-year service — no year filter needed
  const queries = [`1=1`]
  for (const where of queries) {
    const params = new URLSearchParams({
      where,
      outFields: '*',
      f: 'geojson',
      resultRecordCount: '2000',
    })
    try {
      console.log(`  → ${where}`)
      const res = await fetch(`${WADNR_URL}?${params}`, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) { console.log(`    HTTP ${res.status}`); continue }
      const json = await res.json()
      if (json.error) { console.log(`    API error: ${json.error.message}`); continue }
      if (!json.features?.length) { console.log('    0 features'); continue }
      console.log(`    ✓ ${json.features.length} features`)
      return json
    } catch (e) {
      console.log(`    Error: ${e.message}`)
    }
  }
  console.warn(`  ⚠ No WADNR data found for ${year}`)
  return null
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  let anyFailed = false

  // NIFC fire perimeters (polygons)
  for (const year of [2024, 2025]) {
    const outFile = join(OUT_DIR, `fires-${year}.geojson`)
    const data = await downloadYear(year)

    if (data) {
      writeFileSync(outFile, JSON.stringify(data))
      const kb = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)
      console.log(`  Saved fires-${year}.geojson (${data.features.length} features, ${kb} KB)`)
    } else if (existsSync(outFile)) {
      console.log(`  Keeping existing fires-${year}.geojson`)
    } else {
      console.warn(`  Writing empty placeholder for fires-${year}.geojson`)
      writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: [] }))
      anyFailed = true
    }
  }

  // WADNR fire points (current season)
  for (const year of [2025]) {
    const outFile = join(OUT_DIR, `wadnr-fires-${year}.geojson`)
    const data = await downloadWADNRFires(year)

    if (data) {
      writeFileSync(outFile, JSON.stringify(data))
      const kb = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)
      console.log(`  Saved wadnr-fires-${year}.geojson (${data.features.length} features, ${kb} KB)`)
    } else if (existsSync(outFile)) {
      console.log(`  Keeping existing wadnr-fires-${year}.geojson`)
    } else {
      console.warn(`  Writing empty placeholder for wadnr-fires-${year}.geojson`)
      writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: [] }))
      // WADNR failure is non-critical — don't set anyFailed
    }
  }

  if (anyFailed) {
    console.warn('\nSome downloads failed. Deploy will use empty/existing data files.')
    process.exit(0) // Don't fail the build
  }
  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(0) // Don't fail the build on unexpected errors
})
