import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDokument = pdfjs.PDFDocumentProxy;
export type PdfStrana = pdfjs.PDFPageProxy;
export type PdfViewport = pdfjs.PageViewport;

/**
 * Otevře PDF v pdf.js. Data se vždy zkopírují – pdf.js předá buffer
 * do svého workeru a původní pole by se tím „vyprázdnilo".
 */
export function otevriPdf(data: ArrayBuffer | Uint8Array) {
  const kopie = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  return pdfjs.getDocument({
    data: kopie,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  }).promise;
}

/** Uvolní dokument i jeho worker. */
export function zavriPdf(dokument: PdfDokument) {
  return dokument.loadingTask.destroy();
}

export function jeChybaHesla(chyba: unknown) {
  return chyba instanceof pdfjs.PasswordException || (chyba as { name?: string })?.name === 'PasswordException';
}

export { pdfjs };
