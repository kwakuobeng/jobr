import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { getDocumentProxy } from "unpdf";
import { PDF } from "./model";
export const MAX_TEXT_CHARS = 500_000;
const MAX_XML_BYTES = 2 * 1024 * 1024;
export function docxText(bytes: Uint8Array): string {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("The file is not a valid DOCX archive.");
  const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" && file.originalSize <= MAX_XML_BYTES });
  const document = files["word/document.xml"];
  if (!document || document.length > MAX_XML_BYTES) throw new Error("DOCX document is missing or exceeds the extraction limit.");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Unsupported or invalid DOCX XML.");
  const tree: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, parseTagValue: false }).parse(xml);
  function text(node: unknown): string {
    if (Array.isArray(node)) return node.map(text).join("");
    if (!node || typeof node !== "object") return "";
    return Object.entries(node).map(([key, value]) => {
      if (key === "#text") return typeof value === "string" ? value : "";
      if (key === "w:tab") return "\t";
      if (key === "w:br" || key === "w:cr") return "\n";
      return text(value) + (key === "w:p" ? "\n" : "");
    }).join("");
  }
  return text(tree);
}
export async function extractResumeText(bytes: Uint8Array, mime: string) {
  let raw: string;
  if (mime === PDF) {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The file is not a valid PDF.");
    const document = await getDocumentProxy(bytes, { useSystemFonts: false, disableFontFace: true, maxImageSize: 0, verbosity: 0 });
    try {
      if (document.numPages > 50) throw new Error("Resume PDFs are limited to 50 pages.");
      const pages: string[] = []; let length = 0;
      for (let index = 1; index <= document.numPages; index++) {
        const page = await document.getPage(index);
        const content = await page.getTextContent();
        const value = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
        length += value.length;
        if (length > MAX_TEXT_CHARS) throw new Error("Resume text exceeds the extraction limit.");
        pages.push(value); page.cleanup();
      }
      raw = pages.join("\n");
    } finally { await document.loadingTask.destroy(); }
  } else { raw = docxText(bytes); }
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("No text found. Use a text-based PDF or DOCX; scanned images require OCR, which is not supported.");
  if (normalized.length > MAX_TEXT_CHARS) throw new Error("Resume text exceeds the extraction limit.");
  return normalized;
}
