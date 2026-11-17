require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const radius = Number(process.argv[2]) || 300;

async function report() {
  const result = await pool.query(
    `SELECT
       a.source_id AS a_source_id,
       a.name AS a_name,
       a.data_source AS a_source,
       b.source_id AS b_source_id,
       b.name AS b_name,
       b.data_source AS b_source,
       ROUND(ST_Distance(a.location, b.location)::numeric) AS distance_m,
       EXISTS (
         SELECT 1 FROM toll_rates r
         WHERE r.plaza_id = a.id
           AND r.vehicle_category = 'axle_4_6'
           AND r.rate_type = 'single'
           AND r.amount_inr > 0
       ) AS a_has_truck_rate,
       EXISTS (
         SELECT 1 FROM toll_rates r
         WHERE r.plaza_id = b.id
           AND r.vehicle_category = 'axle_4_6'
           AND r.rate_type = 'single'
           AND r.amount_inr > 0
       ) AS b_has_truck_rate
     FROM toll_plazas a
     JOIN toll_plazas b
       ON a.id < b.id
      AND ST_DWithin(a.location, b.location, $1)
     WHERE a.is_active = TRUE AND b.is_active = TRUE
     ORDER BY distance_m, a.source_id`,
    [radius]
  );

  console.log(`Plaza pairs within ${radius} m: ${result.rowCount}`);
  console.table(result.rows);
}

report()
  .catch((error) => {
    console.error("Report failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
