/**
 * Zakreslení schválených oprav do KOPIE PDF (originál se nemění).
 *
 * Pro každou stránku s opravami:
 *  1. stránka se vyrenderuje (pdf.js) – z obrázku se zpřesní poloha škrtu a ověřuje volné místo,
 *  2. škrt jednou tenkou čarou přes střed textu (u doplnění se neškrtá),
 *  3. oprava modře a hned za ní podpis: vpravo → nad → pod → nejbližší volné místo se spojnicí,
 *  4. vše se kreslí přímo do obsahu stránky (ne jako anotace) písmem Noto Sans (čeština).
 */
import fontkit from '@pdf-lib/fontkit';
import { degrees, PDFContentStream, PDFDocument, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { konfigurace } from '../../konfigurace';
import { bodUseku, sirkaPodleTvaru, type PolozkaTextu, type Usek } from '../pdf/hledani';
import { otevriPdf, zavriPdf, type PdfStrana, type PdfViewport } from '../pdf/pdfjs';
import { najdiUmisteni, posun, rozvrhni, STRED_PISMA, type RamecBox, type Rozvrzeni, type Umisteni } from './rozmisteni';

export interface OpravaKZakresleni {
  /** Pro hlášení: např. „Bod 1" nebo „Ruční oprava". */
  popis: string;
  strana: number;
  typ: 'oprava' | 'doplneni';
  useky: Usek[];
  text: string;
}

export interface ZpravaOprave {
  popis: string;
  strana: number;
  poloha: Umisteni['poloha'];
  nouzove: boolean;
}

/** Měřítko vykreslení stránky pro kontroly (2 = 144 dpi). */
const MERITKO = 2;

let pismoCache: Promise<ArrayBuffer> | null = null;
function nactiPismo() {
  pismoCache ??= fetch('/fonty/NotoSans-Regular.ttf').then((r) => {
    if (!r.ok) throw new Error('Písmo pro opravy se nepodařilo načíst.');
    return r.arrayBuffer();
  });
  return pismoCache;
}

/** Datum vedle podpisu (když je zapnuté v konfiguraci). */
export function dnesniDatum(datum = new Date()) {
  return `${datum.getDate()}. ${datum.getMonth() + 1}. ${datum.getFullYear()}`;
}

export async function zakresliOpravy(
  original: ArrayBuffer,
  opravy: OpravaKZakresleni[],
  podpisPng: ArrayBuffer | null,
): Promise<{ data: Uint8Array; zpravy: ZpravaOprave[] }> {
  const pdf = await PDFDocument.load(original.slice(0), { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const pismo = await pdf.embedFont(await nactiPismo(), { subset: true });
  const podpis = podpisPng ? await pdf.embedPng(podpisPng) : null;
  const datum = konfigurace.vzhled.datumUPodpisu ? dnesniDatum() : null;
  const zpravy: ZpravaOprave[] = [];

  const nahled = await otevriPdf(original);
  try {
    const strany = [...new Set(opravy.map((o) => o.strana))].sort((a, b) => a - b);
    for (const cislo of strany) {
      const stranaJs = await nahled.getPage(cislo);
      const viewport = stranaJs.getViewport({ scale: MERITKO });
      const obraz = await vyrenderuj(stranaJs, viewport);
      const polozky = (await stranaJs.getTextContent()).items.filter(
        (i): i is (typeof i) & PolozkaTextu => 'str' in i && i.str.trim() !== '',
      );
      const stranka = pdf.getPage(cislo - 1);
      obalPuvodniObsah(pdf, stranka);
      const umistene: [number, number][][] = [];

      for (const oprava of opravy.filter((o) => o.strana === cislo)) {
        const useky = oprava.useky.map((u) => zpresniUsek(u, obraz, viewport));
        if (useky.length === 0) continue;
        if (oprava.typ === 'oprava') for (const u of useky) skrtni(stranka, u);

        const prvni = useky[0];
        const posledni = useky[useky.length - 1];
        const ramec = ramecUseku(posledni);
        const velikost = Math.min(konfigurace.vzhled.velikostPismaMax, Math.max(konfigurace.vzhled.velikostPismaMin, posledni.velikost));
        const varianty = [1, 0.85].map((k) =>
          rozvrhni({
            sirkaTextu: (t, s) => pismo.widthOfTextAtSize(t, s),
            text: oprava.text,
            pomerPodpisu: podpis ? podpis.width / podpis.height : null,
            datum,
            velikostPisma: Math.max(konfigurace.vzhled.velikostPismaMin, velikost * k),
            vyskaPodpisu: konfigurace.vzhled.vyskaPodpisu * (k === 1 ? 1 : 0.7),
            mezera: konfigurace.vzhled.mezera,
          }),
        );
        const umisteni = najdiUmisteni({
          posledni,
          prvni,
          varianty,
          mezera: konfigurace.vzhled.mezera,
          stranka: hraniceStranky(stranaJs.view, ramec),
          jeVolno: (box) =>
            !koliduje(box, ramec, polozky, umistene) && jePrazdnoNaObraze(box, ramec, obraz, viewport),
        });
        nakresliOpravu(stranka, ramec, umisteni, oprava.text, pismo, podpis, datum);
        umistene.push(rohyBoxu(posun(umisteni.rozvrzeni.box, umisteni.u, umisteni.v), ramec));
        zpravy.push({ popis: oprava.popis, strana: cislo, poloha: umisteni.poloha, nouzove: umisteni.nouzove });
      }
      stranaJs.cleanup();
    }
  } finally {
    await zavriPdf(nahled);
  }

  return { data: await pdf.save(), zpravy };
}

// ------------------------------------------------------------------ rámec řádku

interface Ramec {
  pocatek: [number, number];
  smer: [number, number];
  nahoru: [number, number];
}

function ramecUseku(u: Usek): Ramec {
  return { pocatek: u.pocatek, smer: u.smer, nahoru: u.nahoru };
}

function doRamce(r: Ramec, [x, y]: [number, number]): [number, number] {
  const dx = x - r.pocatek[0];
  const dy = y - r.pocatek[1];
  return [dx * r.smer[0] + dy * r.smer[1], dx * r.nahoru[0] + dy * r.nahoru[1]];
}

function zRamce(r: Ramec, u: number, v: number): [number, number] {
  return [r.pocatek[0] + r.smer[0] * u + r.nahoru[0] * v, r.pocatek[1] + r.smer[1] * u + r.nahoru[1] * v];
}

function rohyBoxu(b: RamecBox, r: Ramec): [number, number][] {
  return [zRamce(r, b.u0, b.v0), zRamce(r, b.u1, b.v0), zRamce(r, b.u1, b.v1), zRamce(r, b.u0, b.v1)];
}

function boxZRohu(rohy: [number, number][], r: Ramec): RamecBox {
  const body = rohy.map((b) => doRamce(r, b));
  return {
    u0: Math.min(...body.map((b) => b[0])),
    u1: Math.max(...body.map((b) => b[0])),
    v0: Math.min(...body.map((b) => b[1])),
    v1: Math.max(...body.map((b) => b[1])),
  };
}

function prekryvaSe(a: RamecBox, b: RamecBox, rezerva = 0) {
  return a.u0 < b.u1 + rezerva && a.u1 > b.u0 - rezerva && a.v0 < b.v1 + rezerva && a.v1 > b.v0 - rezerva;
}

/** Viditelná část stránky (CropBox) zmenšená o okraj, v rámci řádku. */
function hraniceStranky(view: number[], r: Ramec): RamecBox {
  const b = boxZRohu(
    [
      [view[0], view[1]],
      [view[2], view[1]],
      [view[2], view[3]],
      [view[0], view[3]],
    ],
    r,
  );
  const o = konfigurace.vzhled.okrajStranky;
  return { u0: b.u0 + o, u1: b.u1 - o, v0: b.v0 + o, v1: b.v1 - o };
}

// ------------------------------------------------------------------ kontrola volného místa

function rohyPolozky(p: PolozkaTextu): [number, number][] {
  const [a, b, c, d, e, f] = p.transform;
  const velikost = Math.hypot(a, b) || 1;
  const smer: [number, number] = [a / velikost, b / velikost];
  const vyskaN = Math.hypot(c, d) || velikost;
  const nahoru: [number, number] = [c / vyskaN, d / vyskaN];
  const u: Usek = { pocatek: [e, f], smer, nahoru, delka: p.width, velikost };
  return [bodUseku(u, 0, -0.25 * velikost), bodUseku(u, p.width, -0.25 * velikost), bodUseku(u, p.width, 0.85 * velikost), bodUseku(u, 0, 0.85 * velikost)];
}

/** Hranice stránky, text a už umístěné opravy. */
function koliduje(box: RamecBox, r: Ramec, polozky: PolozkaTextu[], umistene: [number, number][][]) {
  for (const p of polozky) if (prekryvaSe(box, boxZRohu(rohyPolozky(p), r), 0.75)) return true;
  for (const rohy of umistene) if (prekryvaSe(box, boxZRohu(rohy, r), 1)) return true;
  return false;
}

export interface Obraz {
  jas: Uint8Array;
  sirka: number;
  vyska: number;
  /** Pixel tmavší než tohle je obsah (čára, písmo, razítko). */
  prah: number;
}

async function vyrenderuj(strana: PdfStrana, viewport: PdfViewport): Promise<Obraz> {
  const platno = document.createElement('canvas');
  platno.width = Math.ceil(viewport.width);
  platno.height = Math.ceil(viewport.height);
  await strana.render({ canvas: platno, viewport }).promise;
  const data = platno.getContext('2d')!.getImageData(0, 0, platno.width, platno.height).data;
  const jas = new Uint8Array(platno.width * platno.height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < jas.length; i++) {
    const j = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    jas[i] = j;
    histogram[jas[i]]++;
  }
  // Barva papíru = nejčastější světlý odstín; u tmavšího skenu se práh posune.
  let papir = 255;
  for (let j = 255, nej = 0; j >= 128; j--) if (histogram[j] > nej) [nej, papir] = [histogram[j], j];
  platno.width = platno.height = 0;
  return { jas, sirka: Math.ceil(viewport.width), vyska: Math.ceil(viewport.height), prah: Math.min(konfigurace.vzhled.prahObsahu, papir - 30) };
}

/** Je oblast na vyrenderované stránce prázdná? (dovolí pár osamělých tmavých pixelů – šum skenu) */
function jePrazdnoNaObraze(box: RamecBox, r: Ramec, obraz: Obraz, viewport: PdfViewport) {
  const body = rohyBoxu(box, r).map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const x0 = Math.max(0, Math.floor(Math.min(...body.map((b) => b[0]))));
  const x1 = Math.min(obraz.sirka - 1, Math.ceil(Math.max(...body.map((b) => b[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...body.map((b) => b[1]))));
  const y1 = Math.min(obraz.vyska - 1, Math.ceil(Math.max(...body.map((b) => b[1]))));
  if (x1 <= x0 || y1 <= y0) return false;
  let tmavych = 0;
  const povoleno = Math.max(2, ((x1 - x0) * (y1 - y0)) / 2000);
  for (let y = y0; y <= y1; y++) {
    const radek = y * obraz.sirka;
    for (let x = x0; x <= x1; x++) if (obraz.jas[radek + x] < obraz.prah && ++tmavych > povoleno) return false;
  }
  return true;
}

// ------------------------------------------------------------------ zpřesnění škrtu podle obrazu

/**
 * pdf.js nedává šířky jednotlivých znaků, takže začátek a konec úseku uprostřed řádku
 * jsou jen odhad. Na vyrenderované stránce se najdou „slova" (souvislý inkoust)
 * a okraj úseku se přitáhne na okraj slova – jen tam, kde v textu je mezera nebo
 * kraj řádku (zacatekSlova / konecSlova).
 */
export function zpresniUsek(u: Usek, obraz: Obraz, viewport: PdfViewport): Usek {
  const s = u.velikost;
  const krok = 0.25;
  const od = -0.6 * s;
  const sloupcu = Math.ceil((u.delka + 1.2 * s) / krok);
  const inkoust: boolean[] = [];
  for (let k = 0; k <= sloupcu; k++) {
    const podel = od + k * krok;
    let je = false;
    for (let v = 0.05 * s; v <= 0.65 * s && !je; v += 0.1 * s) {
      const [x, y] = viewport.convertToViewportPoint(...bodUseku(u, podel, v));
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < obraz.sirka && yi < obraz.vyska && obraz.jas[yi * obraz.sirka + xi] < obraz.prah) je = true;
    }
    inkoust.push(je);
  }
  // Souvislé úseky inkoustu (mezery kratší než 0,12 velikosti písma patří do slova)
  const slova: { zacatek: number; konec: number }[] = [];
  const mezeraVeSlove = (0.12 * s) / krok;
  for (let k = 0; k < inkoust.length; k++) {
    if (!inkoust[k]) continue;
    const posledni = slova[slova.length - 1];
    const pozice = od + k * krok;
    if (posledni && (pozice - posledni.konec) / krok <= mezeraVeSlove) posledni.konec = pozice + krok;
    else slova.push({ zacatek: pozice, konec: pozice + krok });
  }
  if (slova.length === 0) return u;

  const okno = 0.6 * s;
  let zacatek = 0;
  let konec = u.delka;
  if (u.zacatekSlova !== false) {
    const kandidat = slova
      .filter((w) => Math.abs(w.zacatek) <= okno && w.konec > 0)
      .sort((a, b) => Math.abs(a.zacatek) - Math.abs(b.zacatek))[0];
    if (kandidat) zacatek = kandidat.zacatek;
  }
  if (u.konecSlova !== false) {
    const kandidat = slova
      .filter((w) => Math.abs(w.konec - u.delka) <= okno && w.zacatek < u.delka)
      .sort((a, b) => Math.abs(a.konec - u.delka) - Math.abs(b.konec - u.delka))[0];
    if (kandidat) konec = kandidat.konec;
  } else if (u.posledniSlovo && u.za) {
    // Za textem hned následuje např. čárka: konec leží uvnitř souvislého inkoustu „1985,"
    const w = slova.find((x) => x.zacatek <= u.delka + 0.1 * s && x.konec >= u.delka - 0.1 * s);
    if (w) konec = w.zacatek + ((w.konec - w.zacatek) * sirkaPodleTvaru(u.posledniSlovo)) / sirkaPodleTvaru(u.posledniSlovo + u.za);
  }
  if (u.zacatekSlova === false && u.pred && u.prvniSlovo) {
    // Před textem je např. závorka: začátek leží uvnitř souvislého inkoustu „(1985"
    const w = slova.find((x) => x.zacatek <= 0.1 * s && x.konec >= -0.1 * s);
    if (w) zacatek = w.zacatek + ((w.konec - w.zacatek) * sirkaPodleTvaru(u.pred)) / sirkaPodleTvaru(u.pred + u.prvniSlovo);
  }
  if (konec - zacatek < 0.3 * s) return u;
  return { ...u, pocatek: bodUseku(u, zacatek, 0), delka: konec - zacatek };
}

// ------------------------------------------------------------------ kreslení

/** Původní obsah stránky obalí do q … Q, aby jeho transformace neovlivnila naše kreslení. */
function obalPuvodniObsah(pdf: PDFDocument, stranka: PDFPage) {
  const ctx = pdf.context;
  const zacatek = ctx.register(PDFContentStream.of(ctx.obj({}), [pushGraphicsState()]));
  const konec = ctx.register(PDFContentStream.of(ctx.obj({}), [popGraphicsState()]));
  stranka.node.wrapContentStreams(zacatek, konec);
}

function barva(b: { r: number; g: number; b: number }) {
  return rgb(b.r, b.g, b.b);
}

function uhel(r: Ramec) {
  return degrees((Math.atan2(r.smer[1], r.smer[0]) * 180) / Math.PI);
}

function skrtni(stranka: PDFPage, u: Usek) {
  const vyska = STRED_PISMA * u.velikost;
  const [x0, y0] = bodUseku(u, 0, vyska);
  const [x1, y1] = bodUseku(u, u.delka, vyska);
  stranka.drawLine({
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
    thickness: konfigurace.vzhled.tloustkaSkrtu,
    color: barva(konfigurace.vzhled.barvaSkrtu),
  });
}

function nakresliOpravu(
  stranka: PDFPage,
  r: Ramec,
  um: Umisteni,
  text: string,
  pismo: PDFFont,
  podpis: PDFImage | null,
  datum: string | null,
) {
  const rz: Rozvrzeni = um.rozvrzeni;
  const modra = barva(konfigurace.vzhled.barvaOpravy);
  const otoceni = uhel(r);
  const [tx, ty] = zRamce(r, um.u, um.v);
  stranka.drawText(text, { x: tx, y: ty, size: rz.velikostPisma, font: pismo, color: modra, rotate: otoceni });
  if (podpis && rz.podpis) {
    const [px, py] = zRamce(r, um.u + rz.podpis.u, um.v + rz.podpis.v);
    stranka.drawImage(podpis, { x: px, y: py, width: rz.podpis.sirka, height: rz.podpis.vyska, rotate: otoceni });
  }
  if (datum && rz.datum) {
    const [dx, dy] = zRamce(r, um.u + rz.datum.u, um.v);
    stranka.drawText(datum, { x: dx, y: dy, size: rz.datum.velikost, font: pismo, color: modra, rotate: otoceni });
  }
  if (um.spojnice) {
    const [ax, ay] = zRamce(r, ...um.spojnice.od);
    const [bx, by] = zRamce(r, ...um.spojnice.do);
    stranka.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: 0.5, color: modra, opacity: 0.8 });
  }
}
