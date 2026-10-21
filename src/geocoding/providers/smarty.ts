import { matchesAddress } from "../address.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function smartyPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://us-street.api.smarty.com/street-address");
  url.search = new URLSearchParams({ "auth-id": process.env.SMARTY_AUTH_ID!, "auth-token": process.env.SMARTY_AUTH_TOKEN!,
    street: a.street, city: a.city, state: a.state, zipcode: a.zip ?? "", candidates: "2", match: "strict" }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body)) throw new GeocoderError();
  const matches = body.flatMap((r: any): SourcedPoint[] => {
    const c = r.components ?? {}, m = r.metadata ?? {};
    const accuracy = ({ Rooftop: "rooftop", Parcel: "parcel" } as const)[m.precision as string];
    if (!accuracy || !["Y", "S", "D"].includes(r.analysis?.dpv_match_code) || !matchesAddress(a, {
      house: c.primary_number, street: [c.street_predirection, c.street_name, c.street_suffix, c.street_postdirection].filter(Boolean).join(" "),
      city: c.city_name, state: c.state_abbreviation, zip: c.zipcode, country: "US",
    })) return [];
    return [{ provider: "smarty", source: "smarty", accuracy, lon: m.longitude, lat: m.latitude }];
  });
  return matches.length === 1 ? matches[0] : null;
}
