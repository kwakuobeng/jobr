export function verifyResumeQuoteSubstring(
  rawResumeText: string,
  quote: string,
): boolean {
  return quote.trim().length > 0 && rawResumeText.includes(quote);
}
export interface SourceLine {
  id: string;
  text: string;
}
export function mapResumeLines(raw: string): SourceLine[] {
  return raw
    .split(/\r?\n/)
    .map((text, index) => ({
      id: `line_${String(index + 1).padStart(3, "0")}`,
      text,
    }));
}
export function verifyEvidence(
  raw: string,
  evidence: { source_line_ids: string[]; verbatim_quote: string },
): boolean {
  if (
    !verifyResumeQuoteSubstring(raw, evidence.verbatim_quote) ||
    evidence.source_line_ids.length === 0
  )
    return false;
  const lines = mapResumeLines(raw);
  const ids = evidence.source_line_ids;
  const positions = ids.map((id) => lines.findIndex((line) => line.id === id));
  if (positions.some((p, i) => p < 0 || (i > 0 && p !== positions[i - 1]! + 1)))
    return false;
  const block = positions
    .map((p) => lines[p]!.text)
    .join(raw.includes("\r\n") ? "\r\n" : "\n");
  return block.includes(evidence.verbatim_quote);
}
