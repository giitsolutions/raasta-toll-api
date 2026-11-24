const data = require("../data/toll-plazas-raw.json");

console.log(
  "Top-level:",
  Array.isArray(data) ? "Array" : typeof data
);

console.log(
  "Count:",
  Array.isArray(data) ? data.length : Object.keys(data).length
);

const firstRecord = Array.isArray(data)
  ? data[0]
  : Object.values(data)[0];

console.log(
  "First record keys:",
  Object.keys(firstRecord)
);