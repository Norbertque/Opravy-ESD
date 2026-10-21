/**
 * Převody mezi souřadnicemi náhledu (pixely pdf.js viewportu, počátek vlevo nahoře)
 * a souřadnicemi stránky PDF (body, počátek vlevo dole), ve kterých kreslí pdf-lib.
 *
 * Úsek textu je otočený obdélník v souřadnicích stránky (počátek na účaří, směr textu,
 * směr nahoru, délka, velikost písma). Díky tomu stejný kód funguje i pro otočené
 * stránky (/Rotate) a pro stránky s ořezem (CropBox) – o to se stará viewport pdf.js.
 */
import { bodUseku, type PolozkaTextu, type Usek } from '../pdf/hledani';

/** Část PageViewport z pdf.js, kterou potřebujeme (dá se snadno podstrčit v testech). */
export interface Viewport {
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint(x: number, y: number): number[];
}

export interface Obdelnik {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Spodní a horní okraj písma vůči účaří (násobky velikosti písma). */
export const SPODEK_PISMA = -0.25;
export const VRCHOL_PISMA = 0.85;

/** Rohy úseku v souřadnicích stránky (od spodku po vrchol písma). */
export function rohyUseku(u: Usek, spodek = SPODEK_PISMA, vrchol = VRCHOL_PISMA): [number, number][] {
  return [
    bodUseku(u, 0, spodek * u.velikost),
    bodUseku(u, u.delka, spodek * u.velikost),
    bodUseku(u, u.delka, vrchol * u.velikost),
    bodUseku(u, 0, vrchol * u.velikost),
  ];
}

/** Obdélník úseku v náhledu (pixely). */
export function obdelnikUseku(u: Usek, viewport: Viewport, okraj = 0): Obdelnik {
  const body = rohyUseku(u).map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const xs = body.map((b) => b[0]);
  const ys = body.map((b) => b[1]);
  const left = Math.min(...xs) - okraj;
  const top = Math.min(...ys) - okraj;
  return { left, top, width: Math.max(...xs) + okraj - left, height: Math.max(...ys) + okraj - top };
}

/** Jednotkový vektor ve stránce, který v náhledu míří vpravo (resp. nahoru). */
function smeryNahledu(viewport: Viewport, x: number, y: number) {
  const p0 = viewport.convertToPdfPoint(x, y);
  const pVpravo = viewport.convertToPdfPoint(x + 100, y);
  const pNahoru = viewport.convertToPdfPoint(x, y - 100);
  const norm = (a: number[], b: number[]): [number, number] => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  return { smer: norm(p0, pVpravo), nahoru: norm(p0, pNahoru) };
}

/**
 * Úsek z obdélníku nataženého v náhledu. Když obdélník protíná řádek textu,
 * převezme se jeho účaří a velikost písma (škrt pak sedí na textu), jinak se
 * škrtá středem obdélníku.
 */
export function usekZObdelniku(o: Obdelnik, viewport: Viewport, polozky: PolozkaTextu[] = []): Usek {
  const { smer, nahoru } = smeryNahledu(viewport, o.left, o.top + o.height);
  const vlevoDole = viewport.convertToPdfPoint(o.left, o.top + o.height);
  const vpravoNahore = viewport.convertToPdfPoint(o.left + o.width, o.top);
  const dx = vpravoNahore[0] - vlevoDole[0];
  const dy = vpravoNahore[1] - vlevoDole[1];
  const delka = Math.abs(dx * smer[0] + dy * smer[1]);
  const vyska = Math.abs(dx * nahoru[0] + dy * nahoru[1]);

  // Řádek textu, který obdélník protíná (stejný směr, účaří uvnitř obdélníku)
  const radky = polozky
    .map((p) => {
      const [a, b, , , e, f] = p.transform;
      const velikost = Math.hypot(a, b);
      if (!velikost || Math.abs((a / velikost) * smer[0] + (b / velikost) * smer[1] - 1) > 0.01) return null;
      const naUcari = (e - vlevoDole[0]) * nahoru[0] + (f - vlevoDole[1]) * nahoru[1];
      const zacatek = (e - vlevoDole[0]) * smer[0] + (f - vlevoDole[1]) * smer[1];
      const konec = zacatek + p.width;
      const protina = naUcari + 0.3 * velikost > 0 && naUcari + 0.3 * velikost < vyska && konec > 0 && zacatek < delka;
      return protina ? { naUcari, velikost } : null;
    })
    .filter((r): r is { naUcari: number; velikost: number } => r !== null);
  const vsechnyStejne = radky.length > 0 && radky.every((r) => Math.abs(r.naUcari - radky[0].naUcari) < 0.3 * r.velikost);

  if (vsechnyStejne) {
    const { naUcari, velikost } = radky[0];
    return {
      pocatek: [vlevoDole[0] + nahoru[0] * naUcari, vlevoDole[1] + nahoru[1] * naUcari],
      smer,
      nahoru,
      delka,
      velikost,
    };
  }
  // Bez textu: „písmo" vyplní obdélník, škrt pak vede zhruba jeho středem.
  const velikost = vyska / (VRCHOL_PISMA - SPODEK_PISMA);
  const odspodu = -SPODEK_PISMA * velikost;
  return {
    pocatek: [vlevoDole[0] + nahoru[0] * odspodu, vlevoDole[1] + nahoru[1] * odspodu],
    smer,
    nahoru,
    delka,
    velikost,
  };
}

/** Bod pro doplnění z kliknutí: úsek nulové délky na řádku pod kurzorem. */
export function usekZBodu(x: number, y: number, viewport: Viewport, polozky: PolozkaTextu[] = []): Usek {
  return { ...usekZObdelniku({ left: x - 1, top: y - 6, width: 2, height: 12 }, viewport, polozky), delka: 0 };
}
