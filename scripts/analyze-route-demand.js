
const fs = require("fs");
const path = require("path");
const routes = require("./freight-routes");
const axios = require("axios");

const API_URL = "http://127.0.0.1:3000/api/v1/route";
const OUTPUT_FILE = path.join(
  __dirname,
  "route-demand-ranking.csv"
);

// Three tariff categories to investigate.
const truckTests = [
  { label: "axle_4_6", vehicle_type: "truck", axle_count: 5 },
  { label: "axle_7_plus", vehicle_type: "truck", axle_count: 8 },
  { label: "hcm", vehicle_category: "hcm" },
];

const plazaMap = new Map();
const failures = [];


async function callRouteAPI(route, vehicle, maxRetries = 3) {
  const payload = {
    source: route.source,
    destination: route.destination,
    journey_type: "single",
    ...vehicle,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(API_URL, payload, {
        timeout: 120000,
      });

      if (!response.data?.success) {
        throw new Error("API returned an unsuccessful response");
      }

      return response.data.data;
    } catch (error) {
      const status = error.response?.status;

      const retryable = status === 429 || status >= 500;

      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const delayMs = 5000 * attempt;

      console.log(
        `  Retry ${attempt}/${maxRetries} after ${delayMs / 1000}s`
      );

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

function recordPlaza(plaza, route, category) {
  const id = String(plaza.source_id);

  if (!plazaMap.has(id)) {
    plazaMap.set(id, {
      source_id: id,
      name: plaza.name,
      state: plaza.state || "",
      highway: plaza.highway || "",
      routeNames: new Set(),
      categories: {},
      rate_status: plaza.rate_status,
      missing_reason: plaza.missing_reason || "",
      fee_point_type: plaza.fee_point_type || "",
      likely_closed_system: plaza.likely_closed_system,
      rate_freshness: plaza.rate_freshness || "unknown",
    });
  }

  const entry = plazaMap.get(id);

  entry.routeNames.add(route.name);

  entry.categories[category] = plaza.rate_status;

  // Preserve any non-available status for investigation.
  if (plaza.rate_status !== "available") {
    entry.rate_status = plaza.rate_status;
  }

  if (plaza.missing_reason) {
    entry.missing_reason = plaza.missing_reason;
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}


function priorityFor(entry) {
  const encounters = entry.routeNames.size;

  // Every category must have a confirmed result.
  const validStatuses = [
    "available",
    "missing",
    "zero_in_source",
  ];

  const allCategoriesTested = truckTests.every(vehicle =>
    validStatuses.includes(entry.categories[vehicle.label])
  );

  if (!allCategoriesTested) {
    return "INCOMPLETE_TEST";
  }

  const missingCount = truckTests.filter(vehicle => {
    const status = entry.categories[vehicle.label];
    return status === "missing" || status === "zero_in_source";
  }).length;

  if (missingCount === 0) return "NO_MISSING_RATE";

  if (encounters >= 5) return "HIGH";
  if (encounters >= 2) return "MEDIUM";

  return "LOW";
}


function saveCSV() {
  const rows = [...plazaMap.values()]
    .map(entry => ({
      ...entry,
      route_count: entry.routeNames.size,
      priority: priorityFor(entry),
    }))
    .sort((a, b) =>
      b.route_count - a.route_count ||
      a.source_id.localeCompare(b.source_id)
    );

  const headers = [
    "source_id",
    "name",
    "state",
    "highway",
    "route_count",
    "routes",
    "axle_4_6_status",
    "axle_7_plus_status",
    "hcm_status",
    "rate_status",
    "missing_reason",
    "fee_point_type",
    "likely_closed_system",
    "rate_freshness",
    "priority",
  ];

  const csvRows = rows.map(entry => [
    entry.source_id,
    entry.name,
    entry.state,
    entry.highway,
    entry.route_count,
    [...entry.routeNames].join("; "),
    entry.categories.axle_4_6 || "not_tested",
    entry.categories.axle_7_plus || "not_tested",
    entry.categories.hcm || "not_tested",
    entry.rate_status,
    entry.missing_reason,
    entry.fee_point_type,
    entry.likely_closed_system,
    entry.rate_freshness,
    entry.priority,
  ]);

  const csv = [
    headers,
    ...csvRows,
  ].map(row => row.map(csvEscape).join(",")).join("\n");

  fs.writeFileSync(OUTPUT_FILE, "\uFEFF" + csv, "utf8");

  return rows;
}


async function main() {
  console.log(`Starting analysis of ${routes.length} routes`);
  console.log(`API: ${API_URL}`);

  let completed = 0;

  for (const route of routes) {
    console.log(`\nRoute: ${route.name}`);

    for (const vehicle of truckTests) {
      try {
        const result = await callRouteAPI(route, vehicle);

        const plazas = result.toll_plazas || [];

        for (const plaza of plazas) {
          recordPlaza(plaza, route, vehicle.label);
        }

        console.log(
          `  ${vehicle.label}: ${plazas.length} plazas`
        );
      } catch (error) {
        failures.push({
          route: route.name,
          category: vehicle.label,
          error: error.response?.data?.message || error.message,
        });

        console.log(
          `  ${vehicle.label}: FAILED - ${error.message}`
        );
      }
    }

    completed++;

const savedRows = saveCSV();

const failureFile = path.join(
  __dirname,
  "route-demand-failures.json"
);

fs.writeFileSync(
  failureFile,
  JSON.stringify(failures, null, 2),
  "utf8"
);

console.log(`Progress: ${completed}/${routes.length}`);
console.log(`Saved ${savedRows.length} plazas to CSV`);
console.log(`Recorded ${failures.length} failed requests`);
  }

  const rows = saveCSV();
  console.log("\n========== ANALYSIS COMPLETE ==========");
  console.log(`Routes configured: ${routes.length}`);
  console.log(`Routes completed: ${completed}`);
  console.log(`Unique plazas encountered: ${rows.length}`);
  console.log(`Failed API requests: ${failures.length}`);
  console.log(`CSV saved: ${OUTPUT_FILE}`);

  console.log("\nPriority summary:");
for (const priority of [
  "HIGH",
  "MEDIUM",
  "LOW",
  "INCOMPLETE_TEST",
  "NO_MISSING_RATE",
]) {
    const count = rows.filter(r => r.priority === priority).length;
    console.log(`${priority}: ${count}`);
  }

  if (failures.length) {
    const failureFile = path.join(__dirname, "route-demand-failures.json");
    fs.writeFileSync(
      failureFile,
      JSON.stringify(failures, null, 2),
      "utf8"
    );
    console.log(`Failures saved: ${failureFile}`);
  }
}

main().catch(error => {
  console.error("Analysis failed:", error.message);
  process.exitCode = 1;
});

