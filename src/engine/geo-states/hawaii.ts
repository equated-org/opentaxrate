/**
 * Hawaii's general excise tax, which is on the business rather than the
 * sale but customarily passed on: 4% state plus each county's 0.5%
 * surcharge (Department of Taxation). This is the tax rate, not the higher
 * rate a business may visibly pass on (4.712% where the surcharge applies),
 * and only for activity taxed at 4%. Kalawao County is named in no
 * surcharge.
 */
import { stateTable } from "./tables.js";

export const hawaii = stateTable("HI", () => ({
  stateRates: [{ rate: 0.04, from: "2000-01-01" }],
  locals: [
    { name: "Honolulu", rate: 0.005, from: "2007-01-01", to: "2030-12-31", type: "00" },
    { name: "Kauai", rate: 0.005, from: "2019-01-01", to: "2030-12-31", type: "00" },
    { name: "Hawaii", rate: 0.0025, from: "2019-01-01", to: "2019-12-31", type: "00" },
    { name: "Hawaii", rate: 0.005, from: "2020-01-01", to: "2030-12-31", type: "00" },
    { name: "Maui", rate: 0.005, from: "2024-01-01", to: "2030-12-31", type: "00" },
  ],
  source: "HI Department of Taxation county surcharge",
}));
