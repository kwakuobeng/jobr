import { locationTextParts } from "./workplace-badge";
/**
 * Job location → country classification. Single source of truth for the Matches region filter:
 * ingestion and the backfill store the result in canonical_jobs.region/country_codes (0009), the
 * match RPC filters on it before the top-N cut, and the API uses it for display.
 */
export type JobRegion = "us" | "non_us" | "unknown";
const US_STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const US_STATE_SET = new Set(US_STATE_CODES.split("|"));
const US_STATE_NAMES = "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
// Major US metros that ATS boards commonly list without a state ("San Francisco Office", "Seattle").
const US_CITIES = "san francisco|sf bay area|bay area|silicon valley|seattle|new york city|nyc|manhattan|brooklyn|austin|boston|chicago|los angeles|san diego|san jose|palo alto|mountain view|menlo park|sunnyvale|redwood city|oakland|denver|boulder|atlanta|miami|dallas|houston|phoenix|philadelphia|pittsburgh|portland|salt lake city|minneapolis|detroit|nashville|raleigh|durham|charlotte|columbus|cincinnati|cleveland|indianapolis|kansas city|st\\.? louis|las vegas|baltimore|arlington|reston|mclean|tampa|orlando|jacksonville|san antonio|plano|irving|frisco|scottsdale|tempe|bellevue|redmond|kirkland|cambridge, ma|somerville|stamford|jersey city|hoboken|newark|princeton|ann arbor|madison|milwaukee|omaha|boise|honolulu|anchorage|sacramento|irvine|santa monica|santa clara|washington,? d\\.?c\\.?";
const US_CI_RE = new RegExp(`(?<![a-z])(?:united states(?: of america)?|usa|u\\.s\\.(?:a\\.)?|${US_STATE_NAMES}|${US_CITIES})(?![a-z])`, "i");
// Case-sensitive codes: "US", ", TX", "TX" alone, and "Remote NY" / "Remote - CA" / "Remote (WA)".
const US_CS_RE = new RegExp(`\\bUS\\b|,\\s*(?:${US_STATE_CODES})\\b|^(?:${US_STATE_CODES})$|\\bRemote\\s*[-–—,:(]?\\s*(?:${US_STATE_CODES})\\b`);
const NON_US_RE = /\b(?:canada|united kingdom|uk|great britain|england|scotland|wales|ireland|germany|deutschland|france|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|iceland|poland|czech(?:ia| republic)?|romania|hungary|greece|turkey|türkiye|israel|uae|united arab emirates|saudi arabia|egypt|nigeria|kenya|ghana|south africa|india|pakistan|bangladesh|singapore|malaysia|indonesia|philippines|vietnam|thailand|japan|korea|china|hong kong|taiwan|australia|new zealand|brazil|argentina|chile|colombia|peru|mexico|costa rica|emea|apac|latam|europe|asia|toronto|vancouver|montreal|london|berlin|munich|dublin|paris|amsterdam|stockholm|madrid|barcelona|lisbon|warsaw|zurich|tel aviv|bangalore|bengaluru|sydney|melbourne|tokyo|seoul|são paulo|sao paulo|beijing|shanghai|istanbul|makati|manila|jakarta|delhi|mumbai|milan|prague|dubai|johannesburg|buenos aires|ho chi minh|adelaide|brisbane|perth|auckland)\b/i;
// ISO 3166-1 alpha-2 codes seen as a trailing ", xx" token (ATS feeds often use lowercase: "Austin, us", "Beijing, cn").
const ISO2 = new Set("ad ae af ag ar at au az ba bd be bg bh bo br by ca ch cl cn co cr cy cz de dk do dz ec ee eg es fi fr gb ge gh gr gt hk hn hr hu id ie il in iq is it jm jo jp ke kh kr kw kz lb lk lt lu lv ma md me mk mt mu mx my ng ni nl no np nz om pa pe ph pk pl pr pt py qa ro rs ru sa se sg si sk sn sv th tn tr tt tw ua ug uk us uy uz ve vn za zm zw".split(" "));
const isoCountry = (code: string) => (code === "uk" ? "GB" : code.toUpperCase());
/** Country for one location string: "US", another ISO code, "XX" (non-US, country unknown), or null. */
export function classifyLocation(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  const trailing = /,\s*([A-Za-z]{2})\s*$/.exec(value)?.[1];
  if (trailing) {
    // Uppercase US state codes ("Dallas, TX", "San Francisco, CA") are states, not countries.
    if (trailing === trailing.toUpperCase() && US_STATE_SET.has(trailing)) return "US";
    const lower = trailing.toLowerCase();
    if (ISO2.has(lower)) return isoCountry(lower);
  }
  if (US_CS_RE.test(value) || US_CI_RE.test(value.replace(/\s+office$/i, ""))) return "US";
  if (NON_US_RE.test(value)) return "XX";
  return null;
}
export interface RegionInfo { region: JobRegion; country_codes: string[] }
export function classifyLocations(parts: readonly string[]): RegionInfo {
  const codes = new Set<string>();
  for (const part of parts) { const code = classifyLocation(part); if (code) codes.add(code); }
  const country_codes = [...codes].sort();
  const region: JobRegion = codes.has("US") ? "us" : codes.size ? "non_us" : "unknown";
  return { region, country_codes };
}
/** Region from stored location text. Remote roles count by stated region ("Remote - US" = US, "Remote - Sweden" = Non-US). */
export function jobRegion(row: { locations_json?: unknown; location_label?: string | null; region?: string | null }): JobRegion {
  if (row.region === "us" || row.region === "non_us") return row.region; // stored by ingestion/backfill (0009)
  const parts = [...locationTextParts(row.locations_json), ...(row.location_label ? [row.location_label] : [])];
  return classifyLocations(parts).region;
}
/** "US or Remote only": US-located roles, plus Remote roles that do not state a non-US region. */
export function usOrRemote(row: { workplace_type?: string | null; locations_json?: unknown; location_label?: string | null }): boolean {
  const region = jobRegion(row);
  return region === "us" || ((row.workplace_type ?? "").toLowerCase() === "remote" && region === "unknown");
}
