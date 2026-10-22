/** Vytáhne text z PDF na serveru (pdf.js pro Node). Používá se pro PDF z Disku, která model dostává jako výsledek nástroje. */
export async function textZPdf(data: Buffer, maxZnaku: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const uloha = pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true });
  try {
    const doc = await uloha.promise;
    const strany: string[] = [];
    let delka = 0;
    for (let i = 1; i <= doc.numPages && delka < maxZnaku; i++) {
      const obsah = await (await doc.getPage(i)).getTextContent();
      const text = obsah.items
        .map((p) => ('str' in p ? p.str + (p.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
      strany.push(`[strana ${i}]\n${text}`);
      delka += text.length;
    }
    return strany.join('\n\n').slice(0, maxZnaku);
  } finally {
    await uloha.destroy();
  }
}
