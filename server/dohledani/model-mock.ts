/**
 * Testovací náhrada modelu Gemini (MOCK_GEMINI=1). Projde stejnou smyčku
 * nástrojů jako skutečný model: hledá na Disku, čte soubory a nakonec vrátí
 * připravený výsledek. Pro testovací dokumenty (smlouva č. 7712345678) vrací
 * správné odpovědi, pro cokoli jiného jen prázdné body s nízkou jistotou.
 *
 * Pro test chybových hlášek: značka #TEST-429-<cokoli> nebo #TEST-TIMEOUT-<cokoli>
 * v textu intervence vyvolá příslušnou chybu, ale jen poprvé (Zkusit znovu projde).
 */
import { HLASKY, ChybaModelu, type KrokModelu, type ModelKlient, type VysledekNastroje } from './model';
import type { Blok } from './vstupy';

const pockej = (ms: number, signal: AbortSignal) =>
  new Promise<void>((hotovo, chyba) => {
    const t = setTimeout(hotovo, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      chyba(new ChybaModelu('jina', 'Dohledání bylo zrušeno.'));
    });
  });

interface Relace {
  esd: string[];
  intervence: string;
  testovaci: boolean;
  krok: number;
  /** Co se našlo na Disku: název → odkaz */
  disk: Map<string, { id: string; odkaz: string }>;
}

const vyvolaneChyby = new Set<string>();

export function modelMock(): ModelKlient {
  const relace = new Map<string, Relace>();
  let citac = 0;

  const krok = (r: Relace, castecny: Partial<KrokModelu>): KrokModelu => {
    const id = `mock-${++citac}`;
    relace.set(id, r);
    return { id, volani: [], hledaniGoogle: [], cteneStranky: [], text: '', ...castecny };
  };

  return {
    nazev: 'testovací náhrada (bez Gemini)',
    testovaci: true,

    async zacni({ vstup, signal }) {
      await pockej(400, signal);
      const texty = vstup.filter((b): b is Extract<Blok, { druh: 'text' }> => b.druh === 'text').map((b) => b.text);
      const esd = texty.flatMap((t) => [...t.matchAll(/^ESD – soubor „(.+)":$/gm)].map((m) => m[1]));
      const intervence = texty.join('\n');
      // Značka #TEST-429-xyz / #TEST-TIMEOUT-xyz selže jen poprvé (Zkusit znovu pak projde).
      for (const znacka of intervence.match(/#TEST-(?:429|TIMEOUT)\S*/g) ?? []) {
        if (vyvolaneChyby.has(znacka)) continue;
        vyvolaneChyby.add(znacka);
        const limit = znacka.startsWith('#TEST-429');
        throw new ChybaModelu(limit ? 'limit' : 'timeout', limit ? HLASKY.limit : HLASKY.timeout);
      }
      const r: Relace = { esd, intervence, testovaci: intervence.includes('7712345678'), krok: 0, disk: new Map() };
      if (!r.testovaci) return krok(r, { text: JSON.stringify(obecnyVysledek(intervence)) });
      return krok(r, {
        volani: [
          { id: 'c1', nazev: 'drive_search', argumenty: { dotaz: 'získatelské číslo' } },
          { id: 'c2', nazev: 'drive_search', argumenty: { dotaz: 'adresy poboček' } },
        ],
      });
    },

    async pokracuj({ predchozi, vysledky = [], signal }) {
      await pockej(400, signal);
      const r = relace.get(predchozi);
      if (!r) throw new ChybaModelu('model', HLASKY.model);
      r.krok++;
      if (r.krok === 1) {
        // Z výsledků hledání vybrat soubory a přečíst je
        const nalezene = vysledky.flatMap((v) => souboryZVysledku(v));
        const seznam = nalezene.find((s) => s.nazev.includes('zprostředkovatel'));
        const adresy = nalezene.find((s) => s.nazev.includes('Adresy poboček'));
        for (const s of [seznam, adresy]) if (s) r.disk.set(s.nazev, { id: s.id, odkaz: s.odkaz });
        return krok(r, {
          volani: [seznam, adresy]
            .filter((s): s is NonNullable<typeof s> => Boolean(s))
            .map((s, i) => ({ id: `r${i}`, nazev: 'drive_read', argumenty: { id: s.id } })),
        });
      }
      return krok(r, { text: JSON.stringify(vysledekTestovacichDokumentu(r)) });
    },

    async nahrajSoubor(_data, mimeType, nazev) {
      return { uri: `mock://soubor/${encodeURIComponent(nazev)}`, mimeType, name: `files/mock-${++citac}` };
    },

    async smazSoubor() {},
  };
}

function souboryZVysledku(v: VysledekNastroje): { id: string; nazev: string; odkaz: string }[] {
  const prvni = v.obsah[0];
  if (v.nazev !== 'drive_search' || prvni?.druh !== 'text') return [];
  try {
    return (JSON.parse(prvni.text) as { soubory?: { id: string; nazev: string; odkaz: string }[] }).soubory ?? [];
  } catch {
    return [];
  }
}

function vyber(esd: string[], ...klice: string[]) {
  return esd.find((n) => klice.some((k) => n.toLowerCase().includes(k))) ?? esd[0] ?? '';
}

function vysledekTestovacichDokumentu(r: Relace) {
  const zaznam = vyber(r.esd, 'esd-1', 'zaznam', 'záznam');
  const plnaMoc = vyber(r.esd, 'esd-2', 'plna', 'plná');
  const odkaz = (nazev: string) => {
    const s = [...r.disk.entries()].find(([n]) => n.includes(nazev));
    return s ? `${s[0]} – ${s[1].odkaz}` : nazev;
  };
  return {
    body: [
      {
        bod_intervence: 'Datum narození klienta v dokumentaci neodpovídá smlouvě.',
        typ: 'oprava',
        vyskyty: [
          { soubor: zaznam, strana: 1, presny_text: '14. 5. 1985', kontext_pred: 'Datum narození', kontext_za: 'Bydliště' },
          { soubor: plnaMoc, strana: 1, presny_text: '14. 5. 1985', kontext_pred: 'Jan Testovací, nar.', kontext_za: ', bytem Lipová 12' },
        ],
        oprava: '14. 5. 1983',
        zdroj_typ: 'smlouva',
        zdroj_odkaz: 'Smlouva, čl. 1, str. 1',
        zdroj_strana: 1,
        konflikt: false,
        zduvodneni: 'Smlouva v čl. 1 uvádí u pojistníka Jana Testovacího datum narození 14. 5. 1983.',
        jistota: 'vysoka',
      },
      {
        bod_intervence: 'V záznamu z jednání chybí číslo smlouvy.',
        typ: 'doplneni',
        vyskyty: [{ soubor: zaznam, strana: 1, presny_text: 'Číslo smlouvy:', kontext_pred: 'pobočka Brno-střed', kontext_za: 'Klient' }],
        oprava: '7712345678',
        zdroj_typ: 'smlouva',
        zdroj_odkaz: 'Smlouva, záhlaví, str. 1',
        zdroj_strana: 1,
        konflikt: false,
        zduvodneni: 'Číslo smlouvy je v záhlaví smlouvy: Pojistná smlouva č. 7712345678.',
        jistota: 'vysoka',
      },
      {
        bod_intervence: 'Na plné moci je uvedeno chybné získatelské číslo zprostředkovatelky.',
        typ: 'oprava',
        vyskyty: [
          { soubor: plnaMoc, strana: 1, presny_text: '401234', kontext_pred: 'Vzorník a.s., získatelské číslo', kontext_za: '' },
        ],
        oprava: '401243',
        zdroj_typ: 'disk',
        zdroj_odkaz: odkaz('Seznam zprostředkovatelů'),
        zdroj_strana: 0,
        konflikt: false,
        zduvodneni: 'Smlouva uvádí jen jméno zprostředkovatelky. Podle seznamu zprostředkovatelů na Disku má Petra Ukázková získatelské číslo 401243.',
        jistota: 'vysoka',
      },
      {
        bod_intervence: 'V záznamu z jednání je chybně uvedena adresa pobočky.',
        typ: 'oprava',
        vyskyty: [
          {
            soubor: zaznam,
            strana: 2,
            presny_text: 'Masarykova 132/45, 602 00 Brno',
            kontext_pred: 'na pobočce Brno-střed,',
            kontext_za: '. Klient obdržel',
          },
        ],
        oprava: 'Masarykova 123/45, 602 00 Brno',
        zdroj_typ: 'disk',
        zdroj_odkaz: odkaz('Adresy poboček'),
        zdroj_strana: 0,
        konflikt: false,
        zduvodneni: 'Smlouva adresu pobočky neuvádí. Podle dokumentu Adresy poboček na Disku je adresa pobočky Brno-střed Masarykova 123/45, 602 00 Brno.',
        jistota: 'vysoka',
      },
      {
        bod_intervence: 'Na plné moci chybí podpis klienta.',
        typ: 'rucne',
        vyskyty: [],
        oprava: '',
        zdroj_typ: 'zadny',
        zdroj_odkaz: '',
        zdroj_strana: 0,
        konflikt: false,
        zduvodneni: 'Chybějící podpis nejde doplnit škrtnutím a dopsáním. Klient musí plnou moc podepsat na straně 2 (Podpis klienta).',
        jistota: 'vysoka',
      },
    ],
  };
}

/** Pro jiné než testovací dokumenty: každý očíslovaný řádek intervence jako bod bez opravy. */
function obecnyVysledek(intervence: string) {
  const radky = intervence
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => /^\d+[.)]\s+/.test(r));
  const body = (radky.length ? radky : [intervence.trim().slice(0, 200) || 'Intervence']).map((r) => ({
    bod_intervence: r.replace(/^\d+[.)]\s+/, ''),
    typ: 'oprava',
    vyskyty: [],
    oprava: '',
    zdroj_typ: 'zadny',
    zdroj_odkaz: '',
    zdroj_strana: 0,
    konflikt: false,
    zduvodneni: 'Testovací režim: skutečné dohledání proběhne jen s modelem Gemini (v AI Studiu).',
    jistota: 'nizka',
  }));
  return { body };
}
