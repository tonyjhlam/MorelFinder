import { useState, useCallback } from 'react'
import Map from './components/Map.jsx'
import LayerPanel from './components/LayerPanel.jsx'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import { useFirePerimeters } from './hooks/useFirePerimeters.js'
import { useWADNRFirePoints } from './hooks/useWADNRFirePoints.js'
import { usePublicLands } from './hooks/usePublicLands.js'
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
    defaultOn: false,
  },
  blmLands: {
    id: 'blmLands',
    label: 'BLM Lands',
    description: 'Bureau of Land Management — picking generally allowed',
    color: '#c9a227',
    defaultOn: false,
  },
  waDnrLands: {
    id: 'waDnrLands',
    label: 'WA State Lands (DNR)',
    description: 'Washington DNR state forests — free permit required for commercial, personal use OK',
    color: '#6d8b3a',
    defaultOn: false,
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
  const [clickedInfo, setClickedInfo] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const { data: fires2024, loading: fires2024Loading } = useFirePerimeters(2024)
  const { data: fires2025, loading: fires2025Loading } = useFirePerimeters(2025)
  const { data: wadnrFires } = useWADNRFirePoints(2025)
  const publicLands = usePublicLands()
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
          onTogglePanel={() => setSidebarOpen(v => !v)}
        />
        <div className="map-wrapper">
          <Map
            layerVis={layerVis}
            fires2024={fires2024}
            fires2025={fires2025}
            wadnrFires={wadnrFires}
            publicLands={publicLands}
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
