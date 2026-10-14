import {
  ApplicationPrepSchema,
  MatchExplanationSchema,
  ResumeExtractionSchema,
  type EvidenceSchema,
} from "../../../specs/ai/structured_schemas";
import { verifyEvidence } from "./quote-verifier";
import { calculateNonOverlappingExperience } from "./experience-calculator";
import type { z } from "zod";
const noLinks = (text: string) =>
  !/(?:https?:|www\.|javascript:|data:|\]\s*\()/i.test(text);
function assertEvidence(
  raw: string,
  evidence: z.infer<typeof EvidenceSchema>[],
  requireExplicit = false,
) {
  if (
    !evidence.length ||
    evidence.some(
      (e) =>
        !verifyEvidence(raw, e) ||
        (requireExplicit && e.evidence_type !== "explicit"),
    )
  )
    throw new Error("Ungrounded evidence");
}
export function validateResumeExtraction(
  value: unknown,
  raw: string,
  referenceDate: string,
) {
  const result = ResumeExtractionSchema.parse(value);
  for (const item of [
    ...result.work_experiences,
    ...result.education,
    ...result.certifications,
    ...result.extracted_skills,
  ])
    assertEvidence(raw, [item.evidence]);
  for (const item of result.accomplishments) assertEvidence(raw, item.evidence);
  const experience = calculateNonOverlappingExperience(
    result.work_experiences.map((i) => ({
      id: i.id,
      startDate: i.start_date,
      endDate: i.end_date,
      isCurrent: i.is_current,
      isInternship: i.is_internship,
    })),
    referenceDate,
  );
  return { ...result, experience };
}
export function validateMatchExplanation(
  value: unknown,
  raw: string,
  allowedJobIds: readonly string[],
  explicitSkillIds: readonly string[],
) {
  const result = MatchExplanationSchema.parse(value);
  const seen = new Set<string>();
  for (const item of result.explanations) {
    if (
      !allowedJobIds.includes(item.canonical_job_id) ||
      seen.has(item.canonical_job_id)
    )
      throw new Error("Unexpected or duplicate job");
    seen.add(item.canonical_job_id);
    if (item.cited_skill_ids.some((id) => !explicitSkillIds.includes(id)))
      throw new Error("Invented skill");
    for (const strength of item.why_it_matches) {
      assertEvidence(raw, strength.evidence, true);
      if (!noLinks(strength.text)) throw new Error("Outbound link");
    }
    if (item.potential_concerns.some((text) => !noLinks(text)))
      throw new Error("Outbound link");
  }
  return result;
}
export function validateApplicationPreparation(
  value: unknown,
  raw: string,
  questionIds: readonly string[],
) {
  const result = ApplicationPrepSchema.parse(value);
  for (const paragraph of [
    ...result.cover_letter_paragraphs,
    ...result.resume_bullets,
  ]) {
    assertEvidence(raw, paragraph.evidence, true);
    if (!noLinks(paragraph.text)) throw new Error("Outbound link");
  }
  const seen = new Set<string>();
  for (const item of result.screening_answers) {
    if (!questionIds.includes(item.question_id) || seen.has(item.question_id))
      throw new Error("Unexpected or duplicate question");
    seen.add(item.question_id);
    if (item.answer === null || item.answer.trim() === "") {
      item.answer = null;
      item.requires_user_input = true;
      item.evidence = [];
    } else {
      if (!noLinks(item.answer)) throw new Error("Outbound link");
      if (
        !item.evidence.length ||
        item.evidence.some(
          (e) => e.evidence_type !== "explicit" || !verifyEvidence(raw, e),
        )
      ) {
        item.answer = null;
        item.requires_user_input = true;
        item.evidence = [];
      }
    }
  }
  for (const id of questionIds)
    if (!seen.has(id))
      result.screening_answers.push({
        question_id: id,
        answer: null,
        requires_user_input: true,
        evidence: [],
      });
  return result;
}
