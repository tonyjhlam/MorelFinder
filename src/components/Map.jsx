import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getNotableFire } from '../utils/colors.js'

// Western Washington center, zoom
const CENTER = [-122.1, 47.5]
const ZOOM = 7

// PNW bounds for maxBounds
const BOUNDS = [[-130, 43], [-113, 51]]

// Free USGS National Map topo tiles — no API key needed
const BASE_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'usgs-topo': {
      type: 'raster',
      tiles: [
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS National Map</a>',
      maxzoom: 16,
    },
  },
  layers: [{ id: 'usgs-topo', type: 'raster', source: 'usgs-topo' }],
}

// ─── WMS / WMTS helper ──────────────────────────────────────────────────────

function makeTileUrl(base, wmsParams) {
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    CRS: 'EPSG:3857',
    STYLES: '',
    WIDTH: '256',
    HEIGHT: '256',
    BBOX: '{bbox-epsg-3857}',
    ...wmsParams,
  })
  return `${base}?${p.toString()}`
}

function addWMSLayers(map) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().split('T')[0]

  // SNODAS Snow Water Equivalent (layer 1 = SWE)
  map.addSource('snodas', {
    type: 'raster',
    tiles: [
      makeTileUrl(
        'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/WMSServer',
        { LAYERS: '1' },
      ),
    ],
    tileSize: 256,
    attribution: 'NOAA SNODAS',
  })
  map.addLayer({
    id: 'snodas-layer',
    type: 'raster',
    source: 'snodas',
    paint: { 'raster-opacity': 0.65 },
    layout: { visibility: 'none' },
  })

  // NASA GIBS MODIS Snow Cover (WMTS tile template)
  map.addSource('modis-snow', {
    type: 'raster',
    tiles: [
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/${dateStr}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
    ],
    tileSize: 256,
    attribution: 'NASA GIBS / MODIS',
  })
  map.addLayer({
    id: 'modis-snow-layer',
    type: 'raster',
    source: 'modis-snow',
    paint: { 'raster-opacity': 0.7 },
    layout: { visibility: 'none' },
  })

  // LANDFIRE Existing Vegetation Type (EVT)
  map.addSource('landfire', {
    type: 'raster',
    tiles: [
      makeTileUrl(
        'https://edcintl.cr.usgs.gov/geoserver/landfire/conus_2024/ows',
        { LAYERS: 'LC24_EVT_240' },
      ),
    ],
    tileSize: 256,
    attribution: 'LANDFIRE / USGS',
  })
  map.addLayer({
    id: 'landfire-layer',
    type: 'raster',
    source: 'landfire',
    paint: { 'raster-opacity': 0.6 },
    layout: { visibility: 'none' },
  })

  // NOAA RFC QPE 7-day precipitation
  map.addSource('noaa-qpe', {
    type: 'raster',
    tiles: [
      makeTileUrl(
        'https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer/WMSServer',
        { LAYERS: '7' }, // layer 7 = 7-day accumulated
      ),
    ],
    tileSize: 256,
    attribution: 'NOAA RFC QPE',
  })
  map.addLayer({
    id: 'noaa-qpe-layer',
    type: 'raster',
    source: 'noaa-qpe',
    paint: { 'raster-opacity': 0.6 },
    layout: { visibility: 'none' },
  })

  // National Forests (USFS EDW)
  map.addSource('nat-forests', {
    type: 'raster',
    tiles: [makeTileUrl(
      'https://apps.fs.usda.gov/arcx/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/WMSServer',
      { LAYERS: '1' },
    )],
    tileSize: 256,
    attribution: 'USDA Forest Service',
  })
  map.addLayer({
    id: 'nat-forests-layer',
    type: 'raster',
    source: 'nat-forests',
    paint: { 'raster-opacity': 0.35 },
    layout: { visibility: 'none' },
  })

  // Wilderness Areas (USFS EDW)
  map.addSource('wilderness', {
    type: 'raster',
    tiles: [makeTileUrl(
      'https://apps.fs.usda.gov/arcx/services/EDW/EDW_Wilderness_01/MapServer/WMSServer',
      { LAYERS: '0' },
    )],
    tileSize: 256,
    attribution: 'USDA Forest Service',
  })
  map.addLayer({
    id: 'wilderness-layer',
    type: 'raster',
    source: 'wilderness',
    paint: { 'raster-opacity': 0.45 },
    layout: { visibility: 'none' },
  })

  // National Parks & Monuments (NPS)
  map.addSource('nat-parks', {
    type: 'raster',
    tiles: [makeTileUrl(
      'https://mapservices.nps.gov/arcgis/services/LandResourcesDivisionTractAndBoundaryService/MapServer/WMSServer',
      { LAYERS: '2' },
    )],
    tileSize: 256,
    attribution: 'National Park Service',
  })
  map.addLayer({
    id: 'nat-parks-layer',
    type: 'raster',
    source: 'nat-parks',
    paint: { 'raster-opacity': 0.45 },
    layout: { visibility: 'none' },
  })

  // BLM Surface Management Agency
  map.addSource('blm-lands', {
    type: 'raster',
    tiles: [makeTileUrl(
      'https://gis.blm.gov/arcgis/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/WMSServer',
      { LAYERS: '0' },
    )],
    tileSize: 256,
    attribution: 'Bureau of Land Management',
  })
  map.addLayer({
    id: 'blm-lands-layer',
    type: 'raster',
    source: 'blm-lands',
    paint: { 'raster-opacity': 0.45 },
    layout: { visibility: 'none' },
  })

  // Washington DNR State Lands
  map.addSource('wa-dnr-lands', {
    type: 'raster',
    tiles: [makeTileUrl(
      'https://gis.dnr.wa.gov/site3/services/Public_Boundaries/WADNR_PUBLIC_Major_Public_Lands_NonDNR/MapServer/WMSServer',
      { LAYERS: '1' },
    )],
    tileSize: 256,
    attribution: 'Washington DNR',
  })
  map.addLayer({
    id: 'wa-dnr-lands-layer',
    type: 'raster',
    source: 'wa-dnr-lands',
    paint: { 'raster-opacity': 0.45 },
    layout: { visibility: 'none' },
  })
}

// ─── Fire layer helpers ──────────────────────────────────────────────────────

function ensureFireLayer(map, id, geojson, fillColor, outlineColor, fillOpacity) {
  if (map.getSource(id)) {
    map.getSource(id).setData(geojson)
    return
  }
  map.addSource(id, { type: 'geojson', data: geojson })
  map.addLayer({
    id: `${id}-fill`,
    type: 'fill',
    source: id,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': fillOpacity,
    },
  })
  map.addLayer({
    id: `${id}-outline`,
    type: 'line',
    source: id,
    paint: {
      'line-color': outlineColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5],
    },
  })
  // Labels for notable fires at zoom >= 9
  map.addLayer({
    id: `${id}-label`,
    type: 'symbol',
    source: id,
    minzoom: 9,
    layout: {
      'text-field': [
        'coalesce',
        ['get', 'attr_IncidentName'],
        ['get', 'IncidentName'],
        ['get', 'FIRE_NAME'],
        '',
      ],
      'text-size': 11,
      'text-anchor': 'center',
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#fff',
      'text-halo-color': '#000',
      'text-halo-width': 1.5,
    },
  })
}

function setVis(map, layerId, visible) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }
}

// ─── Fire property normalization ─────────────────────────────────────────────

function fireProps(properties) {
  const p = properties || {}
  return {
    name: p.attr_IncidentName || p.IncidentName || p.FIRE_NAME || p.fireName || 'Unknown Fire',
    acres: p.attr_TotalAcres || p.GISAcres || p.GISACRES || p.totalAcres || null,
    year: p.attr_FireYear || p.FireYear || p.FIRE_YEAR || p.fireYear || null,
    pct: p.attr_PercentContained ?? p.PercentContained ?? null,
    state: p.attr_POOState || p.POOState || '',
    county: p.attr_POOCounty || p.POOCounty || '',
    containedDate: p.attr_ContainmentDateTime || p.ContainmentDateTime || null,
  }
}

// ─── Map component ───────────────────────────────────────────────────────────

export default function Map({
  layerVis,
  fires2024,
  fires2025,
  snotelStations,
  inatObs,
  onPointClick,
  onFeatureClick,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const snotelMarkersRef = useRef([])
  const inatMarkersRef = useRef([])
  const [mapReady, setMapReady] = useState(false)

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: CENTER,
      zoom: ZOOM,
      maxBounds: BOUNDS,
    })

    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.addControl(
      new maplibregl.ScaleControl({ maxWidth: 140, unit: 'imperial' }),
      'bottom-right',
    )
    m.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: false }),
      'top-right',
    )

    m.on('load', () => {
      addWMSLayers(m)
      setMapReady(true)
    })

    mapRef.current = m
    return () => {
      m.remove()
      mapRef.current = null
    }
  }, [])

  // ── Click handler ────────────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return

    const handleClick = (e) => {
      const fireLayers = [
        'fires-2024-fill',
        'fires-2025-fill',
      ].filter(id => m.getLayer(id))

      if (fireLayers.length > 0) {
        const features = m.queryRenderedFeatures(e.point, { layers: fireLayers })
        if (features.length > 0) {
          const props = fireProps(features[0].properties)
          const notable = getNotableFire(props.name)
          onFeatureClick({ type: 'fire', ...props, notable })
          return
        }
      }

      // Generic point click → soil temperature
      onPointClick({ type: 'point', lat: e.lngLat.lat, lng: e.lngLat.lng })
    }

    m.on('click', handleClick)
    return () => m.off('click', handleClick)
  }, [mapReady, onPointClick, onFeatureClick])

  // ── Pointer cursor over fire polygons ────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return

    const fireIds = ['fires-2024-fill', 'fires-2025-fill']
    const enter = () => { m.getCanvas().style.cursor = 'pointer' }
    const leave = () => { m.getCanvas().style.cursor = '' }

    fireIds.forEach(id => {
      m.on('mouseenter', id, enter)
      m.on('mouseleave', id, leave)
    })
    return () => {
      fireIds.forEach(id => {
        m.off('mouseenter', id, enter)
        m.off('mouseleave', id, leave)
      })
    }
  }, [mapReady])

  // ── Fire 2024 perimeters ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !fires2024) return
    ensureFireLayer(m, 'fires-2024', fires2024, '#FF8C00', '#C85C00', 0.32)
  }, [mapReady, fires2024])

  // ── Fire 2025 perimeters ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !fires2025) return
    ensureFireLayer(m, 'fires-2025', fires2025, '#E63946', '#9B1B2A', 0.38)
  }, [mapReady, fires2025])

  // ── Layer visibility ──────────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return

    setVis(m, 'fires-2024-fill',    layerVis.fires2024)
    setVis(m, 'fires-2024-outline', layerVis.fires2024)
    setVis(m, 'fires-2024-label',   layerVis.fires2024)
    setVis(m, 'fires-2025-fill',    layerVis.fires2025)
    setVis(m, 'fires-2025-outline', layerVis.fires2025)
    setVis(m, 'fires-2025-label',   layerVis.fires2025)
    setVis(m, 'snodas-layer',       layerVis.snodas)
    setVis(m, 'modis-snow-layer',   layerVis.modisSnow)
    setVis(m, 'landfire-layer',     layerVis.landfire)
    setVis(m, 'noaa-qpe-layer',     layerVis.noaaQpe)
    setVis(m, 'nat-forests-layer',  layerVis.natForests)
    setVis(m, 'wilderness-layer',   layerVis.wilderness)
    setVis(m, 'nat-parks-layer',    layerVis.natParks)
    setVis(m, 'blm-lands-layer',    layerVis.blmLands)
    setVis(m, 'wa-dnr-lands-layer', layerVis.waDnrLands)
  }, [mapReady, layerVis])

  // ── SNOTEL markers ────────────────────────────────────────────────────────────
  useEffect(() => {
    // Clear old markers
    snotelMarkersRef.current.forEach(mk => mk.remove())
    snotelMarkersRef.current = []

    const m = mapRef.current
    if (!m || !mapReady || !snotelStations || !layerVis.snotel) return

    snotelStations.forEach(station => {
      const el = document.createElement('div')
      el.className = 'snotel-marker'
      el.title = `${station.name} (${station.elevation?.toLocaleString() ?? '?'} ft)`

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([station.longitude, station.latitude])
        .addTo(m)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onFeatureClick({ type: 'snotel', station })
      })

      snotelMarkersRef.current.push(marker)
    })
  }, [mapReady, snotelStations, layerVis.snotel, onFeatureClick])

  // ── iNaturalist markers ───────────────────────────────────────────────────────
  useEffect(() => {
    inatMarkersRef.current.forEach(mk => mk.remove())
    inatMarkersRef.current = []

    const m = mapRef.current
    if (!m || !mapReady || !inatObs || !layerVis.inat) return

    inatObs.forEach(obs => {
      if (!obs.location) return
      const parts = obs.location.split(',')
      if (parts.length < 2) return
      const lat = parseFloat(parts[0])
      const lng = parseFloat(parts[1])
      if (isNaN(lat) || isNaN(lng)) return

      const el = document.createElement('div')
      el.className = 'inat-marker'
      const taxonName = obs.taxon?.name || 'Morchella sp.'
      el.title = `${taxonName} — ${obs.observed_on || ''}`

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(m)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onFeatureClick({ type: 'inat', obs })
      })

      inatMarkersRef.current.push(marker)
    })
  }, [mapReady, inatObs, layerVis.inat, onFeatureClick])

  return <div ref={containerRef} className="map-container" />
}
