import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDokument = pdfjs.PDFDocumentProxy;
export type PdfStrana = pdfjs.PDFPageProxy;
export type PdfViewport = pdfjs.PageViewport;

/**
 * Otevře PDF v pdf.js. Data se vždy zkopírují – pdf.js předá buffer
 * do svého workeru a původní pole by se tím „vyprázdnilo“.
 */
export async function otevriPdf(data: ArrayBuffer | Uint8Array): Promise<PdfDokument> {
  const kopie = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const ukol = pdfjs.getDocument({
    data: kopie,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  });
  try {
    return await ukol.promise;
  } catch (chyba) {
    // PDF se neotevřelo (heslo, poškozený soubor) – worker by jinak zůstal běžet.
    await ukol.destroy().catch(() => {});
    throw chyba;
  }
}

/** Uvolní dokument i jeho worker. */
export function zavriPdf(dokument: PdfDokument) {
  return dokument.loadingTask.destroy();
}

export function jeChybaHesla(chyba: unknown) {
  return chyba instanceof pdfjs.PasswordException || (chyba as { name?: string })?.name === 'PasswordException';
}

export { pdfjs };
