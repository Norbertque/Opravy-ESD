/**
 * Najde výskyty z dohledání v PDF souborech ESD (textová vrstva přes pdf.js).
 * Když model uvede špatnou stranu, hledá se i na ostatních stranách téhož souboru.
 */
import { jednoznacnaShoda, najdiText, type PolozkaTextu, type Shoda, type Usek } from '../pdf/hledani';
import { otevriPdf, zavriPdf, type PdfDokument } from '../pdf/pdfjs';
import type { Vyskyt } from '../sdilene/dohledani';
import type { SouborInfo } from '../ulozeni/typy';
import { nactiSoubor } from '../ulozeni/uloziste';

export type StavUmisteni = 'nalezeno' | 'vice' | 'nenalezeno' | 'sken' | 'vybrano';

export interface UmisteniVyskytu {
  /** nalezeno = appka našla jedno místo; vybrano = vybral uživatel; vice/nenalezeno/sken = je potřeba vybrat ručně */
  stav: StavUmisteni;
  /** ID souboru ESD v úložišti (prázdné, když soubor neexistuje). */
  souborId: string;
  strana: number;
  useky: Usek[];
  /** Při více výskytech: kandidáti k výběru. */
  kandidati?: { strana: number; useky: Usek[] }[];
}

export function jeUmisteno(u: UmisteniVyskytu) {
  return u.stav === 'nalezeno' || u.stav === 'vybrano';
}

/** Otevřené PDF souborů ESD a jejich textová vrstva (načítá se jednou). */
export class DokumentyEsd {
  private dokumenty = new Map<string, Promise<PdfDokument>>();
  private texty = new Map<string, Promise<PolozkaTextu[]>>();

  constructor(private readonly esd: SouborInfo[]) {}

  souborPodleNazvu(nazev: string) {
    return this.esd.find((s) => s.nazev === nazev);
  }

  dokument(soubor: SouborInfo) {
    let d = this.dokumenty.get(soubor.id);
    if (!d) {
      d = nactiSoubor(soubor.id).then(async (blob) => {
        if (!blob) throw new Error(`Soubor ${soubor.nazev} chybí v úložišti.`);
        return otevriPdf(await blob.arrayBuffer());
      });
      this.dokumenty.set(soubor.id, d);
    }
    return d;
  }

  async polozky(soubor: SouborInfo, strana: number): Promise<PolozkaTextu[]> {
    const klic = `${soubor.id}:${strana}`;
    let t = this.texty.get(klic);
    if (!t) {
      t = this.dokument(soubor).then(async (doc) => {
        const obsah = await (await doc.getPage(strana)).getTextContent();
        return obsah.items.filter((i): i is (typeof obsah.items)[number] & PolozkaTextu => 'str' in i);
      });
      this.texty.set(klic, t);
    }
    return t;
  }

  async zavri() {
    // Nejdřív vyprázdnit (další volání otevřou PDF znovu), teprve pak zavírat.
    const otevrene = [...this.dokumenty.values()];
    this.dokumenty.clear();
    this.texty.clear();
    for (const d of otevrene) await d.then(zavriPdf).catch(() => {});
  }
}

/** Najde jeden výskyt z dohledání v PDF. */
export async function najdiVyskyt(dokumenty: DokumentyEsd, vyskyt: Vyskyt): Promise<UmisteniVyskytu> {
  const soubor = dokumenty.souborPodleNazvu(vyskyt.soubor);
  if (!soubor) return { stav: 'nenalezeno', souborId: '', strana: vyskyt.strana, useky: [] };
  const stran = soubor.kontrola?.stran || (await dokumenty.dokument(soubor)).numPages;
  const strana = Math.min(Math.max(1, vyskyt.strana), stran);
  const bezTextu = new Set(soubor.kontrola?.stranyBezTextu ?? []);
  const zaklad = { souborId: soubor.id, strana };
  const kontext = { pred: vyskyt.kontext_pred, za: vyskyt.kontext_za };

  const hledej = async (s: number) =>
    (await najdiText(await dokumenty.polozky(soubor, s), vyskyt.presny_text, kontext)).map((shoda) => ({ strana: s, shoda }));

  // 1) strana uvedená modelem
  if (!bezTextu.has(strana)) {
    const naStrane = await hledej(strana);
    const jedna = jednoznacnaShoda(naStrane.map((n) => n.shoda));
    if (jedna) return { ...zaklad, stav: 'nalezeno', useky: jedna.useky };
    if (naStrane.length > 1) return { ...zaklad, stav: 'vice', useky: [], kandidati: naStrane.map(naKandidata) };
  }

  // 2) ostatní strany téhož souboru
  const jinde: { strana: number; shoda: Shoda }[] = [];
  for (let s = 1; s <= stran; s++) if (s !== strana && !bezTextu.has(s)) jinde.push(...(await hledej(s)));
  jinde.sort((a, b) => b.shoda.skoreKontextu - a.shoda.skoreKontextu);
  const jedna = jednoznacnaShoda(jinde.map((n) => n.shoda));
  if (jedna) {
    const s = jinde.find((n) => n.shoda === jedna)!.strana;
    return { ...zaklad, strana: s, stav: 'nalezeno', useky: jedna.useky };
  }
  if (jinde.length > 1) return { ...zaklad, stav: 'vice', useky: [], kandidati: jinde.map(naKandidata) };

  // 3) nic – na skenu je potřeba OCR, jinak ruční výběr
  return { ...zaklad, stav: bezTextu.has(strana) ? 'sken' : 'nenalezeno', useky: [] };
}

function naKandidata(n: { strana: number; shoda: Shoda }) {
  return { strana: n.strana, useky: n.shoda.useky };
}
