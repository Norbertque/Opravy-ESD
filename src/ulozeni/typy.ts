import type { Usek } from '../pdf/hledani';
import type { UmisteniVyskytu } from '../schvalovani/umisteni';
import type { KodChyby, VysledekDohledani } from '../sdilene/dohledani';

/** Výsledek kontroly nahraného PDF. */
export interface KontrolaPdf {
  /** Počet stran (0, když PDF nejde otevřít). */
  stran: number;
  /** PDF je zašifrované – nejde ho upravit (u ESD) nebo vůbec otevřít. */
  sifrovany: boolean;
  /** Šifrované tak, že bez hesla nejde ani otevřít. */
  potrebujeHeslo: boolean;
  /** PDF má digitální podpis – úpravou přestane platit. */
  digitalnePodepsany: boolean;
  /** Strany bez textové vrstvy (sken) – číslováno od 1. Na ty se použije OCR. */
  stranyBezTextu: number[];
  /** Srozumitelný popis chyby, když se PDF nepodařilo přečíst. */
  chyba?: string;
}

/** Soubor uložený v prohlížeči. Samotná data jsou v samostatném úložišti (podle id). */
export interface SouborInfo {
  id: string;
  nazev: string;
  mime: string;
  velikost: number;
  kontrola?: KontrolaPdf;
}

export type KrokIntervence = 'nahrani' | 'dohledani' | 'schvalovani' | 'export';

export interface Intervence {
  id: string;
  nazev: string;
  vytvoreno: number;
  /** Čas poslední změny – podle něj se po 30 dnech nečinnosti intervence smaže. */
  upraveno: number;
  /** Krok, na kterém uživatel naposledy byl. */
  krok: KrokIntervence;
  smlouva: SouborInfo | null;
  esd: SouborInfo[];
  /** Intervence od centrály: vložený text a/nebo soubory (PDF, obrázek, TXT, EML, DOCX). */
  zprava: {
    text: string;
    soubory: SouborInfo[];
  };
  /** Poslední dohledání (krok 2). */
  dohledani?: StavDohledani;
  /** Schvalování oprav (krok 3). */
  schvalovani?: StavSchvalovani;
}

export interface StavDohledani {
  vysledek: VysledekDohledani | null;
  /** Hlášky průběhu („Hledám na Disku: …"). */
  prubeh: string[];
  chyba: { kod: KodChyby; zprava: string } | null;
  spusteno: number;
  dokonceno: number | null;
}

export interface RozhodnutiBodu {
  rozhodnuti: 'ceka' | 'schvaleno' | 'zamitnuto';
  /** Oprava – návrh z dohledání, případně upravený uživatelem. */
  oprava: string;
  /** Místa v PDF – stejné pořadí jako výskyty v dohledání. */
  vyskyty: UmisteniVyskytu[];
}

/** Oprava, kterou uživatel přidal sám (označením místa v náhledu). */
export interface RucniOprava {
  id: string;
  souborId: string;
  strana: number;
  typ: 'oprava' | 'doplneni';
  useky: Usek[];
  oprava: string;
}

export interface StavSchvalovani {
  /** Ke kterému dohledání patří (čas dokončení). Po novém dohledání se schvalování založí znovu. */
  dohledaniZ: number;
  /** Podle čísla bodu. */
  body: Record<number, RozhodnutiBodu>;
  rucni: RucniOprava[];
  /** Čísla ručních úkolů označených jako hotové. */
  hotoveUkoly: number[];
}
