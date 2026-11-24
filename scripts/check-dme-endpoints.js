
require("dotenv").config();

const axios = require("axios");
const pool = require("../src/db");

const ORS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions";

async function main() {
  const endpoints = await pool.query(`
    SELECT
      e.endpoint_code,
      e.endpoint_name,
      e.chainage_km,
      p.longitude,
      p.latitude
    FROM dme_endpoints e
    JOIN toll_plazas p ON p.id = e.plaza_id
    ORDER BY e.chainage_km
  `);

  const byCode = Object.fromEntries(
    endpoints.rows.map((e) => [e.endpoint_code, e])
  );

  const source = [
    Number(byCode.sarai_kale_khan.longitude),
    Number(byCode.sarai_kale_khan.latitude),
  ];

  const destination = [
    Number(byCode.kashi.longitude),
    Number(byCode.kashi.latitude),
  ];

  const response = await axios.post(
    `${ORS_URL}/driving-car/geojson`,
    { coordinates: [source, destination] },
    {
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const geometry = JSON.stringify(
    response.data.features[0].geometry
  );

  const result = await pool.query(
    `WITH route AS (
       SELECT ST_SetSRID(
         ST_GeomFromGeoJSON($1), 4326
       ) AS geom
     )
     SELECT
       e.endpoint_code,
       e.endpoint_name,
       e.chainage_km,
       ROUND(
         ST_Distance(
           p.location,
           route.geom::geography
         )::numeric,
         1
       ) AS distance_from_route_m,
       ROUND(
         (
           ST_LineLocatePoint(
             route.geom,
             p.location::geometry
           ) *
           ST_Length(route.geom::geography) / 1000
         )::numeric,
         2
       ) AS route_position_km
     FROM dme_endpoints e
     JOIN toll_plazas p ON p.id = e.plaza_id
     CROSS JOIN route
     ORDER BY ST_LineLocatePoint(
       route.geom,
       p.location::geometry
     )`,
    [geometry]
  );

  console.table(result.rows);

 console.log(
  "Route distance (km):",
  (
    response.data.features[0].properties.summary.distance /
    1000
  ).toFixed(2)
);

console.log(
  "Route bounding box:",
  response.data.features[0].bbox
);
}

main()
  .catch((error) => {
    console.error(error.response?.data || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
