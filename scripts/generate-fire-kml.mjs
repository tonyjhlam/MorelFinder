#!/usr/bin/env node
/**
 * scripts/generate-fire-kml.mjs
 *
 * Fetches WADNR Jurisdiction Fire Points 2025 and writes a KML file suitable
 * for import into Google Maps (My Maps → Import).
 *
 * Output: public/data/wadnr-fires-2025.kml
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR   = join(__dirname, '..', 'public', 'data')
const OUT_FILE  = join(OUT_DIR, 'wadnr-fires-2025.kml')

const WADNR_URL =
  'https://services.arcgis.com/4x406oNViizbGo13/arcgis/rest/services' +
  '/WADNR_Jurisdiction_Fire_Points_2025/FeatureServer/0/query'

function escapeXml(v) {
  if (v == null) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return String(ts) }
}

// Acre-based style tiers — icon color + scale both increase with fire size
const STYLES = [
  { id: 'fire-unknown', label: 'Unknown size',    icon: 'ltblue-dot', scale: 0.7 },
  { id: 'fire-xs',      label: '< 5 acres',       icon: 'yellow-dot', scale: 0.7 },
  { id: 'fire-sm',      label: '5–50 acres',      icon: 'orange-dot', scale: 0.9 },
  { id: 'fire-md',      label: '50–500 acres',    icon: 'red-dot',    scale: 1.1 },
  { id: 'fire-lg',      label: '500–5 000 acres', icon: 'red-dot',    scale: 1.4, color: 'ff0000dd' },
  { id: 'fire-xl',      label: '> 5 000 acres',   icon: 'red-dot',    scale: 1.8, color: 'ff000099' },
]

function styleForAcres(acres) {
  if (acres == null || acres === '' || isNaN(parseFloat(acres))) return 'fire-unknown'
  const a = parseFloat(acres)
  if (a <     5) return 'fire-xs'
  if (a <    50) return 'fire-sm'
  if (a <   500) return 'fire-md'
  if (a <  5000) return 'fire-lg'
  return 'fire-xl'
}

const ICON_BASE = 'http://maps.google.com/mapfiles/ms/icons'

function styleXml(s) {
  const colorEl = s.color ? `\n      <color>${s.color}</color>` : ''
  return `  <Style id="${s.id}">
    <IconStyle>${colorEl}
      <scale>${s.scale}</scale>
      <Icon><href>${ICON_BASE}/${s.icon}.png</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0.8</scale></LabelStyle>
  </Style>`
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  console.log('Fetching WADNR fire points…')
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '2000',
  })

  const res = await fetch(`${WADNR_URL}?${params}`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const geojson = await res.json()
  if (geojson.error) throw new Error(`API error: ${geojson.error.message}`)

  const features = geojson.features ?? []
  console.log(`  ${features.length} fire points received`)

  const placemarks = features.map(f => {
    const p  = f.properties ?? {}
    const [lon, lat] = f.geometry?.coordinates ?? [0, 0]
    const name = escapeXml(p.INCIDENT_N || 'Unknown Fire')

    const styleId = styleForAcres(p.ACRES_BURN)

    // Google Maps renders CDATA HTML in the description balloon
    const rows = [
      p.COUNTY_LAB  && `<b>County:</b> ${escapeXml(p.COUNTY_LAB)}`,
      p.ACRES_BURN  != null && `<b>Acres burned:</b> ${fmtAcres(p.ACRES_BURN)}`,
      p.FIREGCAUSE  && `<b>General cause:</b> ${escapeXml(p.FIREGCAUSE)}`,
      p.FIRESCAUSE  && `<b>Specific cause:</b> ${escapeXml(p.FIRESCAUSE)}`,
      p.DSCVR_DT    && `<b>Discovered:</b> ${fmtDate(p.DSCVR_DT)}`,
      p.CONTROL_DT  && `<b>Controlled:</b> ${fmtDate(p.CONTROL_DT)}`,
      p.FIRE_OUT_D  && `<b>Fire out:</b> ${fmtDate(p.FIRE_OUT_D)}`,
      p.SITE_ELEV   != null && `<b>Elevation:</b> ${escapeXml(p.SITE_ELEV)} ft`,
      p.START_JURI  && `<b>Jurisdiction:</b> ${escapeXml(p.START_JURI)}`,
      p.PROTECTION  && `<b>Protection:</b> ${escapeXml(p.PROTECTION)}`,
    ].filter(Boolean).join('<br/>')

    return `  <Placemark>
    <name>${name}</name>
    <description><![CDATA[${rows}]]></description>
    <styleUrl>#${styleId}</styleUrl>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`
  }).join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>WADNR Jurisdiction Fires 2025</name>
  <description>Washington DNR jurisdiction fire incidents, 2025 season. Dot color = acres burned: light blue = unknown, yellow = &lt;5 ac, orange = 5–50 ac, red = 50–500 ac, dark red (large) = 500–5000 ac, dark red (largest) = 5000+ ac. Source: WADNR ArcGIS Feature Service.</description>
${STYLES.map(styleXml).join('\n')}
${placemarks}
</Document>
</kml>`

  writeFileSync(OUT_FILE, kml, 'utf8')
  console.log(`  Saved wadnr-fires-2025.kml (${features.length} placemarks)`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(0) // never fail the build
})
