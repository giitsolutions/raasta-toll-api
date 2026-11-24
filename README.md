# Raasta Toll API – India Toll Calculation Platform

An India-focused toll calculation platform that estimates toll charges for road routes using **Node.js, Express.js, PostgreSQL, PostGIS, React, and OpenRouteService (ORS)**.

The platform provides a REST API for calculating route-based toll estimates, along with a Developer Portal for API access, usage monitoring, and API key management. An Admin Dashboard supports customer management and API quota administration.

> **Important:** Toll amounts are estimates based on the available dataset. They should be independently verified before operational or financial use.

## Features

### Toll Calculation API
- Calculate road routes between source and destination coordinates.
- Identify toll-plaza candidates along calculated routes.
- Support seven database vehicle categories, including commercial trucks.
- Accept actual truck axle counts and select an available tariff category.
- Support single, return, monthly, and commercial rate types.
- Retrieve applicable toll rates from PostgreSQL.
- Distinguish available, missing, and zero-valued source rates.
- Provide diagnostics explaining unavailable toll rates.
- Identify potential duplicate toll-plaza records.
- Classify likely closed-system and non-highway fee points.
- Calculate known toll subtotals and report incomplete estimates.
- Return route distance, duration, toll details, and data-quality warnings.
- Optionally return route geometry as GeoJSON.

### Developer Portal
- Developer registration and login.
- Automatic API key generation during registration.
- Secure API key storage using SHA-256 hashes.
- API key authentication through request headers.
- API key regeneration.
- Daily API request quotas.
- Usage dashboard showing API consumption and remaining quota.

### Admin Dashboard
- Admin email/password authentication.
- Session-based access control.
- View registered API customers.
- Activate or deactivate customer accounts.
- Create API customers.
- Modify customer daily request limits.
- View customer API usage history.

### Additional Features
- PostgreSQL-backed session management.
- Health endpoint with database connectivity verification.
- Automated unit tests and API smoke tests.
- Diagnostic scripts for toll data quality and duplicate investigation.

## Tech Stack

| Layer | Technologies |
|---|---|
| Backend | Node.js, Express.js |
| Frontend | React, Vite, Axios |
| Database | PostgreSQL, PostGIS |
| Routing | OpenRouteService / HeiGIT |
| Authentication | bcryptjs, Express Session |
| Session Storage | connect-pg-simple |
| API Security | API key hashing, quota validation |
| Testing | Node.js built-in test runner |
| Version Control | Git, GitHub |

## Project Structure

```text
india-toll-api/
│
├── client/                     # React + Vite frontend
│   ├── public/
│   └── src/
│       ├── AdminDashboard.jsx
│       ├── DeveloperPortal.jsx
│       ├── App.jsx
│       └── ...
│
├── database/                   # Database-related SQL files
│
├── scripts/                    # Import, diagnostics and testing scripts
│
├── src/
│   ├── app.js                  # Express application and API routes
│   ├── db.js                   # PostgreSQL connection
│   └── plaza-classification.js # Toll plaza classification
│
├── data/                       # Local toll dataset (not committed)
├── .env                        # Local environment configuration
├── package.json
└── README.md
```

## Supported Vehicle Categories

| API value | Vehicle category |
|---|---|
| `car` | Car / Jeep / Van |
| `lcv` | Light Commercial Vehicle |
| `bus` | Bus / Truck (2 axle) |
| `multiaxle` | 3 axle |
| `axle_4_6` | 4 to 6 axle |
| `axle_7_plus` | 7 or more axle |
| `hcm` | HCM / EME |

### Truck Axle-Based Requests

Truck requests can specify `vehicle_type: "truck"` and an actual `axle_count`.

| Requested axle count | Tariff category used | Approximate |
|---|---|---|
| 2 | `axle_4_6` | Yes |
| 3 | `axle_4_6` | Yes |
| 4–6 | `axle_4_6` | No |
| 7 or more | `axle_7_plus` | No |

The 2- and 3-axle mappings use the available 4–6 axle tariff band as provisional estimates. They are not exact axle-specific tariffs.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/giitsolutions/raasta-toll-api.git
cd raasta-toll-api
```

### 2. Install backend dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root.

```env
PORT=3000
DATABASE_URL=postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE_NAME

ORS_API_KEY=YOUR_ORS_API_KEY
ORS_TRUCK_PROFILE=driving-hgv

SESSION_SECRET=YOUR_SESSION_SECRET

ADMIN_EMAIL=YOUR_ADMIN_EMAIL
ADMIN_PASSWORD_HASH=YOUR_BCRYPT_PASSWORD_HASH
```

Configuration:

| Variable | Purpose |
|---|---|
| `PORT` | Backend server port; defaults to 3000 |
| `DATABASE_URL` | PostgreSQL connection string |
| `ORS_API_KEY` | Routing service API key |
| `ORS_TRUCK_PROFILE` | Truck routing profile |
| `SESSION_SECRET` | Secret used to sign session cookies |
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the admin password |

Never commit `.env` or expose API credentials, passwords, or session secrets.

### 4. Configure PostgreSQL and PostGIS

Create a PostgreSQL database and enable the PostGIS extension.

The database must contain the required project tables, including:

- `toll_plazas`
- `toll_rates`
- `api_clients`
- `api_usage`
- `user_sessions`

The registration-related SQL file is available under `database/`. The complete database initialization and migration process should be documented and maintained separately.

### 5. Import toll data

The import script expects the source dataset at:

```text
data/toll-plazas-raw.json
```

The raw dataset is excluded from Git and must be obtained separately.

Source: [ForceGT India Toll Plazas](https://github.com/ForceGT/india-toll-plazas)

Run:

```bash
node scripts/import-toll-plazas.js
```

The importer inserts new plazas, updates existing records, and imports available toll rates.

### 6. Start the backend

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

The backend runs by default at:

```text
http://localhost:3000
```

### 7. Start the frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

The Vite development server runs at:

```text
http://localhost:5173
```

The frontend communicates with the backend through the configured `/api` proxy.

## API Endpoints

### Health Check

`GET /api/v1/health`

Checks API availability and database connectivity.

### Developer Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register a developer and generate an API key |
| POST | `/api/v1/auth/login` | Developer login |
| GET | `/api/v1/auth/me` | Get current developer session |
| POST | `/api/v1/auth/logout` | Developer logout |
| GET | `/api/v1/auth/usage` | View developer API usage |
| POST | `/api/v1/auth/regenerate-key` | Generate a replacement API key |

The raw API key is displayed at registration or regeneration time. Only its hash is stored in the database. Save the key securely because it cannot be retrieved from the stored hash.

### Protected Toll API

These endpoints require a valid API key in the `x-api-key` request header.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/toll-plazas` | Retrieve toll-plaza records |
| POST | `/api/v1/route` | Calculate route and toll estimate |
| GET | `/api/v1/usage` | Retrieve API usage information |

Example request header:

```http
x-api-key: YOUR_API_KEY
```

The API checks the key, account status, and daily quota before processing protected requests. Successful authenticated requests are recorded in usage tracking.

### Route Calculation Example

`POST /api/v1/route`

Example request:

```json
{
  "source": [77.2090, 28.6139],
  "destination": [76.7794, 30.7333],
  "vehicle_category": "axle_4_6",
  "journey_type": "single",
  "include_geometry": false
}
```

Coordinates use `[longitude, latitude]` order.

For truck axle-based calculations:

```json
{
  "source": [77.08037, 27.570033],
  "destination": [76.7794, 30.7333],
  "vehicle_type": "truck",
  "axle_count": 3,
  "journey_type": "return",
  "include_geometry": false
}
```

### Admin Authentication and Management

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/admin/auth/login` | Admin login |
| GET | `/api/v1/admin/auth/me` | Verify admin session |
| POST | `/api/v1/admin/auth/logout` | Admin logout |
| POST | `/api/v1/admin/customers` | Create an API customer |
| GET | `/api/v1/admin/customers` | List API customers |
| PATCH | `/api/v1/admin/customers/:id/status` | Change customer account status |
| PATCH | `/api/v1/admin/customers/:id/limit` | Change daily API limit |
| GET | `/api/v1/admin/customers/:id/usage` | View customer usage history |

Admin management endpoints require a valid authenticated admin session.

## Toll Rate Interpretation

Each toll-plaza candidate has a rate status:

| Status | Meaning |
|---|---|
| `available` | A usable rate was found |
| `missing` | No applicable rate was found |
| `zero_in_source` | The source dataset contains a zero value |

A zero-valued source rate is not automatically treated as a free toll.

The API also provides diagnostic information about missing rates, fee-point classification, and possible duplicate records.

If one or more candidates lack usable rates, the API can return a `null` complete total while reporting the known subtotal separately. This prevents an incomplete subtotal from being presented as the final toll amount.

## Automated Testing

Run unit tests:

```bash
npm run test:unit
```

Start the backend, then run API smoke tests in another terminal:

```bash
npm test
```

Tests cover plaza classification, rate diagnostics, API health, toll-plaza listing, route calculations, truck axle mapping, input validation, and route geometry.

Successful route tests require a configured database, a valid routing API key, and availability of the external routing service.

## Data Sources and Routing

- Toll plaza and rate records: [ForceGT India Toll Plazas](https://github.com/ForceGT/india-toll-plazas)
- Road routing: HeiGIT / OpenRouteService
- Spatial queries and toll-plaza storage: PostgreSQL / PostGIS

Toll rates and confidence labels depend on the available source data and are not independent verification of every toll charge.

## Important Limitations

- Toll-plaza candidates near a route do not necessarily mean a vehicle must pay at every candidate.
- Closed-loop toll systems may require entry and exit information that is not currently calculated.
- Missing or zero-valued rates can prevent a complete toll estimate.
- Some truck axle mappings are approximate.
- Potential duplicate records require manual verification.
- Fee-point classifications are diagnostic heuristics.
- The raw toll dataset must be obtained separately.
- The database must be initialized before running the application.
- The current API does not provide independently verified toll charges for every Indian route.

## Future Work

- Admin login rate limiting and brute-force protection.
- CSRF protection for session-authenticated admin operations.
- Further session security review and testing.
- Production deployment with HTTPS and secure environment configuration.
- Automated toll-rate updates and verification.
- Improved closed-loop toll calculation.
- Improved toll-plaza matching and duplicate resolution.
- Expanded integration and security testing.
- Complete database schema migrations and setup documentation.
- Review admin route protection and private admin dashboard access.

## License

A license has not yet been assigned to this repository.