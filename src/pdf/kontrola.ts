import { PDFDict, PDFDocument, PDFName, PDFSignature } from 'pdf-lib';
import type { KontrolaPdf } from '../ulozeni/typy';
import { jeChybaHesla, otevriPdf, zavriPdf } from './pdfjs';

/** Strana s méně znaky v textové vrstvě se bere jako sken bez textu. */
const MIN_ZNAKU_TEXTU = 12;

/**
 * Zkontroluje nahrané PDF: počet stran, šifrování, digitální podpis
 * a strany bez textové vrstvy (skeny, na které bude potřeba OCR).
 */
export async function zkontrolujPdf(data: ArrayBuffer): Promise<KontrolaPdf> {
  const vysledek: KontrolaPdf = {
    stran: 0,
    sifrovany: false,
    potrebujeHeslo: false,
    digitalnePodepsany: obsahujeBajty(new Uint8Array(data), '/ByteRange'),
    stranyBezTextu: [],
  };

  // pdf-lib: šifrování (pdf-lib šifrované PDF upravit neumí) a podpisová pole.
  // Pozor: chybu EncryptedPDFError nejde poznat přes instanceof, proto isEncrypted.
  try {
    const dokument = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true });
    vysledek.sifrovany = dokument.isEncrypted;
    if (!dokument.isEncrypted) {
      const podepsanePole = dokument
        .getForm()
        .getFields()
        .some((pole) => pole instanceof PDFSignature && pole.acroField.dict.lookup(PDFName.of('V')) instanceof PDFDict);
      vysledek.digitalnePodepsany ||= podepsanePole;
    }
  } catch {
    vysledek.chyba = 'Soubor se nepodařilo přečíst. Možná je poškozený nebo to není PDF.';
    return vysledek;
  }

  // pdf.js: počet stran a textová vrstva
  try {
    const dokument = await otevriPdf(data);
    vysledek.stran = dokument.numPages;
    for (let cislo = 1; cislo <= dokument.numPages; cislo++) {
      const strana = await dokument.getPage(cislo);
      const obsah = await strana.getTextContent();
      const znaku = obsah.items.reduce(
        (soucet, polozka) => soucet + ('str' in polozka ? polozka.str.replace(/\s+/g, '').length : 0),
        0,
      );
      if (znaku < MIN_ZNAKU_TEXTU) vysledek.stranyBezTextu.push(cislo);
      strana.cleanup();
    }
    await zavriPdf(dokument);
  } catch (chyba) {
    if (jeChybaHesla(chyba)) {
      vysledek.sifrovany = true;
      vysledek.potrebujeHeslo = true;
    } else {
      vysledek.chyba = 'Soubor se nepodařilo otevřít. Možná je poškozený nebo to není PDF.';
    }
  }

  return vysledek;
}

/** Hledá text (ASCII) v binárních datech bez převodu celého souboru na řetězec. */
export function obsahujeBajty(data: Uint8Array, hledane: string) {
  const vzor = Array.from(hledane, (znak) => znak.charCodeAt(0));
  const prvni = vzor[0];
  outer: for (let i = data.indexOf(prvni); i !== -1 && i <= data.length - vzor.length; i = data.indexOf(prvni, i + 1)) {
    for (let j = 1; j < vzor.length; j++) {
      if (data[i + j] !== vzor[j]) continue outer;
    }
    return true;
  }
  return false;
}
