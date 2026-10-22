/**
 * Pennsylvania: 6% state, plus 1% in Allegheny County and 2% in
 * Philadelphia (city and county share one boundary), per the Department of
 * Revenue. No other local sales tax.
 */
import { stateTable } from "./tables.js";

export const pennsylvania = stateTable("PA", () => ({
  stateRates: [{ rate: 0.06, from: "2000-01-01" }],
  locals: [
    { name: "Allegheny", rate: 0.01, from: "2000-01-01", type: "00" },
    { name: "Philadelphia", rate: 0.01, from: "2000-01-01", to: "2009-10-07", type: "00" },
    { name: "Philadelphia", rate: 0.02, from: "2009-10-08", type: "00" },
  ],
  source: "PA Department of Revenue sales tax rates",
  publications: [{ url: "https://www.revenue.pa.gov/TaxTypes/SUT/", name: "pa-sut.html" }],
}));
