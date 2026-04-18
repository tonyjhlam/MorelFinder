import { useState, useCallback } from 'react'
import Map from './components/Map.jsx'
import LayerPanel from './components/LayerPanel.jsx'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import { useWADNRFirePoints } from './hooks/useWADNRFirePoints.js'
import { usePublicLands } from './hooks/usePublicLands.js'
import './App.css'

export const LAYERS = {
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
}

function buildDefaultVisibility() {
  const v = {}
  Object.values(LAYERS).forEach(l => { v[l.id] = l.defaultOn })
  return v
}

export default function App() {
  const [layerVis, setLayerVis] = useState(buildDefaultVisibility)
  const [showPublicLandFiresOnly, setShowPublicLandFiresOnly] = useState(false)
  const [clickedInfo, setClickedInfo] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const { data: wadnrFires } = useWADNRFirePoints(2025)
  const publicLands = usePublicLands()

  const toggleLayer = useCallback((id) => {
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
            wadnrFires={wadnrFires}
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
