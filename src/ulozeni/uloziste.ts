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
}

const DEN_MS = 24 * 60 * 60 * 1000;

let spojeni: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  spojeni ??= openDB<Schema>('opravy-esd', 1, {
    upgrade(databaze) {
      databaze.createObjectStore('intervence', { keyPath: 'id' });
      const soubory = databaze.createObjectStore('soubory', { keyPath: 'id' });
      soubory.createIndex('intervenceId', 'intervenceId');
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
  return (await db()).get('intervence', id);
}

/** Uloží intervenci. Čas poslední změny se nastaví sám. */
export async function ulozIntervenci(intervence: Intervence) {
  const ulozena = { ...intervence, upraveno: Date.now() };
  await (await db()).put('intervence', ulozena);
  return ulozena;
}

export async function smazIntervenci(id: string) {
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
    mime: soubor.type || odhadniMime(soubor.name),
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

/** Druh souboru podle přípony, když ho prohlížeč nepozná (typicky .eml, někdy .docx). */
export function odhadniMime(nazev: string) {
  const pripona = nazev.toLowerCase().split('.').pop() ?? '';
  const mapa: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    eml: 'message/rfc822',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
  };
  return mapa[pripona] ?? 'application/octet-stream';
}
