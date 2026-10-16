import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth/mammoth.browser.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

export type DocumentSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

export type ExportDocument = {
  title: string;
  subtitle?: string;
  sections: DocumentSection[];
  footer?: string;
};

export type CandidateDocumentFormat = "pdf" | "docx" | "txt";
export type DocumentExportFormat = "html" | "pdf" | "docx";

export type CandidateDocumentExtraction = {
  format: CandidateDocumentFormat;
  text: string;
  parseStatus: "ready" | "needs-review";
  pageCount?: number;
};

const MAX_EXTRACTED_TEXT_LENGTH = 200_000;
const MAX_PDF_PAGES = 80;

export function detectCandidateDocumentFormat(filename: string, input: Uint8Array | ArrayBuffer): CandidateDocumentFormat {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (extension !== ".pdf" && extension !== ".docx" && extension !== ".txt") {
    throw new Error("Only PDF, DOCX and TXT documents are supported.");
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (extension === ".pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The file contents do not match a PDF document.");
  }
  if (extension === ".docx" && !(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new Error("The file contents do not match a DOCX document.");
  }
  if (extension === ".txt" && bytes.includes(0)) {
    throw new Error("The file contents do not look like a UTF-8 text document.");
  }
  return extension.slice(1) as CandidateDocumentFormat;
}

function cleanExtractedText(value: string): string {
  return value.replaceAll("\u0000", "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function extractCandidateDocumentText(input: Uint8Array | ArrayBuffer, filename: string): Promise<CandidateDocumentExtraction> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = detectCandidateDocumentFormat(filename, bytes);
  let text = "";
  let pageCount: number | undefined;

  if (format === "txt") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (format === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: exactArrayBuffer(bytes) });
    text = result.value;
  } else {
    // PDF.js may transfer its input buffer while parsing, so isolate the parser
    // from the upload buffer that the route will store in R2 afterward.
    const document = await getDocumentProxy(bytes.slice());
    pageCount = document.numPages;
    if (pageCount > MAX_PDF_PAGES) throw new Error(`PDF documents must have ${MAX_PDF_PAGES} pages or fewer for automatic extraction.`);
    const result = await extractText(document, { mergePages: true });
    text = result.text;
  }

  const cleanText = cleanExtractedText(text);
  return { format, text: cleanText, parseStatus: cleanText ? "ready" : "needs-review", ...(pageCount === undefined ? {} : { pageCount }) };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function buildPrintableDocumentHtml(input: ExportDocument): string {
  const sections = input.sections.map((section) => {
    const paragraphs = (section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
    const items = section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
    return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${items}</section>`;
  }).join("");
  const subtitle = input.subtitle ? `<p class="subtitle">${escapeHtml(input.subtitle)}</p>` : "";
  const footer = input.footer ? `<footer>${escapeHtml(input.footer)}</footer>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:40px auto;padding:0 28px;color:#172033;line-height:1.55}h1{font-size:28px;margin-bottom:6px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #dbe3ef;padding-bottom:6px}.subtitle,footer{color:#52627a;font-size:13px}p{white-space:pre-wrap}li{margin:6px 0}footer{margin-top:32px}@page{margin:18mm}@media print{body{max-width:none;margin:0;padding:0}h2{break-after:avoid}li,p{orphans:3;widows:3}}</style></head><body><h1>${escapeHtml(input.title)}</h1>${subtitle}${sections}${footer}</body></html>`;
}

export async function buildDocxExport(input: ExportDocument): Promise<Blob> {
  const children: Paragraph[] = [new Paragraph({ text: input.title, heading: HeadingLevel.TITLE })];
  if (input.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: input.subtitle, italics: true })] }));
  for (const section of input.sections) {
    children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    for (const paragraph of section.paragraphs ?? []) {
      for (const line of paragraph.split(/\r?\n/)) children.push(new Paragraph(line));
    }
    for (const item of section.items ?? []) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
  }
  if (input.footer) children.push(new Paragraph({ children: [new TextRun({ text: input.footer, italics: true, color: "52627A" })] }));
  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}

function printablePdfText(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/·/g, "-")
    .replace(/→/g, "->")
    .replace(/€/g, "EUR")
    .replace(/£/g, "GBP")
    .replace(/[^\x20-\x7E]/g, (character) => `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`)
    .replace(/\s+/g, " ")
    .trim();
}

function wrapPdfText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, fontSize: number, maxWidth: number): string[] {
  const words = printablePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildPdfExport(input: ExportDocument): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 612;
  const height = 792;
  const margin = 52;
  const bottom = 50;
  const contentWidth = width - margin * 2;
  const pages = [document.addPage([width, height])];
  let page = pages[0];
  let y = height - margin;

  const nextPage = () => {
    page = document.addPage([width, height]);
    pages.push(page);
    y = height - margin;
  };
  const ensureSpace = (lineHeight: number) => {
    if (y - lineHeight < bottom) nextPage();
  };
  const drawWrapped = (text: string, options: { font: typeof regular; size: number; lineHeight: number; indent?: number; color?: ReturnType<typeof rgb> }) => {
    const indent = options.indent ?? 0;
    const lines = wrapPdfText(text, options.font, options.size, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(options.lineHeight);
      page.drawText(line, { x: margin + indent, y: y - options.size, size: options.size, font: options.font, color: options.color ?? rgb(0.09, 0.13, 0.2) });
      y -= options.lineHeight;
    }
  };

  drawWrapped(input.title, { font: bold, size: 22, lineHeight: 29 });
  if (input.subtitle) {
    drawWrapped(input.subtitle, { font: regular, size: 10, lineHeight: 16, color: rgb(0.32, 0.38, 0.47) });
    y -= 12;
  }
  for (const section of input.sections) {
    ensureSpace(32);
    y -= 10;
    drawWrapped(section.heading, { font: bold, size: 14, lineHeight: 19 });
    page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: width - margin, y: y + 2 }, thickness: 0.6, color: rgb(0.82, 0.86, 0.91) });
    y -= 7;
    for (const paragraph of section.paragraphs ?? []) {
      drawWrapped(paragraph, { font: regular, size: 10, lineHeight: 14 });
      y -= 5;
    }
    for (const item of section.items ?? []) {
      drawWrapped(`- ${item}`, { font: regular, size: 10, lineHeight: 14, indent: 8 });
      y -= 3;
    }
  }
  if (input.footer) {
    y -= 10;
    drawWrapped(input.footer, { font: regular, size: 9, lineHeight: 12, color: rgb(0.32, 0.38, 0.47) });
  }

  pages.forEach((currentPage, index) => {
    currentPage.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 44, y: 24, size: 8, font: regular, color: rgb(0.42, 0.47, 0.54) });
  });
  return document.save();
}

export function parseDocumentExportFormat(value: string | null): DocumentExportFormat | null {
  const format = value ?? "html";
  return format === "html" || format === "pdf" || format === "docx" ? format : null;
}

export async function createDocumentExportResponse(input: ExportDocument, filenameBase: string, format: DocumentExportFormat): Promise<Response> {
  const filename = filenameBase.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 96) || "document";
  const commonHeaders = { "cache-control": "private, no-store" };
  if (format === "html") {
    return new Response(buildPrintableDocumentHtml(input), {
      headers: { ...commonHeaders, "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="${filename}.html"` },
    });
  }
  if (format === "pdf") {
    const bytes = await buildPdfExport(input);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: { ...commonHeaders, "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}.pdf"` },
    });
  }
  const blob = await buildDocxExport(input);
  return new Response(blob, {
    headers: { ...commonHeaders, "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${filename}.docx"` },
  });
}
