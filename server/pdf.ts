import { toMarkdownBytes } from "@firecrawl/anydoc";
import { PDFDocument } from "pdf-lib";
import { LIMITS } from "../shared/contracts.js";
import { RequestError, type ParsedPdf } from "./store.js";

const pdfMagic = Buffer.from("%PDF-");
const maxChunk = 1100;
const overlap = 130;

export function validatePdfBytes(name: string, bytes: Uint8Array) {
  if (bytes.byteLength > LIMITS.bytes) throw new RequestError(413, "Each PDF must be 10 MB or smaller.");
  if (!name.toLowerCase().endsWith(".pdf") || !Buffer.from(bytes.subarray(0, 5)).equals(pdfMagic)) {
    throw new RequestError(422, "Select a valid PDF file.");
  }
}

export async function openPdf(bytes: Uint8Array) {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  } catch {
    throw new RequestError(422, "The PDF is damaged or password protected. Upload a readable PDF.");
  }
  const count = pdf.getPageCount();
  if (!count) throw new RequestError(422, "The PDF must contain at least one page.");
  if (count > LIMITS.pages) throw new RequestError(422, "Each PDF can contain up to 20 pages.");
  return pdf;
}

function split(text: string) {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChunk, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + maxChunk / 2) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export async function parsePdf(pdf: PDFDocument): Promise<ParsedPdf> {
  const chunks: ParsedPdf["chunks"] = [];
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const singlePage = await PDFDocument.create();
    const [page] = await singlePage.copyPages(pdf, [i]);
    singlePage.addPage(page);
    const text = (await toMarkdownBytes(await singlePage.save())).trim();
    if (text.length > 100_000) throw new RequestError(422, "A page contains too much text to index.");
    for (const chunk of split(text)) chunks.push({ page: i + 1, text: chunk });
  }
  if (!chunks.length) throw new RequestError(422, "No readable text found. Upload a text-based PDF or run OCR first.");
  return { pages: pdf.getPageCount(), chunks };
}
