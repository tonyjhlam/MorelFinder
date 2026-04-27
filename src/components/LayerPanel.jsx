import { useState } from 'react'
import '../App.css'

const LAYER_GROUPS = [
  {
    label: 'Historical Fire Perimeters',
    ids: ['fires2024', 'fires2025'],
  },
  {
    label: 'WA DNR Fire Incidents',
    ids: ['wadnrFires'],
  },
  {
    label: 'Fire Closures',
    ids: ['usfsFireClosures'],
  },
  {
    label: 'Public Lands',
    ids: ['natForests', 'wilderness', 'natParks', 'blmLands', 'naturePreserves', 'waDnrLands'],
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

function FireFilterOption({ checked, onChange }) {
  return (
    <div className="layer-subitem" onClick={onChange}>
      <Toggle
        id="toggle-public-land-fires-only"
        checked={checked}
        onChange={onChange}
      />
      <div className="layer-text">
        <div className="layer-label">Only Fires On Public Lands</div>
        <div className="layer-desc">Hide WA DNR incidents that fall outside loaded public-land boundaries</div>
      </div>
    </div>
  )
}

function LayerGroup({ group, layers, visibility, onToggle, showPublicLandFiresOnly, onTogglePublicLandFiresOnly }) {
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

      {open && group.ids.includes('wadnrFires') && (
        <FireFilterOption
          checked={showPublicLandFiresOnly}
          onChange={onTogglePublicLandFiresOnly}
        />
      )}
    </div>
  )
}

export default function LayerPanel({
  layers,
  visibility,
  onToggle,
  showPublicLandFiresOnly,
  onTogglePublicLandFiresOnly,
  isOpen,
  onTogglePanel,
}) {
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
          showPublicLandFiresOnly={showPublicLandFiresOnly}
          onTogglePublicLandFiresOnly={onTogglePublicLandFiresOnly}
        />
      ))}

      <div className="panel-tip">
        <strong>Click the map</strong> for soil temp &amp; GDD at any point.<br />
        <strong>Click a fire</strong> for burn details and morel outlook.
      </div>
    </aside>
  )
}
