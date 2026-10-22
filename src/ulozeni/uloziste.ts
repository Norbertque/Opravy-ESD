import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { konfigurace } from '../../konfigurace';
import type { Intervence, SouborInfo } from './typy';

/**
 * Úložiště rozpracovaných intervencí v prohlížeči (IndexedDB).
 * Nic z toho neodchází na server. Data zůstávají jen v tomto prohlížeči
 * na tomto počítači, dokud je uživatel nesmaže nebo nevyprší lhůta.
 */

interface Schema extends DBSchema {
  intervence: {
    key: string;
    value: Intervence;
  };
  soubory: {
    key: string;
    value: { id: string; intervenceId: string; data: Blob };
    indexes: { intervenceId: string };
  };
  /** Věci, které nepatří k jedné intervenci (zapamatovaný podpis). */
  nastaveni: {
    key: string;
    value: { klic: string; data: Blob; popis: string };
  };
}

const DEN_MS = 24 * 60 * 60 * 1000;

let spojeni: Promise<IDBPDatabase<Schema>> | null = null;

/**
 * Rozpracovaná uložení podle id intervence. Uložení jedné intervence jdou za sebou
 * a čtení na ně počká – po rychlém odchodu a návratu tak obrazovka nenačte starou verzi.
 */
const ukladaniIntervenci = new Map<string, Promise<void>>();

/** Odebrané soubory podle id intervence. Data se smažou, až bude uložená verze, která je nezmiňuje. */
const kSmazani = new Map<string, Set<string>>();

function db() {
  spojeni ??= openDB<Schema>('opravy-esd', 2, {
    upgrade(databaze, staraVerze) {
      if (staraVerze < 1) {
        databaze.createObjectStore('intervence', { keyPath: 'id' });
        const soubory = databaze.createObjectStore('soubory', { keyPath: 'id' });
        soubory.createIndex('intervenceId', 'intervenceId');
      }
      if (staraVerze < 2) databaze.createObjectStore('nastaveni', { keyPath: 'klic' });
    },
    // Novější verze appky v jiné záložce potřebuje databázi upravit – uvolnit ji.
    blocking() {
      void spojeni?.then((d) => d.close());
      spojeni = null;
    },
  });
  return spojeni;
}

export function noveId() {
  return crypto.randomUUID();
}

export function novaIntervence(): Intervence {
  const ted = Date.now();
  return {
    id: noveId(),
    nazev: '',
    vytvoreno: ted,
    upraveno: ted,
    krok: 'nahrani',
    smlouva: null,
    esd: [],
    zprava: { text: '', soubory: [] },
  };
}

export async function seznamIntervenci(): Promise<Intervence[]> {
  const vse = await (await db()).getAll('intervence');
  return vse.sort((a, b) => b.upraveno - a.upraveno);
}

export async function nactiIntervenci(id: string) {
  await ukladaniIntervenci.get(id)?.catch(() => undefined);
  return (await db()).get('intervence', id);
}

/** Uloží intervenci. Čas poslední změny se nastaví sám. */
export async function ulozIntervenci(intervence: Intervence) {
  const ulozena = { ...intervence, upraveno: Date.now() };
  // Zařadí se hned (ne až po await), aby o uložení věděla i obrazovka otevřená vzápětí.
  const predchozi = ukladaniIntervenci.get(ulozena.id) ?? Promise.resolve();
  const ulozeni: Promise<void> = predchozi
    .catch(() => undefined)
    .then(async () => {
      await (await db()).put('intervence', ulozena);
      // Mezitím zařazené uložení je novější – soubory smaže až ono.
      if (ukladaniIntervenci.get(ulozena.id) === ulozeni) await smazOdebraneSoubory(ulozena);
    });
  ukladaniIntervenci.set(ulozena.id, ulozeni);
  const uklid = () => {
    if (ukladaniIntervenci.get(ulozena.id) === ulozeni) ukladaniIntervenci.delete(ulozena.id);
  };
  ulozeni.then(uklid, uklid);
  await ulozeni;
  return ulozena;
}

export async function smazIntervenci(id: string) {
  // Uložení, které ještě běží, by smazanou intervenci zase vytvořilo.
  await ukladaniIntervenci.get(id)?.catch(() => undefined);
  kSmazani.delete(id);
  const d = await db();
  const tx = d.transaction(['intervence', 'soubory'], 'readwrite');
  const klice = await tx.objectStore('soubory').index('intervenceId').getAllKeys(id);
  await Promise.all([
    ...klice.map((k) => tx.objectStore('soubory').delete(k)),
    tx.objectStore('intervence').delete(id),
  ]);
  await tx.done;
}

export async function ulozSoubor(intervenceId: string, soubor: File): Promise<SouborInfo> {
  const info: SouborInfo = {
    id: noveId(),
    nazev: soubor.name,
    mime: mimeSouboru(soubor),
    velikost: soubor.size,
  };
  // Kopie dat do vlastního Blobu, aby nezávisela na původním souboru na disku.
  const data = new Blob([await soubor.arrayBuffer()], { type: info.mime });
  await (await db()).put('soubory', { id: info.id, intervenceId, data });
  return info;
}

export async function nactiSoubor(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('soubory', id))?.data;
}

export async function smazSoubor(id: string) {
  await (await db()).delete('soubory', id);
}

/**
 * Smaže data souboru odebraného z intervence, ale až po uložení intervence bez něj.
 * Kdyby se smazala hned a stránka se zavřela před uložením, zůstala by uložená verze
 * s odkazem na soubor, který už neexistuje.
 */
export function smazSouborPoUlozeni(intervenceId: string, souborId: string) {
  const cekajici = kSmazani.get(intervenceId) ?? new Set<string>();
  cekajici.add(souborId);
  kSmazani.set(intervenceId, cekajici);
}

async function smazOdebraneSoubory(ulozena: Intervence) {
  const cekajici = kSmazani.get(ulozena.id);
  if (!cekajici) return;
  const pouzite = new Set([ulozena.smlouva, ...ulozena.esd, ...ulozena.zprava.soubory].map((s) => s?.id));
  for (const souborId of cekajici) {
    if (pouzite.has(souborId)) continue;
    cekajici.delete(souborId);
    // Když se smazání nepovede, data zůstanou jen do smazání celé intervence.
    await smazSoubor(souborId).catch(() => undefined);
  }
  if (cekajici.size === 0) kSmazani.delete(ulozena.id);
}

/** Za kolik dní se intervence sama smaže (0 = dnes). */
export function dniDoSmazani(intervence: Intervence, ted = Date.now()) {
  const konec = intervence.upraveno + konfigurace.ulozeni.smazatPoDnech * DEN_MS;
  return Math.max(0, Math.ceil((konec - ted) / DEN_MS));
}

/** Smaže intervence, které se déle než nastavenou dobu neměnily. Vrací počet smazaných. */
export async function uklidStarych(ted = Date.now()) {
  const stare = (await seznamIntervenci()).filter(
    (i) => ted - i.upraveno > konfigurace.ulozeni.smazatPoDnech * DEN_MS,
  );
  for (const i of stare) await smazIntervenci(i.id);
  return stare.length;
}

const MIME_PODLE_PRIPONY: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  eml: 'message/rfc822',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
const ZNAME_MIME = new Set(Object.values(MIME_PODLE_PRIPONY));
const NEZNAMY_MIME = 'application/octet-stream';

/** Druh souboru podle přípony, když ho prohlížeč nepozná (typicky .eml, někdy .docx). */
export function odhadniMime(nazev: string) {
  const pripona = nazev.toLowerCase().split('.').pop() ?? '';
  return MIME_PODLE_PRIPONY[pripona] ?? NEZNAMY_MIME;
}

/**
 * Druh nahraného souboru. Prohlížeč ho někdy nezná nebo uvádí nestandardně
 * (prázdný u .eml a .heic, „image/jpg“, „application/x-pdf“), pak rozhoduje přípona.
 */
export function mimeSouboru(soubor: { name: string; type: string }) {
  if (ZNAME_MIME.has(soubor.type)) return soubor.type;
  const podlePripony = odhadniMime(soubor.name);
  return podlePripony === NEZNAMY_MIME && soubor.type ? soubor.type : podlePripony;
}

// ------------------------------------------------------------------ zapamatovaný podpis

/** Podpis nahraný z počítače – zapamatuje se v tomto prohlížeči pro další intervence. */
export async function ulozPodpis(data: Blob, popis: string) {
  await (await db()).put('nastaveni', { klic: 'podpis', data, popis });
}

export async function nactiUlozenyPodpis() {
  return (await db()).get('nastaveni', 'podpis');
}

export async function zapomenPodpis() {
  await (await db()).delete('nastaveni', 'podpis');
}
