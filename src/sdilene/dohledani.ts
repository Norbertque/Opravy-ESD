/**
 * Výsledek dohledání – společné pro server i prohlížeč.
 * Názvy polí odpovídají zadání (bod_intervence, presny_text, …), aby byly
 * stejné v promptu, v JSON schématu pro Gemini i v kódu.
 */

export type TypBodu = 'oprava' | 'doplneni' | 'rucne';
export type ZdrojTyp = 'smlouva' | 'disk' | 'web' | 'zadny';
export type Jistota = 'vysoka' | 'stredni' | 'nizka';

/** Jedno místo v ESD, kde se má oprava provést. */
export interface Vyskyt {
  /** Název souboru ESD přesně tak, jak byl nahrán. */
  soubor: string;
  /** Strana od 1. */
  strana: number;
  /** Celá chybná hodnota doslova (u doplnění text, za který se dopisuje). */
  presny_text: string;
  kontext_pred: string;
  kontext_za: string;
}

export interface BodIntervence {
  /** Pořadí bodu (1, 2, …) – doplňuje server. */
  cislo: number;
  /** Text bodu intervence doslova. */
  bod_intervence: string;
  typ: TypBodu;
  vyskyty: Vyskyt[];
  /** Správný údaj. Prázdné = nenalezeno nebo konflikt. */
  oprava: string;
  zdroj_typ: ZdrojTyp;
  /** Článek a strana smlouvy, název a odkaz souboru na Disku, nebo URL. */
  zdroj_odkaz: string;
  /** Strana smlouvy, když je zdrojem smlouva (jinak 0). */
  zdroj_strana: number;
  /** Zdroje si odporují – oprava se nenavrhuje. */
  konflikt: boolean;
  /** Proč je oprava taková; u nenalezeného údaje i kde všude se hledalo. */
  zduvodneni: string;
  jistota: Jistota;
}

export interface VysledekDohledani {
  body: BodIntervence[];
  /** Model, který dohledání provedl. */
  model: string;
  /** Kolikrát model použil nástroj (Disk, ARES, internet). */
  pocetVolaniNastroju: number;
  /** Výsledek je z testovacího režimu (MOCK_GEMINI) – není skutečný. */
  testovaci: boolean;
}

/** Zprávy, které server posílá prohlížeči během dohledání (jeden JSON na řádek). */
export type UdalostDohledani =
  | { typ: 'prubeh'; text: string }
  | { typ: 'vysledek'; vysledek: VysledekDohledani }
  | { typ: 'chyba'; kod: KodChyby; zprava: string };

export type KodChyby =
  | 'limit' // 429 – přetížení nebo vyčerpaný limit
  | 'tarif' // funkce není na tarifu klíče dostupná (např. hledání Google na free tieru)
  | 'timeout'
  | 'klic' // chybí nebo neplatný Gemini klíč
  | 'disk' // přihlášení k Disku chybí nebo vypršelo
  | 'vstup' // špatně nahrané soubory
  | 'model' // model vrátil nepoužitelnou odpověď
  | 'jina';

/** Chyby, u kterých má smysl tlačítko Zkusit znovu. */
export const OPAKOVATELNE: KodChyby[] = ['limit', 'timeout', 'model', 'jina', 'disk'];

/**
 * JSON schéma výstupu pro Gemini (strukturovaný výstup).
 * Jen jednoduché konstrukce – Gemini nepodporuje všechny části JSON Schema.
 */
export const SCHEMA_VYSLEDKU = {
  type: 'object',
  properties: {
    body: {
      type: 'array',
      description: 'Každý bod intervence zvlášť, ve stejném pořadí jako v intervenci.',
      items: {
        type: 'object',
        properties: {
          bod_intervence: { type: 'string', description: 'Text bodu intervence doslova.' },
          typ: {
            type: 'string',
            enum: ['oprava', 'doplneni', 'rucne'],
            description: 'oprava = škrtnout a napsat správně; doplneni = jen dopsat chybějící údaj; rucne = nejde vyřešit škrtnutím a dopsáním.',
          },
          vyskyty: {
            type: 'array',
            description: 'Všechna místa v ESD, kterých se bod týká. U ručního bodu může být prázdné.',
            items: {
              type: 'object',
              properties: {
                soubor: { type: 'string', description: 'Název souboru ESD přesně podle seznamu souborů ESD.' },
                strana: { type: 'integer', description: 'Číslo strany v tom souboru, od 1.' },
                presny_text: {
                  type: 'string',
                  description: 'Celá chybná hodnota doslova tak, jak je v ESD. U doplnění text, za který se dopisuje.',
                },
                kontext_pred: { type: 'string', description: 'Pár slov těsně před presny_text (doslova).' },
                kontext_za: { type: 'string', description: 'Pár slov těsně za presny_text (doslova).' },
              },
              required: ['soubor', 'strana', 'presny_text', 'kontext_pred', 'kontext_za'],
            },
          },
          oprava: { type: 'string', description: 'Správný údaj. Prázdné, když nebyl nalezen nebo si zdroje odporují.' },
          zdroj_typ: { type: 'string', enum: ['smlouva', 'disk', 'web', 'zadny'] },
          zdroj_odkaz: {
            type: 'string',
            description: 'Smlouva: článek a strana. Disk: název souboru a odkaz. Web: URL. Jinak prázdné.',
          },
          zdroj_strana: { type: 'integer', description: 'Strana smlouvy, když je zdrojem smlouva, jinak 0.' },
          konflikt: { type: 'boolean', description: 'true, když si zdroje odporují.' },
          zduvodneni: {
            type: 'string',
            description: 'Krátce proč. Když údaj nebyl nalezen, napiš, kde všude se hledalo.',
          },
          jistota: { type: 'string', enum: ['vysoka', 'stredni', 'nizka'] },
        },
        required: [
          'bod_intervence',
          'typ',
          'vyskyty',
          'oprava',
          'zdroj_typ',
          'zdroj_odkaz',
          'zdroj_strana',
          'konflikt',
          'zduvodneni',
          'jistota',
        ],
      },
    },
  },
  required: ['body'],
} as const;

/**
 * Převede odpověď modelu na bezpečný tvar: doplní chybějící hodnoty,
 * opraví typy a názvy souborů ESD přiřadí k nahraným souborům.
 * Vyhodí chybu, když odpověď vůbec není použitelná.
 */
export function normalizujBody(surova: unknown, nazvyEsd: string[]): BodIntervence[] {
  const data = surova as { body?: unknown };
  if (!data || !Array.isArray(data.body)) throw new Error('Odpověď modelu neobsahuje seznam bodů.');
  return data.body.map((b, index): BodIntervence => {
    const bod = (b ?? {}) as Record<string, unknown>;
    const typ = jedenZ(bod.typ, ['oprava', 'doplneni', 'rucne'] as const, 'rucne');
    const vyskyty = (Array.isArray(bod.vyskyty) ? bod.vyskyty : [])
      .map((v) => {
        const vy = (v ?? {}) as Record<string, unknown>;
        return {
          soubor: prirad(text(vy.soubor), nazvyEsd),
          strana: Math.max(1, Math.round(cislo(vy.strana) || 1)),
          presny_text: text(vy.presny_text),
          kontext_pred: text(vy.kontext_pred),
          kontext_za: text(vy.kontext_za),
        };
      })
      .filter((v) => v.presny_text.trim() !== '');
    const oprava = typ === 'rucne' ? '' : text(bod.oprava).trim();
    const konflikt = bod.konflikt === true;
    return {
      cislo: index + 1,
      bod_intervence: text(bod.bod_intervence),
      typ,
      vyskyty,
      oprava: konflikt ? '' : oprava,
      zdroj_typ: jedenZ(bod.zdroj_typ, ['smlouva', 'disk', 'web', 'zadny'] as const, 'zadny'),
      zdroj_odkaz: text(bod.zdroj_odkaz),
      zdroj_strana: Math.max(0, Math.round(cislo(bod.zdroj_strana))),
      konflikt,
      zduvodneni: text(bod.zduvodneni),
      jistota: jedenZ(bod.jistota, ['vysoka', 'stredni', 'nizka'] as const, 'nizka'),
    };
  });
}

/** Bod, který se nezahrne do „Schválit vše" a je potřeba ho projít ručně. */
export function vyzadujePozornost(b: BodIntervence) {
  return b.typ !== 'rucne' && (b.jistota === 'nizka' || b.konflikt || b.oprava.trim() === '' || b.vyskyty.length === 0);
}

function text(hodnota: unknown) {
  return typeof hodnota === 'string' ? hodnota : hodnota == null ? '' : String(hodnota);
}

function cislo(hodnota: unknown) {
  const n = typeof hodnota === 'number' ? hodnota : Number.parseFloat(text(hodnota));
  return Number.isFinite(n) ? n : 0;
}

function jedenZ<T extends string>(hodnota: unknown, moznosti: readonly T[], vychozi: T): T {
  const t = text(hodnota).trim().toLowerCase();
  return (moznosti as readonly string[]).includes(t) ? (t as T) : vychozi;
}

/** Přiřadí název souboru od modelu k nahranému ESD (přesně, bez ohledu na velikost písmen, nebo podle podobnosti). */
export function prirad(nazev: string, nazvyEsd: string[]) {
  if (nazvyEsd.includes(nazev)) return nazev;
  const zjednodus = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\.pdf$/, '')
      .replace(/[^a-z0-9]+/g, '');
  const hledany = zjednodus(nazev);
  const presny = nazvyEsd.find((n) => zjednodus(n) === hledany);
  if (presny) return presny;
  const obsahujici = nazvyEsd.filter((n) => hledany && (zjednodus(n).includes(hledany) || hledany.includes(zjednodus(n))));
  if (obsahujici.length === 1) return obsahujici[0];
  return nazvyEsd.length === 1 ? nazvyEsd[0] : nazev;
}
