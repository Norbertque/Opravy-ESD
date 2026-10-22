import JSZip from 'jszip';
import { AlertTriangle, ChevronLeft, Download, Eye, FileArchive, FileCheck2, Loader2, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { konfigurace } from '../../konfigurace';
import { jdiNa } from '../cesta';
import { PRIHLASENI_NAPOJENO, tokenDisku } from '../disk/prihlaseni';
import { zakresliOpravy, type OpravaKZakresleni, type ZpravaOprave } from '../export/kresleni';
import { NahledPdf } from '../komponenty/NahledPdf';
import { bezPripony, sklonuj } from '../pomocne';
import { jeUmisteno } from '../schvalovani/umisteni';
import type { Intervence, SouborInfo } from '../ulozeni/typy';
import { nactiSoubor, smazIntervenci } from '../ulozeni/uloziste';
import type { KrokProps } from './DetailIntervence';

interface Podpis {
  data: ArrayBuffer;
  url: string;
  zdroj: string;
}

interface Kandidat {
  id: string;
  nazev: string;
}

interface Vystup {
  soubor: SouborInfo;
  nazev: string;
  data: Uint8Array;
  zpravy: ZpravaOprave[];
}

const POPIS_POLOHY: Record<ZpravaOprave['poloha'], string> = {
  vpravo: 'vpravo vedle textu',
  nad: 'nad textem',
  pod: 'pod textem',
  okraj: 'na volném místě se spojovací čarou',
};

/** Schválené opravy pro jeden soubor ESD. */
export function opravyProSoubor(i: Intervence, souborId: string): OpravaKZakresleni[] {
  const s = i.schvalovani;
  const body = i.dohledani?.vysledek?.body ?? [];
  if (!s) return [];
  const opravy: OpravaKZakresleni[] = [];
  for (const b of body) {
    const r = s.body[b.cislo];
    if (!r || r.rozhodnuti !== 'schvaleno' || !r.oprava.trim()) continue;
    for (const u of r.vyskyty)
      if (jeUmisteno(u) && u.souborId === souborId)
        opravy.push({ popis: `Bod ${b.cislo}`, strana: u.strana, typ: b.typ === 'doplneni' ? 'doplneni' : 'oprava', useky: u.useky, text: r.oprava.trim() });
  }
  for (const r of s.rucni)
    if (r.souborId === souborId) opravy.push({ popis: 'Ruční oprava', strana: r.strana, typ: r.typ, useky: r.useky, text: r.oprava });
  return opravy;
}

/** Krok 4: zakreslení oprav s podpisem a stažení opravených PDF. */
export function KrokExport({ intervence, prejdiNa }: KrokProps) {
  const [mockDisk, setMockDisk] = useState<boolean | null>(null);
  const [podpis, setPodpis] = useState<Podpis | null>(null);
  const [stavPodpisu, setStavPodpisu] = useState<'nacitam' | 'ok' | 'chybi'>('nacitam');
  const [hlaskaPodpisu, setHlaskaPodpisu] = useState<string | null>(null);
  const [kandidati, setKandidati] = useState<Kandidat[]>([]);
  const [vystupy, setVystupy] = useState<Vystup[] | null>(null);
  const [pracuji, setPracuji] = useState<string | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nahled, setNahled] = useState<Vystup | null>(null);
  const vstupPodpisu = useRef<HTMLInputElement>(null);

  const soubory = useMemo(
    () => intervence.esd.map((s) => ({ soubor: s, opravy: opravyProSoubor(intervence, s.id) })).filter((x) => x.opravy.length > 0),
    [intervence],
  );
  const celkem = soubory.reduce((n, x) => n + x.opravy.length, 0);

  // Uvolnit adresu obrázku podpisu
  useEffect(() => () => void (podpis && URL.revokeObjectURL(podpis.url)), [podpis]);

  const nastavPodpis = (data: ArrayBuffer, zdroj: string) => {
    setPodpis({ data, url: URL.createObjectURL(new Blob([data], { type: 'image/png' })), zdroj });
    setStavPodpisu('ok');
    setHlaskaPodpisu(null);
    setVystupy(null);
  };

  const hlavicky = async (): Promise<Record<string, string>> => {
    const token = PRIHLASENI_NAPOJENO ? await tokenDisku() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Podpis z Disku podle konfigurace
  useEffect(() => {
    let zruseno = false;
    (async () => {
      try {
        const stav = await fetch('/api/stav').then((r) => r.json());
        if (!zruseno) setMockDisk(stav.mockDisk);
        const odpoved = await fetch('/api/podpis', { headers: await hlavicky() });
        if (zruseno) return;
        if (odpoved.ok) return nastavPodpis(await odpoved.arrayBuffer(), `z Google Disku: ${decodeURIComponent(odpoved.headers.get('X-Nazev') ?? konfigurace.disk.podpis)}`);
        const telo = await odpoved.json().catch(() => ({}));
        setKandidati(telo.kandidati ?? []);
        setHlaskaPodpisu(telo.chyba ?? 'Podpis se nepodařilo načíst. Nahrajte ho z počítače.');
        setStavPodpisu('chybi');
      } catch {
        if (zruseno) return;
        setHlaskaPodpisu('Podpis se nepodařilo načíst. Nahrajte ho z počítače.');
        setStavPodpisu('chybi');
      }
    })();
    return () => {
      zruseno = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vybratKandidata = async (k: Kandidat) => {
    const odpoved = await fetch(`/api/podpis/${encodeURIComponent(k.id)}`, { headers: await hlavicky() });
    if (odpoved.ok) nastavPodpis(await odpoved.arrayBuffer(), `z Google Disku: ${k.nazev}`);
    else setHlaskaPodpisu('Vybraný obrázek se nepodařilo načíst.');
  };

  const nahratZPocitace = async (soubor: File | undefined) => {
    if (!soubor) return;
    if (soubor.type !== 'image/png' && !soubor.name.toLowerCase().endsWith('.png'))
      return setHlaskaPodpisu('Podpis musí být obrázek PNG (ideálně s průhledným pozadím).');
    nastavPodpis(await soubor.arrayBuffer(), `nahraný z počítače: ${soubor.name}`);
  };

  const vytvorit = async () => {
    setChyba(null);
    setVystupy(null);
    setNahled(null);
    const hotove: Vystup[] = [];
    try {
      for (const { soubor, opravy } of soubory) {
        setPracuji(`Zakresluji opravy do „${soubor.nazev}“…`);
        const blob = await nactiSoubor(soubor.id);
        if (!blob) throw new Error(`Soubor „${soubor.nazev}“ chybí v úložišti prohlížeče.`);
        const { data, zpravy } = await zakresliOpravy(await blob.arrayBuffer(), opravy, podpis?.data ?? null);
        hotove.push({ soubor, nazev: `${bezPripony(soubor.nazev)}${konfigurace.vystup.priponaSouboru}.pdf`, data, zpravy });
      }
      setVystupy(hotove);
      setNahled(hotove[0] ?? null);
    } catch (e) {
      setChyba(`Opravená PDF se nepodařilo vytvořit: ${e instanceof Error ? e.message : 'neznámá chyba'}`);
    } finally {
      setPracuji(null);
    }
  };

  const stahniZip = async () => {
    if (!vystupy) return;
    const zip = new JSZip();
    for (const v of vystupy) zip.file(v.nazev, v.data);
    const datum = new Date().toISOString().slice(0, 10);
    stahni(await zip.generateAsync({ type: 'blob' }), `${konfigurace.vystup.nazevZip}-${datum}.zip`);
  };

  const dokoncit = async () => {
    if (!window.confirm('Dokončit a smazat tuto intervenci včetně nahraných souborů? Opravená PDF si nejdřív stáhněte.')) return;
    await smazIntervenci(intervence.id);
    jdiNa({ obrazovka: 'seznam' });
  };

  const podepsane = soubory.filter((x) => x.soubor.kontrola?.digitalnePodepsany);
  const nahledData = useMemo(() => (nahled ? new Blob([nahled.data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) : null), [nahled]);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="min-h-0 space-y-4 overflow-auto p-4 lg:w-[28rem] lg:shrink-0 lg:border-r lg:border-slate-200">
        <section className="karta p-4">
          <h2 className="mb-1 text-lg font-semibold">Stažení opravených PDF</h2>
          {celkem === 0 ? (
            <p className="text-slate-600">Není schválená žádná oprava. Vraťte se ke schvalování.</p>
          ) : (
            <p className="text-slate-600">
              {sklonuj(celkem, 'oprava', 'opravy', 'oprav')} v {sklonuj(soubory.length, 'souboru', 'souborech', 'souborech')}. Originály
              zůstanou beze změny.
            </p>
          )}
          {podepsane.map((x) => (
            <p key={x.soubor.id} className="mt-2 flex gap-2 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Soubor „{x.soubor.nazev}“ je digitálně podepsaný – úpravou digitální podpis přestane platit.
            </p>
          ))}
        </section>

        <section className="karta p-4">
          <h3 className="mb-2 font-semibold">Podpis</h3>
          {stavPodpisu === 'nacitam' && (
            <p className="flex items-center gap-2 text-slate-600">
              <Loader2 size={16} className="animate-spin" /> Načítám podpis z Disku…
            </p>
          )}
          {podpis && (
            <div className="mb-2 flex items-center gap-3">
              <img src={podpis.url} alt="Podpis" className="h-12 max-w-48 rounded border border-slate-200 bg-white object-contain p-1" />
              <span className="text-sm text-slate-600">{podpis.zdroj}</span>
            </div>
          )}
          {hlaskaPodpisu && <p className="mb-2 text-sm text-amber-900">{hlaskaPodpisu}</p>}
          {kandidati.length > 0 && !podpis && (
            <ul className="mb-2 space-y-1">
              {kandidati.map((k) => (
                <li key={k.id}>
                  <button className="tlacitko w-full justify-start" onClick={() => vybratKandidata(k)}>
                    {k.nazev}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {stavPodpisu !== 'nacitam' && (
            <button className="tlacitko" onClick={() => vstupPodpisu.current?.click()}>
              <Upload size={18} /> {podpis ? 'Použít jiný podpis z počítače' : 'Nahrát podpis z počítače'}
            </button>
          )}
          <input
            ref={vstupPodpisu}
            type="file"
            accept=".png,image/png"
            className="hidden"
            onChange={(e) => {
              void nahratZPocitace(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {mockDisk === false && !PRIHLASENI_NAPOJENO && !podpis && (
            <p className="mt-2 text-sm text-slate-600">Google Disk není v appce připojený, podpis nahrajte z počítače.</p>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <button className="tlacitko-hlavni" disabled={!podpis || celkem === 0 || !!pracuji} onClick={vytvorit}>
            {pracuji ? <Loader2 size={18} className="animate-spin" /> : <FileCheck2 size={18} />} Vytvořit opravená PDF
          </button>
          <button className="tlacitko" onClick={() => prejdiNa('schvalovani')} disabled={!!pracuji}>
            <ChevronLeft size={18} /> Zpět ke schvalování
          </button>
        </div>
        {pracuji && <p className="text-sm text-slate-600">{pracuji}</p>}
        {chyba && <p className="rounded-lg bg-red-50 p-3 text-red-800">{chyba}</p>}

        {vystupy && (
          <section className="karta p-4">
            <h3 className="mb-2 font-semibold">Hotovo</h3>
            <ul className="mb-3 space-y-3">
              {vystupy.map((v) => (
                <li key={v.nazev} className="rounded-lg border border-slate-200 p-2">
                  <p className="mb-1 font-medium">{v.nazev}</p>
                  <ul className="mb-2 text-sm text-slate-600">
                    {v.zpravy.map((z, i) => (
                      <li key={i} className={z.nouzove ? 'text-amber-900' : undefined}>
                        {z.popis} (str. {z.strana}): {z.nouzove ? 'nenašlo se volné místo – zkontrolujte, jestli oprava nic nepřekrývá' : POPIS_POLOHY[z.poloha]}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button className="tlacitko" onClick={() => stahni(new Blob([v.data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), v.nazev)}>
                      <Download size={18} /> Stáhnout
                    </button>
                    <button className="tlacitko" onClick={() => setNahled(v)}>
                      <Eye size={18} /> Náhled
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {vystupy.length > 1 && (
              <button className="tlacitko-hlavni mb-3" onClick={stahniZip}>
                <FileArchive size={18} /> Stáhnout vše (ZIP)
              </button>
            )}
            <p className="mb-2 text-sm text-slate-600">
              Až budete mít opravená PDF stažená, intervenci můžete smazat. Jinak se sama smaže po {konfigurace.ulozeni.smazatPoDnech} dnech bez
              úprav.
            </p>
            <button className="tlacitko-nebezpecne" onClick={dokoncit}>
              <Trash2 size={18} /> Dokončit a smazat
            </button>
          </section>
        )}
      </div>

      <div className="min-h-[60vh] flex-1 lg:min-h-0">
        {nahledData ? (
          <NahledPdf key={nahled?.nazev} data={nahledData} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">
            Po vytvoření se tu zobrazí náhled opraveného PDF.
          </div>
        )}
      </div>
    </div>
  );
}

function stahni(blob: Blob, nazev: string) {
  const url = URL.createObjectURL(blob);
  const odkaz = document.createElement('a');
  odkaz.href = url;
  odkaz.download = nazev;
  document.body.append(odkaz);
  odkaz.click();
  odkaz.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
