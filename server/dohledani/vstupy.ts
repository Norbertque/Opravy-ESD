/**
 * Převod nahraných souborů na „bloky" pro model: text, PDF dokument nebo obrázek.
 * Intervence může být text, PDF, obrázek, TXT, e-mail (EML) nebo Word (DOCX).
 * Nic se neukládá – vše je jen v paměti po dobu jednoho dohledání.
 */
import PostalMime from 'postal-mime';

export type Blok =
  | { druh: 'text'; text: string }
  | { druh: 'dokument'; mimeType: 'application/pdf'; data?: Buffer; uri?: string }
  | { druh: 'obrazek'; mimeType: string; data?: Buffer; uri?: string };

export type RoleSouboru = 'smlouva' | 'esd' | 'priloha';

export interface NahranySoubor {
  role: RoleSouboru;
  nazev: string;
  mimeType: string;
  /** Data poslaná přímo v dotazu… */
  data?: Buffer;
  /** …nebo odkaz na soubor nahraný předem do Files API (velké soubory). */
  uri?: string;
}

/** Obrázky, které Gemini umí přečíst. */
const OBRAZKY = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

export function jePdf(mimeType: string, nazev: string) {
  return mimeType === 'application/pdf' || nazev.toLowerCase().endsWith('.pdf');
}

/** Bloky pro smlouvu, ESD a intervenci v pořadí, v jakém je dostane model. */
export async function sestavVstupy(soubory: NahranySoubor[], textIntervence: string): Promise<Blok[]> {
  const bloky: Blok[] = [];
  const smlouva = soubory.find((s) => s.role === 'smlouva');
  const esd = soubory.filter((s) => s.role === 'esd');
  const prilohy = soubory.filter((s) => s.role === 'priloha');

  if (smlouva) {
    bloky.push({ druh: 'text', text: `SMLOUVA – soubor „${smlouva.nazev}":` });
    bloky.push(dokument(smlouva));
  }
  bloky.push({
    druh: 'text',
    text: `ESD (smluvní dokumentace) – ${esd.length} ${esd.length === 1 ? 'soubor' : 'soubory'}: ${esd
      .map((s) => `„${s.nazev}"`)
      .join(', ')}. Do pole „soubor" piš přesně tyto názvy.`,
  });
  for (const s of esd) {
    bloky.push({ druh: 'text', text: `ESD – soubor „${s.nazev}":` });
    bloky.push(dokument(s));
  }

  bloky.push({ druh: 'text', text: 'INTERVENCE (zpráva od centrály, co je v ESD špatně):' });
  if (textIntervence.trim()) bloky.push({ druh: 'text', text: textIntervence.trim() });
  for (const p of prilohy) bloky.push(...(await prilohaNaBloky(p)));
  return bloky;
}

function dokument(s: NahranySoubor): Blok {
  return { druh: 'dokument', mimeType: 'application/pdf', data: s.data, uri: s.uri };
}

async function prilohaNaBloky(p: NahranySoubor, hloubka = 0): Promise<Blok[]> {
  const nazev = p.nazev;
  const mime = p.mimeType.toLowerCase();
  const pripona = nazev.toLowerCase().split('.').pop() ?? '';
  if (jePdf(mime, nazev)) return [{ druh: 'text', text: `Příloha intervence „${nazev}":` }, dokument(p)];
  if (OBRAZKY.includes(mime)) return [{ druh: 'text', text: `Příloha intervence „${nazev}" (obrázek):` }, { druh: 'obrazek', mimeType: mime, data: p.data, uri: p.uri }];
  if (!p.data) return [{ druh: 'text', text: `(Přílohu „${nazev}" se nepodařilo přečíst.)` }];
  if (mime === 'message/rfc822' || pripona === 'eml') return emlNaBloky(p.data, nazev, hloubka);
  if (mime.includes('wordprocessingml') || pripona === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: p.data });
    return [{ druh: 'text', text: `Příloha intervence „${nazev}" (dokument Word):\n${value.trim()}` }];
  }
  if (mime.startsWith('text/') || pripona === 'txt') {
    return [{ druh: 'text', text: `Příloha intervence „${nazev}":\n${p.data.toString('utf8').trim()}` }];
  }
  return [{ druh: 'text', text: `(Přílohu „${nazev}" typu ${p.mimeType || pripona} appka neumí přečíst – byla vynechána.)` }];
}

async function emlNaBloky(data: Buffer, nazev: string, hloubka: number): Promise<Blok[]> {
  const email = await PostalMime.parse(data);
  const adresy = (a: unknown) =>
    (Array.isArray(a) ? a : a ? [a] : [])
      .map((x: { name?: string; address?: string }) => (x.name ? `${x.name} <${x.address ?? ''}>` : (x.address ?? '')))
      .join(', ');
  const telo = email.text?.trim() || htmlNaText(email.html ?? '');
  const bloky: Blok[] = [
    {
      druh: 'text',
      text: [
        `E-mail „${nazev}":`,
        `Od: ${adresy(email.from)}`,
        `Komu: ${adresy(email.to)}`,
        `Předmět: ${email.subject ?? ''}`,
        `Datum: ${email.date ?? ''}`,
        '',
        telo,
      ].join('\n'),
    },
  ];
  if (hloubka >= 2) return bloky;
  for (const a of email.attachments ?? []) {
    const obsah =
      typeof a.content === 'string'
        ? Buffer.from(a.content, 'base64')
        : a.content instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(a.content))
          : Buffer.from(a.content);
    bloky.push(
      ...(await prilohaNaBloky(
        { role: 'priloha', nazev: a.filename || 'příloha', mimeType: a.mimeType || '', data: obsah },
        hloubka + 1,
      )),
    );
  }
  return bloky;
}

function htmlNaText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
