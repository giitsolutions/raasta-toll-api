require("dotenv").config();
const pool = require("../src/db");

async function main() {
  const result = await pool.query(`
    SELECT
      vehicle_category,
      rate_type,
      amount_inr,
      effective_from,
      effective_to
    FROM toll_rates
    WHERE plaza_id = (
      SELECT id FROM toll_plazas WHERE source_id = 831
    )
    ORDER BY vehicle_category, rate_type
  `);

  console.table(result.rows);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
