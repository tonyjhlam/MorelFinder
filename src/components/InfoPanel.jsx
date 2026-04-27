import { useState, useEffect } from 'react'
import { useOpenMeteo, currentSoilTemp, dailyForecast } from '../hooks/useOpenMeteo.js'
import { fetchSnotelData } from '../hooks/useSnotel.js'
import { computeGDD, gddStatus, soilTempStatus, interpolate10cm, PRIME_THRESHOLD } from '../utils/gdd.js'
import { soilTempColor } from '../utils/colors.js'

// ─── Soil Temperature Panel ──────────────────────────────────────────────────

function SoilTempInfo({ lat, lng }) {
  const { data, loading, error } = useOpenMeteo(lat, lng)

  if (loading) {
    return (
      <>
        <div className="coords-label">{lat.toFixed(4)}°N, {Math.abs(lng).toFixed(4)}°W</div>
        <div className="info-loading">
          <span className="spinner" />
          Fetching Open-Meteo soil temperatures…
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <div className="coords-label">{lat.toFixed(4)}°N, {Math.abs(lng).toFixed(4)}°W</div>
        <div className="info-error">Could not load soil temperature data. {error}</div>
      </>
    )
  }

  if (!data) return null

  const { t6cm, t18cm, t10cm } = currentSoilTemp(data.forecast)
  const forecast = dailyForecast(data.forecast)

  const hourlyTimes = data.forecast?.hourly?.time || []
  const histT6 = data.forecast?.hourly?.soil_temperature_6cm || []
  const histT18 = data.forecast?.hourly?.soil_temperature_18cm || []
  const pastT10 = hourlyTimes
    .map((time, i) => {
      if (new Date(time).getTime() > Date.now()) return null
      return interpolate10cm(histT6[i], histT18[i])
    })
    .filter(v => v != null)

  // GDD from recent interpolated 10cm temps, limited to past hours only.
  const gdd = computeGDD(pastT10)
  const gddInfo = gddStatus(gdd)
  const status10 = soilTempStatus(t10cm ?? t6cm)

  const pct = Math.min(100, (gdd / PRIME_THRESHOLD) * 100)

  return (
    <>
      <div className="coords-label">{lat.toFixed(4)}°N, {Math.abs(lng).toFixed(4)}°W</div>

      <div className="soil-temp-grid">
        <div className={`soil-temp-card ${t6cm != null && t6cm >= 50 && t6cm <= 55 ? 'optimal' : ''}`}>
          <div className="soil-temp-value" style={{ color: soilTempColor(t6cm) }}>
            {t6cm != null ? `${t6cm.toFixed(1)}°F` : '—'}
          </div>
          <div className="soil-temp-label">Soil @ 6 cm (2.4″)</div>
        </div>
        <div className={`soil-temp-card ${t18cm != null && t18cm >= 50 && t18cm <= 55 ? 'optimal' : ''}`}>
          <div className="soil-temp-value" style={{ color: soilTempColor(t18cm) }}>
            {t18cm != null ? `${t18cm.toFixed(1)}°F` : '—'}
          </div>
          <div className="soil-temp-label">Soil @ 18 cm (7″)</div>
        </div>
        <div className={`soil-temp-card ${t10cm != null && t10cm >= 50 && t10cm <= 55 ? 'optimal' : ''}`} style={{ gridColumn: '1 / -1' }}>
          <div className="soil-temp-value" style={{ color: soilTempColor(t10cm) }}>
            {t10cm != null ? `${t10cm.toFixed(1)}°F` : '—'}
          </div>
          <div className="soil-temp-label">Interpolated @ 10 cm (4″) — morel target depth</div>
          <div className="soil-temp-status" style={{ color: status10.color }}>{status10.label}</div>
        </div>
      </div>

      <div className="gdd-section">
        <div className="gdd-header">
          <span className="gdd-title">20-Day GDD (base 32°F)</span>
          <span className="gdd-value" style={{ color: gddInfo.color }}>
            {gdd.toFixed(0)}
          </span>
        </div>
        <div className="gdd-bar-track">
          <div
            className="gdd-bar-fill"
            style={{ width: `${pct}%`, background: gddInfo.color }}
          />
        </div>
        <div className="gdd-target">Target: ~410 GDD for first morels</div>
        <div className="gdd-status-label" style={{ color: gddInfo.color }}>
          {gddInfo.label}
        </div>
      </div>

      {forecast.length > 0 && (
        <>
          <div className="info-section-title">7-Day Soil Temp Forecast</div>
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>6 cm</th>
                <th>10 cm</th>
                <th>18 cm</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map(row => {
                const st = soilTempStatus(row.t10 ?? row.t6)
                return (
                  <tr key={row.date}>
                    <td>{formatShortDate(row.date)}</td>
                    <td>
                      <span className="temp-dot" style={{ background: soilTempColor(row.t6) }} />
                      {row.t6 != null ? `${row.t6.toFixed(0)}°` : '—'}
                    </td>
                    <td style={{ color: st.color, fontWeight: 600 }}>
                      {row.t10 != null ? `${row.t10.toFixed(0)}°` : '—'}
                    </td>
                    <td>
                      {row.t18 != null ? `${row.t18.toFixed(0)}°` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="info-section-title" style={{ marginTop: 12 }}>About This Location</div>
      <div style={{ fontSize: 11, color: '#6e7681', lineHeight: 1.6 }}>
        Data from Open-Meteo (modeled, 1–11 km grid). Optimal morel soil temps: 50–55°F at 4″ depth,
        sustained for several consecutive days. GDD accumulates above 32°F base.
      </div>
    </>
  )
}

// ─── Fire Info Panel ─────────────────────────────────────────────────────────

function formatAcres(acres) {
  if (acres == null) return '?'
  return Number(acres).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function FireInfo({ info }) {
  const acresFormatted = formatAcres(info.acres)

  return (
    <>
      <div className="fire-info-name">{info.name}</div>
      {info.notable && (
        <div style={{
          background: '#1c1f0a',
          border: '1px solid #f5a623',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: '#f5a623',
          marginBottom: 10,
        }}>
          ⭐ {info.notable.label}
        </div>
      )}

      <div className="fire-meta-grid">
        <div className="fire-meta-item">
          <div className="fire-meta-value">{info.year || '?'}</div>
          <div className="fire-meta-key">Fire Year</div>
        </div>
        <div className="fire-meta-item">
          <div className="fire-meta-value">{acresFormatted}</div>
          <div className="fire-meta-key">Acres</div>
        </div>
        {info.pct != null && (
          <div className="fire-meta-item">
            <div className="fire-meta-value">{info.pct}%</div>
            <div className="fire-meta-key">Contained</div>
          </div>
        )}
        {info.county && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 13 }}>{info.county}</div>
            <div className="fire-meta-key">County</div>
          </div>
        )}
      </div>

      <div className="fire-prediction-box">
        {info.year === 2025 || info.year === '2025' ? (
          <>
            <strong>Spring 2026 Outlook:</strong> Burn morels fruit the <em>first spring</em> after fire in
            conifer forest. Look for moderate-severity zones where trees died but the duff layer survived.
            Check when soil temps reach 50–55°F and 6 weeks of precipitation has occurred.
          </>
        ) : (
          <>
            <strong>Spring 2025 Outlook:</strong> This 2024 fire is a primary target for this season.
            Access conditions permitting, moderate-severity burn areas in Douglas-fir and
            Pacific silver fir zones should be productive once snow clears.
          </>
        )}
      </div>

      {info.containedDate && (
        <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8 }}>
          Contained: {new Date(info.containedDate).toLocaleDateString()}
        </div>
      )}

      <div className="info-section-title">Burn Severity Note</div>
      <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.6 }}>
        Moderate-severity burn (trees dead, duff intact) produces the most morels.
        Completely incinerated areas and unburned patches are typically unproductive.
        Check RAVG burn severity maps for detailed within-perimeter analysis.
      </div>
    </>
  )
}

function formatGps(lat, lng) {
  if (lat == null || lng == null) return null
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`
}

function formatDateTime(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString()
}

// ─── SNOTEL Info Panel ───────────────────────────────────────────────────────

function SnotelInfo({ station }) {
  const [liveData, setLiveData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!station?.triplet) return
    fetchSnotelData(station.triplet)
      .then(d => { setLiveData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [station?.triplet])

  return (
    <>
      <div className="snotel-name">{station.name}</div>
      <div className="snotel-elev">
        {station.elevation != null ? `${station.elevation.toLocaleString()} ft elevation` : ''}
        {station.county ? ` · ${station.county} County` : ''}
        {station.state ? `, ${station.state}` : ''}
      </div>

      {loading && (
        <div className="info-loading">
          <span className="spinner" />
          Loading live station data…
        </div>
      )}

      {error && <div className="info-error">Could not load station data. {error}</div>}

      {liveData && (
        <div className="snotel-metrics">
          <div className="metric-card">
            <div className="metric-value" style={{ color: '#74c0fc' }}>
              {liveData.swe != null ? `${liveData.swe}"` : '—'}
            </div>
            <div className="metric-key">Snow Water Equiv.</div>
          </div>
          <div className="metric-card">
            <div className="metric-value" style={{ color: '#a9d8f5' }}>
              {liveData.snowDepth != null ? `${liveData.snowDepth}"` : '—'}
            </div>
            <div className="metric-key">Snow Depth</div>
          </div>
          {liveData.soilTemp != null && (
            <div className={`metric-card ${liveData.soilTemp >= 50 && liveData.soilTemp <= 55 ? 'optimal' : ''}`}
              style={{ gridColumn: '1 / -1' }}>
              <div className="metric-value" style={{ color: soilTempColor(liveData.soilTemp) }}>
                {liveData.soilTemp.toFixed(1)}°F
              </div>
              <div className="metric-key">Soil Temp (nearest sensor depth)</div>
            </div>
          )}
        </div>
      )}

      <div className="info-section-title" style={{ marginTop: 12 }}>Station Info</div>
      <div style={{ fontSize: 11, color: '#6e7681', lineHeight: 1.6 }}>
        SNOTEL station data via NRCS AWDB. SWE in inches; snow depth in inches.
        When SWE reaches 0, snowmelt is complete — morel season starts 1–3 weeks later
        at this elevation.
      </div>
      <div style={{ marginTop: 8 }}>
        <a
          href={`https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${station.triplet?.split(':')[0]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inat-link"
        >
          View full station data on NRCS →
        </a>
      </div>
    </>
  )
}

// ─── iNaturalist Observation Panel ───────────────────────────────────────────

function InatInfo({ obs }) {
  return (
    <>
      <div className="inat-taxon">{obs.taxon?.name || 'Morchella sp.'}</div>
      <div className="inat-common">{obs.taxon?.preferred_common_name || 'Morel mushroom'}</div>

      <div className="inat-meta">
        <div>Observed: <strong>{obs.observed_on || 'unknown'}</strong></div>
        {obs.place_guess && <div>Location: {obs.place_guess}</div>}
        {obs.user?.login && <div>Observer: @{obs.user.login}</div>}
        {obs.quality_grade && (
          <div>Quality: {obs.quality_grade === 'research' ? '✓ Research Grade' : obs.quality_grade}</div>
        )}
        {obs.num_identification_agreements != null && (
          <div>IDs: {obs.num_identification_agreements} agree / {obs.num_identification_disagreements || 0} disagree</div>
        )}
      </div>

      {obs.photos?.[0]?.url && (
        <div style={{ marginTop: 10 }}>
          <img
            src={obs.photos[0].url.replace('/square.', '/medium.')}
            alt={obs.taxon?.name}
            style={{
              width: '100%',
              borderRadius: 6,
              border: '1px solid #30363d',
              objectFit: 'cover',
              maxHeight: 160,
            }}
            onError={e => { e.target.style.display = 'none' }}
          />
        </div>
      )}

      <a
        href={`https://www.inaturalist.org/observations/${obs.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inat-link"
      >
        View on iNaturalist →
      </a>
    </>
  )
}

// ─── Main InfoPanel ───────────────────────────────────────────────────────────

// ─── WADNR Fire Point Panel ───────────────────────────────────────────────────

function WADNRFireInfo({ info }) {
  const acresFormatted = formatAcres(info.acres)
  const gps = formatGps(info.lat, info.lng)
  return (
    <>
      <div className="fire-info-name">{info.name}</div>
      <div style={{ fontSize: 11, color: '#FF4500', marginBottom: 10, fontWeight: 600 }}>
        WA DNR Jurisdiction Fire
      </div>
      <div className="fire-meta-grid">
        <div className="fire-meta-item">
          <div className="fire-meta-value">{acresFormatted}</div>
          <div className="fire-meta-key">Acres Burned</div>
        </div>
        {info.county && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 13 }}>{info.county}</div>
            <div className="fire-meta-key">County</div>
          </div>
        )}
        {info.cause && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 12 }}>{info.cause}</div>
            <div className="fire-meta-key">General Cause</div>
          </div>
        )}
        {info.causeSpecific && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 12 }}>{info.causeSpecific}</div>
            <div className="fire-meta-key">Specific Cause</div>
          </div>
        )}
        {info.protection && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 12 }}>{info.protection}</div>
            <div className="fire-meta-key">Protection</div>
          </div>
        )}
        {info.elevation != null && (
          <div className="fire-meta-item">
            <div className="fire-meta-value">{Number(info.elevation).toLocaleString()} ft</div>
            <div className="fire-meta-key">Elevation</div>
          </div>
        )}
        {gps && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 12 }}>{gps}</div>
            <div className="fire-meta-key">GPS Coordinates</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8, lineHeight: 1.7 }}>
        {info.discoveryDate && <div>Discovered: {info.discoveryDate}</div>}
        {info.controlDate && <div>Controlled: {info.controlDate}</div>}
        {info.fireOutDate && <div>Fire Out: {info.fireOutDate}</div>}
        {info.startJurisdiction && <div>Start Jurisdiction: {info.startJurisdiction}</div>}
      </div>
      <div className="fire-prediction-box" style={{ marginTop: 12 }}>
        <strong>Burn Morel Potential:</strong> WA DNR jurisdiction fires on state-protected forests
        can produce excellent burn morels the following spring. Check for moderate-severity
        burned areas in conifer forest when soil temps reach 50–55°F.
      </div>
    </>
  )
}

function UsfsClosureInfo({ info }) {
  const startDate = formatDateTime(info.startDate)
  const endDate = formatDateTime(info.endDate)

  return (
    <>
      <div className="fire-info-name">{info.name}</div>
      <div style={{ fontSize: 11, color: '#b00020', marginBottom: 10, fontWeight: 600 }}>
        USDA Forest Service Fire Closure
      </div>
      <div className="fire-meta-grid">
        {info.forest && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 13 }}>{info.forest}</div>
            <div className="fire-meta-key">National Forest</div>
          </div>
        )}
        {info.fireName && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 13 }}>{info.fireName.trim()}</div>
            <div className="fire-meta-key">Fire</div>
          </div>
        )}
        {info.orderNumber && (
          <div className="fire-meta-item">
            <div className="fire-meta-value" style={{ fontSize: 13 }}>{info.orderNumber}</div>
            <div className="fire-meta-key">Order Number</div>
          </div>
        )}
        {info.status && (
          <div className="fire-meta-item">
            <div className="fire-meta-value">{info.status}</div>
            <div className="fire-meta-key">Status</div>
          </div>
        )}
      </div>
      {(info.district || info.description) && (
        <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8, lineHeight: 1.7 }}>
          {info.district && <div>District: {info.district}</div>}
          {info.description && <div>Description: {info.description}</div>}
        </div>
      )}
      {(startDate || endDate) && (
        <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8, lineHeight: 1.7 }}>
          {startDate && <div>Starts: {startDate}</div>}
          {endDate && <div>Ends: {endDate}</div>}
        </div>
      )}
      {info.url && (
        <div style={{ marginTop: 10 }}>
          <a href={info.url} target="_blank" rel="noopener noreferrer" className="inat-link">
            View USDA closure order →
          </a>
        </div>
      )}
    </>
  )
}

const TITLES = {
  point: 'Soil Temperature',
  fire: 'Fire Perimeter',
  wadnrFire: 'WA DNR Fire Incident',
  usfsClosure: 'USFS Fire Closure',
  snotel: 'SNOTEL Station',
  inat: 'iNaturalist Sighting',
}

export default function InfoPanel({ info, onClose }) {
  const title = TITLES[info?.type] || 'Info'

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">{title}</span>
        <button className="info-close" onClick={onClose} aria-label="Close panel">×</button>
      </div>
      <div className="info-panel-body">
        {info?.type === 'point' && <SoilTempInfo lat={info.lat} lng={info.lng} />}
        {info?.type === 'fire' && <FireInfo info={info} />}
        {info?.type === 'wadnrFire' && <WADNRFireInfo info={info} />}
        {info?.type === 'usfsClosure' && <UsfsClosureInfo info={info} />}
        {info?.type === 'snotel' && <SnotelInfo station={info.station} />}
        {info?.type === 'inat' && <InatInfo obs={info.obs} />}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatShortDate(isoDate) {
  const [, month, day] = isoDate.split('-')
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month, 10)]} ${parseInt(day, 10)}`
}
