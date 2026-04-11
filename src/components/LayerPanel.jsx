import { useState } from 'react'
import '../App.css'

const LAYER_GROUPS = [
  {
    label: 'Fire Perimeters',
    ids: ['fires2024', 'fires2025'],
  },
  {
    label: 'WA DNR Fire Incidents',
    ids: ['wadnrFires'],
  },
  {
    label: 'Snow & Precipitation',
    ids: ['snodas', 'modisSnow', 'noaaQpe'],
  },
  {
    label: 'Public Lands',
    ids: ['natForests', 'wilderness', 'natParks', 'blmLands', 'waDnrLands'],
  },
  {
    label: 'Vegetation',
    ids: ['landfire'],
  },
  {
    label: 'Ground Truth',
    ids: ['snotel', 'inat'],
  },
]

function Toggle({ id, checked, onChange }) {
  return (
    <label className="layer-toggle" htmlFor={id} onClick={e => e.stopPropagation()}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
      <span className="layer-toggle-track" />
    </label>
  )
}

function LayerGroup({ group, layers, visibility, onToggle }) {
  const [open, setOpen] = useState(true)
  const visibleLayers = group.ids.filter(id => layers[id])
  if (visibleLayers.length === 0) return null

  return (
    <div className="layer-group">
      <button
        className="layer-group-label layer-group-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>{group.label}</span>
        <span className="group-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && visibleLayers.map(id => {
        const layer = layers[id]
        return (
          <div
            key={id}
            className="layer-item"
            onClick={() => onToggle(id)}
          >
            <Toggle
              id={`toggle-${id}`}
              checked={!!visibility[id]}
              onChange={() => onToggle(id)}
            />
            <span
              className="layer-swatch"
              style={{ background: layer.color }}
            />
            <div className="layer-text">
              <div className="layer-label">{layer.label}</div>
              <div className="layer-desc">{layer.description}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function LayerPanel({ layers, visibility, onToggle, isOpen, onTogglePanel }) {
  return (
    <aside className={`layer-panel${isOpen ? '' : ' closed'}`}>
      {/* Tab button always visible on the panel edge */}
      <button
        className="panel-tab"
        onClick={onTogglePanel}
        aria-label={isOpen ? 'Hide layers panel' : 'Show layers panel'}
        title={isOpen ? 'Hide layers' : 'Show layers'}
      >
        {isOpen ? '◀' : '▶'}
      </button>

      <div className="layer-panel-header">Map Layers</div>

      {LAYER_GROUPS.map(group => (
        <LayerGroup
          key={group.label}
          group={group}
          layers={layers}
          visibility={visibility}
          onToggle={onToggle}
        />
      ))}

      <div className="panel-tip">
        <strong>Click the map</strong> for soil temp &amp; GDD at any point.<br />
        <strong>Click a fire</strong> for burn details and morel outlook.<br />
        <strong>Click a marker</strong> for live station data.
      </div>
    </aside>
  )
}
