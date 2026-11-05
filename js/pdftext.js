/* Extracts text lines from a PDF entirely inside the browser using pdf.js.
 * The PDF is never uploaded anywhere. */
(function (root) {
  'use strict';
  const FS = root.FS;

  async function pdfToLines(arrayBuffer) {
    const pdfjsLib = root.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF library failed to load');
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false, // never compile code from the PDF
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
    }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim() !== '')
        .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str }));
      // Group into rows by y coordinate (PDF y grows upwards).
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
        if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let text = '', lastEnd = null;
        for (const it of r.items) {
          if (lastEnd != null) text += it.x - lastEnd > 12 ? '   ' : (it.x - lastEnd > 1 ? ' ' : '');
          text += it.s;
          lastEnd = it.x + it.w;
        }
        lines.push(text.trim());
      }
      page.cleanup();
    }
    await doc.destroy();
    return lines;
  }

  FS.pdfToLines = pdfToLines;
})(typeof window !== 'undefined' ? window : globalThis);
