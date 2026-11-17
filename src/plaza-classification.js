const CLOSED_SYSTEM_PATTERN = /close\s*loop|entry\s*exit/i;
const POSSIBLE_CLOSED_SYSTEM_PATTERN =
  /interchange|\bexit\b|\bEEH\b|\bDVE\b|\(samruddhi\)/i;
const NON_HIGHWAY_PATTERN = /check\s*post|border|forest|\bEMC\b/i;

function classifyFeePoint(name) {
  const text = name || "";

  if (CLOSED_SYSTEM_PATTERN.test(text)) {
    return "closed_system";
  }

  if (POSSIBLE_CLOSED_SYSTEM_PATTERN.test(text)) {
    return "possible_closed_system";
  }

  if (NON_HIGHWAY_PATTERN.test(text)) {
    return "non_highway_fee_point";
  }

  return "toll_plaza";
}

function classifyRateData(counts) {
  const total = Number(counts?.total_rows) || 0;
  const category = Number(counts?.category_rows) || 0;
  const otherJourney = Number(counts?.category_other_journey_rows) || 0;
  const future = Number(counts?.future_rows) || 0;
  const expired = Number(counts?.expired_rows) || 0;

  if (total === 0) {
    return "no_rates_in_source";
  }

  if (category === 0) {
    return "no_rate_for_vehicle_category";
  }

  if (future > 0) {
    return "rate_not_yet_effective";
  }

  if (expired > 0) {
    return "rate_expired";
  }

  if (otherJourney > 0) {
    return "no_rate_for_journey_type";
  }

  return "unclassified";
}

function describeRate({ rateStatus, name, counts }) {
  const feePointType = classifyFeePoint(name);

  if (rateStatus === "available") {
    return {
      fee_point_type: feePointType,
      missing_reason: null,
      rate_data_state: null,
    };
  }

  const rateDataState =
    rateStatus === "zero_in_source"
      ? "zero_in_source"
      : classifyRateData(counts);

    const missingReason = rateDataState;

  return {
    fee_point_type: feePointType,
    missing_reason: missingReason,
    rate_data_state: rateDataState,
  };
}

module.exports = {
  CLOSED_SYSTEM_PATTERN,
  classifyFeePoint,
  classifyRateData,
  describeRate,
};
