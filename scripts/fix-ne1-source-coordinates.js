const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../data/toll-plazas-raw.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

const corrections = {
  260: { location: "2.600" },
  515: {
    latitude: "22.413798",
    longitude: "73.149308",
    location: "86.000"
  },
 766: {
  latitude: "22.594556",
  longitude: "72.981298",
  location: "58.616"
},
  767: { location: "3.800" },
768: {
  latitude: "22.696475",
  longitude: "72.896397",
  location: "43.855"
}
,
};

for (const [sourceId, values] of Object.entries(corrections)) {
  const plaza = data.find(
    p => Number(p.tollplaza_id) === Number(sourceId)
  );

  if (!plaza) {
    throw new Error(`Source ID ${sourceId} not found`);
  }

  Object.assign(plaza, values);
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

console.log("NE-1 source corrections saved.");

for (const sourceId of Object.keys(corrections)) {
  const p = data.find(
    x => Number(x.tollplaza_id) === Number(sourceId)
  );

  console.log({
    source_id: p.tollplaza_id,
    name: p.tollplaza_name,
    latitude: p.latitude,
    longitude: p.longitude,
    location: p.location
  });
}