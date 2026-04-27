export default function Legend({ layerVis }) {
  const rows = []

  if (layerVis.fires2025) {
    rows.push({ color: '#E63946', label: '2025 large fire perimeter' })
  }
  if (layerVis.fires2024) {
    rows.push({ color: '#FF8C00', label: '2024 large fire perimeter' })
  }
  if (layerVis.usfsFireClosures) {
    rows.push({ color: '#b00020', label: 'USFS active fire closure area' })
  }

  const soilRows = [
    { color: '#74c0fc', label: '< 40°F  Too cold' },
    { color: '#b8e8b0', label: '48–50°F  Near range' },
    { color: '#2ecc71', label: '50–55°F  Optimal' },
    { color: '#f5a623', label: '55–62°F  Warm' },
    { color: '#e74c3c', label: '> 62°F  Too hot' },
  ]

  return (
    <div className="legend">
      {rows.length > 0 && (
        <>
          <div className="legend-title">Fire Layers</div>
          {rows.map(r => (
            <div className="legend-row" key={r.label}>
              <span className="legend-swatch" style={{ background: r.color }} />
              <span>{r.label}</span>
            </div>
          ))}
          <div className="legend-divider" />
        </>
      )}
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
