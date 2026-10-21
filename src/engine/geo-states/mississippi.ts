/**
 * Mississippi: 7% state, plus the two city taxes the Department of Revenue
 * lists on general retail sales: Jackson's 1% special infrastructure tax and
 * Tupelo's 0.25% water procurement tax. Every other local levy is on
 * hotels or restaurants only. Jackson's tax follows where the seller is,
 * not the buyer, which is the caller's to apply.
 */
import { stateTable } from "./tables.js";

export const mississippi = stateTable("MS", () => ({
  // Covered from Jackson's tax's start; Tupelo's began on 1989-02-01 and
  // the state's general rate has been 7% throughout.
  stateRates: [{ rate: 0.07, from: "2014-03-01" }],
  locals: [
    { name: "Jackson", rate: 0.01, from: "2014-03-01", to: "2035-06-30", type: "01" },
    { name: "Tupelo", rate: 0.0025, from: "1989-02-01", type: "01" },
  ],
  source: "MS DOR tourism and economic development taxes",
}));
