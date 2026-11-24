const pool = require("../src/db");

pool.query(`
  SELECT
    p.source_id,
    p.name,
    r.vehicle_category,
    r.rate_type,
    r.amount_inr,
    r.effective_from,
    r.effective_to
  FROM toll_plazas p
  LEFT JOIN toll_rates r ON r.plaza_id = p.id
  WHERE p.source_id IN ('1289', '921')
  ORDER BY p.source_id, r.vehicle_category, r.rate_type
`).then(result => {
  console.table(result.rows);
}).catch(console.error).finally(() => pool.end());