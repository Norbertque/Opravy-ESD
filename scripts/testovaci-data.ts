/**
 * Vyrobí syntetické testovací dokumenty (žádná reálná data):
 *
 *   testovaci-data/smlouva.pdf               pojistná smlouva (3 strany)
 *   testovaci-data/esd-1-zaznam.pdf          ESD 1: záznam z jednání (CropBox, tabulka, dělené slovo)
 *   testovaci-data/esd-2-plna-moc.pdf        ESD 2: plná moc (otočená strana, strana Letter)
 *   testovaci-data/esd-2-plna-moc-sken.pdf   ESD 2 jako sken (jen obrázky, bez textu)
 *   testovaci-data/intervence.txt / .eml / .docx   intervence s 5 body
 *   test-drive/…                             náhrada Google Disku (materiály + podpis)
 *
 * Spuštění: npm run testovaci-data
 *
 * Správné odpovědi (pro kontrolu dohledání):
 *   1. datum narození 14. 5. 1985 → 14. 5. 1983 (smlouva čl. 1, str. 1); v ESD 1 i ESD 2
 *   2. doplnit číslo smlouvy 7712345678 za „Číslo smlouvy:" (smlouva, str. 1)
 *   3. získatelské číslo 401234 → 401243 (Disk: Seznam zprostředkovatelů 2026)
 *   4. adresa pobočky Masarykova 132/45, 602 00 Brno → Masarykova 123/45, 602 00 Brno (Disk: Adresy poboček)
 *   5. chybí podpis klienta na plné moci – ruční bod
 */
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { PNG } from 'pngjs';

const KOREN = path.resolve(import.meta.dirname, '..');
const DATA = path.join(KOREN, 'testovaci-data');
const DISK = path.join(KOREN, 'test-drive');
const NBSP = ' ';
const CERNA = rgb(0.1, 0.1, 0.12);
const SEDA = rgb(0.4, 0.4, 0.45);
const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];

const pismoData = await fs.readFile(path.join(KOREN, 'public/fonty/NotoSans-Regular.ttf'));

async function novyDokument(titulek: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const pismo = await doc.embedFont(pismoData, { subset: true });
  doc.setTitle(titulek);
  doc.setProducer('Opravy ESD – testovací data');
  doc.setCreationDate(new Date('2026-03-20T10:00:00Z'));
  doc.setModificationDate(new Date('2026-03-20T10:00:00Z'));
  return { doc, pismo };
}

/** Píše řádky textu shora dolů (souřadnice y = účaří). */
function text(strana: PDFPage, pismo: PDFFont, obsah: string, x: number, y: number, velikost = 10.5, barva = CERNA) {
  strana.drawText(obsah, { x, y, size: velikost, font: pismo, color: barva });
}

/** Zalomí odstavec na řádky dané šířky. */
function zalom(pismo: PDFFont, obsah: string, velikost: number, sirka: number) {
  const radky: string[] = [];
  let radek = '';
  for (const slovo of obsah.split(' ')) {
    const zkus = radek ? `${radek} ${slovo}` : slovo;
    if (pismo.widthOfTextAtSize(zkus, velikost) > sirka && radek) {
      radky.push(radek);
      radek = slovo;
    } else radek = zkus;
  }
  if (radek) radky.push(radek);
  return radky;
}

function odstavec(strana: PDFPage, pismo: PDFFont, obsah: string, x: number, y: number, sirka: number, velikost = 10.5, radkovani = 15) {
  for (const radek of zalom(pismo, obsah, velikost, sirka)) {
    text(strana, pismo, radek, x, y, velikost);
    y -= radkovani;
  }
  return y;
}

/** Ručně vypadající podpis (křivka) – vektorově přímo do PDF. */
function podpisVektor(strana: PDFPage, x: number, y: number, meritko = 1, otoceni = 0) {
  strana.drawSvgPath(
    'M0,10 C8,-6 14,22 22,6 S34,-4 40,10 C46,22 52,0 60,8 C66,14 72,4 80,9 M18,16 L70,2',
    { x, y, scale: meritko, borderColor: rgb(0.05, 0.1, 0.4), borderWidth: 1.1, rotate: degrees(otoceni) },
  );
}

// ---------------------------------------------------------------- smlouva

async function smlouva() {
  const { doc, pismo } = await novyDokument('Pojistná smlouva č. 7712345678');
  const sirka = 470;
  const x = 62;

  let s = doc.addPage(A4);
  text(s, pismo, 'POJISTNÁ SMLOUVA č. 7712345678', x, 770, 17);
  text(s, pismo, 'pojištění domácnosti, uzavřená podle zákona č. 89/2012 Sb., občanský zákoník', x, 750, 9.5, SEDA);
  let y = 712;
  text(s, pismo, 'Článek 1 – Smluvní strany', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, 'Pojistitel: Pojišťovna Vzorník a.s., se sídlem Vzorová 1/1, 110 00 Praha 1, zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl B, vložka 0000 (dále jen „pojistitel").', x, y, sirka);
  y -= 8;
  y = odstavec(s, pismo, `Pojistník a pojištěný: Jan Testovací, datum narození 14. 5. 1983, bytem Lipová 12, 664${NBSP}01 Bílovice nad Svitavou (dále jen „pojistník").`, x, y, sirka);
  y -= 18;
  text(s, pismo, 'Článek 2 – Předmět pojištění', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, 'Předmětem pojištění je soubor movitých věcí tvořících zařízení domácnosti v bytě na adrese bydliště pojistníka. Pojištění se vztahuje na škody způsobené požárem, vodou z vodovodního zařízení, vichřicí, krádeží a vandalismem v rozsahu pojistných podmínek VPP-D 2026.', x, y, sirka);
  text(s, pismo, 'Strana 1 z 3', 270, 40, 9, SEDA);

  s = doc.addPage(A4);
  y = 770;
  text(s, pismo, 'Článek 3 – Pojistná doba', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, 'Pojištění se sjednává na dobu neurčitou s počátkem dne 1. 3. 2026. Pojistným obdobím je jeden rok.', x, y, sirka);
  y -= 18;
  text(s, pismo, 'Článek 4 – Pojistné', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, `Roční pojistné činí 3${NBSP}600 Kč a je splatné vždy k počátku pojistného období na účet pojistitele č. 1234567890/0100 s variabilním symbolem 7712345678.`, x, y, sirka);
  y -= 18;
  text(s, pismo, 'Článek 5 – Zprostředkování', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, 'Smlouva byla uzavřena prostřednictvím zprostředkovatelky Petry Ukázkové, pobočka Brno-střed. Údaje o zprostředkovateli vede pojistitel ve svém seznamu zprostředkovatelů.', x, y, sirka);
  text(s, pismo, 'Strana 2 z 3', 270, 40, 9, SEDA);

  s = doc.addPage(A4);
  y = 770;
  text(s, pismo, 'Článek 6 – Závěrečná ustanovení', x, y, 12.5);
  y -= 22;
  y = odstavec(s, pismo, 'Smlouva je vyhotovena ve dvou stejnopisech, z nichž každá strana obdrží jeden. Smlouva nabývá platnosti dnem podpisu oběma stranami.', x, y, sirka);
  y -= 30;
  text(s, pismo, 'V Brně dne 20. 3. 2026', x, y);
  y -= 60;
  text(s, pismo, 'za pojistitele', x, y, 9.5, SEDA);
  text(s, pismo, 'pojistník', 360, y, 9.5, SEDA);
  podpisVektor(s, x, y + 14);
  podpisVektor(s, 360, y + 14, 0.9);
  text(s, pismo, 'Strana 3 z 3', 270, 40, 9, SEDA);

  return doc.save();
}

// ---------------------------------------------------------------- ESD 1

async function esd1() {
  const { doc, pismo } = await novyDokument('Záznam z jednání s klientem');
  const x = 60;

  // Strana 1: viditelná část stránky (CropBox) je menší než MediaBox.
  let s = doc.addPage(A4);
  s.setCropBox(25, 35, 545.28 - 25, 776.89 - 35);
  // Tisková značka mimo viditelnou část – nesmí se brát jako text dokumentu.
  text(s, pismo, 'TISKOVÁ ZNAČKA 0042', 30, 12, 7, SEDA);
  text(s, pismo, 'ZÁZNAM Z JEDNÁNÍ S KLIENTEM', x, 735, 16);
  text(s, pismo, 'Pojišťovna Vzorník a.s. · pobočka Brno-střed', x, 717, 9, SEDA);
  text(s, pismo, 'Číslo smlouvy:', x, 685, 11);

  // Tabulka s čarami: oprava nesmí přes čáry.
  const radky: [string, string][] = [
    ['Klient', 'Jan Testovací'],
    ['Datum narození', '14. 5. 1985'],
    ['Bydliště', `Lipová 12, 664${NBSP}01 Bílovice nad Svitavou`],
    ['Telefon', '+420 600 000 000'],
  ];
  const levy = x;
  const stred = 190;
  const pravy = 520;
  const vyskaRadku = 26;
  let horni = 660;
  for (const [popisek, hodnota] of radky) {
    s.drawRectangle({ x: levy, y: horni - vyskaRadku, width: pravy - levy, height: vyskaRadku, borderColor: CERNA, borderWidth: 0.8 });
    s.drawLine({ start: { x: stred, y: horni }, end: { x: stred, y: horni - vyskaRadku }, thickness: 0.8, color: CERNA });
    text(s, pismo, popisek, levy + 6, horni - 17, 10, SEDA);
    text(s, pismo, hodnota, stred + 6, horni - 17, 10.5);
    horni -= vyskaRadku;
  }
  let y = horni - 34;
  y = odstavec(s, pismo, 'Klient projevil zájem o pojištění domácnosti. Byl seznámen s pojistnými podmínkami VPP-D 2026, s informačním dokumentem o pojistném produktu a s informacemi o zpracování osobních údajů.', x, y, 455);
  y -= 10;
  odstavec(s, pismo, `Sjednané roční pojistné: 3${NBSP}600 Kč. Způsob placení: bankovním převodem.`, x, y, 455);
  text(s, pismo, 'Strana 1 z 2', 265, 50, 9, SEDA);

  // Strana 2: adresa je rozdělená přes dva řádky a slovo „Masarykova" dělené spojovníkem.
  s = doc.addPage(A4);
  y = 770;
  text(s, pismo, 'Jednání proběhlo dne 20. 3. 2026 na pobočce Brno-střed, Masa-', x, y);
  y -= 15;
  text(s, pismo, `rykova 132/45, 602${NBSP}00 Brno. Klient obdržel kopii záznamu a souhlasí`, x, y);
  y -= 15;
  text(s, pismo, 'se zpracováním osobních údajů v rozsahu nezbytném pro uzavření smlouvy.', x, y);
  y -= 50;
  text(s, pismo, 'Podpis klienta:', x, y);
  podpisVektor(s, x + 95, y - 4, 0.9);
  text(s, pismo, 'Podpis zprostředkovatele:', x + 250, y);
  podpisVektor(s, x + 395, y - 4, 0.8);
  text(s, pismo, 'Strana 2 z 2', 265, 50, 9, SEDA);

  return doc.save();
}

// ---------------------------------------------------------------- ESD 2

async function esd2() {
  const { doc, pismo } = await novyDokument('Plná moc a prohlášení klienta');

  // Strana 1: A4 s /Rotate 90 – zobrazuje se na šířku (841,89 × 595,28).
  // Zobrazený bod (X zleva, Y shora) odpovídá bodu stránky x = Y, y = X;
  // text se kreslí otočený o 90°, aby se zobrazil vodorovně.
  const s1 = doc.addPage(A4);
  s1.setRotation(degrees(90));
  const otocene = (obsah: string, X: number, Y: number, velikost = 11) =>
    s1.drawText(obsah, { x: Y, y: X, size: velikost, font: pismo, color: CERNA, rotate: degrees(90) });
  otocene('PLNÁ MOC', 70, 80, 18);
  otocene(`Zmocnitel: Jan Testovací, nar. 14. 5. 1985, bytem Lipová 12, 664${NBSP}01 Bílovice nad Svitavou`, 70, 130);
  otocene('Zmocněnec: Petra Ukázková, zprostředkovatelka pojišťovny Vzorník a.s., získatelské číslo 401234', 70, 160);
  otocene('Zmocnitel tímto zmocňuje zmocněnce k jednání ve věci pojistné smlouvy o pojištění domácnosti,', 70, 200);
  otocene('včetně přijímání písemností a podávání oznámení pojistiteli.', 70, 218);
  otocene('V Brně dne 20. 3. 2026', 70, 270);
  otocene('Strana 1 z 2', 390, 560, 9);

  // Strana 2: formát Letter (jiný rozměr než A4). Chybí podpis klienta.
  const s2 = doc.addPage(LETTER);
  const x = 64;
  text(s2, pismo, 'PROHLÁŠENÍ KLIENTA', x, 720, 15);
  odstavec(s2, pismo, 'Prohlašuji, že všechny údaje uvedené v plné moci jsou pravdivé a úplné a že jsem byl seznámen s tím, jakým způsobem bude zmocněnec jednat jménem zmocnitele.', x, 690, 480);
  text(s2, pismo, 'V Brně dne 20. 3. 2026', x, 600);
  text(s2, pismo, 'Podpis klienta: ………………………………………', x, 540);
  text(s2, pismo, 'Podpis zprostředkovatele:', x, 490);
  podpisVektor(s2, x + 150, 486, 0.9);
  text(s2, pismo, 'Strana 2 z 2', 280, 50, 9, SEDA);

  return doc.save();
}

// ---------------------------------------------------------------- sken

/** Vyrenderuje PDF do obrázků (200 dpi, mírné natočení a šum) a složí z nich „sken" bez textu. */
async function sken(pdf: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const zdroj = await pdfjs.getDocument({
    data: pdf.slice(),
    standardFontDataUrl: path.join(KOREN, 'node_modules/pdfjs-dist/standard_fonts/'),
  }).promise;
  const vystup = await PDFDocument.create();
  const DPI = 200;
  for (let i = 1; i <= zdroj.numPages; i++) {
    const strana = await zdroj.getPage(i);
    const vp = strana.getViewport({ scale: DPI / 72 });
    const platno = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = platno.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, platno.width, platno.height);
    // Skener: mírné natočení
    ctx.translate(platno.width / 2, platno.height / 2);
    ctx.rotate((0.25 * Math.PI) / 180);
    ctx.translate(-platno.width / 2, -platno.height / 2);
    await strana.render({ canvas: platno as unknown as HTMLCanvasElement, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    // Šum a lehce zašedlý papír
    const obraz = ctx.getImageData(0, 0, platno.width, platno.height);
    let semeno = 42 + i;
    const nahodne = () => ((semeno = (semeno * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let p = 0; p < obraz.data.length; p += 4) {
      const sum = (nahodne() - 0.5) * 18;
      for (let k = 0; k < 3; k++) obraz.data[p + k] = Math.max(0, Math.min(255, obraz.data[p + k] * 0.97 + sum));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(obraz, 0, 0);
    const png = await vystup.embedPng(platno.toBuffer('image/png'));
    const sirka = vp.width / (DPI / 72);
    const vyska = vp.height / (DPI / 72);
    const nova = vystup.addPage([sirka, vyska]);
    nova.drawImage(png, { x: 0, y: 0, width: sirka, height: vyska });
  }
  vystup.setTitle('Plná moc – sken');
  vystup.setProducer('Opravy ESD – testovací data');
  vystup.setCreationDate(new Date('2026-03-21T08:00:00Z'));
  vystup.setModificationDate(new Date('2026-03-21T08:00:00Z'));
  return vystup.save();
}

// ---------------------------------------------------------------- podpis (PNG)

function podpisPng() {
  const sirka = 480;
  const vyska = 160;
  const png = new PNG({ width: sirka, height: vyska });
  png.data.fill(0); // průhledné pozadí
  const tah = (x: number, y: number, polomer: number) => {
    for (let dy = -polomer - 1; dy <= polomer + 1; dy++) {
      for (let dx = -polomer - 1; dx <= polomer + 1; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= sirka || py >= vyska) continue;
        const vzdalenost = Math.hypot(px - x, py - y);
        const krytí = Math.max(0, Math.min(1, polomer + 0.5 - vzdalenost));
        if (krytí <= 0) continue;
        const i = (py * sirka + px) * 4;
        png.data[i] = 15;
        png.data[i + 1] = 30;
        png.data[i + 2] = 110;
        png.data[i + 3] = Math.max(png.data[i + 3], Math.round(255 * krytí));
      }
    }
  };
  // Křivka „podpisu": několik smyček a přeškrtnutí
  for (let t = 0; t <= 1; t += 0.0004) {
    const x = 30 + 400 * t;
    const y = 85 + 38 * Math.sin(t * 22) * Math.exp(-t * 1.2) - 25 * Math.sin(t * 5);
    tah(x, y, 2.6 - 1.2 * t);
  }
  for (let t = 0; t <= 1; t += 0.001) tah(60 + 330 * t, 120 - 70 * t, 1.8);
  return PNG.sync.write(png);
}

// ---------------------------------------------------------------- intervence

const INTERVENCE = `Dobrý den,

při kontrole smluvní dokumentace ke smlouvě č. 7712345678 (klient Jan Testovací) jsme zjistili tyto nedostatky:

1. Datum narození klienta v dokumentaci neodpovídá smlouvě.
2. V záznamu z jednání chybí číslo smlouvy.
3. Na plné moci je uvedeno chybné získatelské číslo zprostředkovatelky.
4. V záznamu z jednání je chybně uvedena adresa pobočky.
5. Na plné moci chybí podpis klienta.

Prosíme o opravu a zaslání opravené dokumentace.

S pozdravem
oddělení kontroly dokumentace
Pojišťovna Vzorník a.s.
`;

function eml(textZpravy: string) {
  const telo = Buffer.from(textZpravy, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    'From: Kontrola dokumentace <kontrola@vzornik.example>',
    'To: Pobocka Brno-stred <brno-stred@vzornik.example>',
    'Subject: =?UTF-8?B?' + Buffer.from('Intervence – smlouva 7712345678', 'utf8').toString('base64') + '?=',
    'Date: Mon, 23 Mar 2026 09:15:00 +0100',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    telo,
    '',
  ].join('\r\n');
}

async function docx(textZpravy: string) {
  const zip = new JSZip();
  const datum = { date: new Date('2026-03-23T09:00:00Z') };
  const odstavce = textZpravy
    .split('\n')
    .map((r) => `<w:p><w:r><w:t xml:space="preserve">${r.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    datum,
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    datum,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${odstavce}</w:body></w:document>`,
    datum,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------------------------------------------------------------- test-drive

const SEZNAM_ZPROSTREDKOVATELU = `Jméno;Získatelské číslo;Pobočka;Platnost oprávnění do
Karel Příkladný;401118;Praha 4;31.12.2026
Petra Ukázková;401243;Brno-střed;31.12.2026
Lenka Vzorová;401301;Ostrava;30.06.2027
Tomáš Modelový;401377;Plzeň;31.12.2026
`;

const ADRESY_POBOCEK = `Adresy poboček Pojišťovny Vzorník a.s. – platné od 1. 1. 2026

Praha 4: Budějovická 1200/7, 140 00 Praha 4
Brno-střed: Masarykova 123/45, 602 00 Brno
Ostrava: Nádražní 88/12, 702 00 Ostrava
Plzeň: Americká 2100/30, 301 00 Plzeň

Úřední hodiny: Po–Pá 8:00–17:00.
`;

const SMERNICE = `Interní směrnice – archivace dokumentace

Smluvní dokumentace se archivuje po dobu 10 let od zániku pojištění.
Opravy v dokumentaci se provádějí přeškrtnutím chybného údaje jednou čarou tak,
aby zůstal čitelný, doplněním správného údaje a podpisem osoby, která opravu provedla.
`;

/** Popis souborů náhrady Disku: druh souboru jako na Google Disku a datum úpravy. */
const METADATA_DISKU = {
  'Seznam zprostředkovatelů 2026.csv': {
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedTime: '2026-01-05T09:12:00Z',
  },
  'Adresy poboček.txt': { mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-01-02T14:30:00Z' },
  'Směrnice/Interní směrnice – archivace.txt': {
    mimeType: 'application/vnd.google-apps.document',
    modifiedTime: '2025-06-10T08:00:00Z',
  },
  'podpis.png': { mimeType: 'image/png', modifiedTime: '2025-11-20T16:45:00Z' },
};

// ---------------------------------------------------------------- spuštění

await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(path.join(DISK, 'Směrnice'), { recursive: true });

const esd2Pdf = await esd2();
await fs.writeFile(path.join(DATA, 'smlouva.pdf'), await smlouva());
await fs.writeFile(path.join(DATA, 'esd-1-zaznam.pdf'), await esd1());
await fs.writeFile(path.join(DATA, 'esd-2-plna-moc.pdf'), esd2Pdf);
await fs.writeFile(path.join(DATA, 'esd-2-plna-moc-sken.pdf'), await sken(esd2Pdf));
await fs.writeFile(path.join(DATA, 'intervence.txt'), INTERVENCE);
await fs.writeFile(path.join(DATA, 'intervence.eml'), eml(INTERVENCE));
await fs.writeFile(path.join(DATA, 'intervence.docx'), await docx(INTERVENCE));

await fs.writeFile(path.join(DISK, 'Seznam zprostředkovatelů 2026.csv'), SEZNAM_ZPROSTREDKOVATELU);
await fs.writeFile(path.join(DISK, 'Adresy poboček.txt'), ADRESY_POBOCEK);
await fs.writeFile(path.join(DISK, 'Směrnice', 'Interní směrnice – archivace.txt'), SMERNICE);
await fs.writeFile(path.join(DISK, 'podpis.png'), podpisPng());
await fs.writeFile(path.join(DISK, '_metadata.json'), JSON.stringify(METADATA_DISKU, null, 2) + '\n');

console.log('Testovací data jsou ve složkách testovaci-data/ a test-drive/.');
