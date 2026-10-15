import { mapResumeLines } from "@/lib/resume/quote-verifier";
import { SuggestedSkill } from "./model";

/**
 * Inferred ("Suggested") skills: skills a person in a role family very likely has, or that an
 * achievement implies, but that the resume does not state verbatim. They are suggestions only:
 * never added to chips, never used for matching or applications until the user accepts them.
 * Every suggestion carries a one-line reason that quotes the title or line it was inferred from.
 */
interface Family { id: string; label: string; title: RegExp; skills: string[] }
export const ROLE_FAMILIES: Family[] = [
  { id: "ae", label: "account executive", title: /\b(?:account executive|\bAE\b|account director|sales executive|closer)\b/i,
    skills: ["Negotiation", "Closing", "Objection handling", "Account planning", "Sales forecasting", "Executive presentations", "Deal qualification", "Value-based selling"] },
  { id: "sdr", label: "SDR/BDR", title: /\b(?:sales development|business development representative|\bSDR\b|\bBDR\b|inside sales|lead generation)\b/i,
    skills: ["Cold calling", "Email prospecting", "Lead qualification", "Objection handling", "Sales cadences", "Appointment setting", "CRM data hygiene"] },
  { id: "am", label: "account management", title: /\b(?:account manager|customer success|client success|relationship manager)\b/i,
    skills: ["Renewals", "Upselling", "Customer retention", "Account planning", "Executive business reviews", "Churn reduction"] },
  { id: "se", label: "sales engineering", title: /\b(?:sales engineer|solutions? (?:engineer|consultant|architect)|pre-?sales)\b/i,
    skills: ["Technical demos", "Proof of concept management", "Solution design", "RFP responses", "Technical discovery"] },
  { id: "sales_mgmt", label: "sales leadership", title: /\b(?:sales (?:manager|director)|head of sales|vp,? (?:of )?sales|vice president,? (?:of )?sales)\b/i,
    skills: ["Sales coaching", "Team leadership", "Sales forecasting", "Territory planning", "Hiring and onboarding", "Pipeline reviews"] },
  { id: "analyst", label: "data/BI analyst", title: /\b(?:data analyst|business analyst|bi analyst|business intelligence|analytics|reporting analyst|insights analyst|sales analyst)\b/i,
    skills: ["SQL", "Excel", "Data visualization", "Dashboarding", "Data cleaning", "KPI reporting", "Stakeholder reporting", "Statistics"] },
  { id: "revops", label: "RevOps/sales ops", title: /\b(?:revenue operations|revops|rev ops|sales operations|sales ops|gtm operations|business operations)\b/i,
    skills: ["CRM administration", "Sales forecasting", "Pipeline analytics", "Territory planning", "Process automation", "Commission planning", "Data hygiene"] },
  { id: "marketing", label: "marketing", title: /\b(?:marketing (?:manager|specialist|coordinator|analyst)|demand generation|growth marketer|content marketer)\b/i,
    skills: ["Campaign management", "Marketing analytics", "Email marketing", "Lead nurturing", "Content strategy"] },
  { id: "pm", label: "project/program management", title: /\b(?:project manager|program manager|product manager|scrum master)\b/i,
    skills: ["Roadmapping", "Stakeholder management", "Risk management", "Agile", "Prioritization"] },
  { id: "swe", label: "software engineering", title: /\b(?:software engineer|developer|full[- ]stack|front[- ]end|back[- ]end|web engineer)\b/i,
    skills: ["Git", "Code review", "Testing", "APIs", "Debugging"] },
];
/** Achievement cues: a line pattern implies a skill. */
export const ACHIEVEMENT_RULES: Array<{ cue: RegExp; skill: string; why: string }> = [
  { cue: /\b\d{2,3}\s*%\s*(?:of\s+)?(?:quota|attainment)|\bexceeded quota|\bmet or exceeded quota|\b1\d\d%/i, skill: "Quota overachievement", why: "states quota attainment" },
  { cue: /\b(?:closed|generated|sold)\b[^.]*\$\s?\d/i, skill: "Closing", why: "describes closed revenue" },
  { cue: /\bpipeline\b[^.]*\$\s?\d|\$\s?\d[^.]*\bpipeline\b/i, skill: "Pipeline generation", why: "quantifies pipeline built" },
  { cue: /\b(?:C-suite|CFO|CIO|CEO|chief [a-z]+ officer|executive board|finance chiefs)\b/i, skill: "Executive selling", why: "engages executives" },
  { cue: /\b(?:ROI|business case)\b/, skill: "Business case development", why: "builds ROI or business cases" },
  { cue: /\bprocurement\b|\bRFP\b|\bbudget (?:cycle|approval|allocation)/i, skill: "Navigating procurement", why: "works through procurement or budgets" },
  { cue: /\b(?:channel partners?|resellers?|alliances?)\b/i, skill: "Partner selling", why: "works with channel partners" },
  { cue: /\b(?:dashboards?|reports?)\b[^.]*\b(?:built|created|automated|designed)\b|\b(?:built|created|automated|designed)\b[^.]*\b(?:dashboards?|reports?)\b/i, skill: "Dashboarding", why: "builds dashboards or reports" },
  { cue: /\b(?:mentored|coached|trained|onboarded)\b/i, skill: "Coaching", why: "mentors or coaches others" },
  { cue: /\b(?:cold calls?|cold outbound|outbound touches|sequences?|cadences?)\b/i, skill: "Sales cadences", why: "runs outbound sequences" },
  { cue: /\b(?:needs assessments?|discovery)\b/i, skill: "Needs analysis", why: "runs discovery or needs assessments" },
];
export const MAX_SUGGESTIONS = 14; const PER_FAMILY = 4;
const clip = (s: string, n = 70) => { const t = s.replace(/^[\s•·*▪◦‣-]+/, "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

export function inferSkills(raw: string, titles: readonly string[], explicit: readonly string[]): SuggestedSkill[] {
  const taken = new Set(explicit.map((s) => s.toLowerCase()));
  const out: SuggestedSkill[] = [];
  const push = (name: string, reason: string, source: SuggestedSkill["source"]) => {
    const key = name.toLowerCase(); if (taken.has(key) || out.length >= MAX_SUGGESTIONS) return;
    taken.add(key); out.push({ name, reason, source });
  };
  // Achievement cues first (they quote a real line), then role families from detected titles (most recent first).
  const lines = mapResumeLines(raw).filter((l) => l.text.trim());
  for (const rule of ACHIEVEMENT_RULES) { const line = lines.find((l) => rule.cue.test(l.text)); if (line) push(rule.skill, `Your resume ${rule.why}: "${clip(line.text)}".`, "rules"); }
  const used = new Set<string>();
  for (const title of titles) for (const fam of ROLE_FAMILIES) {
    if (used.has(fam.id) || !fam.title.test(title)) continue; used.add(fam.id);
    let added = 0;
    for (const skill of fam.skills) { if (added >= PER_FAMILY) break; const before = out.length; push(skill, `Common for ${fam.label} roles; inferred from your title "${clip(title, 60)}".`, "rules"); if (out.length > before) added++; }
  }
  return out;
}
/** Merge model-inferred suggestions after rules, de-duplicated against explicit skills and existing suggestions. */
export function mergeSuggestions(base: SuggestedSkill[], extra: SuggestedSkill[], explicit: readonly string[], limit = MAX_SUGGESTIONS + 6): SuggestedSkill[] {
  const seen = new Set([...explicit, ...base.map((s) => s.name)].map((s) => s.toLowerCase()));
  const out = [...base];
  for (const s of extra) { const k = s.name.toLowerCase(); if (!seen.has(k) && out.length < limit) { seen.add(k); out.push(s); } }
  return out;
}
