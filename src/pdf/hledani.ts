/**
 * Hledání přesného textu v textové vrstvě stránky PDF.
 *
 * Text z PDF a hledaný text se porovnávají ve „zjednodušené" podobě: bez mezer
 * (normální i nezlomitelné), bez rozdílu velkých a malých písmen a se sjednocenými
 * pomlčkami a uvozovkami. Spojovník na konci řádku se zkouší jednou vynechat
 * (dělené slovo „Masa-|rykova") a jednou ponechat (složenina „Brno-|střed").
 * Text může pokračovat na dalším řádku – výsledkem je pak víc úseků (jeden na řádek).
 *
 * Modul nepotřebuje prohlížeč: šířku části textu měří funkce, kterou dodá volající
 * (v prohlížeči podle skutečného písma z PDF, jinak poměrem počtu znaků).
 */

/** Položka textové vrstvy (podmnožina TextItem z pdf.js, nebo slovo z OCR). */
export interface PolozkaTextu {
  str: string;
  /** Matice [a, b, c, d, e, f] v souřadnicích stránky PDF (body). */
  transform: number[];
  /** Šířka položky podél účaří (body). */
  width: number;
  hasEOL?: boolean;
  fontName?: string;
}

/** Úsek textu na jednom řádku – otočený obdélník v souřadnicích stránky PDF. */
export interface Usek {
  /** Začátek na účaří. */
  pocatek: [number, number];
  /** Jednotkový vektor směru textu (podél účaří). */
  smer: [number, number];
  /** Jednotkový vektor „nahoru" (kolmo na účaří, k horní části písmen). */
  nahoru: [number, number];
  /** Délka úseku podél účaří (body). */
  delka: number;
  /** Velikost písma (body). */
  velikost: number;
}

export interface Shoda {
  /** Úseky po řádcích. */
  useky: Usek[];
  /** Nalezený text tak, jak je v PDF. */
  text: string;
  /** Jak dobře sedí okolní text (kontext_pred / kontext_za). */
  skoreKontextu: number;
}

/** Změří šířku textu v daném písmu (stejné jednotky pro celý řetězec i jeho část). */
export type MeritkoTextu = (text: string, polozka: PolozkaTextu) => number;

/** Bez znalosti písma: šířka úměrná počtu znaků. */
export const meritkoPodleZnaku: MeritkoTextu = (text) => text.length;

// ------------------------------------------------------------------ zjednodušení textu

const MEZERY = /[\s  -​  　]/;
const POMLCKY = /[‐-―−­]/g;

/** Zjednodušení jednoho znaku (bez mezer – ty se vynechávají zvlášť). */
function zjednodusZnak(znak: string) {
  return znak
    .normalize('NFC')
    .toLowerCase()
    .replace(POMLCKY, '-')
    .replace(/[„“”″"]/g, '"')
    .replace(/[‚‘’′']/g, "'");
}

export function zjednodus(text: string) {
  let vysledek = '';
  for (const znak of text.normalize('NFC')) if (!MEZERY.test(znak)) vysledek += zjednodusZnak(znak);
  return vysledek;
}

// ------------------------------------------------------------------ index stránky

interface ZnakIndexu {
  /** Položka a pozice znaku v ní (−1 = oddělovač mezi položkami). */
  polozka: number;
  pozice: number;
}

interface IndexStranky {
  /** Surový text stránky (s mezerami a konci řádků) a odkud který znak pochází. */
  surovy: string;
  puvod: ZnakIndexu[];
  polozky: PolozkaTextu[];
}

function geometrie(p: PolozkaTextu) {
  const [a, b, c, d, e, f] = p.transform;
  const velikost = Math.hypot(a, b) || Math.hypot(c, d) || 1;
  const smer: [number, number] = [a / (Math.hypot(a, b) || 1), b / (Math.hypot(a, b) || 1)];
  let nahoru: [number, number] = [c / (Math.hypot(c, d) || 1), d / (Math.hypot(c, d) || 1)];
  // Některé PDF mají zrcadlenou matici – „nahoru" musí být vlevo od směru textu.
  if (smer[0] * nahoru[1] - smer[1] * nahoru[0] < 0) nahoru = [-nahoru[0], -nahoru[1]];
  if (!Number.isFinite(nahoru[0]) || (nahoru[0] === 0 && nahoru[1] === 0)) nahoru = [-smer[1], smer[0]];
  return { pocatek: [e, f] as [number, number], smer, nahoru, velikost };
}

/** Postaví text stránky z položek; mezi položky vloží mezeru nebo konec řádku podle polohy. */
export function postavIndex(polozky: PolozkaTextu[]): IndexStranky {
  let surovy = '';
  const puvod: ZnakIndexu[] = [];
  const pouzite = polozky.filter((p) => p.str.length > 0);
  let predchozi: { p: PolozkaTextu; g: ReturnType<typeof geometrie> } | null = null;
  pouzite.forEach((p, i) => {
    const g = geometrie(p);
    if (predchozi) {
      const pg = predchozi.g;
      const dx = g.pocatek[0] - pg.pocatek[0];
      const dy = g.pocatek[1] - pg.pocatek[1];
      const posunNahoru = dx * pg.nahoru[0] + dy * pg.nahoru[1];
      const posunVpred = dx * pg.smer[0] + dy * pg.smer[1];
      const jinyRadek = predchozi.p.hasEOL || Math.abs(posunNahoru) > 0.5 * pg.velikost || posunVpred < -0.5 * pg.velikost;
      const mezera = posunVpred - predchozi.p.width;
      const oddelovac = jinyRadek ? '\n' : mezera > 0.15 * pg.velikost ? ' ' : '';
      if (oddelovac) {
        surovy += oddelovac;
        puvod.push({ polozka: -1, pozice: -1 });
      }
    }
    for (let j = 0; j < p.str.length; j++) {
      surovy += p.str[j];
      puvod.push({ polozka: i, pozice: j });
    }
    predchozi = { p, g };
  });
  return { surovy, puvod, polozky: pouzite };
}

/**
 * Zjednodušený text s mapováním zpět do surového textu.
 * @param vynechatDeleni vynechat spojovník na konci řádku (dělené slovo)
 */
function zjednodusIndex(surovy: string, vynechatDeleni: boolean) {
  let text = '';
  const naSurovy: number[] = [];
  for (let i = 0; i < surovy.length; i++) {
    const znak = surovy[i];
    if (MEZERY.test(znak)) continue;
    if (vynechatDeleni && /[-­‐‑]/.test(znak)) {
      // spojovník, za kterým (po mezerách) následuje konec řádku a malé písmeno
      let j = i + 1;
      while (j < surovy.length && surovy[j] !== '\n' && MEZERY.test(surovy[j])) j++;
      if (surovy[j] === '\n' && i > 0 && /\p{L}/u.test(surovy[i - 1])) {
        let k = j + 1;
        while (k < surovy.length && MEZERY.test(surovy[k])) k++;
        if (k < surovy.length && /\p{Ll}/u.test(surovy[k])) continue;
      }
    }
    for (const z of zjednodusZnak(znak)) {
      text += z;
      naSurovy.push(i);
    }
  }
  return { text, naSurovy };
}

// ------------------------------------------------------------------ hledání

/**
 * Najde všechny výskyty `hledany` na stránce. Seřazeno od nejlepší shody kontextu.
 * Shoda musí začínat a končit na hranici slova (aby „12" nenašlo „1250").
 */
export function najdiText(
  polozky: PolozkaTextu[],
  hledany: string,
  kontext: { pred?: string; za?: string } = {},
  meritko: MeritkoTextu = meritkoPodleZnaku,
): Shoda[] {
  const jehla = zjednodus(hledany);
  if (!jehla) return [];
  const index = postavIndex(polozky);
  const nalezene = new Map<string, { od: number; do: number }>();

  for (const vynechatDeleni of [true, false]) {
    const z = zjednodusIndex(index.surovy, vynechatDeleni);
    for (let i = z.text.indexOf(jehla); i !== -1; i = z.text.indexOf(jehla, i + 1)) {
      const od = z.naSurovy[i];
      const doZnaku = z.naSurovy[i + jehla.length - 1] + 1;
      if (!naHraniciSlova(index.surovy, od, doZnaku, hledany)) continue;
      nalezene.set(`${od}-${doZnaku}`, { od, do: doZnaku });
    }
  }

  const shody = [...nalezene.values()].map(({ od, do: doZnaku }) => ({
    useky: usekyRozsahu(index, od, doZnaku, meritko),
    text: index.surovy.slice(od, doZnaku),
    skoreKontextu: skoreKontextu(index.surovy, od, doZnaku, kontext),
  }));
  return shody.sort((a, b) => b.skoreKontextu - a.skoreKontextu);
}

/**
 * Vybere jedinou shodu: když je jen jedna, nebo když jedna má jasně nejlepší kontext.
 * Jinak vrátí null (uživatel pak klikne na správné místo).
 */
export function jednoznacnaShoda(shody: Shoda[]): Shoda | null {
  if (shody.length === 1) return shody[0];
  if (shody.length > 1 && shody[0].skoreKontextu > 0 && shody[0].skoreKontextu > shody[1].skoreKontextu) return shody[0];
  return null;
}

function naHraniciSlova(surovy: string, od: number, doZnaku: number, hledany: string) {
  const alnum = /[\p{L}\p{N}]/u;
  const zacatek = hledany.trim()[0] ?? '';
  const konec = hledany.trim().slice(-1);
  if (alnum.test(zacatek) && od > 0 && alnum.test(surovy[od - 1])) return false;
  if (alnum.test(konec) && doZnaku < surovy.length && alnum.test(surovy[doZnaku])) return false;
  return true;
}

/** Délka nejdelšího společného konce (pred) a začátku (za) ve zjednodušené podobě. */
function skoreKontextu(surovy: string, od: number, doZnaku: number, kontext: { pred?: string; za?: string }) {
  let skore = 0;
  const pred = zjednodus(kontext.pred ?? '');
  const za = zjednodus(kontext.za ?? '');
  if (pred) {
    const okoli = zjednodus(surovy.slice(Math.max(0, od - pred.length * 3 - 20), od));
    let n = 0;
    while (n < pred.length && n < okoli.length && pred[pred.length - 1 - n] === okoli[okoli.length - 1 - n]) n++;
    skore += n;
  }
  if (za) {
    const okoli = zjednodus(surovy.slice(doZnaku, doZnaku + za.length * 3 + 20));
    let n = 0;
    while (n < za.length && n < okoli.length && za[n] === okoli[n]) n++;
    skore += n;
  }
  return skore;
}

/** Převede rozsah znaků surového textu na úseky po řádcích. */
function usekyRozsahu(index: IndexStranky, od: number, doZnaku: number, meritko: MeritkoTextu): Usek[] {
  // Rozsahy po položkách
  const castiPolozek = new Map<number, { od: number; do: number }>();
  for (let i = od; i < doZnaku; i++) {
    const { polozka, pozice } = index.puvod[i];
    if (polozka < 0) continue;
    const c = castiPolozek.get(polozka);
    if (c) c.do = pozice + 1;
    else castiPolozek.set(polozka, { od: pozice, do: pozice + 1 });
  }

  const useky: Usek[] = [];
  for (const [i, cast] of [...castiPolozek.entries()].sort((a, b) => a[0] - b[0])) {
    const p = index.polozky[i];
    // Mezery na krajích nejsou součástí škrtnutí
    let zac = cast.od;
    let kon = cast.do;
    while (zac < kon && MEZERY.test(p.str[zac])) zac++;
    while (kon > zac && MEZERY.test(p.str[kon - 1])) kon--;
    if (zac >= kon) continue;
    const g = geometrie(p);
    const cela = meritko(p.str, p) || 1;
    const x0 = (meritko(p.str.slice(0, zac), p) / cela) * p.width;
    const x1 = (meritko(p.str.slice(0, kon), p) / cela) * p.width;
    const pocatek: [number, number] = [g.pocatek[0] + g.smer[0] * x0, g.pocatek[1] + g.smer[1] * x0];
    const usek: Usek = { pocatek, smer: g.smer, nahoru: g.nahoru, delka: x1 - x0, velikost: g.velikost };

    // Navazuje na předchozí úsek na stejném řádku? Spojit.
    const minuly = useky[useky.length - 1];
    if (minuly && stejnyRadek(minuly, usek)) {
      const konec = [usek.pocatek[0] + usek.smer[0] * usek.delka, usek.pocatek[1] + usek.smer[1] * usek.delka];
      minuly.delka = (konec[0] - minuly.pocatek[0]) * minuly.smer[0] + (konec[1] - minuly.pocatek[1]) * minuly.smer[1];
      minuly.velikost = Math.max(minuly.velikost, usek.velikost);
    } else useky.push(usek);
  }
  return useky;
}

function stejnyRadek(a: Usek, b: Usek) {
  const dx = b.pocatek[0] - a.pocatek[0];
  const dy = b.pocatek[1] - a.pocatek[1];
  const posunNahoru = dx * a.nahoru[0] + dy * a.nahoru[1];
  const stejnySmer = Math.abs(a.smer[0] * b.smer[0] + a.smer[1] * b.smer[1] - 1) < 0.01;
  return stejnySmer && Math.abs(posunNahoru) < 0.5 * a.velikost;
}

/** Bod na úseku: `podel` body od začátku podél účaří, `vyska` bodů nad účařím. */
export function bodUseku(u: Usek, podel: number, vyska: number): [number, number] {
  return [
    u.pocatek[0] + u.smer[0] * podel + u.nahoru[0] * vyska,
    u.pocatek[1] + u.smer[1] * podel + u.nahoru[1] * vyska,
  ];
}
