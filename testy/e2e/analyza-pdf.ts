/**
 * Kontrola výsledných PDF v Node (pdf.js + @napi-rs/canvas): kde je modrý škrt,
 * kde jsou nové texty a obrázky (podpisy) a jestli se s něčím nepřekrývají.
 */
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import type { PolozkaTextu, Usek } from '../../src/pdf/hledani';
import { KOREN } from './prohlizec';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsCache: Pdfjs | null = null;
async function pdfjs() {
  pdfjsCache ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsCache;
}

export async function otevri(data: Uint8Array) {
  return (await pdfjs()).getDocument({
    data: data.slice(),
    standardFontDataUrl: path.join(KOREN, 'node_modules/pdfjs-dist/standard_fonts/'),
  }).promise;
}
export type Dokument = Awaited<ReturnType<typeof otevri>>;

export interface Render {
  data: Uint8ClampedArray;
  sirka: number;
  vyska: number;
  bodNaPixel: (x: number, y: number) => [number, number];
}

export async function vyrenderuj(doc: Dokument, cislo: number, meritko = 4): Promise<Render> {
  const strana = await doc.getPage(cislo);
  const vp = strana.getViewport({ scale: meritko });
  const platno = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await strana.render({ canvas: platno as unknown as HTMLCanvasElement, viewport: vp }).promise;
  const data = platno.getContext('2d').getImageData(0, 0, platno.width, platno.height).data;
  return { data, sirka: platno.width, vyska: platno.height, bodNaPixel: (x, y) => vp.convertToViewportPoint(x, y) as [number, number] };
}

export async function polozky(doc: Dokument, cislo: number): Promise<PolozkaTextu[]> {
  const obsah = await (await doc.getPage(cislo)).getTextContent();
  return obsah.items.filter((i): i is (typeof obsah.items)[number] & PolozkaTextu => 'str' in i && i.str.trim() !== '');
}

/** Obdélník (osově zarovnaný ve stránce) okolo položky textu. */
export function boxPolozky(p: PolozkaTextu) {
  const [a, b, c, d, e, f] = p.transform;
  const s = Math.hypot(a, b);
  const smer = [a / s, b / s];
  const h = Math.hypot(c, d) || s;
  const nahoru = [c / h, d / h];
  const body = [
    [0, -0.25 * s],
    [p.width, -0.25 * s],
    [p.width, 0.85 * s],
    [0, 0.85 * s],
  ].map(([u, v]) => [e + smer[0] * u + nahoru[0] * v, f + smer[1] * u + nahoru[1] * v]);
  return obalka(body);
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function obalka(body: number[][]): Box {
  return {
    x0: Math.min(...body.map((b) => b[0])),
    y0: Math.min(...body.map((b) => b[1])),
    x1: Math.max(...body.map((b) => b[0])),
    y1: Math.max(...body.map((b) => b[1])),
  };
}

export function prekryvaSe(a: Box, b: Box, rezerva = 0) {
  return a.x0 < b.x1 - rezerva && a.x1 > b.x0 + rezerva && a.y0 < b.y1 - rezerva && a.y1 > b.y0 + rezerva;
}

/** Obrázky na stránce (podpisy) – jejich obrys ve stránce podle transformací v obsahu. */
export async function obrazky(doc: Dokument, cislo: number): Promise<Box[]> {
  const { OPS, Util } = await pdfjs();
  const seznam = await (await doc.getPage(cislo)).getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const zasobnik: number[][] = [];
  const vysledek: Box[] = [];
  seznam.fnArray.forEach((op, i) => {
    const arg = seznam.argsArray[i];
    if (op === OPS.save) zasobnik.push(ctm);
    else if (op === OPS.restore) ctm = zasobnik.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) ctm = Util.transform(ctm, arg);
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      const body = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      vysledek.push(obalka(body));
    }
  });
  return vysledek;
}

/** Podíl tmavých pixelů v obdélníku stránky na vyrenderovaném ORIGINÁLU (0 = úplně prázdno). */
export function podilTmavych(r: Render, b: Box, prah = 200) {
  const [ax, ay] = r.bodNaPixel(b.x0, b.y0);
  const [bx, by] = r.bodNaPixel(b.x1, b.y1);
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx)));
  const x1 = Math.min(r.sirka - 1, Math.ceil(Math.max(ax, bx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by)));
  const y1 = Math.min(r.vyska - 1, Math.ceil(Math.max(ay, by)));
  let tmavych = 0;
  let vsech = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * r.sirka + x) * 4;
      vsech++;
      if ((r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3 < prah) tmavych++;
    }
  return vsech ? tmavych / vsech : 1;
}

function jeModra(r: Render, x: number, y: number) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= r.sirka || yi >= r.vyska) return false;
  const i = (yi * r.sirka + xi) * 4;
  const [cr, cg, cb] = [r.data[i], r.data[i + 1], r.data[i + 2]];
  return cb - cr > 50 && cb - cg > 30;
}

/**
 * Změří modrý škrt u očekávaného úseku: kde začíná a končí (v bodech od začátku úseku)
 * a v jaké výšce nad účařím vede.
 */
export function zmerSkrt(r: Render, u: Usek) {
  const bod = (podel: number, v: number) => {
    const x = u.pocatek[0] + u.smer[0] * podel + u.nahoru[0] * v;
    const y = u.pocatek[1] + u.smer[1] * podel + u.nahoru[1] * v;
    return r.bodNaPixel(x, y);
  };
  const vysky: number[] = [];
  for (let v = 0.05 * u.velikost; v <= 0.65 * u.velikost; v += 0.05) {
    let modrych = 0;
    for (let podel = 0; podel <= u.delka; podel += u.delka / 20) if (jeModra(r, ...bod(podel, v))) modrych++;
    if (modrych >= 15) vysky.push(v);
  }
  if (vysky.length === 0) return null;
  const vyska = vysky.reduce((a, b) => a + b, 0) / vysky.length;
  // Od středu úseku na obě strany, dokud je čára souvislá
  const krok = 0.1;
  let zacatek = u.delka / 2;
  while (zacatek - krok > -5 && jeModra(r, ...bod(zacatek - krok, vyska))) zacatek -= krok;
  let konec = u.delka / 2;
  while (konec + krok < u.delka + 5 && jeModra(r, ...bod(konec + krok, vyska))) konec += krok;
  return { zacatek, konec, vyska };
}

/** Průměrný jas (0–255) v obdélníku stránky. */
export function prumernyJas(r: Render, b: Box) {
  const [ax, ay] = r.bodNaPixel(b.x0, b.y0);
  const [bx, by] = r.bodNaPixel(b.x1, b.y1);
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx)));
  const x1 = Math.min(r.sirka - 1, Math.ceil(Math.max(ax, bx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by)));
  const y1 = Math.min(r.vyska - 1, Math.ceil(Math.max(ay, by)));
  let soucet = 0;
  let pocet = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * r.sirka + x) * 4;
      soucet += (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
      pocet++;
    }
  return pocet ? soucet / pocet : 255;
}
