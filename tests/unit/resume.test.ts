import { describe, it, expect, vi } from "vitest";
import {
  calculateNonOverlappingExperience,
  toMonthIndex,
} from "@/lib/resume/experience-calculator";
import {
  mapResumeLines,
  verifyResumeQuoteSubstring,
  verifyEvidence,
} from "@/lib/resume/quote-verifier";
const interval = (
  start: string,
  end: string | null,
  current = false,
  internship = false,
) => ({
  id: "role",
  startDate: start,
  endDate: end,
  isCurrent: current,
  isInternship: internship,
});
const calc = (intervals: ReturnType<typeof interval>[]) =>
  calculateNonOverlappingExperience(intervals, "2026-10-14");
describe("resume calendar and exact provenance", () => {
  it.each([
    "garbage",
    "2020-02-30",
    "2021-02-29",
    "2020-00-01",
    "2020-13-01",
    "2020-01-00",
    "2020-01-32",
    "2020-1-01",
    "2020-01-01 trailing",
    "2020-01",
  ])("rejects invalid ISO date %s", (date) =>
    expect(() => toMonthIndex(date)).toThrow(),
  );
  it("accepts leap days", () =>
    expect(toMonthIndex("2020-02-29")).toBe(2020 * 12 + 1));
  it("rejects reversed dates and future experience", () => {
    expect(() => calc([interval("2020-06-01", "2020-01-01")])).toThrow(
      "Reversed",
    );
    expect(() => calc([interval("2030-01-01", null)])).toThrow("Reversed");
    expect(() => calc([interval("2020-01-01", "2030-01-01")])).toThrow(
      "Future",
    );
  });
  it("supports current UTC date default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    expect(
      calculateNonOverlappingExperience([interval("2026-10-01", null)])
        .totalProfessionalMonths,
    ).toBe(1);
    vi.useRealTimers();
  });
  it("handles same-month positions", () =>
    expect(
      calc([interval("2020-01-01", "2020-01-31")]).totalProfessionalMonths,
    ).toBe(1));
  it("merges simultaneous internships independently", () =>
    expect(
      calc([
        interval("2020-01-01", "2020-06-01", false, true),
        interval("2020-04-01", "2020-12-01", false, true),
      ]).totalInternshipMonths,
    ).toBe(12));
  it("never counts gaps or mutates input", () => {
    const input = [
      interval("2020-01-01", "2020-02-01"),
      interval("2021-01-01", "2021-02-01"),
    ];
    const before = JSON.stringify(input);
    expect(calc(input).totalProfessionalMonths).toBe(4);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("exact substring preserves whitespace, case, and punctuation", () => {
    expect(
      verifyResumeQuoteSubstring("Built  APIs\nwith Go.", "APIs\nwith Go."),
    ).toBe(true);
    expect(verifyResumeQuoteSubstring("Built  APIs", "Built APIs")).toBe(false);
    expect(verifyResumeQuoteSubstring("Built APIs", "built APIs")).toBe(false);
    expect(verifyResumeQuoteSubstring("Built APIs", "APIs.")).toBe(false);
    expect(verifyResumeQuoteSubstring("Built APIs", "")).toBe(false);
  });
  it("maps stable line IDs and verifies contiguous source lines", () => {
    const raw = "Built APIs\nwith Go\nand SQL";
    expect(mapResumeLines(raw)[0]?.id).toBe("line_001");
    expect(
      verifyEvidence(raw, {
        source_line_ids: ["line_001", "line_002"],
        verbatim_quote: "APIs\nwith Go",
      }),
    ).toBe(true);
    expect(
      verifyEvidence(raw, {
        source_line_ids: ["line_003"],
        verbatim_quote: "Built APIs",
      }),
    ).toBe(false);
  });
  it("rejects unknown, empty, duplicate or discontiguous evidence lines", () => {
    const raw = "one\ntwo\nthree";
    for (const ids of [
      [],
      ["line_999"],
      ["line_001", "line_003"],
      ["line_001", "line_001"],
      ["line_002", "line_001"],
    ])
      expect(
        verifyEvidence(raw, { source_line_ids: ids, verbatim_quote: "one" }),
      ).toBe(false);
    expect(
      verifyEvidence(raw, {
        source_line_ids: ["line_001"],
        verbatim_quote: "invented",
      }),
    ).toBe(false);
  });
  it("preserves CRLF exact quotes", () =>
    expect(
      verifyEvidence("one\r\ntwo", {
        source_line_ids: ["line_001", "line_002"],
        verbatim_quote: "one\r\ntwo",
      }),
    ).toBe(true));
});
