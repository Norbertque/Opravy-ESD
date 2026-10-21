import { konfigurace } from '../../konfigurace';
import type { KodChyby, UdalostDohledani, VysledekDohledani } from '../sdilene/dohledani';
import type { Intervence, SouborInfo } from '../ulozeni/typy';
import { nactiSoubor } from '../ulozeni/uloziste';

/** Chyba dohledání s kódem (podle něj se rozhodne, jestli nabídnout Zkusit znovu). */
export class ChybaDohledani extends Error {
  constructor(
    readonly kod: KodChyby,
    zprava: string,
  ) {
    super(zprava);
    this.name = 'ChybaDohledani';
  }
}

/** Celkový objem dat poslaných v jednom dotazu (Cloud Run přijme nejvýš 32 MB). */
const MAX_V_DOTAZU = 25 * 1024 * 1024;

type Role = 'smlouva' | 'esd' | 'priloha';

interface Polozka {
  role: Role;
  info: SouborInfo;
  data: Blob;
}

/**
 * Spustí dohledání na serveru. Soubory pošle v jednom dotazu; velké soubory
 * nejdřív zvlášť nahraje do Files API (přes server), aby dotaz nepřekročil limit.
 * Průběh hlásí přes onPrubeh, výsledek vrátí, chybu vyhodí jako ChybaDohledani.
 */
export async function spustDohledani(
  intervence: Intervence,
  moznosti: { token: string | null; onPrubeh: (text: string) => void; signal: AbortSignal },
): Promise<VysledekDohledani> {
  const { token, onPrubeh, signal } = moznosti;
  const hlavicky: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const polozky: Polozka[] = [];
  const pridej = async (role: Role, info: SouborInfo) => {
    const data = await nactiSoubor(info.id);
    if (!data) throw new ChybaDohledani('vstup', `Soubor „${info.nazev}" chybí v úložišti prohlížeče. Nahrajte ho znovu.`);
    polozky.push({ role, info, data });
  };
  if (intervence.smlouva) await pridej('smlouva', intervence.smlouva);
  for (const s of intervence.esd) await pridej('esd', s);
  for (const s of intervence.zprava.soubory) await pridej('priloha', s);

  // Které soubory nahrát předem: větší než limit z konfigurace a pak největší, dokud se zbytek nevejde do dotazu.
  const predem = new Set<Polozka>(polozky.filter((p) => p.data.size > konfigurace.gemini.inlineLimitMB * 1024 * 1024));
  const zbytek = () => polozky.filter((p) => !predem.has(p)).reduce((s, p) => s + p.data.size, 0);
  for (const p of [...polozky].sort((a, b) => b.data.size - a.data.size)) {
    if (zbytek() <= MAX_V_DOTAZU) break;
    predem.add(p);
  }

  const odkazy = new Map<Polozka, { uri: string; mimeType: string; name: string }>();
  for (const p of predem) {
    onPrubeh(`Nahrávám velký soubor „${p.info.nazev}"…`);
    const odpoved = await volej('/api/gemini-soubor', {
      method: 'POST',
      headers: { ...hlavicky, 'Content-Type': p.info.mime, 'X-Nazev': encodeURIComponent(p.info.nazev) },
      body: p.data,
      signal,
    });
    odkazy.set(p, await odpoved.json());
  }

  const formular = new FormData();
  const soubory = polozky.map((p, i) => {
    const odkaz = odkazy.get(p);
    if (!odkaz) formular.append(`f${i}`, p.data, p.info.nazev);
    return {
      pole: odkaz ? null : `f${i}`,
      role: p.role,
      nazev: p.info.nazev,
      mimeType: p.info.mime,
      nahrano: odkaz ?? null,
    };
  });
  formular.append('zadani', JSON.stringify({ textIntervence: intervence.zprava.text, soubory }));

  onPrubeh('Posílám dokumenty k dohledání…');
  const odpoved = await volej('/api/dohledani', { method: 'POST', headers: hlavicky, body: formular, signal });
  if (!odpoved.body) throw new ChybaDohledani('jina', 'Server neposlal žádnou odpověď.');

  // Odpověď je proud řádků, každý řádek jedna událost (JSON).
  const ctecka = odpoved.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    let kus: ReadableStreamReadResult<string>;
    try {
      kus = await ctecka.read();
    } catch {
      if (signal.aborted) throw new ChybaDohledani('jina', 'Dohledání bylo zrušeno.');
      throw new ChybaDohledani('jina', 'Spojení se serverem se přerušilo. Zkuste to znovu.');
    }
    if (kus.done) break;
    buffer += kus.value;
    let konecRadku: number;
    while ((konecRadku = buffer.indexOf('\n')) >= 0) {
      const radek = buffer.slice(0, konecRadku).trim();
      buffer = buffer.slice(konecRadku + 1);
      if (!radek) continue;
      const udalost = JSON.parse(radek) as UdalostDohledani;
      if (udalost.typ === 'prubeh') onPrubeh(udalost.text);
      else if (udalost.typ === 'vysledek') return udalost.vysledek;
      else throw new ChybaDohledani(udalost.kod, udalost.zprava);
    }
  }
  throw new ChybaDohledani('jina', 'Dohledání skončilo bez výsledku. Zkuste to znovu.');
}

async function volej(adresa: string, init: RequestInit) {
  let odpoved: Response;
  try {
    odpoved = await fetch(adresa, init);
  } catch {
    if (init.signal?.aborted) throw new ChybaDohledani('jina', 'Dohledání bylo zrušeno.');
    throw new ChybaDohledani('jina', 'Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.');
  }
  if (odpoved.ok) return odpoved;
  if (odpoved.status === 413)
    throw new ChybaDohledani('vstup', 'Soubory jsou dohromady příliš velké. Zkuste nahrát menší PDF (např. bez zbytečných stran).');
  let telo: { kod?: KodChyby; chyba?: string } = {};
  try {
    telo = await odpoved.json();
  } catch {
    // odpověď není JSON
  }
  throw new ChybaDohledani(telo.kod ?? 'jina', telo.chyba ?? `Server odpověděl chybou ${odpoved.status}.`);
}
