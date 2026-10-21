/**
 * Náhrada Google Disku pro lokální testy: čte složku test-drive/.
 * Zapíná se v .env.local proměnnou MOCK_DISK=1.
 *
 * ID souboru je jeho cesta ve složce (zakódovaná). Druh souboru jako na Disku
 * (Google dokument, tabulka…) a datum úpravy jsou v test-drive/_metadata.json.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ChybaDisku, omezText, popisTypu, type DiskKlient, type SouborNaDisku } from './disk';

const KOREN = path.resolve(import.meta.dirname, '../../test-drive');

type Metadata = Record<string, { mimeType?: string; modifiedTime?: string }>;

function idZCesty(cesta: string) {
  return Buffer.from(cesta, 'utf8').toString('base64url');
}

function cestaZId(id: string) {
  const cesta = Buffer.from(id, 'base64url').toString('utf8');
  const plna = path.resolve(KOREN, cesta);
  if (!plna.startsWith(KOREN + path.sep)) throw new ChybaDisku('Soubor na Disku nebyl nalezen.', 'nenalezeno');
  return { cesta, plna };
}

function mimeZPripony(nazev: string) {
  const pripona = path.extname(nazev).toLowerCase();
  return (
    {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }[pripona] ?? 'application/octet-stream'
  );
}

async function vsechnySoubory(): Promise<SouborNaDisku[]> {
  let metadata: Metadata = {};
  try {
    metadata = JSON.parse(await fs.readFile(path.join(KOREN, '_metadata.json'), 'utf8'));
  } catch {
    // bez metadat se typ odhadne z přípony
  }
  const soubory: SouborNaDisku[] = [];
  for (const zaznam of await fs.readdir(KOREN, { recursive: true, withFileTypes: true })) {
    if (!zaznam.isFile() || zaznam.name.startsWith('_')) continue;
    const cesta = path.relative(KOREN, path.join(zaznam.parentPath, zaznam.name)).split(path.sep).join('/');
    const meta = metadata[cesta] ?? {};
    const mimeType = meta.mimeType ?? mimeZPripony(zaznam.name);
    const id = idZCesty(cesta);
    // Google dokumenty a tabulky nemají na Disku příponu
    const nazev = mimeType.startsWith('application/vnd.google-apps.') ? zaznam.name.replace(/\.[^.]+$/, '') : zaznam.name;
    soubory.push({
      id,
      nazev,
      typ: popisTypu(mimeType),
      mimeType,
      odkaz: `https://drive.google.com/file/d/test-${id.slice(0, 12)}/view`,
      upraveno: meta.modifiedTime ?? '',
    });
  }
  return soubory;
}

/** Bez diakritiky a malými písmeny – pro jednoduché fulltextové hledání. */
function zjednodus(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function diskMock(): DiskKlient {
  return {
    async hledat(dotaz) {
      const slova = zjednodus(dotaz).split(/\s+/).filter((s) => s.length > 1);
      const vysledky: { soubor: SouborNaDisku; skore: number }[] = [];
      for (const soubor of await vsechnySoubory()) {
        if (soubor.mimeType.startsWith('image/')) continue;
        const { plna } = cestaZId(soubor.id);
        const obsah = zjednodus(`${soubor.nazev}\n${await fs.readFile(plna, 'utf8')}`);
        const skore = slova.filter((s) => obsah.includes(s)).length;
        if (skore > 0) vysledky.push({ soubor, skore });
      }
      return vysledky.sort((a, b) => b.skore - a.skore).map((v) => v.soubor);
    },

    async precist(id) {
      const soubor = (await vsechnySoubory()).find((s) => s.id === id);
      if (!soubor) throw new ChybaDisku('Soubor na Disku nebyl nalezen.', 'nenalezeno');
      const { plna } = cestaZId(id);
      const data = await fs.readFile(plna);
      if (soubor.mimeType === 'application/pdf') return { druh: 'pdf', soubor, data, mimeType: soubor.mimeType };
      if (soubor.mimeType.startsWith('image/')) return { druh: 'obrazek', soubor, data, mimeType: soubor.mimeType };
      return { druh: 'text', soubor, ...omezText(data.toString('utf8')) };
    },

    async najdiPodpis(nazevNeboId) {
      const vse = await vsechnySoubory();
      const nalezeny = vse.find((s) => s.id === nazevNeboId || s.nazev === nazevNeboId);
      if (!nalezeny || !nalezeny.mimeType.startsWith('image/'))
        return { kandidati: vse.filter((s) => s.mimeType === 'image/png') };
      return { soubor: nalezeny, data: await fs.readFile(cestaZId(nalezeny.id).plna) };
    },

    async stahniObrazek(id) {
      const soubor = (await vsechnySoubory()).find((s) => s.id === id);
      if (!soubor?.mimeType.startsWith('image/')) throw new ChybaDisku('Vybraný soubor není obrázek.', 'jina');
      return fs.readFile(cestaZId(id).plna);
    },
  };
}
