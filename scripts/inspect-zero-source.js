const data = require("../data/toll-plazas-raw.json");

const targetIds = [
  1124, 1127, 1129, 1131, 1132,
  1227, 1228, 1229,
  1241, 1243, 1244,
  1302, 1304, 3421,
  3599, 3600, 3773,
  3814, 3816, 3818, 3822, 3836, 3858,
  4552, 4564, 920,
];
const categories = [
  "car",
  "lcv",
  "bus",
  "multiaxle",
  "axle_4_6",
  "axle_7_plus",
  "hcm",
];

const journeyTypes = [
  "single",
  "return",
  "monthly",
  "commercial",
];

for (const id of targetIds) {
  const plaza = data.find(
    record => Number(record.tollplaza_id) === id
  );

  console.log("\n====================================");
  console.log("SOURCE ID:", id);

  if (!plaza) {
    console.log("NOT FOUND IN ORIGINAL JSON");
    continue;
  }

  console.log("Name:", plaza.tollplaza_name);
  console.log("State:", plaza.state_name);
  console.log("Data source:", plaza.data_source);
  console.log("Data confidence:", plaza.data_confidence);
  console.log("Effective date:", plaza.rate_effective_date);
  console.log("Revision date:", plaza.rate_revision_date);

  console.log("\nTARIFF VALUES:");

  for (const category of categories) {
    const rates = {};

    for (const journey of journeyTypes) {
      rates[journey] = plaza[`${category}_${journey}`];
    }

    console.log(category, rates);
  }
}