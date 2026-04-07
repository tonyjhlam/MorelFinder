export default function Legend({ layerVis }) {
  const rows = []

  if (layerVis.fires2025) {
    rows.push({ color: '#E63946', label: '2025 fires (spring 2026 targets)' })
  }
  if (layerVis.fires2024) {
    rows.push({ color: '#FF8C00', label: '2024 fires (spring 2025 targets)' })
  }
  if (layerVis.snotel) {
    rows.push({ color: '#4ecca3', label: 'SNOTEL station', round: true })
  }
  if (layerVis.inat) {
    rows.push({ color: '#98c379', label: 'Morchella observation', round: true })
  }

  const soilRows = [
    { color: '#74c0fc', label: '< 40°F  Too cold' },
    { color: '#b8e8b0', label: '48–50°F  Near range' },
    { color: '#2ecc71', label: '50–55°F  Optimal' },
    { color: '#f5a623', label: '55–62°F  Warm' },
    { color: '#e74c3c', label: '> 62°F  Too hot' },
  ]

  if (rows.length === 0) return null

  return (
    <div className="legend">
      <div className="legend-title">Legend</div>

      {rows.map(r => (
        <div className="legend-row" key={r.label}>
          <span
            className="legend-swatch"
            style={{
              background: r.color,
              borderRadius: r.round ? '50%' : 2,
            }}
          />
          <span>{r.label}</span>
        </div>
      ))}

      <div className="legend-divider" />
      <div className="legend-title">Soil Temp (click map)</div>
      {soilRows.map(r => (
        <div className="legend-row" key={r.label}>
          <span className="legend-swatch" style={{ background: r.color }} />
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}
