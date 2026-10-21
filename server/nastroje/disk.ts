/**
 * Přístup ke Google Disku – jen pro čtení.
 *
 * Appka s Diskem pracuje JEN přes tyto tři funkce (rozhraní DiskKlient):
 *   hledat(dotaz)        fulltext ve složce s materiály (včetně podsložek)
 *   precist(id)          obsah souboru (Google dokument jako text, tabulka jako CSV, PDF, obrázek, text)
 *   najdiPodpis(…)       soubor s podpisem (PNG)
 *
 * V AI Studiu se přihlášení k Disku zapne v panelu Integrations. Prohlížeč pak
 * u každého dotazu na server pošle přístupový token v hlavičce Authorization
 * a server s ním volá Google Drive API (diskGoogle níže). Lokálně se místo Disku
 * čte složka test-drive/ (diskMock v disk-mock.ts).
 */
import { konfigurace } from '../../konfigurace';

export interface SouborNaDisku {
  id: string;
  nazev: string;
  /** Typ souboru srozumitelně (Google dokument, Tabulka, PDF…). */
  typ: string;
  mimeType: string;
  odkaz: string;
  upraveno: string;
}

export type ObsahSouboru =
  | { druh: 'text'; soubor: SouborNaDisku; text: string; zkraceno: boolean }
  | { druh: 'pdf' | 'obrazek'; soubor: SouborNaDisku; data: Buffer; mimeType: string }
  | { druh: 'nepodporovano'; soubor: SouborNaDisku; duvod: string };

export interface DiskKlient {
  hledat(dotaz: string): Promise<SouborNaDisku[]>;
  precist(id: string): Promise<ObsahSouboru>;
  /** Podpis podle konfigurace (název nebo ID). Když se nenajde, vrátí kandidáty (PNG soubory). */
  najdiPodpis(nazevNeboId: string): Promise<{ soubor: SouborNaDisku; data: Buffer } | { kandidati: SouborNaDisku[] }>;
  /** Stáhne konkrétní PNG (ruční výběr podpisu). */
  stahniObrazek(id: string): Promise<Buffer>;
}

/** Chyba přístupu k Disku srozumitelná pro uživatele. */
export class ChybaDisku extends Error {
  constructor(
    zprava: string,
    readonly kod: 'prihlaseni' | 'nenalezeno' | 'mimo-slozku' | 'jina',
  ) {
    super(zprava);
    this.name = 'ChybaDisku';
  }
}

const GOOGLE_TYPY: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google dokument',
  'application/vnd.google-apps.spreadsheet': 'Google tabulka',
  'application/vnd.google-apps.presentation': 'Google prezentace',
  'application/vnd.google-apps.folder': 'Složka',
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/csv': 'Tabulka CSV',
  'image/png': 'Obrázek PNG',
  'image/jpeg': 'Obrázek JPEG',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Dokument Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Tabulka Excel',
};

export function popisTypu(mimeType: string) {
  return GOOGLE_TYPY[mimeType] ?? mimeType;
}

/** Zkrátí text na limit z konfigurace. */
export function omezText(text: string) {
  const max = konfigurace.disk.maxZnakuTextu;
  return text.length > max ? { text: text.slice(0, max), zkraceno: true } : { text, zkraceno: false };
}

// ------------------------------------------------------------------ Google Drive API

const API = 'https://www.googleapis.com/drive/v3';
const SLOZKA = 'application/vnd.google-apps.folder';
const POLE = 'id,name,mimeType,webViewLink,modifiedTime,size,parents';
/** Kolik podsložek nejvýš projít při hledání ve složce s materiály. */
const MAX_SLOZEK = 300;

interface DriveSoubor {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
}

/** Uvozovky a zpětná lomítka v dotazu Drive API. */
function q(hodnota: string) {
  return `'${hodnota.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function diskGoogle(token: string): DiskKlient {
  let slozkyCache: Promise<string[] | null> | null = null;

  async function volej<T>(cesta: string, parametry: Record<string, string> = {}): Promise<T> {
    const odpoved = await volejSurove(cesta, parametry);
    return (await odpoved.json()) as T;
  }

  async function volejSurove(cesta: string, parametry: Record<string, string> = {}) {
    const url = new URL(API + cesta);
    for (const [k, v] of Object.entries(parametry)) url.searchParams.set(k, v);
    const odpoved = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (odpoved.status === 401) throw new ChybaDisku('Přihlášení k Google Disku vypršelo. Přihlaste se znovu.', 'prihlaseni');
    if (odpoved.status === 403) throw new ChybaDisku('Appka nemá oprávnění číst Google Disk. Přihlaste se znovu a povolte přístup.', 'prihlaseni');
    if (odpoved.status === 404) throw new ChybaDisku('Soubor na Disku nebyl nalezen.', 'nenalezeno');
    if (!odpoved.ok) throw new ChybaDisku(`Google Disk odpověděl chybou ${odpoved.status}.`, 'jina');
    return odpoved;
  }

  async function seznam(dotaz: string, max = 100): Promise<DriveSoubor[]> {
    const vysledek = await volej<{ files: DriveSoubor[] }>('/files', {
      q: dotaz,
      fields: `files(${POLE})`,
      pageSize: String(max),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });
    return vysledek.files ?? [];
  }

  /** ID složky s materiály a všech jejích podsložek (null = celý Disk). */
  function slozky() {
    slozkyCache ??= (async () => {
      const nastaveni = konfigurace.disk.slozka.trim();
      if (!nastaveni) return null;
      let koren: string | null = null;
      try {
        const primo = await volej<DriveSoubor>(`/files/${encodeURIComponent(nastaveni)}`, { fields: POLE, supportsAllDrives: 'true' });
        if (primo.mimeType === SLOZKA) koren = primo.id;
      } catch (e) {
        if (!(e instanceof ChybaDisku) || e.kod !== 'nenalezeno') throw e;
      }
      if (!koren) {
        const podleNazvu = await seznam(`mimeType = '${SLOZKA}' and name = ${q(nastaveni)} and trashed = false`, 5);
        if (podleNazvu.length === 0)
          throw new ChybaDisku(`Složka „${nastaveni}" nastavená v konfiguraci na Disku není.`, 'nenalezeno');
        koren = podleNazvu[0].id;
      }
      const vsechny = [koren];
      for (let i = 0; i < vsechny.length && vsechny.length < MAX_SLOZEK; i++) {
        const deti = await seznam(`mimeType = '${SLOZKA}' and ${q(vsechny[i])} in parents and trashed = false`, 200);
        vsechny.push(...deti.map((d) => d.id));
      }
      return vsechny.slice(0, MAX_SLOZEK);
    })();
    return slozkyCache;
  }

  function naSoubor(f: DriveSoubor): SouborNaDisku {
    return {
      id: f.id,
      nazev: f.name,
      typ: popisTypu(f.mimeType),
      mimeType: f.mimeType,
      odkaz: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      upraveno: f.modifiedTime ?? '',
    };
  }

  /** Hledání v dávkách po 40 složkách (dotaz Drive API má omezenou délku). */
  async function hledejVeSlozkach(podminka: string, max: number) {
    const idSlozek = await slozky();
    if (!idSlozek) return seznam(`${podminka} and trashed = false`, max);
    const nalezeno = new Map<string, DriveSoubor>();
    for (let i = 0; i < idSlozek.length && nalezeno.size < max; i += 40) {
      const rodice = idSlozek
        .slice(i, i + 40)
        .map((id) => `${q(id)} in parents`)
        .join(' or ');
      for (const f of await seznam(`${podminka} and (${rodice}) and trashed = false`, max)) nalezeno.set(f.id, f);
    }
    return [...nalezeno.values()].slice(0, max);
  }

  async function overUmisteni(f: DriveSoubor) {
    const idSlozek = await slozky();
    if (!idSlozek) return;
    if (!f.parents?.some((p) => idSlozek.includes(p)))
      throw new ChybaDisku('Soubor není ve složce s materiály nastavené v konfiguraci.', 'mimo-slozku');
  }

  return {
    async hledat(dotaz) {
      const max = konfigurace.disk.maxVysledkuHledani;
      const nalezeno = await hledejVeSlozkach(`mimeType != '${SLOZKA}' and fullText contains ${q(dotaz)}`, max);
      return nalezeno.map(naSoubor);
    },

    async precist(id) {
      const f = await volej<DriveSoubor>(`/files/${encodeURIComponent(id)}`, { fields: POLE, supportsAllDrives: 'true' });
      await overUmisteni(f);
      const soubor = naSoubor(f);
      const maxBajtu = konfigurace.disk.maxVelikostSouboruMB * 1024 * 1024;
      const exportuj = async (mime: string) =>
        (await volejSurove(`/files/${encodeURIComponent(id)}/export`, { mimeType: mime })).text();
      const stahni = async () => {
        if (Number(f.size ?? 0) > maxBajtu)
          return null;
        return Buffer.from(await (await volejSurove(`/files/${encodeURIComponent(id)}`, { alt: 'media', supportsAllDrives: 'true' })).arrayBuffer());
      };

      switch (f.mimeType) {
        case 'application/vnd.google-apps.document':
        case 'application/vnd.google-apps.presentation':
          return { druh: 'text', soubor, ...omezText(await exportuj('text/plain')) };
        case 'application/vnd.google-apps.spreadsheet':
          // Export do CSV obsahuje jen první list tabulky.
          return { druh: 'text', soubor, ...omezText(await exportuj('text/csv')) };
      }
      if (f.mimeType === 'application/pdf' || f.mimeType.startsWith('image/') || f.mimeType.startsWith('text/') || f.mimeType.includes('wordprocessingml')) {
        const data = await stahni();
        if (!data)
          return { druh: 'nepodporovano', soubor, duvod: `Soubor je větší než ${konfigurace.disk.maxVelikostSouboruMB} MB.` };
        if (f.mimeType === 'application/pdf') return { druh: 'pdf', soubor, data, mimeType: f.mimeType };
        if (f.mimeType.startsWith('image/')) return { druh: 'obrazek', soubor, data, mimeType: f.mimeType };
        if (f.mimeType.includes('wordprocessingml')) {
          const mammoth = await import('mammoth');
          const { value } = await mammoth.extractRawText({ buffer: data });
          return { druh: 'text', soubor, ...omezText(value) };
        }
        return { druh: 'text', soubor, ...omezText(data.toString('utf8')) };
      }
      return { druh: 'nepodporovano', soubor, duvod: `Typ souboru ${popisTypu(f.mimeType)} appka neumí přečíst.` };
    },

    async najdiPodpis(nazevNeboId) {
      const pngVeSlozce = () => hledejVeSlozkach(`mimeType = 'image/png'`, 30).then((s) => s.map(naSoubor));
      let nalezeny: DriveSoubor | undefined;
      try {
        const primo = await volej<DriveSoubor>(`/files/${encodeURIComponent(nazevNeboId)}`, { fields: POLE, supportsAllDrives: 'true' });
        if (primo.mimeType.startsWith('image/')) nalezeny = primo;
      } catch (e) {
        if (!(e instanceof ChybaDisku) || e.kod !== 'nenalezeno') throw e;
      }
      if (!nalezeny) {
        const podleNazvu = await hledejVeSlozkach(`name = ${q(nazevNeboId)} and mimeType contains 'image/'`, 5);
        nalezeny = podleNazvu[0] ?? (await seznam(`name = ${q(nazevNeboId)} and mimeType contains 'image/' and trashed = false`, 5))[0];
      }
      if (!nalezeny) return { kandidati: await pngVeSlozce() };
      return { soubor: naSoubor(nalezeny), data: await this.stahniObrazek(nalezeny.id) };
    },

    async stahniObrazek(id) {
      const f = await volej<DriveSoubor>(`/files/${encodeURIComponent(id)}`, { fields: POLE, supportsAllDrives: 'true' });
      if (!f.mimeType.startsWith('image/')) throw new ChybaDisku('Vybraný soubor není obrázek.', 'jina');
      if (Number(f.size ?? 0) > 5 * 1024 * 1024) throw new ChybaDisku('Obrázek podpisu je větší než 5 MB.', 'jina');
      const odpoved = await volejSurove(`/files/${encodeURIComponent(id)}`, { alt: 'media', supportsAllDrives: 'true' });
      return Buffer.from(await odpoved.arrayBuffer());
    },
  };
}
