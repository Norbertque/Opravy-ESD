/**
 * Kam na stránce napsat opravu a podpis, aby se nic nepřekrývalo.
 *
 * Počítá se v „rámci řádku": osa u vede podél textu (směr čtení), osa v nahoru
 * kolmo na účaří, počátek je na začátku úseku na účaří. Díky tomu stejný postup
 * funguje i na otočených stránkách. Co je volné, rozhoduje funkce jeVolno
 * (okraje stránky, textová vrstva, vyrenderovaná stránka a už umístěné opravy).
 *
 * Pořadí pokusů podle zadání: vpravo vedle textu → nad text → pod text →
 * nejbližší volné místo (okraj stránky) se spojovací čarou. U každé polohy se
 * nejdřív zkusí plná velikost, pak zmenšená.
 */
import type { Usek } from '../pdf/hledani';

export interface RamecBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Rozměry opravy (text + podpis + případně datum) vůči počátku na účaří textu opravy. */
export interface Rozvrzeni {
  velikostPisma: number;
  sirkaTextu: number;
  podpis: { u: number; v: number; sirka: number; vyska: number } | null;
  datum: { u: number; sirkaTextu: number; velikost: number } | null;
  /** Obrys celé opravy vůči počátku. */
  box: RamecBox;
}

export interface Umisteni {
  /** Počátek textu opravy (na účaří) v rámci řádku. */
  u: number;
  v: number;
  rozvrzeni: Rozvrzeni;
  poloha: 'vpravo' | 'nad' | 'pod' | 'okraj';
  /** Spojovací čára od konce škrtnutého textu k opravě (jen u polohy „okraj"). */
  spojnice: { od: [number, number]; do: [number, number] } | null;
  /** Nenašlo se volné místo – oprava je vpravo, i když se může překrývat. */
  nouzove: boolean;
}

export interface VstupRozvrzeni {
  /** Šířka textu v daném písmu a velikosti (body). */
  sirkaTextu: (text: string, velikost: number) => number;
  text: string;
  /** Poměr šířka/výška obrázku podpisu (null = bez podpisu). */
  pomerPodpisu: number | null;
  datum: string | null;
  velikostPisma: number;
  vyskaPodpisu: number;
  mezera: number;
}

/** Spodek a vrchol písma vůči účaří. */
const SPODEK = -0.25;
const VRCHOL = 0.85;
/** Výška středu malých písmen nad účařím (tudy vede škrt a k ní se zarovná podpis). */
export const STRED_PISMA = 0.3;

export function rozvrhni(v: VstupRozvrzeni): Rozvrzeni {
  const s = v.velikostPisma;
  const sirkaTextu = v.sirkaTextu(v.text, s);
  let u = sirkaTextu;
  const stred = STRED_PISMA * s;
  let v0 = SPODEK * s;
  let v1 = VRCHOL * s;
  let podpis: Rozvrzeni['podpis'] = null;
  if (v.pomerPodpisu) {
    const vyska = v.vyskaPodpisu;
    podpis = { u: u + v.mezera, v: stred - vyska / 2, sirka: vyska * v.pomerPodpisu, vyska };
    u = podpis.u + podpis.sirka;
    v0 = Math.min(v0, podpis.v);
    v1 = Math.max(v1, podpis.v + vyska);
  }
  let datum: Rozvrzeni['datum'] = null;
  if (v.datum) {
    const velikost = s * 0.85;
    datum = { u: u + v.mezera, sirkaTextu: v.sirkaTextu(v.datum, velikost), velikost };
    u = datum.u + datum.sirkaTextu;
  }
  return { velikostPisma: s, sirkaTextu, podpis, datum, box: { u0: 0, u1: u, v0, v1 } };
}

export function posun(box: RamecBox, u: number, v: number): RamecBox {
  return { u0: box.u0 + u, u1: box.u1 + u, v0: box.v0 + v, v1: box.v1 + v };
}

export interface ParametryUmisteni {
  /** Úsek, za který se píše (u opravy přes více řádků poslední řádek). */
  posledni: Usek;
  /** První úsek (pro polohu nad textem). */
  prvni: Usek;
  /** Varianty rozvržení: plná velikost, pak zmenšené. */
  varianty: Rozvrzeni[];
  mezera: number;
  /** Volné místo? (box v rámci řádku úseku `posledni`) */
  jeVolno: (box: RamecBox) => boolean;
  /** Hranice stránky v rámci řádku (oříznutá o okraj). */
  stranka: RamecBox;
}

/** Najde polohu opravy. Rámec řádku je určen úsekem `posledni`. */
export function najdiUmisteni(p: ParametryUmisteni): Umisteni {
  const { posledni: R, mezera } = p;
  const vR = R.velikost;
  // Začátek prvního úseku v rámci posledního (u víceřádkového textu leží výš).
  const dx = p.prvni.pocatek[0] - R.pocatek[0];
  const dy = p.prvni.pocatek[1] - R.pocatek[1];
  const prvniU = dx * R.smer[0] + dy * R.smer[1];
  const prvniV = dx * R.nahoru[0] + dy * R.nahoru[1];
  const horniOkrajTextu = prvniV + VRCHOL * p.prvni.velikost;
  const dolniOkrajTextu = SPODEK * vR;

  const zkus = (poloha: Umisteni['poloha'], kandidati: (r: Rozvrzeni) => [number, number][]): Umisteni | null => {
    for (const r of p.varianty) {
      for (const [u, v] of kandidati(r)) {
        if (p.jeVolno(posun(r.box, u, v))) return { u, v, rozvrzeni: r, poloha, spojnice: null, nouzove: false };
      }
    }
    return null;
  };

  // Na šířku stránky: když se oprava nevejde od začátku textu, posune se doleva.
  const vejdeSe = (u: number, r: Rozvrzeni) => Math.min(u, p.stranka.u1 - r.box.u1);

  const vpravo = zkus('vpravo', () => [[R.delka + mezera, 0]]);
  if (vpravo) return vpravo;
  const nad = zkus('nad', (r) => [[vejdeSe(prvniU, r), horniOkrajTextu + mezera - r.box.v0]]);
  if (nad) return nad;
  const pod = zkus('pod', (r) => [[vejdeSe(0, r), dolniOkrajTextu - mezera - r.box.v1]]);
  if (pod) return pod;

  // Nejbližší volné místo: okraje stránky a volné řádky nad a pod textem.
  const okraj = zkus('okraj', (r) => {
    const sirka = r.box.u1 - r.box.u0;
    const sloupce = [p.stranka.u1 - sirka, R.delka + mezera, 0, p.stranka.u0];
    const kandidati: [number, number][] = [];
    for (let posunV = 0; posunV <= 200; posunV += 4)
      for (const znamenko of posunV === 0 ? [1] : [1, -1])
        for (const u of sloupce) kandidati.push([u, znamenko * posunV]);
    return kandidati;
  });
  if (okraj) {
    const r = okraj.rozvrzeni;
    okraj.spojnice = {
      od: [R.delka, STRED_PISMA * vR],
      do: [okraj.u + (okraj.u >= R.delka ? 0 : r.box.u1), okraj.v + STRED_PISMA * r.velikostPisma],
    };
    return okraj;
  }
  const r = p.varianty[p.varianty.length - 1];
  return { u: R.delka + mezera, v: 0, rozvrzeni: r, poloha: 'vpravo', spojnice: null, nouzove: true };
}
