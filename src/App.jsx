import { useState, useCallback } from 'react'
import Map from './components/Map.jsx'
import LayerPanel from './components/LayerPanel.jsx'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import { useFirePerimeters } from './hooks/useFirePerimeters.js'
import { useSnotel } from './hooks/useSnotel.js'
import { useInatObservations } from './hooks/useInatObservations.js'
import './App.css'

export const LAYERS = {
  fires2024: {
    id: 'fires2024',
    label: '2024 Fires (2025 targets)',
    description: 'Spring 2025 burn morel zones',
    color: '#FF8C00',
    defaultOn: true,
  },
  fires2025: {
    id: 'fires2025',
    label: '2025 Fires (2026 targets)',
    description: 'Spring 2026 burn morel zones — Bear Gulch priority',
    color: '#E63946',
    defaultOn: true,
  },
  snodas: {
    id: 'snodas',
    label: 'SNODAS Snow Analysis',
    description: 'Daily snow water equivalent (NOAA, 1 km)',
    color: '#74C0FC',
    defaultOn: false,
  },
  modisSnow: {
    id: 'modisSnow',
    label: 'MODIS Snow Cover',
    description: 'Satellite snow extent, yesterday (NASA GIBS, 500 m)',
    color: '#A9D8F5',
    defaultOn: false,
  },
  landfire: {
    id: 'landfire',
    label: 'LANDFIRE Vegetation',
    description: 'Existing vegetation type (USGS, 30 m)',
    color: '#4CAF50',
    defaultOn: false,
  },
  noaaQpe: {
    id: 'noaaQpe',
    label: 'Precipitation (QPE)',
    description: '7-day observed precip (NOAA RFC, ~4 km)',
    color: '#5E8FCC',
    defaultOn: false,
  },
  snotel: {
    id: 'snotel',
    label: 'SNOTEL Stations',
    description: 'Click for live SWE, snow depth, soil temp',
    color: '#4ECCA3',
    defaultOn: true,
  },
  inat: {
    id: 'inat',
    label: 'iNaturalist Sightings',
    description: 'Research-grade Morchella observations',
    color: '#98C379',
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
  const [clickedInfo, setClickedInfo] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const { data: fires2024, loading: fires2024Loading } = useFirePerimeters(2024)
  const { data: fires2025, loading: fires2025Loading } = useFirePerimeters(2025)
  const { data: snotelStations } = useSnotel()
  const { data: inatObs } = useInatObservations()

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
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(v => !v)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
        <span className="app-title">MorelFinder</span>
        <span className="app-subtitle">Western Washington Morel Prediction</span>
        <div className="header-status">
          {(fires2024Loading || fires2025Loading) && (
            <span className="loading-badge">Loading fire data…</span>
          )}
          {fires2024 && (
            <span className="data-badge">
              {fires2024.features?.length ?? 0} fires (2024)
            </span>
          )}
          {fires2025 && (
            <span className="data-badge highlight">
              {fires2025.features?.length ?? 0} fires (2025)
            </span>
          )}
        </div>
      </header>

      <div className="app-body">
        <LayerPanel
          layers={LAYERS}
          visibility={layerVis}
          onToggle={toggleLayer}
          isOpen={sidebarOpen}
        />
        <div className="map-wrapper">
          <Map
            layerVis={layerVis}
            fires2024={fires2024}
            fires2025={fires2025}
            snotelStations={snotelStations}
            inatObs={inatObs}
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
