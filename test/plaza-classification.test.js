const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyFeePoint,
  classifyRateData,
  describeRate,
} = require("../src/plaza-classification");

test("classifyFeePoint recognises closed-system names", () => {
  assert.equal(
    classifyFeePoint("Ghata Samsabad (Close Loop Toll)"),
    "closed_system"
  );
  assert.equal(
    classifyFeePoint("Bhandaraj (Entry Exit )Toll"),
    "closed_system"
  );
});

test("classifyFeePoint recognises possible closed-system names", () => {
  assert.equal(
    classifyFeePoint("Khalilpur (NH -DVE Exit) "),
    "possible_closed_system"
  );
  assert.equal(
    classifyFeePoint("Mulund(EEH) Toll Plaza"),
    "possible_closed_system"
  );
  assert.equal(
    classifyFeePoint("Sinnar Interchange Toll Plaza"),
    "possible_closed_system"
  );
});

test("classifyFeePoint recognises non-highway fee points", () => {
  assert.equal(
    classifyFeePoint("Kagal CheckPost Toll Plaza"),
    "non_highway_fee_point"
  );
  assert.equal(
    classifyFeePoint("NagarjunasagarEMC Checkpost"),
    "non_highway_fee_point"
  );
  assert.equal(
    classifyFeePoint("Achhad BorderCheckpost Toll Plaza"),
    "non_highway_fee_point"
  );
});

test("classifyFeePoint leaves ordinary plazas alone", () => {
  assert.equal(classifyFeePoint("Khalghat"), "toll_plaza");
  assert.equal(classifyFeePoint("Shahjahanpur"), "toll_plaza");
  assert.equal(classifyFeePoint(null), "toll_plaza");
  assert.equal(classifyFeePoint(undefined), "toll_plaza");
});

test("classifyRateData separates the data-level causes", () => {
  assert.equal(classifyRateData({ total_rows: 0 }), "no_rates_in_source");
  assert.equal(
    classifyRateData({ total_rows: 7, category_rows: 0 }),
    "no_rate_for_vehicle_category"
  );
  assert.equal(
    classifyRateData({ total_rows: 7, category_rows: 1, future_rows: 1 }),
    "rate_not_yet_effective"
  );
  assert.equal(
    classifyRateData({ total_rows: 7, category_rows: 1, expired_rows: 1 }),
    "rate_expired"
  );
  assert.equal(
    classifyRateData({
      total_rows: 7,
      category_rows: 2,
      category_other_journey_rows: 2,
    }),
    "no_rate_for_journey_type"
  );
  assert.equal(
    classifyRateData({ total_rows: "0", category_rows: "0" }),
    "no_rates_in_source"
  );
});

test("describeRate returns no missing reason for available rates", () => {
  assert.deepEqual(
    describeRate({ rateStatus: "available", name: "Khalghat", counts: {} }),
    {
      fee_point_type: "toll_plaza",
      missing_reason: null,
      rate_data_state: null,
    }
  );
});

test("describeRate never reports zero as free or as closed-system", () => {
  const result = describeRate({
    rateStatus: "zero_in_source",
    name: "Rasoolpur (DME Close Loop Toll)",
    counts: { total_rows: 3, category_rows: 1 },
  });

  assert.equal(result.missing_reason, "zero_in_source");
  assert.equal(result.fee_point_type, "closed_system");
});

test("describeRate keeps plaza type separate from data state", () => {
  const closed = describeRate({
    rateStatus: "missing",
    name: "Dasna (DME Close Loop Toll)",
    counts: { total_rows: 0 },
  });

  assert.equal(closed.missing_reason, "no_rates_in_source");
  assert.equal(closed.rate_data_state, "no_rates_in_source");
  assert.equal(closed.fee_point_type, "closed_system");

  const checkpost = describeRate({
    rateStatus: "missing",
    name: "Biloli CheckPost Toll Plaza",
    counts: { total_rows: 0 },
  });

  assert.equal(checkpost.missing_reason, "no_rates_in_source");
  assert.equal(checkpost.rate_data_state, "no_rates_in_source");
  assert.equal(checkpost.fee_point_type, "non_highway_fee_point");
});

test("describeRate reports data causes for ordinary plazas", () => {
  const stateCarOnly = describeRate({
    rateStatus: "missing",
    name: "Kundali",
    counts: { total_rows: 4, category_rows: 0 },
  });

  assert.equal(stateCarOnly.fee_point_type, "toll_plaza");
  assert.equal(stateCarOnly.missing_reason, "no_rate_for_vehicle_category");

  const empty = describeRate({
    rateStatus: "missing",
    name: "Pathrala Toll Plaza",
    counts: { total_rows: 0 },
  });

  assert.equal(empty.missing_reason, "no_rates_in_source");
});
