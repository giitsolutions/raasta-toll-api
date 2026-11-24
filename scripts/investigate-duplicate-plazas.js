require("dotenv").config();

const pool = require("../src/db");

const radius = Number(process.argv[2]) || 300;

async function investigate() {
  const result = await pool.query(
    `
    SELECT
      a.id AS a_id,
      a.source_id AS a_source_id,
      a.name AS a_name,
      a.highway AS a_highway,
      a.state AS a_state,
      a.data_source AS a_source,
      a.data_confidence AS a_confidence,
      a.source_url AS a_source_url,

      b.id AS b_id,
      b.source_id AS b_source_id,
      b.name AS b_name,
      b.highway AS b_highway,
      b.state AS b_state,
      b.data_source AS b_source,
      b.data_confidence AS b_confidence,
      b.source_url AS b_source_url,

      ROUND(ST_Distance(a.location, b.location)::numeric, 2) AS distance_m,

      (
        SELECT COUNT(*)
        FROM toll_rates ra
        WHERE ra.plaza_id = a.id
      ) AS a_rate_count,

      (
        SELECT COUNT(*)
        FROM toll_rates rb
        WHERE rb.plaza_id = b.id
      ) AS b_rate_count,

      (
        SELECT COUNT(*)
        FROM toll_rates ra
        JOIN toll_rates rb
          ON ra.vehicle_category = rb.vehicle_category
         AND ra.rate_type = rb.rate_type
         AND ra.amount_inr = rb.amount_inr
         AND ra.effective_from IS NOT DISTINCT FROM rb.effective_from
         AND ra.effective_to IS NOT DISTINCT FROM rb.effective_to
        WHERE ra.plaza_id = a.id
          AND rb.plaza_id = b.id
      ) AS matching_rate_count,

      (
        SELECT COUNT(*)
        FROM toll_rates ra
        JOIN toll_rates rb
          ON ra.vehicle_category = rb.vehicle_category
         AND ra.rate_type = rb.rate_type
        WHERE ra.plaza_id = a.id
          AND rb.plaza_id = b.id
      ) AS comparable_rate_count

    FROM toll_plazas a
    JOIN toll_plazas b
      ON a.id < b.id
     AND ST_DWithin(a.location, b.location, $1)

    WHERE a.is_active = TRUE
      AND b.is_active = TRUE

    ORDER BY distance_m, a.source_id
    `,
    [radius]
  );

  console.log(`Nearby plaza pairs within ${radius} m: ${result.rowCount}`);
  console.table(result.rows);

  console.log("\nInterpretation:");
  console.log("- matching_rate_count: identical category, rate type, amount and validity dates.");
  console.log("- comparable_rate_count: rate records sharing category and rate type.");
  console.log("- These are investigation clues, not proof of duplicates.");
}

investigate()
  .catch((error) => {
    console.error("Investigation failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
