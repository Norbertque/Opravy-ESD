import { PDFDict, PDFDocument, PDFName, PDFSignature } from 'pdf-lib';
import type { KontrolaPdf } from '../ulozeni/typy';
import { jeChybaHesla, otevriPdf, pdfjs, zavriPdf, type PdfDokument, type PdfStrana } from './pdfjs';

/** Strana s méně znaky v textové vrstvě nemá použitelný text (prázdná strana, sken, obrázek). */
const MIN_ZNAKU_TEXTU = 12;
/**
 * Sken bývá orazítkovaný číslem strany nebo textem čárového kódu. Strana s obrázkem přes
 * většinu plochy a méně znaky (přepočteno na plochu A4) se proto pořád bere jako sken.
 */
const MAX_ZNAKU_SKENU_NA_A4 = 150;
const PLOCHA_A4 = 595 * 842; // v bodech PDF
/** Obrázky přes aspoň takovou část strany = naskenovaná strana. */
const POKRYTI_SKENU = 0.5;
/** Strana bez textu je sken, i když obrázek pokrývá jen část (vlepená účtenka). Menší obrázek (logo) ne. */
const POKRYTI_OBRAZKU_BEZ_TEXTU = 0.1;

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
  let upravitelny: PDFDocument | null = null;
  try {
    upravitelny = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true });
    vysledek.sifrovany = upravitelny.isEncrypted;
  } catch {
    // Čitelnost rozhodne až pdf.js níže – tady jde jen o to, jestli půjde zakreslit opravu.
    vysledek.nejdeUpravit = true;
  }
  if (upravitelny && !upravitelny.isEncrypted) {
    // Zvlášť, aby vadné pole formuláře (třeba bez /FT) neudělalo z čitelného PDF poškozené.
    try {
      vysledek.digitalnePodepsany ||= upravitelny
        .getForm()
        .getFields()
        .some((pole) => pole instanceof PDFSignature && pole.acroField.dict.lookup(PDFName.of('V')) instanceof PDFDict);
    } catch {
      // Podpis pak pozná aspoň hledání /ByteRange výše.
    }
  }

  // pdf.js: počet stran a textová vrstva
  let dokument: PdfDokument | null = null;
  try {
    dokument = await otevriPdf(data);
    vysledek.stran = dokument.numPages;
    for (let cislo = 1; cislo <= dokument.numPages; cislo++) {
      const strana = await dokument.getPage(cislo);
      try {
        if (await jeSken(strana)) vysledek.stranyBezTextu.push(cislo);
      } finally {
        strana.cleanup();
      }
    }
  } catch (chyba) {
    if (jeChybaHesla(chyba)) {
      vysledek.sifrovany = true;
      vysledek.potrebujeHeslo = true;
    } else {
      vysledek.chyba = 'Soubor se nepodařilo otevřít. Možná je poškozený nebo to není PDF.';
    }
  } finally {
    if (dokument) await zavriPdf(dokument).catch(() => {});
  }

  return vysledek;
}

/**
 * Sken poznáme podle obrázku přes většinu strany s málem textu. Strana bez textu
 * i bez obrázků je prázdná, ne sken. Obrázky se procházejí jen u stran s málem textu.
 */
async function jeSken(strana: PdfStrana) {
  const obsah = await strana.getTextContent();
  const znaku = obsah.items.reduce(
    (soucet, polozka) => soucet + ('str' in polozka ? polozka.str.replace(/\s+/g, '').length : 0),
    0,
  );
  const [x1, y1, x2, y2] = strana.view;
  const limitZnaku = Math.max(MIN_ZNAKU_TEXTU, (MAX_ZNAKU_SKENU_NA_A4 * (x2 - x1) * (y2 - y1)) / PLOCHA_A4);
  if (znaku >= limitZnaku) return false;
  const pokryti = await pokrytiObrazky(strana);
  return pokryti >= POKRYTI_SKENU || (znaku < MIN_ZNAKU_TEXTU && pokryti >= POKRYTI_OBRAZKU_BEZ_TEXTU);
}

type Matice = [number, number, number, number, number, number];

/**
 * Jakou část strany (0–1) pokrývají obrázky. Projde operátory stránky z pdf.js
 * a sleduje transformace – obrázek se kreslí do čtverce 1×1 v aktuálních souřadnicích.
 */
async function pokrytiObrazky(strana: PdfStrana) {
  const { OPS } = pdfjs;
  // Bez anotací: počítá se jen obsah strany, ne razítka a pole formulářů.
  const { fnArray, argsArray } = await strana.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  const [x1, y1, x2, y2] = strana.view; // pdf.js vrací x1 < x2, y1 < y2
  const ulozene: Matice[] = [];
  let matice: Matice = [1, 0, 0, 1, 0, 0];
  let pokryto = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i];
    switch (fnArray[i]) {
      case OPS.save:
      case OPS.beginGroup:
        ulozene.push(matice);
        break;
      case OPS.restore:
      case OPS.endGroup:
      case OPS.paintFormXObjectEnd:
        matice = ulozene.pop() ?? matice;
        break;
      case OPS.transform:
        matice = nasob(matice, args as Matice);
        break;
      case OPS.paintFormXObjectBegin:
        ulozene.push(matice);
        if (args[0]) matice = nasob(matice, args[0] as Matice);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        pokryto += prekryv(matice, x1, x2, y1, y2) / ((x2 - x1) * (y2 - y1));
        break;
    }
  }
  return Math.min(1, pokryto);
}

/** Složení transformací jako `cm` v PDF: nejdřív `m`, pak dosavadní `a`. */
function nasob(a: Matice, m: Matice): Matice {
  return [
    a[0] * m[0] + a[2] * m[1],
    a[1] * m[0] + a[3] * m[1],
    a[0] * m[2] + a[2] * m[3],
    a[1] * m[2] + a[3] * m[3],
    a[0] * m[4] + a[2] * m[5] + a[4],
    a[1] * m[4] + a[3] * m[5] + a[5],
  ];
}

/** Plocha, kterou čtverec 1×1 po transformaci `m` překryje z obdélníku strany. */
function prekryv(m: Matice, x1: number, x2: number, y1: number, y2: number) {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  const sirka = Math.min(Math.max(...xs), x2) - Math.max(Math.min(...xs), x1);
  const vyska = Math.min(Math.max(...ys), y2) - Math.max(Math.min(...ys), y1);
  return sirka > 0 && vyska > 0 ? sirka * vyska : 0;
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
