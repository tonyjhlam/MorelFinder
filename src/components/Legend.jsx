export default function Legend({ layerVis }) {
  const soilRows = [
    { color: '#74c0fc', label: '< 40°F  Too cold' },
    { color: '#b8e8b0', label: '48–50°F  Near range' },
    { color: '#2ecc71', label: '50–55°F  Optimal' },
    { color: '#f5a623', label: '55–62°F  Warm' },
    { color: '#e74c3c', label: '> 62°F  Too hot' },
  ]

  return (
    <div className="legend">
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
