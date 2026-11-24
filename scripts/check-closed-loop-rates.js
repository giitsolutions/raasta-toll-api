require("dotenv").config();
const pool = require("../src/db");

async function main() {
  const result = await pool.query(`
    SELECT
      p.source_id,
      p.name,
      p.data_source,
      COUNT(r.id) AS rate_rows,
      COUNT(*) FILTER (WHERE r.amount_inr = 0) AS zero_rates,
      COUNT(*) FILTER (WHERE r.amount_inr > 0) AS positive_rates
    FROM toll_plazas p
    LEFT JOIN toll_rates r ON r.plaza_id = p.id
    WHERE p.source_id IN (509, 831)
    GROUP BY p.source_id, p.name, p.data_source
    ORDER BY p.source_id
  `);

  console.table(result.rows);
}

main()
  .catch(console.error)
  .finally(() => pool.end());

