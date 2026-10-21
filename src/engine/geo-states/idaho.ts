/**
 * Idaho: 6% state, plus the resort cities that tax general retail sales,
 * from each city's own ordinance (the Tax Commission lists the cities but
 * not their rates; the cities collect). Exemptions for groceries, vehicles
 * or large items vary by city and are the caller's to apply. Cities whose
 * tax is on lodging, food or drink only are left out.
 */
import { stateTable } from "./tables.js";

const RESORT_CITIES: Array<[string, number, string?]> = [
  ["Ketchum", 0.02],
  ["Sun Valley", 0.03],
  ["Stanley", 0.025],
  ["Lava Hot Springs", 0.02],
  ["McCall", 0.01],
  ["Cascade", 0.01, "2026-12-31"],
  ["Donnelly", 0.01],
  ["Riggins", 0.01],
  ["Ponderay", 0.01],
  ["Bonners Ferry", 0.01],
  ["Harrison", 0.01],
  ["Victor", 0.01],
  ["Swan Valley", 0.01],
  ["Driggs", 0.005],
  ["Tetonia", 0.005],
];

export const idaho = stateTable("ID", () => ({
  // Covered from 2025, the year the city rates were read.
  stateRates: [{ rate: 0.06, from: "2025-01-01" }],
  locals: RESORT_CITIES.map(([name, rate, to]) => ({
    name,
    rate,
    from: "2025-01-01",
    to,
    type: "01" as const,
  })),
  source: "ID resort city ordinances, 2026",
}));
