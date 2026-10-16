import { describe, expect, it } from "vitest";
import { buildDocxExport, buildPdfExport, buildPrintableDocumentHtml, detectCandidateDocumentFormat, extractCandidateDocumentText, parseDocumentExportFormat } from "../../lib/v4/documents";

function makeTextPdf(lines: string[]): Uint8Array {
  const commands = lines.map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const stream = `${commands}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("Version 4 document extraction and export", () => {
  it("extracts searchable text from an uploaded PDF", async () => {
    const result = await extractCandidateDocumentText(makeTextPdf(["Jordan Riley", "Led checkout experiments across three markets."]), "resume.pdf");

    expect(result).toMatchObject({ format: "pdf", parseStatus: "ready" });
    expect(result.text).toContain("Jordan Riley");
    expect(result.text).toContain("checkout experiments");
  });

  it("round-trips a generated DOCX as real OOXML and extracts its text", async () => {
    const document = { title: "Application pack", subtitle: "Product Manager at Acme", sections: [{ heading: "Approved evidence", paragraphs: ["Led checkout experiments across three markets."] }] };
    const blob = await buildDocxExport(document);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await extractCandidateDocumentText(bytes, "resume.docx");

    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(result.parseStatus).toBe("ready");
    expect(result.text).toContain("Approved evidence");
    expect(result.text).toContain("Led checkout experiments across three markets.");
  });

  it("generates a searchable PDF artifact with the document's section content", async () => {
    const bytes = await buildPdfExport({ title: "Interview preparation", subtitle: "Final round · Acme", sections: [{ heading: "Approved STAR evidence", items: ["Led checkout experiments across three markets."] }] });
    const result = await extractCandidateDocumentText(bytes, "interview.pdf");

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
    expect(result.text).toContain("Interview preparation");
    expect(result.text).toContain("Approved STAR evidence");
    expect(result.text).toContain("Led checkout experiments across three markets.");
  });

  it("paginates long PDF exports without dropping section text", async () => {
    const repeatedEvidence = Array.from({ length: 180 }, (_, index) => `Evidence item ${index + 1}: led a verified product experiment.`).join(" ");
    const bytes = await buildPdfExport({ title: "Evidence record", sections: [{ heading: "Approved evidence", paragraphs: [repeatedEvidence] }] });
    const result = await extractCandidateDocumentText(bytes, "evidence.pdf");

    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.text).toContain("Evidence item 180");
  });

  it("renders escaped, print-ready HTML from document sections", () => {
    const html = buildPrintableDocumentHtml({
      title: "Interview <pack>",
      sections: [{ heading: "Practice", paragraphs: ["Answer: <script>alert(1)</script>"], items: ["Review & confirm"] }],
    });

    expect(html).toContain("@media print");
    expect(html).toContain("Interview &lt;pack&gt;");
    expect(html).toContain("Answer: &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Review &amp; confirm");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("requires upload bytes to match the supported filename extension", () => {
    expect(() => detectCandidateDocumentFormat("candidate.pdf", new TextEncoder().encode("plain text"))).toThrow(/contents do not match/i);
    expect(() => detectCandidateDocumentFormat("candidate.exe", new Uint8Array([1]))).toThrow(/only PDF, DOCX and TXT/i);
  });

  it("defaults document exports to HTML and accepts only supported formats", () => {
    expect(parseDocumentExportFormat(null)).toBe("html");
    expect(parseDocumentExportFormat("pdf")).toBe("pdf");
    expect(parseDocumentExportFormat("docx")).toBe("docx");
    expect(parseDocumentExportFormat("exe")).toBeNull();
  });
});
