/**
 * Idaho: 6% state, plus the resort cities that tax general retail sales,
 * from each city's own ordinance (the Tax Commission lists the cities but
 * not their rates; the cities collect). Exemptions vary by city and are the
 * caller's to apply: groceries (Ketchum, McCall, Harrison, Lava Hot
 * Springs), vehicles (Ketchum, McCall, Lava Hot Springs), building
 * materials and auto parts (Lava Hot Springs), and single purchases of
 * $1,000 or more (Bonners Ferry, Ponderay). Cities whose tax is on lodging,
 * food or drink only (Bellevue, Crouch, Hailey, Irwin, Kellogg, Mackay,
 * Salmon, Sandpoint) are left out.
 *
 * Ponderay's tax lapsed for 2025 (its renewal failed) and a new one runs
 * from 2026; Tetonia's began in 2026. Cascade's and Swan Valley's end with
 * 2026, and Ketchum's base rate is on the November 2026 ballot, so those
 * need the results read before 2027.
 */
import { stateTable } from "./tables.js";

/** [city, general retail rate, first day, last day] */
const RESORT_CITIES: Array<[string, number, string?, string?]> = [
  ["Ketchum", 0.02],
  ["Sun Valley", 0.03],
  ["Stanley", 0.025],
  ["Lava Hot Springs", 0.02],
  ["McCall", 0.01],
  ["Cascade", 0.01, undefined, "2026-12-31"],
  ["Donnelly", 0.01],
  ["Riggins", 0.01],
  ["Ponderay", 0.01, "2026-01-01", "2035-12-31"],
  ["Bonners Ferry", 0.01],
  ["Harrison", 0.01],
  ["Victor", 0.01],
  ["Swan Valley", 0.01, undefined, "2026-12-31"],
  ["Driggs", 0.005],
  ["Tetonia", 0.005, "2026-01-01"],
];

export const idaho = stateTable("ID", () => ({
  // Covered from 2025, the year the city rates were read.
  stateRates: [{ rate: 0.06, from: "2025-01-01" }],
  locals: RESORT_CITIES.map(([name, rate, from = "2025-01-01", to]) => ({
    name,
    rate,
    from,
    to,
    type: "01" as const,
  })),
  source: "ID resort city ordinances, 2026",
  publications: [
    { url: "https://tax.idaho.gov/taxes/sales-use/sales-tax/local-sales-tax/city-sales-tax/", name: "id-city-sales-tax.html" },
  ],
}));
