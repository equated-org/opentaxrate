/** Provenance and namespaces shared by polygon indexing and lookup. */
export const RANGE_POLYGON_SOURCES = {
  MO: {
    layer: "https://services2.arcgis.com/kNS2ppBA4rwAQQZy/ArcGIS/rest/services/MO_Sales_Tax_Boundaries/FeatureServer/0",
    // MSDIS explicitly discontinued this distribution. Retain its snapshot
    // date in every resulting source citation; it is not a current rate file.
    file: "MO tax polygons (MSDIS archive 2023-05-11)",
    from: "2023-05-11",
  },
  UT: {
    layer: "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/SalesTaxAreas/FeatureServer/0",
    file: "UT tax zones (UGRC/USTC snapshot 2026-02-26)",
    from: "2026-02-26",
  },
} as const;

export type RangePolygonState = keyof typeof RANGE_POLYGON_SOURCES;

/** Prefixes keep tax-specific outlines apart from Census city/county codes. */
export const rangePolygonPrefix = (state: string) => `rp:${state}:`;

