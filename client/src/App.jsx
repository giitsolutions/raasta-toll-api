import AdminDashboard from './AdminDashboard'
import DeveloperPortal from './DeveloperPortal'
import { useState } from 'react'
import axios from 'axios'
import './App.css'
import {
  MapPin, ArrowDownUp, Search, Calculator, Truck,
  CarFront, Bus, Route, Clock3,
  AlertTriangle, CheckCircle2, LoaderCircle, Info,
} from 'lucide-react'
import {
  MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// async function searchLocation(query) {
//   const url = new URL('https://nominatim.openstreetmap.org/search')
//   url.searchParams.set('format', 'jsonv2')
//   url.searchParams.set('countrycodes', 'in')
//   url.searchParams.set('limit', '5')
//   url.searchParams.set('q', query)

//   const response = await fetch(url)
//   if (!response.ok) throw new Error('Location search failed')
//   return response.json()
// }
async function nominatim(query, extra = {}) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('countrycodes', 'in')
  url.searchParams.set('accept-language', 'en')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '5')
  url.searchParams.set('q', query)
  Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url)
  if (!response.ok) throw new Error('Location search failed')
  return response.json()
}

async function searchLocation(query) {
  const settlements = await nominatim(query, { featureType: 'settlement' })
  const general = await nominatim(query)
  const seen = new Set(settlements.map((place) => place.place_id))
  return [...settlements, ...general.filter((place) => !seen.has(place.place_id))].slice(0, 8)
}

function placeType(place) {
  const raw = (place.addresstype || place.type || 'place').replaceAll('_', ' ')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function shortLabel(place) {
  const a = place.address || {}
  const main =
    place.name ||
    a.city ||
    a.town ||
    a.village ||
    a.suburb ||
    place.display_name.split(',')[0]
  return [...new Set([main, a.state].filter(Boolean))].join(', ')
}


function FitRoute({ geometry }) {
  const map = useMap()

  if (geometry?.type === 'LineString') {
    const positions = geometry.coordinates.map(([lng, lat]) => [lat, lng])
    if (positions.length) map.fitBounds(positions, { padding: [35, 35] })
  }

  if (geometry?.type === 'MultiLineString') {
    const positions = geometry.coordinates.flat().map(([lng, lat]) => [lat, lng])
    if (positions.length) map.fitBounds(positions, { padding: [35, 35] })
  }

  return null
}

function LocationField({ label, value, onChange, selected, onSelect, icon }) {
  const [options, setOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  async function findPlace() {
    if (!value.trim()) {
      setError('Enter a city or place first.')
      return
    }

    setSearching(true)
    setError('')
    setOptions([])

    try {
      const results = await searchLocation(value.trim())
      setOptions(results)
      if (!results.length) setError('No matching places found in India.')
    } catch {
      setError('Could not search locations. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="location-field">
      <label>{label}</label>
      <div className="location-input-row">
        <span className="location-icon">{icon}</span>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            onSelect(null)
            setOptions([])
          }}
          onKeyDown={(e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    findPlace()
  }
}}
          placeholder={`Enter ${label.toLowerCase()} (e.g. Delhi)`}
        />
    <button
  type="button"
  className="search-place"
  onClick={findPlace}
  disabled={searching}
>
          {searching ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
        </button>
      </div>

      {selected && (
        <div className="selected-place">
          <CheckCircle2 size={14} /> Location selected
        </div>
      )}

      {options.length > 0 && (
        <div className="location-options">
          {options.map((place) => (
           <button
  type="button"
  key={place.place_id}
  onClick={() => {
                onChange(shortLabel(place))
                onSelect([Number(place.lon), Number(place.lat)])
                setOptions([])
              }}
            >
              <MapPin size={15} />
              <span>
  <strong>{shortLabel(place)}</strong>
 <small>{placeType(place)} · {place.display_name}</small>
</span>
            </button>
          ))}
        </div>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}

function App() {
  const [view, setView] = useState('calculator')



  const [sourceName, setSourceName] = useState('')
  const [destinationName, setDestinationName] = useState('')
  const [source, setSource] = useState(null)
  const [destination, setDestination] = useState(null)
  const [vehicle, setVehicle] = useState('car')
  const [axles, setAxles] = useState('5')
  const [journey, setJourney] = useState('single')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function calculateToll(e) {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!source || !destination) {
      setError('Search and select both source and destination locations.')
      return
    }

    if (source[0] === destination[0] && source[1] === destination[1]) {
      setError('Source and destination cannot be the same.')
      return
    }

    const payload = {
      source,
      destination,
      journey_type: journey,
      include_geometry: true,
    }

    if (vehicle === 'truck' || vehicle === 'bus') {
      payload.vehicle_type = vehicle
      payload.axle_count = Number(axles)
    } else {
      payload.vehicle_category = vehicle
    }

    setLoading(true)
    try {
      const response = await axios.post('/api/v1/route', payload)
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Calculation failed.')
      }
      setResult(response.data.data)
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.message ||
        'Unable to calculate toll. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  function swapLocations() {
    setSourceName(destinationName)
    setDestinationName(sourceName)
    setSource(destination)
    setDestination(source)
  }

  const money = (amount) =>
    amount == null ? 'Unavailable' : `₹${Number(amount).toLocaleString('en-IN')}`

  const distance = result
    ? `${(result.distance_meters / 1000).toFixed(1)} km`
    : ''

  const duration = result
    ? `${Math.floor(result.duration_seconds / 3600)}h ${Math.round((result.duration_seconds % 3600) / 60)}m`
    : ''

  const summary = result?.toll_summary
  const routeToll = result?.route_toll
  const geometry = result?.route_geometry


  if (view === 'admin') {
    return <AdminDashboard onBack={() => setView('calculator')} />

  }
  if (view === 'developer') {
  return <DeveloperPortal onBack={() => setView('calculator')} />
}

  return (
    <main className="app-shell">
      <header className="topbar">
        <button
  type="button"
  className="admin-nav-button"
  onClick={() => setView('admin')}
>
  Admin Dashboard
</button>
<button
  type="button"
  className="admin-nav-button"
  onClick={() => setView('developer')}
>
  Developer Portal
</button>
        <a className="brand" href="#">
          <span className="brand-mark"><Route size={22} /></span>
          <span>Raasta<span className="brand-highlight">Toll</span></span>
        </a>
        <span className="topbar-tag">INDIA TOLL CALCULATOR</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">SMART ROUTE. CLEAR COST.</span>
          <h1>Know your tolls<br /><span>before you travel.</span></h1>
          <p>Calculate toll charges across Indian highways with route-wise fare details and transparent pricing information.</p>
          <div className="hero-points">
            <span><CheckCircle2 size={16} /> Route-based calculation</span>
            <span><CheckCircle2 size={16} /> Vehicle-specific fares</span>
            <span><CheckCircle2 size={16} /> Toll breakdown</span>
          </div>
        </div>

        <form className="search-card" onSubmit={calculateToll}>
          <div className="card-heading">
            <div>
              <span className="eyebrow">PLAN YOUR JOURNEY</span>
              <h2>Calculate toll charges</h2>
            </div>
            <span className="card-icon"><Calculator size={22} /></span>
          </div>

          <div className="route-inputs">
            <LocationField
              label="Source"
              value={sourceName}
              onChange={setSourceName}
              selected={source}
              onSelect={setSource}
              icon={<span className="source-dot" />}
            />
            <button type="button" className="swap-button" onClick={swapLocations} title="Swap locations">
              <ArrowDownUp size={17} />
            </button>
            <LocationField
              label="Destination"
              value={destinationName}
              onChange={setDestinationName}
              selected={destination}
              onSelect={setDestination}
              icon={<MapPin size={17} />}
            />
          </div>

          <div className="form-divider" />

          <label className="form-label">Vehicle type</label>
          <div className="vehicle-options">
            {[
              { id: 'car', label: 'Car', icon: <CarFront size={19} /> },
              { id: 'lcv', label: 'LCV', icon: <Truck size={19} /> },
              { id: 'truck', label: 'Truck', icon: <Truck size={19} /> },
              { id: 'bus', label: 'Bus', icon: <Bus size={19} /> },
            ].map((item) => (
              <button
                type="button"
                key={item.id}
                className={`vehicle-option ${vehicle === item.id ? 'active' : ''}`}
                onClick={() => setVehicle(item.id)}
              >
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </div>

          {(vehicle === 'truck' || vehicle === 'bus') && (
            <div className="axle-field">
              <label className="form-label">Number of axles</label>
              <select value={axles} onChange={(e) => setAxles(e.target.value)}>
                {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>{n} Axles</option>
                ))}
              </select>
            </div>
          )}

          <label className="form-label journey-label">Journey type</label>
          <div className="journey-options">
            {[
              ['single', 'Single'],
              ['return', 'Return'],
              ['monthly', 'Monthly'],
              ['commercial', 'Commercial'],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={journey === id ? 'journey-option active' : 'journey-option'}
                onClick={() => setJourney(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <div className="error-banner"><AlertTriangle size={17} />{error}</div>}

          <button className="calculate-button" type="submit" disabled={loading}>
            {loading ? <><LoaderCircle className="spin" size={19} /> Calculating route...</> : <><Calculator size={19} /> Calculate toll</>}
          </button>
          <p className="form-footnote"><Info size={13} /> Select a matching location from the search results.</p>
        </form>
      </section>

      {result && (
        <section className="results-section">
          <div className="results-heading">
            <div>
              <span className="eyebrow">YOUR JOURNEY</span>
              <h2>Toll calculation results</h2>
              <p>{sourceName.split(',')[0]} <span>→</span> {destinationName.split(',')[0]}</p>
            </div>
            <span className={`confidence-pill ${summary?.rate_confidence || 'none'}`}>
              {summary?.rate_confidence || 'unknown'} confidence
            </span>
          </div>
         <div className="result-stats">
          {summary?.total_toll_inr == null && summary?.known_subtotal_inr != null ? (
  <div className="stat-card total-card partial">
    <span className="stat-label">PARTIAL TOLL (INCOMPLETE)</span>
    <strong>{money(summary.known_subtotal_inr)}</strong>
    <small>
      Known tolls on {summary.plazas_with_rate} of {result.toll_plaza_candidates} toll points.
      {' '}{summary.plazas_without_rate} point(s) have no rate and are not included.
    </small>
  </div>
) : (
  <div className="stat-card total-card">
    <span className="stat-label">TOTAL TOLL CHARGES</span>
    <strong>{money(summary?.total_toll_inr)}</strong>
    <small>{summary?.total_toll_inr == null ? 'Complete fare not available' : 'Based on available route tariff data'}</small>
  </div>
)}
            <div className="stat-card">
              <span className="stat-label"><Route size={15} /> ROUTE DISTANCE</span>
              <strong>{distance}</strong>
              <small>Estimated road distance</small>
            </div>
            <div className="stat-card">
              <span className="stat-label"><Clock3 size={15} /> TRAVEL TIME</span>
              <strong>{duration}</strong>
              <small>Estimated driving duration</small>
            </div>
            <div className="stat-card">
              <span className="stat-label"><MapPin size={15} /> TOLL POINTS</span>
              <strong>{result.toll_plaza_candidates}</strong>
             <small>
  {summary?.plazas_with_rate === null
    ? 'Covered by route-level tariff'
    : `${summary?.plazas_with_rate || 0} with available rates`}
</small>
            </div>
          </div>

          {routeToll?.matched && (
            <div className="route-tariff-card">
              <div className="route-tariff-title">
                <div><span className="eyebrow">ROUTE-LEVEL TARIFF</span><h3>{routeToll.system}</h3></div>
                <span className="route-amount">{money(routeToll.amount_inr)}</span>
              </div>
              <p>{routeToll.entry} <span>→</span> {routeToll.exit}</p>
              <div className="tariff-meta">
                <span>Vehicle: {routeToll.vehicle_category || result.vehicle_category}</span>
                <span>Journey: {routeToll.journey_type || result.journey_type}</span>
                {routeToll.effective_from && <span>Effective: {routeToll.effective_from}</span>}
                {routeToll.verification_status && <span>Status: {routeToll.verification_status}</span>}
              </div>
              {routeToll.source && <small>Source: {routeToll.source}</small>}
              {routeToll.source_url && <a href={routeToll.source_url} target="_blank" rel="noreferrer">View tariff source ↗</a>}
            </div>
          )}

          {geometry && (
            <div className="map-card">
              <h3>Route map</h3>
              <MapContainer center={[20.5937, 78.9629]} zoom={5} scrollWheelZoom={true}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitRoute geometry={geometry} />
                <GeoJSON data={geometry} style={{ color: '#246b55', weight: 5 }} />
                {result.toll_plazas.map((plaza) => (
                  <CircleMarker
                    key={plaza.source_id}
                    center={[Number(plaza.latitude), Number(plaza.longitude)]}
                    radius={6}
                    pathOptions={{ color: '#b56c26', fillColor: '#f4ad58', fillOpacity: 0.9 }}
                  >
                    <Popup>
  {plaza.name}<br />
  {plaza.pricing_coverage === 'covered_by_route_tariff' ? 'In route fare' : money(plaza.toll_inr)}
</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          )}

          {summary?.warnings?.length > 0 && (
            <div className="warnings-card">
              <h3><AlertTriangle size={18} /> Important fare notes</h3>
              {summary.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
            </div>
          )}

          <div className="breakdown-card">
            <div className="breakdown-heading">
              <div><span className="eyebrow">TOLL DETAILS</span><h3>Plaza-wise breakdown</h3></div>
              <span>{result.toll_plazas.length} locations</span>
            </div>
            {result.toll_plazas.length === 0 ? (
              <p className="empty-state">No toll plaza candidates were found along this route.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Toll plaza</th><th>Highway / State</th><th>Distance</th><th>Fare</th><th>Data status</th></tr>
                  </thead>
                  <tbody>
                    {result.toll_plazas.map((plaza) => (
                      <tr key={plaza.source_id}>
                        <td><strong>{plaza.name}</strong>{plaza.likely_closed_system && <small className="sub-note">Possible closed-system toll</small>}</td>
                        <td>{plaza.highway || '—'}<small className="sub-note">{plaza.state || ''}</small></td>
                        <td>{plaza.approx_km_from_start} km</td>
                        <td className="fare-cell">
  {plaza.pricing_coverage === 'covered_by_route_tariff'
    ? 'In route fare'
    : money(plaza.toll_inr)}
</td>
<td>
  {plaza.pricing_coverage === 'covered_by_route_tariff' ? (
    <span className="status-tag available">Covered by route tariff</span>
  ) : (
    <span className={`status-tag ${plaza.rate_status}`}>{plaza.rate_status.replaceAll('_', ' ')}</span>
  )}
  {plaza.data_source && <small className="sub-note">{plaza.data_source}</small>}
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
           <div className="breakdown-footer">
  {summary?.plazas_with_rate === null ? (
    <span>Priced as one route-level tariff. Individual plaza rates are not added.</span>
  ) : (
    <>
      <span>Plazas with rate: <strong>{summary?.plazas_with_rate ?? 0}</strong></span>
      <span>Missing rates: <strong>{summary?.plazas_without_rate ?? 0}</strong></span>
      <span>Known subtotal: <strong>{money(summary?.known_subtotal_inr)}</strong></span>
    </>
  )}
</div>
          </div>
        </section>
      )}

      <footer className="footer">
        <span>RaastaToll · India Toll Calculator</span>
        <span>Indicative results based on available toll tariff data. Always verify applicable charges before travel.</span>
      </footer>
    </main>
  )
}

export default App
