
import { useState } from 'react'
import axios from 'axios'
import {
  Users, RefreshCw, Plus, ShieldCheck, Activity,
  Power, Eye, X, KeyRound, ArrowLeft
} from 'lucide-react'
import './AdminDashboard.css'

export default function AdminDashboard({ onBack }) {
 const [adminEmail, setAdminEmail] = useState('')
const [adminPassword, setAdminPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newLimit, setNewLimit] = useState(100)
  const [createdKey, setCreatedKey] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [usage, setUsage] = useState(null)

 
  async function loadCustomers() {
    setLoading(true)
    setError('')

    try {
    const response = await axios.get('/api/v1/admin/customers', {
  withCredentials: true
})

      setCustomers(response.data.customers || [])
      setAuthenticated(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load customers.')
      setAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }

  async function login(e) {
  e.preventDefault()
  setError('')

  if (!adminEmail.trim() || !adminPassword) {
    setError('Enter your admin email and password.')
    return
  }

  setLoading(true)

  try {
    await axios.post(
      '/api/v1/admin/auth/login',
      {
        email: adminEmail,
        password: adminPassword
      },
      { withCredentials: true }
    )

    setAdminPassword('')
    await loadCustomers()
  } catch (err) {
    setError(
      err.response?.data?.message || 'Admin login failed.'
    )
    setAuthenticated(false)
  } finally {
    setLoading(false)
  }
}

  async function createCustomer(e) {
    e.preventDefault()
    setError('')
    setCreatedKey('')

    try {
      const response = await axios.post(
        '/api/v1/admin/customers',
        {
          client_name: newName,
          daily_limit: Number(newLimit)
        },
      { withCredentials: true }
      )

      const key =
        response.data.api_key ||
        response.data.apiKey ||
        response.data.customer?.api_key

      if (key) setCreatedKey(key)

      setNewName('')
      setNewLimit(100)
      await loadCustomers()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create customer.')
    }
  }

  async function updateStatus(customer) {
    setError('')

    try {
      await axios.patch(
        `/api/v1/admin/customers/${customer.id}/status`,
        { active: !customer.active },
        { headers }
      )
      await loadCustomers()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update status.')
    }
  }

  async function updateLimit(customer) {
    const value = window.prompt(
      `Enter new daily limit for ${customer.client_name}:`,
      customer.daily_limit
    )

    if (value === null) return

    const limit = Number(value)

    if (!Number.isInteger(limit) || limit < 1) {
      setError('Daily limit must be a positive whole number.')
      return
    }

    try {
      await axios.patch(
        `/api/v1/admin/customers/${customer.id}/limit`,
        { daily_limit: limit },
        { headers }
      )
      await loadCustomers()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update limit.')
    }
  }

  async function viewUsage(customer) {
    setError('')
    setSelectedCustomer(customer)
    setUsage(null)

    try {
      const response = await axios.get(
        `/api/v1/admin/customers/${customer.id}/usage`,
        { headers }
      )
      setUsage(response.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load usage.')
    }
  }
  async function handleLogout() {
  try {
    await axios.post(
      '/api/v1/admin/auth/logout',
      {},
      { withCredentials: true }
    )

    setAuthenticated(false)
    setCustomers([])
    setAdminEmail('')
    setAdminPassword('')
    setError('')
  } catch (err) {
    setError(
      err.response?.data?.message || 'Logout failed.'
    )
  }
}

  if (!authenticated) {
    return (
      <main className="admin-login-page">
        <form className="admin-login-card" onSubmit={login}>
          <button type="button" className="admin-back" onClick={onBack}>
            <ArrowLeft size={17} /> Back to calculator
          </button>

          <div className="admin-login-icon">
            <ShieldCheck size={28} />
          </div>

          <span className="admin-eyebrow">RAASTATOLL ADMINISTRATION</span>
          <h1>Admin Dashboard</h1>
          <p>Enter your admin secret to manage API customers.</p>

          <label>Admin email</label>
<input
  type="email"
  value={adminEmail}
  onChange={(e) => setAdminEmail(e.target.value)}
  placeholder="Enter admin email"
  required
/>

<label>Admin password</label>
<input
  type="password"
  value={adminPassword}
  onChange={(e) => setAdminPassword(e.target.value)}
  placeholder="Enter admin password"
  required
/>

          {error && <div className="admin-error">{error}</div>}

          <button className="admin-primary" type="submit" disabled={loading}>
            {loading ? 'Connecting...' : 'Access dashboard'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-eyebrow">RAASTATOLL</span>
          <h1>Customer Management</h1>
          <p>Log in securely to manage API customers.</p>
        </div>

        <div className="admin-header-actions">
          <button className="admin-secondary" onClick={onBack}>
            <ArrowLeft size={16} /> Calculator
          </button>
          <button className="admin-secondary" onClick={loadCustomers}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            className="admin-secondary"
          onClick={handleLogout}
          >
            <Power size={16} /> Logout
          </button>
        </div>
      </header>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-stats">
        <article className="admin-stat-card">
          <Users size={22} />
          <span>Total customers</span>
          <strong>{customers.length}</strong>
        </article>

        <article className="admin-stat-card">
          <Activity size={22} />
          <span>Active customers</span>
          <strong>{customers.filter(c => c.active).length}</strong>
        </article>

        <article className="admin-stat-card">
          <ShieldCheck size={22} />
          <span>Inactive customers</span>
          <strong>{customers.filter(c => !c.active).length}</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2><Plus size={19} /> Register a customer</h2>
            <p>Create an API key for a new customer.</p>
          </div>
        </div>

        <form className="admin-create-form" onSubmit={createCustomer}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Customer / company name"
            required
          />
          <input
            type="number"
            min="1"
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            placeholder="Daily request limit"
            required
          />
          <button className="admin-primary" type="submit">
            <Plus size={17} /> Create customer
          </button>
        </form>

        {createdKey && (
          <div className="admin-key-box">
            <div>
              <KeyRound size={19} />
              <strong>New API key generated — save it now!</strong>
            </div>
            <code>{createdKey}</code>
            <button
              className="admin-secondary"
              onClick={() => navigator.clipboard.writeText(createdKey)}
            >
              Copy API key
            </button>
            <p>This key is shown only once. Do not share it publicly.</p>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2><Users size={19} /> Registered customers</h2>
            <p>Manage customer access and daily quotas.</p>
          </div>
          <span>{customers.length} customers</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Daily limit</th>
                <th>Used today</th>
                <th>Remaining</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(customer => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.client_name}</strong>
                    <small>ID: {customer.id}</small>
                  </td>
                  <td>
                    <span className={customer.active ? 'admin-status active' : 'admin-status inactive'}>
                      {customer.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{customer.daily_limit}</td>
                  <td>{customer.requests_used}</td>
                  <td>{customer.requests_remaining}</td>
                  <td>
                    <div className="admin-actions">
                      <button title="View usage" onClick={() => viewUsage(customer)}>
                        <Eye size={16} />
                      </button>
                      <button title="Change daily limit" onClick={() => updateLimit(customer)}>
                        <Activity size={16} />
                      </button>
                      <button title="Change status" onClick={() => updateStatus(customer)}>
                        <Power size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {customers.length === 0 && (
                <tr>
                  <td colSpan="6">No customers found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCustomer && (
        <div className="admin-modal-backdrop">
          <section className="admin-usage-modal">
            <button
              className="admin-modal-close"
              onClick={() => {
                setSelectedCustomer(null)
                setUsage(null)
              }}
            >
              <X size={20} />
            </button>

            <h2>Customer usage</h2>
            <p>{selectedCustomer.client_name}</p>

            {!usage ? (
              <p>Loading usage information...</p>
            ) : (
              <>
                <div className="admin-usage-stats">
                  <div><span>Daily limit</span><strong>{usage.customer.daily_limit}</strong></div>
                  <div><span>Used today</span><strong>{usage.customer.requests_used_today}</strong></div>
                  <div><span>Remaining</span><strong>{usage.customer.requests_remaining_today}</strong></div>
                </div>

                <h3>Usage history</h3>
                <div className="admin-history">
                  {usage.usage_history.map((item, index) => (
                    <div key={index}>
                      <span>{item.usage_date}</span>
                      <strong>{item.request_count} requests</strong>
                    </div>
                  ))}
                  {usage.usage_history.length === 0 && <p>No usage history yet.</p>}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
