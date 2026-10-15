import { mapResumeLines, verifyEvidence } from "@/lib/resume/quote-verifier";
import { validateResumeExtraction } from "@/lib/resume/structured-parser";
import { Chips } from "./model";

/** Canonical skill name -> extra aliases (all matched case-insensitively on word boundaries). */
const LEXICON: Record<string, string[]> = {
  // Sales / CRM tooling
  Salesforce: ["SFDC", "Sales Cloud"], HubSpot: [], Outreach: ["Outreach.io"], Salesloft: ["Sales Loft"], Gong: ["Gong.io"],
  ZoomInfo: ["Zoom Info"], "LinkedIn Sales Navigator": ["Sales Navigator"], Clari: [], Apollo: ["Apollo.io"], Seamless: ["Seamless.AI"],
  "Microsoft Dynamics": ["Dynamics 365"], Pipedrive: [], Chorus: ["Chorus.ai"], Highspot: [], Seismic: [], DocuSign: [], Marketo: [], Pardot: [], Zendesk: [], Gainsight: [], CPQ: [],
  // Sales methodology / motion
  MEDDIC: [], MEDDPICC: ["MEDDICC"], "Challenger Sale": ["Challenger"], "SPIN Selling": ["SPIN"], "Sandler": [], "Solution Selling": [], "Value Selling": [], "Command of the Message": [],
  Forecasting: ["forecast", "forecasts"], "Pipeline management": ["pipeline development", "pipeline generation", "pipeline building", "built pipeline"],
  "Quota attainment": ["quota"], Prospecting: ["prospected", "outbound prospecting"], "Cold calling": ["cold calls", "cold call"], "Outbound sales": ["outbound"],
  "Full-cycle sales": ["full-cycle", "full cycle", "full sales cycle", "full sales cycles"], "New logo acquisition": ["new logo", "net-new"], "Enterprise sales": ["enterprise B2B sales", "enterprise sales"],
  "B2B SaaS": ["SaaS"], "SLED / public sector sales": ["SLED", "public sector"], "Channel partnerships": ["channel partners", "channel sales"], "Territory planning": ["territory"],
  Negotiation: ["negotiated", "negotiating"], "Account management": ["account manager", "managed accounts"], "Contract negotiation": [], "Discovery": [], "Product demos": ["demos", "demo"],
  "Business case / ROI modeling": ["ROI", "business case"], "Stakeholder management": ["multi-stakeholder", "C-suite", "executive engagement"], "Social selling": [], "Lead qualification": ["sales-qualified", "SQL pipeline", "qualified opportunities"],
  "Customer success": [], "Upselling": ["upsell", "cross-sell"], Procurement: [], RFP: ["RFPs"],
  // Data / analytics
  SQL: [], Excel: ["Microsoft Excel", "MS Excel"], "Google Sheets": [], Tableau: [], "Power BI": ["PowerBI"], Looker: [], "Looker Studio": ["Data Studio"], Python: [], R: [],
  Snowflake: [], dbt: [], BigQuery: [], Redshift: [], PostgreSQL: ["Postgres"], MySQL: [], Pandas: [], "Data analysis": ["data analytics", "analytics"], "Data visualization": ["dashboards", "dashboard"],
  "Financial modeling": [], "A/B testing": [], Statistics: ["statistical"], ETL: [], "Revenue operations": ["RevOps", "Rev Ops", "sales operations", "Sales Ops"], "Business intelligence": ["BI"], Economics: [],
  // Tech
  JavaScript: [], TypeScript: [], "Next.js": ["NextJS"], React: [], "Node.js": ["NodeJS"], Supabase: [], Cloudflare: ["Cloudflare Workers"], Java: [], "C++": [], "C#": [], Go: ["Golang"], Rust: [],
  HTML: [], CSS: [], Tailwind: ["Tailwind CSS"], AWS: [], Azure: [], GCP: ["Google Cloud"], Docker: [], Kubernetes: [], Terraform: [], Git: ["GitHub"], Linux: [], Figma: [], Jira: [], Zapier: [],
  Cybersecurity: ["cyber security", "security software"], "Healthcare": ["healthcare"],
  // General
  "Project management": [], "Customer service": [], Communication: [], Leadership: [], Presentations: ["presentation", "presentations"], "Cross-functional collaboration": ["cross-functional"], Mentoring: ["mentored"],
};
// Short or ambiguous tokens that must keep exact case to avoid false positives ("r", "go", "spin", "bi").
const CASE_SENSITIVE = new Set(["R", "Go", "SPIN", "BI", "ROI", "SLED", "SQL", "RFP", "RFPs", "ETL", "CPQ", "demo", "territory"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED = Object.entries(LEXICON).map(([name, aliases]) => ({
  name,
  patterns: [name, ...aliases].map((term) => new RegExp(`(?<![A-Za-z0-9])${esc(term)}(?![A-Za-z0-9+#])`, CASE_SENSITIVE.has(term) ? "" : "i")),
}));

const TITLE_CORE = String.raw`(?:account executive|account manager|account director|\bAE\b|\bSDR\b|\bBDR\b|sales development representative|business development (?:representative|manager|executive)|inside sales representative|sales representative|sales manager|sales director|sales engineer|solutions? (?:engineer|consultant|architect)|customer success manager|revenue operations(?: manager| analyst)?|\bRevOps\b(?: manager| analyst)?|sales operations(?: manager| analyst)?|(?:data|business|sales|financial|bi|business intelligence|operations|marketing|research|product) analyst|analyst|analytics engineer|data scientist|data engineer|software engineer|engineer|developer|consultant|founder|co-founder|owner|president|vice president|\bVP\b|director|head of [a-z]+|manager|specialist|coordinator|designer|administrator|associate|representative|executive|strategist|recruiter|intern)`;
const TITLE_RE = new RegExp(`${TITLE_CORE}`, "i");
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = `(?:(?:${MONTHS})\\.?\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(present|current|now|today|${DATE})`, "i");
const SECTION_RE = /^(?:professional\s+|work\s+|relevant\s+)?(experience|employment(?: history)?|work history|education|skills|core skills|technical skills|summary|profile|certifications?|projects|awards|volunteer(?:ing)?|interests|references)\s*:?\s*$/i;
const SENTENCE_RE = /\b(?:with|against|across|for|and|the|of|in|at|to|by)\b.*\b(?:with|against|across|for|the|of|in|at|to|by)\b/i;

function toIso(token: string, end: boolean, reference: string): string | null {
  const t = token.trim().toLowerCase();
  if (/^(present|current|now|today)$/.test(t)) return reference.slice(0, 7) + "-01";
  let m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1]!.padStart(2, "0")}-01` : null;
  m = /^(\d{4})$/.exec(t);
  if (m) return `${m[1]}-${end ? "12" : "01"}-01`;
  m = /^([a-z]+)\.?\s+(\d{4})$/.exec(t);
  if (!m) return null;
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]!.slice(0, 3));
  return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, "0")}-01`;
}

function cleanTitle(text: string): string | null {
  let t = text.replace(RANGE_RE, " ").replace(/^[\s•·*\-–]+/, "").trim();
  // Role lines are often "Title | Company" or "Company | Title"; keep the segment containing a title word.
  const parts = t.split(/\s*[|•·,]\s*|\s{3,}|\s+[-–—]\s+|\s+at\s+/).map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) => TITLE_RE.test(p) && p.split(/\s+/).length <= 7);
  if (!hit) return null;
  if (/\.\s*$/.test(text) && !RANGE_RE.test(text)) return null; // prose continuation, not a role line
  t = hit.replace(/[\s.:;]+$/, "");
  const last = t.split(/\s+/).pop() ?? "";
  if (/s$/i.test(last) && !/^(?:sales|operations|analytics|success|ops|logistics|services|relations|systems)$/i.test(last)) return null; // plural = prose
  if (t.length < 3 || t.length > 80 || /https?:|@|\d{3}/.test(t) || SENTENCE_RE.test(t) || /^(?:and|with|for|the)\b/i.test(t)) return null;
  // Require title-like casing: most words capitalised (role lines, not prose).
  const words = t.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(?:of|and|&|the|for|in)$/i.test(w));
  if (!words.length || words.filter((w) => /^[A-Z]/.test(w)).length / words.length < 0.75) return null;
  return t;
}

export interface HeuristicResult {
  parser: string;
  chips: ReturnType<typeof Chips.parse>;
  years_source: "explicit" | "computed" | null;
  explicit_years: number | null;
  computed_years: number | null;
  extraction: ReturnType<typeof validateResumeExtraction>;
}

export function suggestChips(raw: string, referenceDate = new Date().toISOString().slice(0, 10)): HeuristicResult {
  const lines = mapResumeLines(raw);
  const evidence = (line: { id: string; text: string }) => ({ source_line_ids: [line.id], verbatim_quote: line.text, evidence_type: "explicit" as const });
  const usable = lines.filter((l) => l.text.trim().length > 0);

  const extracted = COMPILED.flatMap(({ name, patterns }) => {
    const line = usable.find((entry) => patterns.some((p) => p.test(entry.text)));
    return line ? [{ id: name.toLowerCase().replace(/[^a-z0-9+#]+/g, "-"), name, evidence: evidence(line) }] : [];
  });

  // Walk sections so education dates are not counted as work experience.
  let section = "";
  const titles: string[] = []; const seenTitles = new Set<string>();
  const work: Array<{ id: string; employer: string; title: string; start_date: string; end_date: string | null; is_current: boolean; is_internship: boolean; evidence: ReturnType<typeof evidence> }> = [];
  usable.forEach((line, i) => {
    const text = line.text.trim();
    const header = SECTION_RE.exec(text);
    if (header) { section = header[1]!.toLowerCase(); return; }
    const isBullet = /^[•·*▪◦‣-]/.test(text);
    const range = RANGE_RE.exec(text);
    // Title candidates: the headline under the name, role lines (with dates), or short lines in experience.
    const candidate = !isBullet && !section.startsWith("education") && !section.includes("skill") && (range || i < 3 || section === "experience" || section.startsWith("employment") || section === "work history") ? cleanTitle(text) : null;
    if (candidate && !seenTitles.has(candidate.toLowerCase()) && titles.length < 20) { seenTitles.add(candidate.toLowerCase()); titles.push(candidate); }
    if (range && !section.startsWith("education") && !isBullet) {
      const start = toIso(range[1]!, false, referenceDate); const current = /^(present|current|now|today)$/i.test(range[2]!.trim());
      const end = current ? null : toIso(range[2]!, true, referenceDate);
      const refMonth = referenceDate.slice(0, 7) + "-01";
      if (start && (current || end) && start <= (end ?? refMonth) && (end ?? refMonth) <= refMonth) {
        const prev = usable[i - 1]?.text.trim() ?? ""; const next = usable[i + 1]?.text.trim() ?? "";
        const title = candidate ?? cleanTitle(prev) ?? "";
        const employerLine = [next, prev].find((l) => l && !RANGE_RE.test(l) && !/^[•·*-]/.test(l) && !cleanTitle(l) && l.length <= 80) ?? "";
        work.push({ id: `work_${work.length + 1}`, employer: employerLine.split(/\s*\|\s*/)[0]!.trim(), title, start_date: start, end_date: end, is_current: current, is_internship: /\bintern(ship)?\b/i.test(text + " " + title), evidence: evidence(line) });
      }
    }
  });

  const extraction = validateResumeExtraction({ work_experiences: work, education: [], certifications: [], extracted_skills: extracted, accomplishments: [] }, raw, referenceDate);
  const explicit = [...raw.matchAll(/\b(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+[A-Za-z0-9&/-]+){0,4}?\s+(?:experience|expertise)\b/gi)]
    .map((m) => Number(m[1])).filter((v) => v > 0 && v <= 80);
  const explicitYears = explicit.length ? Math.max(...explicit) : null;
  const months = extraction.experience.totalProfessionalMonths;
  const computedYears = work.length && months > 0 ? Math.min(80, Math.round((months / 12) * 10) / 10) : null;
  const years = explicitYears ?? computedYears;
  return {
    parser: "local-v2",
    chips: Chips.parse({ skills: extraction.extracted_skills.map((s) => s.name).slice(0, 100), titles, years }),
    years_source: explicitYears !== null ? "explicit" : computedYears !== null ? "computed" : null,
    explicit_years: explicitYears,
    computed_years: computedYears,
    extraction,
  };
}

/** Merge model-proposed items (already individually evidence-checked) into heuristic chips. */
export function mergeChips(base: HeuristicResult, ai: { skills: string[]; titles: string[] }) {
  const dedupe = (values: string[], limit: number) => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const v of values.map((x) => x.trim()).filter((x) => x && x.length <= 80)) { const k = v.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } }
    return out.slice(0, limit);
  };
  return Chips.parse({ skills: dedupe([...base.chips.skills, ...ai.skills], 100), titles: dedupe([...base.chips.titles, ...ai.titles], 20), years: base.chips.years });
}
export { verifyEvidence };
