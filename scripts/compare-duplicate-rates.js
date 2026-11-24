require("dotenv").config();

const pool = require("../src/db");

async function compareRates() {
  const result = await pool.query(`
    WITH pairs(a_id, b_id) AS (
      VALUES
        (660::bigint, 668::bigint),
        (1396::bigint, 1398::bigint),
        (1396::bigint, 1397::bigint),
        (758::bigint, 813::bigint)
    )
    SELECT
      a.name AS plaza_a,
      b.name AS plaza_b,
      ra.vehicle_category,
      ra.rate_type,
      ra.amount_inr AS a_amount,
      rb.amount_inr AS b_amount,
      ra.effective_from AS a_effective_from,
      rb.effective_from AS b_effective_from,
      ra.effective_to AS a_effective_to,
      rb.effective_to AS b_effective_to,
      CASE
        WHEN ra.amount_inr IS NOT DISTINCT FROM rb.amount_inr
         AND ra.effective_from IS NOT DISTINCT FROM rb.effective_from
         AND ra.effective_to IS NOT DISTINCT FROM rb.effective_to
        THEN 'EXACT MATCH'
        ELSE 'DIFFERENT'
      END AS comparison
    FROM pairs p
    JOIN toll_plazas a ON a.id = p.a_id
    JOIN toll_plazas b ON b.id = p.b_id
    JOIN toll_rates ra ON ra.plaza_id = a.id
    JOIN toll_rates rb
      ON rb.plaza_id = b.id
     AND rb.vehicle_category = ra.vehicle_category
     AND rb.rate_type = ra.rate_type
    ORDER BY a.name, ra.vehicle_category, ra.rate_type
  `);

  console.log("Detailed toll-rate comparison:");
  console.table(result.rows);
}

compareRates()
  .catch((error) => {
    console.error("Comparison failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
