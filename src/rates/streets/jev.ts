/**
 * One Choice question to TypeSafe's Jev, for picking a street when spelling
 * alone can't. Off unless TYPESAFE_API_KEY is set. Any failure (no key, a
 * timeout, an error, an answer that wasn't offered) is no answer: a lookup
 * never fails because Jev did.
 */
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.OPENTAXRATE_JEV_MODEL || "jev-latest";
const TIMEOUT_MS = 3_000;

/** Picks one of a list of options for a line of text, or none. */
export type StreetPicker = typeof jevChoice;

export async function jevChoice(
  state: string,
  instructions: string,
  options: string[],
  none: string,
): Promise<{ choice: string; confidence: number } | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const criteria = Object.fromEntries([...options.map((o) => [o, null]), ["NONE", none]]);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions: { pick: { type: "choice", instructions, criteria } } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      answers?: { pick?: { choice?: unknown; confidence?: unknown } };
    };
    const { choice, confidence } = body.answers?.pick ?? {};
    if (typeof choice !== "string" || typeof confidence !== "number") return null;
    if (choice !== "NONE" && !options.includes(choice)) return null;
    return { choice, confidence };
  } catch {
    return null;
  }
}
