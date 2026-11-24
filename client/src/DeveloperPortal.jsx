import { ArrowLeft, LogOut, Copy, Route } from 'lucide-react'
import { useEffect, useState } from 'react'
import axios from 'axios'
import './DeveloperPortal.css'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

function DeveloperHeader({ onBack, onLogout }) {
  return (
    <header className="developer-header">
      <button className="developer-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to calculator
      </button>

     <a className="brand developer-brand" href="#">
  <span className="brand-mark">
    <Route size={22} />
  </span>
  <span>
    Raasta<span className="brand-highlight">Toll</span>
  </span>
</a>

      {onLogout ? (
        <button className="developer-logout" onClick={onLogout}>
          <LogOut size={15} />
          Logout
        </button>
      ) : (
        <span className="developer-header-label">DEVELOPER PORTAL</span>
      )}
    </header>
  )
}

export default function DeveloperPortal({ onBack }) {
  const [mode, setMode] = useState('login')
  const [user, setUser] = useState(null)
  const [usage, setUsage] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  async function loadDashboard() {
    const [userResponse, usageResponse] = await Promise.all([
      api.get('/auth/me'),
      api.get('/auth/usage'),
    ])

    setUser(userResponse.data.user)
    setUsage(usageResponse.data)
  }

  useEffect(() => {
    loadDashboard().catch(() => {
      setUser(null)
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (mode === 'register') {
        const response = await api.post('/auth/register', {
          name,
          email,
          password,
        })

        setApiKey(response.data.api_key)
        setMessage('Your account has been created successfully.')
      } else {
        await api.post('/auth/login', { email, password })
      }

      await loadDashboard()
      setPassword('')
    } catch (err) {
      setError(
        err.response?.data?.message || 'Something went wrong. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
      setUser(null)
      setUsage(null)
      setApiKey('')
      setMode('login')
      setMessage('You have been logged out.')
    } catch {
      setError('Logout failed. Please try again.')
    }
  }

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(apiKey)
      setMessage('API key copied successfully.')
    } catch {
      setError('Unable to copy. Please copy the key manually.')
    }
  }
  async function handleRegenerateKey() {
  const confirmed = window.confirm(
    'Are you sure? Your existing API key will stop working immediately. Continue?'
  )

  if (!confirmed) return

  setRegenerating(true)
  setError('')
  setMessage('')

  try {
    const response = await api.post('/auth/regenerate-key')

    setApiKey(response.data.api_key)
    setMessage('New API key generated. Copy and save it securely.')
  } catch (err) {
    setError(
      err.response?.data?.message ||
      'Could not regenerate API key. Please try again.'
    )
  } finally {
    setRegenerating(false)
  }
}

  if (user) {
    return (
      <main className="developer-shell">
        <DeveloperHeader onBack={onBack} onLogout={handleLogout} />

        <section className="developer-content">
          <span className="eyebrow">DEVELOPER DASHBOARD</span>
          <h1>Welcome, {user.name}</h1>
          <p>{user.email}</p>

          <div className="api-key-card">
  <h3>API Key Management</h3>

  {apiKey ? (
    <>
      <p>Your new API key. Copy and save it securely.</p>
      <code>{apiKey}</code>

      <button onClick={copyApiKey}>
        <Copy size={16} />
        Copy API Key
      </button>
    </>
  ) : (
    <p>
      Your existing API key is hidden for security.
      You can generate a new one if needed.
    </p>
  )}

  <button
    type="button"
    onClick={handleRegenerateKey}
    disabled={regenerating}
  >
    {regenerating ? 'Generating...' : 'Regenerate API Key'}
  </button>
</div>

          <div className="usage-grid">
            <div className="usage-card">
              <span>Daily request limit</span>
              <strong>{usage?.today?.daily_limit ?? 100}</strong>
              <small>Requests per day</small>
            </div>

            <div className="usage-card">
              <span>Requests used today</span>
              <strong>{usage?.today?.requests_used ?? 0}</strong>
              <small>API requests</small>
            </div>

            <div className="usage-card">
              <span>Requests remaining</span>
              <strong>{usage?.today?.requests_remaining ?? 100}</strong>
              <small>Available today</small>
            </div>
          </div>

          <section className="history-card">
            <h3>Recent API usage</h3>
            {usage?.usage_history?.length ? (
              usage.usage_history.map((item) => (
                <div className="history-row" key={String(item.usage_date)}>
                  <span>
                    {new Date(item.usage_date).toLocaleDateString()}
                  </span>
                  <strong>{item.request_count} requests</strong>
                </div>
              ))
            ) : (
              <p>No API usage recorded yet.</p>
            )}
          </section>

          {error && <p className="portal-error">{error}</p>}
          {message && <p className="portal-message">{message}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="developer-shell">
      <DeveloperHeader onBack={onBack} />

      <section className="auth-card">
        <span className="eyebrow">RAASTA TOLL API</span>

        <h1>
          {mode === 'register'
            ? 'Create developer account'
            : 'Welcome back'}
        </h1>

        <p>
          {mode === 'register'
            ? 'Register to receive your API key automatically.'
            : 'Log in to manage your API account and usage.'}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              Full name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                placeholder="Your name"
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>

          {error && <p className="portal-error">{error}</p>}
          {message && <p className="portal-message">{message}</p>}

          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : mode === 'register'
                ? 'Create account'
                : 'Login'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'register'
            ? 'Already have an account?'
            : "Don't have an account?"}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register')
              setError('')
              setMessage('')
            }}
          >
            {mode === 'register' ? 'Login' : 'Register'}
          </button>
        </p>
      </section>
    </main>
  )
}
