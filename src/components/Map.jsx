import { useEffect, useRef, useState } from 'react'
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

function pointCoordinates(feature) {
  const coords = feature?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return { lng: null, lat: null }
  const [lng, lat] = coords
  return { lng, lat }
}

function pointInRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function ringBbox(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  ring.forEach(([x, y]) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  })

  return { minX, minY, maxX, maxY }
}

function flattenPublicLandAreas(publicLands) {
  const collections = [
    publicLands?.natForests,
    publicLands?.wilderness,
    publicLands?.natParks,
    publicLands?.blmLands,
    publicLands?.waDnrLands,
  ].filter(Boolean)

  return collections.flatMap(collection => (collection.features || []).flatMap(feature => {
    const geometry = feature?.geometry
    if (!geometry) return []

    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

    return polygons
      .filter(rings => Array.isArray(rings) && rings.length > 0)
      .map(rings => ({
        outer: rings[0],
        holes: rings.slice(1),
        bbox: ringBbox(rings[0]),
      }))
  }))
}

function pointInPublicLand(point, areas) {
  if (!Array.isArray(point) || point.length < 2) return false

  return areas.some(area => {
    const { minX, minY, maxX, maxY } = area.bbox
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) return false
    if (!pointInRing(point, area.outer)) return false
    return !area.holes.some(hole => pointInRing(point, hole))
  })
}

function prepareWadnrFireSourceData(wadnrFires, publicLands, publicOnly) {
  if (!wadnrFires) return null

  const publicLandAreas = flattenPublicLandAreas(publicLands)
  const features = (wadnrFires.features || []).flatMap(feature => {
    const isPublicLand = pointInPublicLand(feature?.geometry?.coordinates, publicLandAreas)
    if (publicOnly && !isPublicLand) return []

    return [{
      ...feature,
      properties: {
        ...feature.properties,
        IS_PUBLIC_LAND: isPublicLand ? 1 : 0,
      },
    }]
  })

  return { ...wadnrFires, features }
}

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
    layout: { visibility: 'none' },
  })
  map.addLayer({
    id: `${id}-outline`,
    type: 'line',
    source: id,
    paint: {
      'line-color': outlineColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5],
    },
    layout: { visibility: 'none' },
  })
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
      visibility: 'none',
    },
    paint: {
      'text-color': '#fff',
      'text-halo-color': '#000',
      'text-halo-width': 1.5,
    },
  })
}

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

function setVis(map, layerId, visible) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }
}

// ─── Public lands layer helper ───────────────────────────────────────────────

function ensurePublicLandLayer(map, id, geojson, fillColor, lineColor, fillOpacity = 0.22) {
  if (map.getSource(id)) {
    map.getSource(id).setData(geojson)
    return
  }
  map.addSource(id, { type: 'geojson', data: geojson })
  map.addLayer({
    id: `${id}-fill`,
    type: 'fill',
    source: id,
    paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity },
    layout: { visibility: 'none' },
  })
  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    paint: {
      'line-color': lineColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5],
      'line-opacity': 0.7,
    },
    layout: { visibility: 'none' },
  })
}

function moveLayerIfPresent(map, layerId, beforeId) {
  if (!map.getLayer(layerId)) return
  if (beforeId && map.getLayer(beforeId)) {
    map.moveLayer(layerId, beforeId)
    return
  }
  map.moveLayer(layerId)
}

// ─── Map component ───────────────────────────────────────────────────────────

export default function Map({
  layerVis,
  fires2024,
  fires2025,
  wadnrFires,
  publicLands,
  showPublicLandFiresOnly,
  onPointClick,
  onFeatureClick,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
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
      const fireLayers = ['fires-2024-fill', 'fires-2025-fill'].filter(id => m.getLayer(id))
      if (fireLayers.length > 0) {
        const features = m.queryRenderedFeatures(e.point, { layers: fireLayers })
        if (features.length > 0) {
          const props = fireProps(features[0].properties)
          const notable = getNotableFire(props.name)
          onFeatureClick({ type: 'fire', ...props, notable })
          return
        }
      }

      // Check WADNR fire points first (on top)
      if (m.getLayer('wadnr-fires-circle')) {
        const pts = m.queryRenderedFeatures(e.point, { layers: ['wadnr-fires-circle'] })
        if (pts.length > 0) {
          const { lng, lat } = pointCoordinates(pts[0])
          const p = pts[0].properties || {}
          onFeatureClick({
            type: 'wadnrFire',
            name: p.INCIDENT_N || 'Unknown Fire',
            acres: p.ACRES_BURN ?? null,
            cause: p.FIREGCAUSE || '',
            causeSpecific: p.FIRESCAUSE || '',
            county: p.COUNTY_LAB || '',
            startJurisdiction: p.START_JURI || '',
            protection: p.PROTECTION || 'WADNR',
            elevation: p.SITE_ELEV ?? null,
            discoveryDate: p.DSCVR_DT || null,
            controlDate: p.CONTROL_DT || null,
            fireOutDate: p.FIRE_OUT_D || null,
            lat,
            lng,
          })
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

    const fireIds = ['fires-2024-fill', 'fires-2025-fill', 'wadnr-fires-circle']
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

  // ── Historical fire perimeters ───────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !fires2024) return
    ensureFireLayer(m, 'fires-2024', fires2024, '#FF8C00', '#C85C00', 0.28)
  }, [mapReady, fires2024])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !fires2025) return
    ensureFireLayer(m, 'fires-2025', fires2025, '#E63946', '#9B1B2A', 0.32)
  }, [mapReady, fires2025])

  // ── WADNR fire points ─────────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !wadnrFires) return
    const wadnrFireData = prepareWadnrFireSourceData(wadnrFires, publicLands, showPublicLandFiresOnly)
    const acresExpr = ['coalesce', ['to-number', ['get', 'ACRES_BURN']], 0]

    if (m.getSource('wadnr-fires')) {
      m.getSource('wadnr-fires').setData(wadnrFireData)
      return
    }
    m.addSource('wadnr-fires', { type: 'geojson', data: wadnrFireData })
    // Halo
    m.addLayer({
      id: 'wadnr-fires-halo',
      type: 'circle',
      source: 'wadnr-fires',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          6, ['interpolate', ['linear'], acresExpr, 0, 8, 10, 9, 100, 10, 1000, 12, 5000, 15],
          10, ['interpolate', ['linear'], acresExpr, 0, 12, 10, 14, 100, 16, 1000, 20, 5000, 24],
        ],
        'circle-color': ['interpolate', ['linear'], acresExpr,
          0, '#ffd166',
          10, '#ffb347',
          100, '#ff7f50',
          500, '#f95d6a',
          2000, '#d7263d',
          10000, '#7f1d1d',
        ],
        'circle-opacity': 0.25,
      },
    })
    // Core dot — size and color scale with acres burned
    m.addLayer({
      id: 'wadnr-fires-circle',
      type: 'circle',
      source: 'wadnr-fires',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          6, ['interpolate', ['linear'], acresExpr, 0, 3.5, 10, 4, 100, 5, 1000, 6.5, 5000, 8],
          10, ['interpolate', ['linear'], acresExpr, 0, 6, 10, 6.5, 100, 8, 1000, 10, 5000, 12],
        ],
        'circle-color': ['interpolate', ['linear'], acresExpr,
          0, '#ffd166',
          10, '#ffb347',
          100, '#ff7f50',
          500, '#f95d6a',
          2000, '#d7263d',
          10000, '#7f1d1d',
        ],
        'circle-stroke-color': '#8B1200',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    })
    // Label at zoom >= 10
    m.addLayer({
      id: 'wadnr-fires-label',
      type: 'symbol',
      source: 'wadnr-fires',
      minzoom: 10,
      layout: {
        'text-field': ['coalesce', ['get', 'INCIDENT_N'], ''],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-max-width': 8,
      },
      paint: {
        'text-color': ['interpolate', ['linear'], acresExpr,
          0, '#ffb347',
          100, '#ff7f50',
          500, '#f95d6a',
          2000, '#d7263d',
          10000, '#7f1d1d',
        ],
        'text-halo-color': '#000',
        'text-halo-width': 1.5,
      },
    })
  }, [mapReady, wadnrFires, publicLands, showPublicLandFiresOnly])

  // ── Public lands vector layers ────────────────────────────────────────────────
  // After ensurePublicLandLayer adds layers (with visibility:'none'), immediately apply
  // the current layerVis state. This fixes a race condition where the visibility
  // effect fires before GeoJSON loads, making the no-op setVis miss the window.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !publicLands?.natForests) return
    ensurePublicLandLayer(m, 'nat-forests', publicLands.natForests, '#2d6a4f', '#1b4332', 0.22)
    setVis(m, 'nat-forests-fill', layerVis.natForests)
    setVis(m, 'nat-forests-line', layerVis.natForests)
  }, [mapReady, publicLands?.natForests])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !publicLands?.wilderness) return
    ensurePublicLandLayer(m, 'wilderness', publicLands.wilderness, '#1a3a5c', '#0d2137', 0.28)
    setVis(m, 'wilderness-fill', layerVis.wilderness)
    setVis(m, 'wilderness-line', layerVis.wilderness)
  }, [mapReady, publicLands?.wilderness])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !publicLands?.natParks) return
    ensurePublicLandLayer(m, 'nat-parks', publicLands.natParks, '#7d3c0a', '#5a2906', 0.28)
    setVis(m, 'nat-parks-fill', layerVis.natParks)
    setVis(m, 'nat-parks-line', layerVis.natParks)
  }, [mapReady, publicLands?.natParks])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !publicLands?.blmLands) return
    ensurePublicLandLayer(m, 'blm-lands', publicLands.blmLands, '#c9a227', '#9a7a1c', 0.22)
    setVis(m, 'blm-lands-fill', layerVis.blmLands)
    setVis(m, 'blm-lands-line', layerVis.blmLands)
  }, [mapReady, publicLands?.blmLands])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady || !publicLands?.waDnrLands) return
    ensurePublicLandLayer(m, 'wa-dnr-lands', publicLands.waDnrLands, '#6d8b3a', '#4a6028', 0.22)
    setVis(m, 'wa-dnr-lands-fill', layerVis.waDnrLands)
    setVis(m, 'wa-dnr-lands-line', layerVis.waDnrLands)
  }, [mapReady, publicLands?.waDnrLands])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layer visibility ──────────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapReady) return

    moveLayerIfPresent(m, 'fires-2024-fill', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'fires-2024-outline', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'fires-2024-label', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'fires-2025-fill', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'fires-2025-outline', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'fires-2025-label', 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'wadnr-fires-halo')
    moveLayerIfPresent(m, 'wadnr-fires-circle')
    moveLayerIfPresent(m, 'wadnr-fires-label')

    setVis(m, 'fires-2024-fill',   layerVis.fires2024)
    setVis(m, 'fires-2024-outline', layerVis.fires2024)
    setVis(m, 'fires-2024-label',  layerVis.fires2024)
    setVis(m, 'fires-2025-fill',   layerVis.fires2025)
    setVis(m, 'fires-2025-outline', layerVis.fires2025)
    setVis(m, 'fires-2025-label',  layerVis.fires2025)
    setVis(m, 'nat-forests-fill',  layerVis.natForests)
    setVis(m, 'nat-forests-line',  layerVis.natForests)
    setVis(m, 'wilderness-fill',   layerVis.wilderness)
    setVis(m, 'wilderness-line',   layerVis.wilderness)
    setVis(m, 'nat-parks-fill',    layerVis.natParks)
    setVis(m, 'nat-parks-line',    layerVis.natParks)
    setVis(m, 'blm-lands-fill',    layerVis.blmLands)
    setVis(m, 'blm-lands-line',    layerVis.blmLands)
    setVis(m, 'wa-dnr-lands-fill', layerVis.waDnrLands)
    setVis(m, 'wa-dnr-lands-line', layerVis.waDnrLands)
    setVis(m, 'wadnr-fires-halo',   layerVis.wadnrFires)
    setVis(m, 'wadnr-fires-circle', layerVis.wadnrFires)
    setVis(m, 'wadnr-fires-label',  layerVis.wadnrFires)
  }, [mapReady, layerVis])

  return <div ref={containerRef} className="map-container" />
}
