import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function createFixturePdf(pages: string[][]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const lines of pages) {
    const page = pdf.addPage();
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: 52, y: page.getHeight() - 66 - i * 32,
        font: i === 0 ? bold : font, size: i === 0 ? 16 : 11,
        color: rgb(0.12, 0.19, 0.17),
      });
    });
  }
  return pdf.save();
}
