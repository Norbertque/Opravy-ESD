import { AlertTriangle, ArrowRight, ChevronLeft, Cloud, Loader2, RotateCcw, Search, Square, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PRIHLASENI_NAPOJENO, prihlasitKDisku, tokenDisku } from '../disk/prihlaseni';
import { ChybaDohledani, spustDohledani } from '../dohledani/klient';
import { OPAKOVATELNE, vyzadujePozornost, type BodIntervence } from '../sdilene/dohledani';
import { sklonuj } from '../pomocne';
import type { KrokProps } from './DetailIntervence';

export const NAZVY_TYPU: Record<BodIntervence['typ'], string> = {
  oprava: 'Oprava',
  doplneni: 'Doplnění',
  rucne: 'Ruční úkol',
};

export const NAZVY_ZDROJU: Record<BodIntervence['zdroj_typ'], string> = {
  smlouva: 'Smlouva',
  disk: 'Google Disk',
  web: 'Internet',
  zadny: 'Nenalezeno',
};

export const NAZVY_JISTOTY: Record<BodIntervence['jistota'], string> = {
  vysoka: 'vysoká',
  stredni: 'střední',
  nizka: 'nízká',
};

/** Krok 2: rozdělení intervence na body a dohledání správných údajů. */
export function KrokDohledani({ intervence, zmen, prejdiNa }: KrokProps) {
  const [bezi, setBezi] = useState(false);
  const [prubeh, setPrubeh] = useState<string[]>(intervence.dohledani?.prubeh ?? []);
  const [mockDisk, setMockDisk] = useState<boolean | null>(null);
  const [hlaskaDisku, setHlaskaDisku] = useState<string | null>(null);
  const preruseni = useRef<AbortController | null>(null);
  const konecSeznamu = useRef<HTMLLIElement>(null);

  useEffect(() => {
    fetch('/api/stav')
      .then((r) => r.json())
      .then((s: { mockDisk: boolean }) => setMockDisk(s.mockDisk))
      .catch(() => setMockDisk(false));
    return () => preruseni.current?.abort();
  }, []);

  useEffect(() => {
    konecSeznamu.current?.scrollIntoView({ block: 'nearest' });
  }, [prubeh.length]);

  const stav = intervence.dohledani;
  const vysledek = stav?.vysledek ?? null;
  const chyba = !bezi ? (stav?.chyba ?? null) : null;

  const spustit = async () => {
    if (vysledek && !window.confirm('Spustit dohledání znovu? Dosavadní výsledek i případné úpravy na dalších krocích se nahradí.'))
      return;
    setHlaskaDisku(null);
    let token: string | null = null;
    if (!mockDisk && PRIHLASENI_NAPOJENO) {
      token = await tokenDisku();
      if (!token) {
        try {
          token = await prihlasitKDisku();
        } catch (e) {
          setHlaskaDisku(
            `Přihlášení k Google Disku se nepodařilo${e instanceof Error ? `: ${e.message}` : '.'} Dohledání poběží bez Disku.`,
          );
        }
      }
    }

    const ovladac = new AbortController();
    preruseni.current = ovladac;
    const radky: string[] = [];
    const spusteno = Date.now();
    setBezi(true);
    setPrubeh([]);
    try {
      const novy = await spustDohledani(intervence, {
        token,
        signal: ovladac.signal,
        onPrubeh: (text) => {
          radky.push(text);
          setPrubeh([...radky]);
        },
      });
      zmen((i) => ({ ...i, dohledani: { vysledek: novy, prubeh: radky, chyba: null, spusteno, dokonceno: Date.now() } }));
    } catch (e) {
      if (ovladac.signal.aborted) {
        radky.push('Dohledání bylo zrušeno.');
        setPrubeh([...radky]);
      } else {
        const ch = e instanceof ChybaDohledani ? { kod: e.kod, zprava: e.message } : { kod: 'jina' as const, zprava: 'Při dohledání došlo k chybě. Zkuste to znovu.' };
        zmen((i) => ({ ...i, dohledani: { vysledek: i.dohledani?.vysledek ?? null, prubeh: radky, chyba: ch, spusteno, dokonceno: null } }));
      }
    } finally {
      setBezi(false);
      preruseni.current = null;
    }
  };

  const pozornost = vysledek?.body.filter(vyzadujePozornost).length ?? 0;
  const rucnich = vysledek?.body.filter((b) => b.typ === 'rucne').length ?? 0;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div className="karta p-4">
        <h2 className="mb-1 text-lg font-semibold">Dohledání správných údajů</h2>
        <p className="mb-3 text-slate-600">
          Appka rozdělí intervenci na jednotlivé body a ke každému dohledá správný údaj: nejdřív ve smlouvě, pak na Google Disku a
          nakonec na internetu. Sama žádné další chyby nehledá.
        </p>
        <p className="mb-3 text-sm text-slate-600">
          Smlouva: <strong>{intervence.smlouva?.nazev}</strong> · ESD: {intervence.esd.map((s) => s.nazev).join(', ')}
        </p>
        {mockDisk === false && !PRIHLASENI_NAPOJENO && (
          <p className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <Cloud size={18} className="shrink-0" />
            Google Disk není v appce připojený (integrace v AI Studiu ještě není zapnutá). Dohledá se jen ze smlouvy a z internetu.
          </p>
        )}
        {hlaskaDisku && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{hlaskaDisku}</p>}
        <div className="flex flex-wrap gap-2">
          {!bezi && (
            <button className="tlacitko-hlavni" onClick={spustit} disabled={mockDisk === null}>
              {vysledek ? <RotateCcw size={18} /> : <Search size={18} />}
              {vysledek ? 'Dohledat znovu' : 'Spustit dohledání'}
            </button>
          )}
          {bezi && (
            <button className="tlacitko" onClick={() => preruseni.current?.abort()}>
              <Square size={16} /> Zrušit
            </button>
          )}
          <button className="tlacitko" onClick={() => prejdiNa('nahrani')} disabled={bezi}>
            <ChevronLeft size={18} /> Zpět k nahrání
          </button>
          {vysledek && !bezi && (
            <button className="tlacitko-hlavni ml-auto" onClick={() => prejdiNa('schvalovani')}>
              Pokračovat ke schvalování <ArrowRight size={18} />
            </button>
          )}
        </div>
      </div>

      {(bezi || prubeh.length > 0) && (
        <div className="karta p-4">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            {bezi && <Loader2 size={18} className="animate-spin text-blue-700" />} Průběh
          </h3>
          <ol className="max-h-64 space-y-1 overflow-auto text-sm text-slate-700" aria-live="polite">
            {prubeh.map((r, i) => (
              <li key={i} ref={i === prubeh.length - 1 ? konecSeznamu : undefined}>
                {r}
              </li>
            ))}
          </ol>
        </div>
      )}

      {chyba && (
        <div className="karta border-red-200 bg-red-50 p-4 text-red-900" role="alert">
          <p className="mb-2 flex gap-2 font-medium">
            <XCircle size={20} className="shrink-0" /> {chyba.zprava}
          </p>
          {OPAKOVATELNE.includes(chyba.kod) && (
            <button className="tlacitko" onClick={spustit}>
              <RotateCcw size={18} /> Zkusit znovu
            </button>
          )}
        </div>
      )}

      {vysledek && !bezi && (
        <div className="karta p-4">
          <h3 className="mb-1 font-semibold">
            Nalezeno {sklonuj(vysledek.body.length, 'bod', 'body', 'bodů')}
            {vysledek.testovaci && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">testovací výsledek</span>}
          </h3>
          <p className="mb-3 text-sm text-slate-600">
            {pozornost > 0 && `${sklonuj(pozornost, 'bod vyžaduje', 'body vyžadují', 'bodů vyžaduje')} vaši pozornost. `}
            {rucnich > 0 && `${sklonuj(rucnich, 'ruční úkol', 'ruční úkoly', 'ručních úkolů')}. `}
            Podrobnosti a schválení jsou v dalším kroku.
          </p>
          <ul className="divide-y divide-slate-100">
            {vysledek.body.map((b) => (
              <li key={b.cislo} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="w-6 shrink-0 font-semibold text-slate-500">{b.cislo}.</span>
                <span className="min-w-0 flex-1">{b.bod_intervence}</span>
                <span className="text-sm text-slate-600">{NAZVY_TYPU[b.typ]}</span>
                {b.typ !== 'rucne' && (
                  <span className={`text-sm ${vyzadujePozornost(b) ? 'text-amber-800' : 'text-slate-600'}`}>
                    {vyzadujePozornost(b) && <AlertTriangle size={14} className="mr-1 inline" />}
                    {b.konflikt ? 'konflikt zdrojů' : b.oprava ? `→ ${b.oprava}` : 'bez opravy'} · {NAZVY_ZDROJU[b.zdroj_typ]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
