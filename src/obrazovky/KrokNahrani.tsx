import { AlertTriangle, ArrowRight, Eye, FileText, Loader2, ScanLine, Trash2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NahledSouboru } from '../komponenty/NahledSouboru';
import { VyberSouboru } from '../komponenty/VyberSouboru';
import { zkontrolujPdf } from '../pdf/kontrola';
import { bezPripony, formatVelikost, sklonuj, vyctiStrany } from '../pomocne';
import type { Intervence, KontrolaPdf, SouborInfo } from '../ulozeni/typy';
import { mimeSouboru, nactiSoubor, smazSoubor, smazSouborPoUlozeni, ulozSoubor } from '../ulozeni/uloziste';
import { pracujNa, usePracuje } from '../ulozeni/useIntervence';
import type { KrokProps } from './DetailIntervence';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Soubory s intervencí, které umí server přečíst. Ostatní (Outlook .msg, Excel, TIFF…) by tiše vynechal. */
const DRUHY_INTERVENCE = [PDF, 'text/plain', 'message/rfc822', DOCX, 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

const PRIJIMA_PDF = '.pdf,application/pdf';
const PRIJIMA_INTERVENCE = ['.pdf', '.txt', '.eml', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', ...DRUHY_INTERVENCE].join(',');

type Skupina = 'smlouva' | 'esd' | 'zprava';

/** Krok 1: nahrání smlouvy, ESD a intervence a jejich náhled. */
export function KrokNahrani({ intervence, zmen, prejdiNa }: KrokProps) {
  const [vybrany, setVybrany] = useState<SouborInfo | null>(null);
  const [hlasky, setHlasky] = useState<string[]>([]);
  const [tahneDoNahledu, setTahneDoNahledu] = useState(false);
  const pracuje = usePracuje(intervence.id);
  // Nahrávání a kontrola mohou doběhnout až po odchodu z obrazovky. Jejich výsledek se pak
  // zahodí: intervenci mezitím mohla načíst nová obrazovka a stará kopie by ji přepsala.
  // Nedokončenou kontrolu spustí znovu příští otevření (viz níže).
  const pripojeno = useRef(false);
  useEffect(() => {
    pripojeno.current = true;
    return () => {
      pripojeno.current = false;
    };
  }, []);

  // Kontrolu PDF mohlo přerušit zavření stránky nebo odchod z obrazovky – při otevření doběhne znovu.
  // Jen jednou: nově nahrané soubory kontroluje `pridat`.
  useEffect(() => {
    const nezkontrolovane = souboryIntervence(intervence).filter((s) => s.mime === PDF && !s.kontrola);
    if (nezkontrolovane.length === 0) return;
    let zruseno = false;
    void pracujNa(intervence.id, async () => {
      for (const s of nezkontrolovane) {
        const kontrola = await zkontrolujSoubor(nactiSoubor(s.id));
        if (zruseno) return;
        zmen((i) => upravSoubor(i, s.id, (x) => ({ ...x, kontrola })));
      }
    });
    return () => {
      zruseno = true;
    };
  }, []);

  // Soubor puštěný mimo pole pro nahrání by prohlížeč otevřel místo appky.
  useEffect(() => {
    const mimoPole = (e: DragEvent) => {
      if (e.defaultPrevented || !jsouToSoubory(e.dataTransfer)) return; // pole pro nahrání si ho vzalo samo
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', mimoPole);
    window.addEventListener('drop', mimoPole);
    return () => {
      window.removeEventListener('dragover', mimoPole);
      window.removeEventListener('drop', mimoPole);
    };
  }, []);

  /** Uloží soubory do prohlížeče, přidá je do intervence a PDF zkontroluje. */
  const pridat = async (skupina: Skupina, soubory: File[]) => {
    const prijate = soubory.filter((s) => (skupina === 'zprava' ? DRUHY_INTERVENCE : [PDF]).includes(mimeSouboru(s)));
    setHlasky(hlaskyOdmitnutych(skupina, soubory.filter((s) => !prijate.includes(s))));
    await pracujNa(intervence.id, async () => {
      // Nejdřív se všechny soubory uloží a ukážou, kontrola PDF (pomalejší) až potom.
      const pridane: { info: SouborInfo; soubor: File }[] = [];
      for (const soubor of prijate) {
        let info: SouborInfo;
        try {
          info = await ulozSoubor(intervence.id, soubor);
        } catch {
          const hlaska = `Soubor „${soubor.name}“ se nepodařilo uložit. V prohlížeči možná došlo místo.`;
          if (pripojeno.current) setHlasky((h) => (h.includes(hlaska) ? h : [...h, hlaska]));
          continue;
        }
        if (!pripojeno.current) {
          void smazSoubor(info.id).catch(() => undefined); // do intervence se už nedostane
          return;
        }
        zmen((i) => {
          // Nahrazená smlouva se smaže, až bude uložená intervence s novou (zmen volá úpravu právě jednou).
          if (skupina === 'smlouva' && i.smlouva) smazSouborPoUlozeni(i.id, i.smlouva.id);
          return pridejDoSkupiny(i, skupina, info);
        });
        if (skupina === 'smlouva') setVybrany(info);
        else if (skupina === 'esd') setVybrany((v) => v ?? info); // z více ESD najednou to první
        pridane.push({ info, soubor });
      }
      for (const { info, soubor } of pridane) {
        if (info.mime !== PDF) continue;
        const kontrola = await zkontrolujSoubor(soubor);
        if (!pripojeno.current) return;
        zmen((i) => upravSoubor(i, info.id, (s) => ({ ...s, kontrola })));
      }
    });
  };

  const odebrat = (soubor: SouborInfo) => {
    if (!window.confirm(`Odebrat soubor „${soubor.nazev}“? Z appky se smaže, originál ve vašem počítači zůstane.`)) return;
    zmen((i) => ({
      ...i,
      smlouva: i.smlouva?.id === soubor.id ? null : i.smlouva,
      esd: i.esd.filter((s) => s.id !== soubor.id),
      zprava: { ...i.zprava, soubory: i.zprava.soubory.filter((s) => s.id !== soubor.id) },
    }));
    smazSouborPoUlozeni(intervence.id, soubor.id);
    setVybrany((v) => (v?.id === soubor.id ? null : v));
  };

  const chybi = coChybi(intervence);
  // Rozpracované nahrávání by odchodem z obrazovky přišlo vniveč.
  if (pracuje && chybi.length === 0) chybi.push('Počkejte, až se soubory nahrají a zkontrolují.');

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-col lg:w-[30rem] lg:shrink-0 lg:border-r lg:border-slate-200">
        <div className="min-h-0 flex-auto overflow-auto p-4">
          <Sekce titulek="1. Smlouva" popis="PDF smlouvy – podle ní se dohledávají správné údaje. Nemění se.">
            {intervence.smlouva && (
              <PolozkaSouboru
                soubor={intervence.smlouva}
                vybrany={vybrany?.id === intervence.smlouva.id}
                onNahled={setVybrany}
                onOdebrat={odebrat}
                roleEsd={false}
              />
            )}
            <VyberSouboru
              popisek={intervence.smlouva ? 'Nahradit smlouvu' : 'Nahrát smlouvu'}
              napoveda="PDF – klikněte nebo přetáhněte"
              prijima={PRIJIMA_PDF}
              onVybrano={(s) => pridat('smlouva', s)}
            />
          </Sekce>

          <Sekce titulek="2. ESD – smluvní dokumentace" popis="Jedno nebo více PDF, které se opravují. Originály zůstanou beze změny.">
            {intervence.esd.map((s) => (
              <PolozkaSouboru
                key={s.id}
                soubor={s}
                vybrany={vybrany?.id === s.id}
                onNahled={setVybrany}
                onOdebrat={odebrat}
                roleEsd
              />
            ))}
            <VyberSouboru
              popisek="Přidat ESD"
              napoveda="PDF, i více najednou"
              prijima={PRIJIMA_PDF}
              vice
              onVybrano={(s) => pridat('esd', s)}
            />
          </Sekce>

          <Sekce titulek="3. Intervence" popis="Zpráva od centrály, co je na ESD špatně. Vložte text nebo nahrajte soubor.">
            <textarea
              className="pole mb-2 min-h-32"
              placeholder="Sem vložte text intervence…"
              value={intervence.zprava.text}
              onChange={(e) => zmen((i) => ({ ...i, zprava: { ...i.zprava, text: e.target.value } }))}
            />
            {intervence.zprava.soubory.map((s) => (
              <PolozkaSouboru
                key={s.id}
                soubor={s}
                vybrany={vybrany?.id === s.id}
                onNahled={setVybrany}
                onOdebrat={odebrat}
                roleEsd={false}
              />
            ))}
            <VyberSouboru
              popisek="Přidat soubor s intervencí"
              napoveda="PDF, obrázek (PNG, JPEG, WebP, HEIC), TXT, e-mail (EML) nebo Word (DOCX)"
              prijima={PRIJIMA_INTERVENCE}
              vice
              onVybrano={(s) => pridat('zprava', s)}
            />
          </Sekce>
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-3">
          {hlasky.length > 0 && (
            <ul className="mb-2 space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
              {hlasky.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {chybi.length > 0 && (
            <ul className="mb-2 list-inside list-disc text-sm text-slate-600">
              {chybi.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <button className="tlacitko-hlavni w-full" disabled={chybi.length > 0} onClick={() => prejdiNa('dohledani')}>
            Pokračovat k dohledání <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <div
        className="relative min-h-[60vh] flex-1 lg:min-h-0"
        onDragOver={(e) => {
          if (jsouToSoubory(e.dataTransfer)) setTahneDoNahledu(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTahneDoNahledu(false);
        }}
        onDrop={() => setTahneDoNahledu(false)}
      >
        {vybrany ? (
          <NahledSouboru key={vybrany.id} soubor={vybrany} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-slate-500">
            Náhled se zobrazí po nahrání nebo po kliknutí na „Náhled“ u souboru.
          </div>
        )}
        {tahneDoNahledu && (
          // Pustit soubor sem nejde (zařídí to hlídání výše), jen se poradí kam.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 p-6 text-center font-medium text-slate-700">
            Sem soubor pustit nejde. Přetáhněte ho do pole pro smlouvu, ESD nebo intervenci.
          </div>
        )}
      </div>
    </div>
  );
}

function Sekce({ titulek, popis, children }: { titulek: string; popis: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-lg font-semibold">{titulek}</h2>
      <p className="mb-2 text-sm text-slate-600">{popis}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function PolozkaSouboru({
  soubor,
  vybrany,
  onNahled,
  onOdebrat,
  roleEsd,
}: {
  soubor: SouborInfo;
  vybrany: boolean;
  onNahled: (s: SouborInfo) => void;
  onOdebrat: (s: SouborInfo) => void;
  roleEsd: boolean;
}) {
  const k = soubor.kontrola;
  const jePdfSoubor = soubor.mime === PDF;
  return (
    <div className={`rounded-lg border p-2 ${vybrany ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <FileText size={20} className="shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={soubor.nazev}>
            {soubor.nazev}
          </p>
          <p className="text-xs text-slate-500">
            {formatVelikost(soubor.velikost)}
            {k && k.stran > 0 && ` · ${sklonuj(k.stran, 'strana', 'strany', 'stran')}`}
          </p>
        </div>
        {/* Velká tlačítka s mezerou, aby se prstem netrefilo odebrání místo náhledu. */}
        <div className="flex shrink-0 items-center gap-4">
          <button className="tlacitko-ikona min-h-11 min-w-11 gap-1 px-2 text-sm font-medium" onClick={() => onNahled(soubor)}>
            <Eye size={20} /> Náhled
          </button>
          <button
            className="tlacitko-ikona min-h-11 min-w-11 text-red-700 hover:bg-red-50"
            onClick={() => onOdebrat(soubor)}
            title="Odebrat"
            aria-label="Odebrat"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>
      {jePdfSoubor && !k && (
        <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Kontroluji soubor…
        </p>
      )}
      {k && <UpozorneniKontroly kontrola={k} roleEsd={roleEsd} />}
    </div>
  );
}

function UpozorneniKontroly({ kontrola: k, roleEsd }: { kontrola: NonNullable<SouborInfo['kontrola']>; roleEsd: boolean }) {
  const radky: { typ: 'chyba' | 'varovani' | 'info'; text: string }[] = [];
  if (k.chyba) radky.push({ typ: 'chyba', text: k.chyba });
  if (k.potrebujeHeslo) radky.push({ typ: 'chyba', text: 'PDF je zašifrované heslem a nejde otevřít. Nahrajte verzi bez hesla.' });
  else if (k.sifrovany && roleEsd)
    radky.push({
      typ: 'chyba',
      text: 'PDF je zašifrované (zabezpečené proti úpravám), takže do něj nejde opravu zakreslit. Nahrajte nezabezpečenou verzi.',
    });
  else if (k.nejdeUpravit && !k.chyba && roleEsd)
    radky.push({
      typ: 'chyba',
      text: 'Toto ESD appka neumí upravit – PDF má neobvyklou vnitřní stavbu. Otevřete ho, uložte znovu jako PDF (třeba přes „Tisk do PDF“) a nahrajte novou verzi.',
    });
  if (k.digitalnePodepsany && roleEsd)
    radky.push({ typ: 'varovani', text: 'PDF je digitálně podepsané. Úpravou digitální podpis přestane platit.' });
  if (k.stranyBezTextu.length > 0 && k.stran > 0)
    radky.push({
      typ: 'info',
      text:
        k.stranyBezTextu.length === k.stran
          ? 'Celé PDF je sken bez textu – text se rozpozná pomocí OCR.'
          : `${k.stranyBezTextu.length === 1 ? 'Strana' : 'Strany'} ${vyctiStrany(k.stranyBezTextu)} ${
              k.stranyBezTextu.length === 1 ? 'je sken' : 'jsou skeny'
            } bez textu – text se rozpozná pomocí OCR.`,
    });
  if (radky.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-sm">
      {radky.map((r) => (
        <li
          key={r.text}
          className={`flex gap-1 ${r.typ === 'chyba' ? 'text-red-700' : r.typ === 'varovani' ? 'text-amber-800' : 'text-slate-600'}`}
        >
          {r.typ === 'chyba' && <XCircle size={16} className="mt-0.5 shrink-0" />}
          {r.typ === 'varovani' && <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {r.typ === 'info' && <ScanLine size={16} className="mt-0.5 shrink-0" />}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Táhne se soubor (ne třeba označený text)? */
function jsouToSoubory(prenos: DataTransfer | null) {
  return !!prenos?.types.includes('Files');
}

/** „a.pdf“, „b.pdf“ a „c.pdf“ */
function vyctiSoubory(nazvy: string[]) {
  const vUvozovkach = nazvy.map((n) => `„${n}“`);
  if (vUvozovkach.length <= 1) return vUvozovkach.join('');
  return `${vUvozovkach.slice(0, -1).join(', ')} a ${vUvozovkach[vUvozovkach.length - 1]}`;
}

/** Hlášky k souborům, které do dané skupiny nepatří. */
function hlaskyOdmitnutych(skupina: Skupina, odmitnute: File[]): string[] {
  if (odmitnute.length === 0) return [];
  const jeden = odmitnute.length === 1;
  if (skupina !== 'zprava')
    return [`${jeden ? 'Soubor' : 'Soubory'} ${vyctiSoubory(odmitnute.map((s) => s.name))} ${jeden ? 'není' : 'nejsou'} PDF. Sem patří jen PDF.`];
  // Soubory se stejnou radou v jedné hlášce.
  const podleRady = new Map<string, string[]>();
  for (const s of odmitnute) podleRady.set(radaKSouboru(s.name), [...(podleRady.get(radaKSouboru(s.name)) ?? []), s.name]);
  return [...podleRady].map(
    ([rada, nazvy]) => `${nazvy.length === 1 ? 'Soubor' : 'Soubory'} ${vyctiSoubory(nazvy)} appka neumí přečíst. ${rada}`,
  );
}

/** Co s nepodporovaným souborem intervence udělat (podle přípony). */
function radaKSouboru(nazev: string) {
  const pripona = nazev.toLowerCase().split('.').pop() ?? '';
  if (pripona === 'msg') return 'E-mail z Outlooku uložte jako .eml, nebo text zprávy vložte do pole.';
  if (['doc', 'rtf', 'odt'].includes(pripona)) return 'Dokument uložte ve Wordu jako .docx nebo jako PDF.';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(pripona)) return 'Tabulku uložte jako PDF, nebo potřebný text vložte do pole.';
  if (['tif', 'tiff', 'bmp', 'gif'].includes(pripona)) return 'Obrázek uložte jako PNG nebo JPEG.';
  return 'Nahrát jde PDF, obrázek (PNG, JPEG, WebP, HEIC), TXT, e-mail (EML) nebo Word (DOCX).';
}

/**
 * Zkontroluje PDF. Když se to nepovede, vrátí kontrolu s chybou – soubor jinak
 * zůstal by navždy „Kontroluji soubor…“ a nešlo by pokračovat.
 */
async function zkontrolujSoubor(data: Blob | undefined | Promise<Blob | undefined>): Promise<KontrolaPdf> {
  const nepovedena = (chyba: string): KontrolaPdf => ({
    stran: 0,
    sifrovany: false,
    potrebujeHeslo: false,
    digitalnePodepsany: false,
    stranyBezTextu: [],
    chyba,
  });
  try {
    const blob = await data;
    if (!blob) return nepovedena('Soubor chybí v úložišti prohlížeče. Odeberte ho a nahrajte znovu.');
    return await zkontrolujPdf(await blob.arrayBuffer());
  } catch {
    return nepovedena('Soubor se nepodařilo přečíst. Možná je poškozený nebo to není PDF.');
  }
}

function souboryIntervence(i: Intervence) {
  return [...(i.smlouva ? [i.smlouva] : []), ...i.esd, ...i.zprava.soubory];
}

function pridejDoSkupiny(i: Intervence, skupina: Skupina, info: SouborInfo): Intervence {
  if (skupina === 'smlouva') return { ...i, smlouva: info, nazev: i.nazev || bezPripony(info.nazev) };
  if (skupina === 'esd') return { ...i, esd: [...i.esd, info] };
  return { ...i, zprava: { ...i.zprava, soubory: [...i.zprava.soubory, info] } };
}

function upravSoubor(i: Intervence, id: string, uprava: (s: SouborInfo) => SouborInfo): Intervence {
  const uprav = (s: SouborInfo) => (s.id === id ? uprava(s) : s);
  return {
    ...i,
    smlouva: i.smlouva && uprav(i.smlouva),
    esd: i.esd.map(uprav),
    zprava: { ...i.zprava, soubory: i.zprava.soubory.map(uprav) },
  };
}

/** Co ještě chybí, aby šlo pokračovat k dohledání. */
export function coChybi(i: Intervence): string[] {
  const chybi: string[] = [];
  if (!i.smlouva) chybi.push('Nahrajte smlouvu.');
  else if (!i.smlouva.kontrola) chybi.push('Počkejte na kontrolu smlouvy.');
  else if (i.smlouva.kontrola.chyba || i.smlouva.kontrola.potrebujeHeslo) chybi.push('Smlouvu nejde otevřít – nahrajte jinou.');
  if (i.esd.length === 0) chybi.push('Nahrajte aspoň jedno ESD.');
  else if (i.esd.some((s) => !s.kontrola)) chybi.push('Počkejte na kontrolu ESD.');
  else if (i.esd.some((s) => s.kontrola?.chyba || s.kontrola?.sifrovany || s.kontrola?.nejdeUpravit))
    chybi.push('Některé ESD nejde upravit – odeberte ho a nahrajte jinou verzi.');
  const soubory = i.zprava.soubory;
  const pdf = soubory.filter((s) => s.mime === PDF);
  if (!i.zprava.text.trim() && soubory.length === 0) chybi.push('Vložte text intervence nebo nahrajte soubor s ní.');
  else if (pdf.some((s) => !s.kontrola)) chybi.push('Počkejte na kontrolu souboru s intervencí.');
  else if (pdf.some((s) => s.kontrola?.chyba || s.kontrola?.potrebujeHeslo))
    chybi.push('Soubor s intervencí nejde otevřít – odeberte ho a nahrajte verzi bez hesla, nebo text vložte do pole.');
  // Soubory nahrané dřív, než appka druhy hlídala.
  const necitelne = soubory.filter((s) => !DRUHY_INTERVENCE.includes(s.mime));
  if (necitelne.length > 0)
    chybi.push(
      `${necitelne.length === 1 ? 'Soubor' : 'Soubory'} ${vyctiSoubory(necitelne.map((s) => s.nazev))} appka neumí přečíst – odeberte ${
        necitelne.length === 1 ? 'ho' : 'je'
      }.`,
    );
  return chybi;
}

/** Načte data souboru (pro další kroky). */
export async function dataSouboru(s: SouborInfo) {
  const blob = await nactiSoubor(s.id);
  if (!blob) throw new Error(`Soubor ${s.nazev} chybí v úložišti prohlížeče.`);
  return blob;
}
