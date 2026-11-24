const pool = require("../src/db");

async function main() {
  const result = await pool.query(`
    SELECT
      source_id,
      name,
      highway,
      latitude,
      longitude,
      ROUND(
        (ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint(72.323165, 27.283378), 4326)::geography
        ) / 1000)::numeric, 2
      ) AS distance_km
    FROM toll_plazas
    WHERE is_active = true
      AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(72.323165, 27.283378), 4326)::geography,
        30000
      )
    ORDER BY distance_km
    LIMIT 15;
  `);

  console.table(result.rows);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
