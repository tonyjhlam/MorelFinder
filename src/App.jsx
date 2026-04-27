import { useState, useCallback } from 'react'
import Map from './components/Map.jsx'
import LayerPanel from './components/LayerPanel.jsx'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import { useFirePerimeters } from './hooks/useFirePerimeters.js'
import { useWADNRFirePoints } from './hooks/useWADNRFirePoints.js'
import { usePublicLands } from './hooks/usePublicLands.js'
import { useUsfsFireClosures } from './hooks/useUsfsFireClosures.js'
import './App.css'

export const LAYERS = {
  fires2024: {
    id: 'fires2024',
    label: '2024 Large Fire Perimeters',
    description: 'Historical large fires from 2024 across the PNW',
    color: '#FF8C00',
    defaultOn: true,
  },
  fires2025: {
    id: 'fires2025',
    label: '2025 Large Fire Perimeters',
    description: 'Historical large fires from 2025 across the PNW',
    color: '#E63946',
    defaultOn: true,
  },
  natForests: {
    id: 'natForests',
    label: 'National Forests',
    description: 'USFS — personal-use picking generally allowed (up to 1 gallon/day)',
    color: '#2d6a4f',
    defaultOn: true,
  },
  wilderness: {
    id: 'wilderness',
    label: 'Wilderness Areas',
    description: 'Within NFs — picking allowed, no motorized vehicles',
    color: '#1a3a5c',
    defaultOn: false,
  },
  natParks: {
    id: 'natParks',
    label: 'National Parks & Monuments',
    description: 'NPS units — foraging generally prohibited',
    color: '#7d3c0a',
    defaultOn: true,
  },
  blmLands: {
    id: 'blmLands',
    label: 'BLM Lands',
    description: 'Bureau of Land Management — picking generally allowed',
    color: '#c9a227',
    defaultOn: true,
  },
  naturePreserves: {
    id: 'naturePreserves',
    label: 'Nature Preserves',
    description: 'Nature reserves and preserve-style protected areas across the PNW',
    color: '#8ecf6c',
    defaultOn: false,
  },
  waDnrLands: {
    id: 'waDnrLands',
    label: 'State & Local Public Lands',
    description: 'State forests, state parks, county and regional public lands across the PNW',
    color: '#6d8b3a',
    defaultOn: true,
  },
  wadnrFires: {
    id: 'wadnrFires',
    label: 'WA DNR Jurisdiction Fires (2025)',
    description: 'Fire incidents on WA DNR-protected lands, current season',
    color: '#FF4500',
    defaultOn: true,
  },
  usfsFireClosures: {
    id: 'usfsFireClosures',
    label: 'USFS Fire Closure Areas',
    description: 'Active USDA Forest Service Region 6 emergency closure polygons',
    color: '#b00020',
    defaultOn: false,
  },
}

function buildDefaultVisibility() {
  const v = {}
  Object.values(LAYERS).forEach(l => { v[l.id] = l.defaultOn })
  return v
}

function buildRequestedLayers() {
  return buildDefaultVisibility()
}

export default function App() {
  const [layerVis, setLayerVis] = useState(buildDefaultVisibility)
  const [requestedLayers, setRequestedLayers] = useState(buildRequestedLayers)
  const [showPublicLandFiresOnly, setShowPublicLandFiresOnly] = useState(false)
  const [clickedInfo, setClickedInfo] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const { data: fires2024 } = useFirePerimeters(2024, requestedLayers.fires2024)
  const { data: fires2025 } = useFirePerimeters(2025, requestedLayers.fires2025)
  const { data: wadnrFires } = useWADNRFirePoints(2025, requestedLayers.wadnrFires)
  const { data: usfsFireClosures } = useUsfsFireClosures(requestedLayers.usfsFireClosures)
  const publicLands = usePublicLands({
    natForests: requestedLayers.natForests,
    wilderness: requestedLayers.wilderness,
    natParks: requestedLayers.natParks,
    blmLands: requestedLayers.blmLands,
    naturePreserves: requestedLayers.naturePreserves,
    waDnrLands: requestedLayers.waDnrLands,
  })

  const toggleLayer = useCallback((id) => {
    setRequestedLayers(prev => (prev[id] ? prev : { ...prev, [id]: true }))
    setLayerVis(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handlePointClick = useCallback((info) => {
    setClickedInfo(info)
  }, [])

  const handleFeatureClick = useCallback((info) => {
    setClickedInfo(info)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">MorelFinder</span>
        <span className="app-subtitle">Western Washington Morel Prediction</span>
      </header>

      <div className="app-body">
        <LayerPanel
          layers={LAYERS}
          visibility={layerVis}
          onToggle={toggleLayer}
          showPublicLandFiresOnly={showPublicLandFiresOnly}
          onTogglePublicLandFiresOnly={() => setShowPublicLandFiresOnly(v => !v)}
          isOpen={sidebarOpen}
          onTogglePanel={() => setSidebarOpen(v => !v)}
        />
        <div className="map-wrapper">
          <Map
            layerVis={layerVis}
            fires2024={fires2024}
            fires2025={fires2025}
            wadnrFires={wadnrFires}
            usfsFireClosures={usfsFireClosures}
            publicLands={publicLands}
            showPublicLandFiresOnly={showPublicLandFiresOnly}
            onPointClick={handlePointClick}
            onFeatureClick={handleFeatureClick}
          />
          <Legend layerVis={layerVis} />
        </div>
      </div>

      {clickedInfo && (
        <InfoPanel info={clickedInfo} onClose={() => setClickedInfo(null)} />
      )}
    </div>
  )
}
