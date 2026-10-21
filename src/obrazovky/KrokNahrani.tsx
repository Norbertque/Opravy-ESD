import { AlertTriangle, ArrowRight, Eye, FileText, Loader2, ScanLine, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { NahledSouboru } from '../komponenty/NahledSouboru';
import { VyberSouboru } from '../komponenty/VyberSouboru';
import { zkontrolujPdf } from '../pdf/kontrola';
import { bezPripony, formatVelikost, sklonuj, vyctiStrany } from '../pomocne';
import type { Intervence, SouborInfo } from '../ulozeni/typy';
import { nactiSoubor, smazSoubor, ulozSoubor } from '../ulozeni/uloziste';
import type { KrokProps } from './DetailIntervence';

const PRIJIMA_PDF = '.pdf,application/pdf';
const PRIJIMA_INTERVENCE = '.pdf,.txt,.eml,.docx,image/*,application/pdf,text/plain,message/rfc822';

type Skupina = 'smlouva' | 'esd' | 'zprava';

/** Krok 1: nahrání smlouvy, ESD a intervence a jejich náhled. */
export function KrokNahrani({ intervence, zmen, prejdiNa }: KrokProps) {
  const [vybrany, setVybrany] = useState<SouborInfo | null>(null);
  const [hlaska, setHlaska] = useState<string | null>(null);

  /** Uloží soubory do prohlížeče, přidá je do intervence a PDF zkontroluje. */
  const pridat = async (skupina: Skupina, soubory: File[]) => {
    setHlaska(null);
    const pdfOnly = skupina !== 'zprava';
    const nepodporovane = soubory.filter((s) => pdfOnly && !jePdf(s));
    if (nepodporovane.length) {
      setHlaska(`Soubor ${nepodporovane.map((s) => `„${s.name}"`).join(', ')} není PDF. Sem patří jen PDF.`);
    }
    for (const soubor of soubory) {
      if (pdfOnly && !jePdf(soubor)) continue;
      let info: SouborInfo;
      try {
        info = await ulozSoubor(intervence.id, soubor);
      } catch {
        setHlaska(`Soubor „${soubor.name}" se nepodařilo uložit. V prohlížeči možná došlo místo.`);
        continue;
      }
      zmen((i) => pridejDoSkupiny(i, skupina, info));
      if (skupina === 'smlouva' && intervence.smlouva) void smazSoubor(intervence.smlouva.id);
      if (info.mime === 'application/pdf') {
        const kontrola = await zkontrolujPdf(await soubor.arrayBuffer());
        zmen((i) => upravSoubor(i, info.id, (s) => ({ ...s, kontrola })));
      }
      if (skupina === 'smlouva' || (skupina === 'esd' && !vybrany)) setVybrany(info);
    }
  };

  const odebrat = (soubor: SouborInfo) => {
    zmen((i) => ({
      ...i,
      smlouva: i.smlouva?.id === soubor.id ? null : i.smlouva,
      esd: i.esd.filter((s) => s.id !== soubor.id),
      zprava: { ...i.zprava, soubory: i.zprava.soubory.filter((s) => s.id !== soubor.id) },
    }));
    void smazSoubor(soubor.id);
    if (vybrany?.id === soubor.id) setVybrany(null);
  };

  const chybi = coChybi(intervence);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="min-h-0 overflow-auto p-4 lg:w-[30rem] lg:shrink-0 lg:border-r lg:border-slate-200">
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
            napoveda="PDF, obrázek, TXT, e-mail (EML) nebo Word (DOCX)"
            prijima={PRIJIMA_INTERVENCE}
            vice
            onVybrano={(s) => pridat('zprava', s)}
          />
        </Sekce>

        {hlaska && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{hlaska}</p>}

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
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

      <div className="min-h-[60vh] flex-1 lg:min-h-0">
        {vybrany ? (
          <NahledSouboru key={vybrany.id} soubor={vybrany} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-slate-500">
            Náhled se zobrazí po nahrání nebo kliknutí na „Náhled" u souboru.
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
  const jePdfSoubor = soubor.mime === 'application/pdf';
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
        <button className="tlacitko-ikona" onClick={() => onNahled(soubor)} title="Náhled" aria-label="Náhled">
          <Eye size={20} />
        </button>
        <button className="tlacitko-ikona text-red-700" onClick={() => onOdebrat(soubor)} title="Odebrat" aria-label="Odebrat">
          <Trash2 size={20} />
        </button>
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
  if (k.digitalnePodepsany && roleEsd)
    radky.push({ typ: 'varovani', text: 'PDF je digitálně podepsané. Úpravou digitální podpis přestane platit.' });
  if (k.stranyBezTextu.length > 0 && k.stran > 0)
    radky.push({
      typ: 'info',
      text:
        k.stranyBezTextu.length === k.stran
          ? 'Celé PDF je sken bez textu – text se rozpozná pomocí OCR.'
          : `${k.stranyBezTextu.length === 1 ? 'Strana' : 'Strany'} ${vyctiStrany(k.stranyBezTextu)} ${
              k.stranyBezTextu.length === 1 ? 'je sken' : 'jsou sken'
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

function jePdf(soubor: File) {
  return soubor.type === 'application/pdf' || soubor.name.toLowerCase().endsWith('.pdf');
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
  else if (i.esd.some((s) => s.kontrola?.chyba || s.kontrola?.sifrovany))
    chybi.push('Některé ESD nejde upravit – odeberte ho a nahrajte jinou verzi.');
  if (!i.zprava.text.trim() && i.zprava.soubory.length === 0) chybi.push('Vložte text intervence nebo nahrajte soubor s ní.');
  return chybi;
}

/** Načte data souboru (pro další kroky). */
export async function dataSouboru(s: SouborInfo) {
  const blob = await nactiSoubor(s.id);
  if (!blob) throw new Error(`Soubor ${s.nazev} chybí v úložišti prohlížeče.`);
  return blob;
}
