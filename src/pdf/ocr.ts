/**
 * OCR naskenovaných stránek (tesseract.js, čeština) přímo v prohlížeči.
 * Z rozpoznaných slov se udělají položky textové vrstvy (stejný tvar jako z pdf.js),
 * takže hledání textu, výběr místa i kreslení fungují na skenu stejně.
 *
 * Worker, jádro OCR i česká jazyková data servíruje náš server (server.ts, /tesseract/…),
 * appka tedy nepotřebuje cizí CDN.
 */
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { PolozkaTextu } from './hledani';
import type { PdfStrana } from './pdfjs';

/** Rozlišení pro OCR (body → pixely). 300 dpi, ale nejvýš 3 500 px na delší straně. */
const DPI = 300;
const MAX_PIXELU = 3500;

let workerCache: Promise<Worker> | null = null;

function worker() {
  workerCache ??= createWorker('ces', OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    workerBlobURL: false,
  }).catch((chyba) => {
    workerCache = null;
    throw chyba;
  });
  return workerCache;
}

/** Ukončí OCR worker (uvolní paměť). */
export async function ukonciOcr() {
  const w = workerCache;
  workerCache = null;
  if (w) await (await w).terminate();
}

/** Rozpozná text na stránce a vrátí slova jako položky textové vrstvy (souřadnice stránky PDF). */
export async function rozpoznejStranu(strana: PdfStrana): Promise<PolozkaTextu[]> {
  const zaklad = strana.getViewport({ scale: 1 });
  const meritko = Math.min(DPI / 72, MAX_PIXELU / Math.max(zaklad.width, zaklad.height));
  const vp = strana.getViewport({ scale: meritko });
  const platno = document.createElement('canvas');
  platno.width = Math.ceil(vp.width);
  platno.height = Math.ceil(vp.height);
  try {
    await strana.render({ canvas: platno, viewport: vp }).promise;
    const { data } = await (await worker()).recognize(platno, {}, { blocks: true, text: false });
    const polozky: PolozkaTextu[] = [];
    for (const blok of data.blocks ?? [])
      for (const odstavec of blok.paragraphs)
        for (const radek of odstavec.lines) {
          const slova = radek.words.filter((w) => w.text.trim() !== '');
          if (slova.length === 0) continue;
          const b = radek.baseline as { x0: number; y0: number; x1: number; y1: number; has_baseline?: boolean };
          const maUcari = b && b.has_baseline !== false && b.x1 !== b.x0;
          const ucariV = (x: number, w: (typeof slova)[number]) =>
            maUcari ? b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0) : w.bbox.y1 - 0.2 * (w.bbox.y1 - w.bbox.y0);
          // Velikost písma z výšky řádku nad účařím (velká písmena a číslice ≈ 0,72 em)
          const vrsek = Math.min(...slova.map((w) => w.bbox.y0));
          const velikostPx = Math.max(4, (ucariV((radek.bbox.x0 + radek.bbox.x1) / 2, slova[0]) - vrsek) / 0.72);
          slova.forEach((w, i) => {
            const y = ucariV(w.bbox.x0, w);
            const p = vp.convertToPdfPoint(w.bbox.x0, y);
            const q = vp.convertToPdfPoint(w.bbox.x1, ucariV(w.bbox.x1, w));
            const u = vp.convertToPdfPoint(w.bbox.x0, y - velikostPx);
            const sirka = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
            const velikost = Math.hypot(u[0] - p[0], u[1] - p[1]) || 1;
            const smer = [(q[0] - p[0]) / sirka, (q[1] - p[1]) / sirka];
            const nahoru = [(u[0] - p[0]) / velikost, (u[1] - p[1]) / velikost];
            polozky.push({
              str: w.text,
              transform: [smer[0] * velikost, smer[1] * velikost, nahoru[0] * velikost, nahoru[1] * velikost, p[0], p[1]],
              width: sirka,
              hasEOL: i === slova.length - 1,
            });
          });
        }
    return polozky;
  } finally {
    platno.width = platno.height = 0;
  }
}
