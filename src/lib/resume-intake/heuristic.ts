import { mapResumeLines } from "@/lib/resume/quote-verifier";
import { validateResumeExtraction } from "@/lib/resume/structured-parser";
import { Chips } from "./model";
const skills = ["JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust", "SQL", "PostgreSQL", "MySQL", "React", "Next.js", "Node.js", "HTML", "CSS", "Tailwind", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Git", "Linux", "Excel", "Salesforce", "Figma", "Tableau", "Power BI", "Project management", "Customer service", "Communication", "Leadership"];
export function suggestChips(raw: string, referenceDate = new Date().toISOString().slice(0, 10)) {
  const lines = mapResumeLines(raw);
  const extracted = skills.flatMap((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
    const line = lines.find((entry) => pattern.test(entry.text));
    if (!line) return [];
    return [{ id: name.toLowerCase(), name, evidence: { source_line_ids: [line.id], verbatim_quote: line.text, evidence_type: "explicit" as const } }];
  });
  const extraction = validateResumeExtraction({ work_experiences: [], education: [], certifications: [], extracted_skills: extracted, accomplishments: [] }, raw, referenceDate);
  const titles = [...new Set(lines.map((line) => line.text.trim()).filter((line) => line.length <= 120 && /\b(engineer|developer|designer|manager|analyst|specialist|director|consultant|coordinator|scientist|administrator|nurse|technician)\b/i.test(line) && !/https?:|@/.test(line)))].slice(0, 20);
  const years = [...raw.matchAll(/\b(\d{1,2}(?:\.\d)?)\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?experience\b/gi)].map((match) => Number(match[1])).filter((value) => value <= 80);
  return { parser: "local-v1", chips: Chips.parse({ skills: extraction.extracted_skills.map((skill) => skill.name), titles, years: years.length ? Math.max(...years) : null }), extraction };
}
