# India Toll Calculation API

A REST API for estimating toll charges on road routes within India using **Node.js, Express, PostgreSQL, PostGIS, and OpenRouteService (ORS)**.

The API accepts source and destination coordinates, calculates a road route, identifies nearby toll-plaza candidates, and retrieves applicable toll rates for different vehicle categories.

> Toll amounts are estimates based on the available dataset. They should be independently verified before operational or financial use.

## Features

- Calculate road routes between source and destination coordinates.
- Support seven database vehicle categories, including commercial trucks.
- Accept actual truck axle counts and select an available tariff category.
- Support single and return toll-rate calculations.
- Identify toll-plaza candidates near the calculated route.
- Retrieve applicable rates from PostgreSQL.
- Distinguish available, missing, and zero-valued source rates.
- Diagnose why a toll rate is unavailable.
- Classify likely closed-system and non-highway fee points.
- Identify nearby plaza records that may be duplicates.
- Calculate known toll subtotals and report incomplete estimates.
- Return route distance, duration, toll details, and data-quality warnings.
- Optionally return route geometry as GeoJSON.
- Health endpoint with database connectivity verification.
- Automated unit tests and API smoke tests.

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- PostGIS
- OpenRouteService / HeiGIT routing API
- Axios
- Git and GitHub
- Node.js built-in test runner

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

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/palaksingh-06/india-toll-api.git
cd india-toll-api
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root using `.env.example` as a reference.

```env
PORT=3000
DATABASE_URL=postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE_NAME
ORS_API_KEY=YOUR_ORS_API_KEY
ORS_TRUCK_PROFILE=driving-hgv
```

Configuration:

- `PORT`: API server port. Defaults to `3000`.
- `DATABASE_URL`: PostgreSQL connection string.
- `ORS_API_KEY`: API key for the routing service.
- `ORS_TRUCK_PROFILE`: Truck routing profile. Defaults to `driving-hgv`.

Never commit your `.env` file or expose API credentials.

### 4. Set up PostgreSQL and PostGIS

Create a PostgreSQL database and enable the PostGIS extension.

The required database tables must be initialized before importing toll data or running the API. The application uses the `toll_plazas` and `toll_rates` tables.

**Note:** The database schema is not currently included as a standalone SQL migration file in this repository. An appropriately initialized database is therefore required.

### 5. Import toll data

The import script reads:

```text
data/toll-plazas-raw.json
```

This raw JSON file is excluded from GitHub and must be obtained separately.

The project's data pipeline uses the [ForceGT India Toll Plazas dataset](https://github.com/ForceGT/india-toll-plazas).

Place the prepared JSON array at the expected path and run:

```bash
node scripts/import-toll-plazas.js
```

The importer inserts new toll plazas, updates existing records, and imports available rates for supported vehicle categories and rate types.

The import operation uses a database transaction and can be rerun to update existing records.

The importer also reports data-quality observations, including:

- Empty rate values.
- Missing effective dates.
- Plazas with no imported rates.
- Unparseable rate values.
- Negative rate values.

Unparseable values are reported rather than silently converted into guessed toll amounts.

### 6. Start the API server

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

By default, the server runs at:

```text
http://localhost:3000
```

## API Endpoints

### 1. Health Check

**GET** `/api/v1/health`

Checks whether the API is running and the database is accessible.

Example:

```bash
curl http://localhost:3000/api/v1/health
```

Successful response:

```json
{
  "success": true,
  "message": "India Toll API is running",
  "database": "connected"
}
```

Returns HTTP `503` if the database is unavailable.

### 2. List Toll Plazas

**GET** `/api/v1/toll-plazas`

Returns active toll plazas from the database.

Optional query parameter:

| Parameter | Description | Default | Range |
|---|---|---|---|
| `limit` | Maximum number of plazas | 20 | 1–100 |

Example:

```bash
curl "http://localhost:3000/api/v1/toll-plazas?limit=5"
```

Response structure:

```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "source_id": 123,
      "name": "Example Toll Plaza",
      "highway": "NH 44",
      "state": "Haryana",
      "latitude": 29.0,
      "longitude": 76.0,
      "is_active": true
    }
  ]
}
```

The plaza values above are illustrative.

### 3. Calculate Route and Toll Estimate

**POST** `/api/v1/route`

Calculates a road route and identifies toll-plaza candidates along it.

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

**Request parameters**

| Parameter | Required | Description |
|---|---|---|
| `source` | Yes | Starting point as `[longitude, latitude]` |
| `destination` | Yes | Destination as `[longitude, latitude]` |
| `vehicle_category` | No | Vehicle category; defaults to `car` |
| `journey_type` | No | `single`, `return`, `monthly`, or `commercial`; defaults to `single` |
| `include_geometry` | No | Set to `true` to include route GeoJSON |

### Truck Axle-Based Requests

In addition to predefined vehicle categories, the API supports truck requests using the actual axle count.

When using this format, provide `vehicle_type: "truck"` and `axle_count` instead of `vehicle_category`.

**Example: 3-axle truck, return journey**

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

**Axle-to-tariff mapping**

| Requested axle count | Tariff category used | Approximate |
|---|---|---|
| 2 | `axle_4_6` | Yes |
| 3 | `axle_4_6` | Yes |
| 4–6 | `axle_4_6` | No |
| 7 or more | `axle_7_plus` | No |

The 2- and 3-axle mappings use the available 4–6 axle tariff band as provisional estimates. They are not exact axle-specific tariffs and should be independently verified.

**Additional response fields**

For axle-based truck requests, the response includes:

- `vehicle_type`: Requested vehicle type (`truck`).
- `requested_axle_count`: Axle count provided by the caller.
- `vehicle_category`: Selected database tariff category.
- `tariff_category_used`: Database tariff category selected for the calculation.
- `is_approximate`: Indicates whether an approximate tariff band was used.
- `estimation_message`: Explains the selected tariff band and any approximation.

Existing requests using `vehicle_category` continue to work without requiring `vehicle_type` or `axle_count`. This maintains backward compatibility.

**Journey types**

- `single`: Retrieves the single-journey toll rate.
- `return`: Retrieves the published return-journey toll rate.
- `monthly`: Uses the available monthly rate data.
- `commercial`: Uses the available commercial rate data.

**Example using curl**

```bash
curl -X POST http://localhost:3000/api/v1/route \
  -H "Content-Type: application/json" \
  -d '{
    "source": [77.2090, 28.6139],
    "destination": [76.7794, 30.7333],
    "vehicle_category": "axle_4_6",
    "journey_type": "single",
    "include_geometry": false
  }'
```

**Response structure**

A successful response contains route information, toll candidates, and a toll summary.

An illustrative response structure:

```json
{
  "success": true,
  "data": {
    "vehicle_category": "axle_4_6",
    "journey_type": "single",
    "routing_profile": "driving-hgv",
    "distance_meters": 267767.2,
    "duration_seconds": 12792,
    "toll_plaza_candidates": 6,
    "toll_summary": {
      "total_toll_inr": null,
      "known_subtotal_inr": 2080,
      "plazas_with_rate": 4,
      "plazas_without_rate": 2,
      "rate_confidence": "medium",
      "data_sources": ["nhai"],
      "list_may_be_truncated": false,
      "warnings": []
    },
    "toll_plazas": []
  }
}
```

The numbers above are illustrative; live results may differ as routing and source data change. The `toll_plazas` array contains individual plaza details.

When `include_geometry` is `true`, the response additionally includes `route_geometry` as a GeoJSON `LineString`.

## Toll Rate Interpretation and Diagnostics

Each toll-plaza candidate has a rate status:

| Status | Meaning |
|---|---|
| `available` | A usable rate was found. |
| `missing` | No applicable rate was found. |
| `zero_in_source` | The source dataset contains a zero value. |

A zero-valued source rate is **not automatically treated as a free toll**.

### Rate Diagnostics

The API provides additional information to explain why a toll rate is unavailable.

Important fields include:

- `fee_point_type`: Classification of the fee point.
- `missing_reason`: Data-level reason why an applicable rate is missing.
- `rate_data_state`: State of the rate data for the requested category and journey.
- `possible_duplicate_of`: Information indicating a nearby record that may be a duplicate, when identified.
- `missing_reason_counts`: Summary of missing-rate reasons across the route candidates.

Possible `fee_point_type` classifications include:

| Classification | Meaning |
|---|---|
| `toll_plaza` | Ordinary toll-plaza classification. |
| `closed_system` | Name matches a likely closed-loop toll pattern. |
| `possible_closed_system` | Name suggests an interchange or another potentially closed-system fee point. |
| `non_highway_fee_point` | Name suggests a check post, border, forest or other non-highway fee point. |

Possible rate-data states include:

- `no_rates_in_source`
- `no_rate_for_vehicle_category`
- `rate_not_yet_effective`
- `rate_expired`
- `no_rate_for_journey_type`
- `unclassified`

These classifications are diagnostic heuristics based on available source information and naming patterns. They do not independently establish the actual operating arrangement of a fee point.

The `missing_reason` field represents the rate-data state, not the fee-point classification. This keeps data-quality problems separate from fee-point type.

### Toll Summary

- `known_subtotal_inr`: Sum of rates that are available.
- `total_toll_inr`: Complete total only when all identified candidates have usable rates and the candidate list is not truncated.
- `plazas_with_rate`: Number of candidates with usable rates.
- `plazas_without_rate`: Number of candidates without usable rates.
- `rate_confidence`: An indication based on source and rate freshness metadata.
- `warnings`: Important data-quality and calculation warnings.
- `missing_reason_counts`: Counts of the different missing-rate reasons.

If one or more candidates lack usable rates, `total_toll_inr` is returned as `null` rather than presenting an incomplete subtotal as the final toll amount.

## Duplicate Plaza Investigation

The project includes a read-only script to identify active toll-plaza records located close to one another.

Run:

```bash
npm run report:duplicates
```

The default search radius is 300 metres.

A custom radius can be supplied in metres:

```bash
node scripts/report-duplicate-plazas.js 500
```

The report displays:

- Source IDs and plaza names.
- Data sources.
- Distance between plaza coordinates.
- Whether each plaza has a positive `axle_4_6` single-journey rate.

**Important:** Nearby records are only potential duplicates. Identical coordinates or similar names do not prove that two records represent the same physical toll facility. The script does not merge, delete, or update any database records.

## Automated Testing

The project includes unit tests for plaza classification and rate diagnostics, as well as API smoke tests.

### 1. Unit tests

Run:

```bash
npm run test:unit
```

These tests use Node.js's built-in test runner and verify:

- Closed-system fee-point classification.
- Possible closed-system classification.
- Non-highway fee-point classification.
- Ordinary toll-plaza classification.
- Missing-rate data-state classification.
- Available-rate handling.
- Zero-valued source-rate handling.
- Separation of fee-point classification and rate-data state.

### 2. API smoke tests

Start the API server in one terminal:

```bash
npm run dev
```

In another terminal, execute:

```bash
npm test
```

The smoke tests verify:

1. API health and database connectivity.
2. Toll-plaza listing.
3. Car single-journey calculation.
4. Truck single-journey calculation (4–6 axle).
5. 3-axle truck approximate tariff mapping.
6. 5-axle truck tariff mapping.
7. 7-axle truck tariff mapping.
8. Car return-journey calculation.
9. Per-plaza rate diagnostics.
10. Invalid vehicle-category validation.
11. Invalid-coordinate validation.
12. Route geometry when enabled.
13. Route geometry when disabled.

**Requirements:** A running API server, a working PostgreSQL/PostGIS database, and a valid routing API key for successful route tests. Route tests also depend on the external routing service being available.

## Data Sources and Routing

- Toll plaza and rate records are imported from the [ForceGT India Toll Plazas dataset](https://github.com/ForceGT/india-toll-plazas).
- Road routes are obtained through the HeiGIT/OpenRouteService directions API.
- PostgreSQL and PostGIS are used for toll-plaza storage and spatial proximity queries.

The importer preserves source and confidence metadata where available. Confidence labels reflect the data-processing pipeline and do not represent independent verification of every toll rate.

## Important Limitations

- Toll plazas identified near a route are candidates, not confirmation that a vehicle must pay at every identified plaza.
- The application currently identifies candidates within 250 metres of the calculated route.
- Closed-loop toll systems may require entry and exit information that is not currently calculated.
- Missing or zero-valued rates can prevent a complete toll estimate.
- Rates with past revision dates may have changed and should be verified.
- The 2- and 3-axle truck tariff mappings are approximate.
- Nearby plaza records may represent separate facilities; duplicate detection does not automatically merge them.
- Fee-point classification uses naming patterns and should not be treated as independently verified ground truth.
- The API does not currently implement API-client authentication, usage tracking, or geocoding.
- Truck routing uses the configured OpenRouteService truck profile; route suitability should be checked for the actual vehicle.
- The raw toll dataset and database schema must be supplied or initialized separately.

## Future Improvements

- API key authentication and usage tracking.
- Improved closed-loop toll calculation using entry and exit points.
- Automated toll-rate updates and verification.
- Improved route and toll-plaza matching.
- Manual verification and resolution of potential duplicate records.
- Expanded automated testing and integration coverage.

## License

A license has not yet been assigned to this repository.