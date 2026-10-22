import { Check, ChevronLeft, CloudAlert, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Intervence, KrokIntervence } from '../ulozeni/typy';
import { useIntervence } from '../ulozeni/useIntervence';
import { KrokDohledani } from './KrokDohledani';
import { KrokExport } from './KrokExport';
import { KrokNahrani } from './KrokNahrani';
import { KrokSchvalovani } from './KrokSchvalovani';
import { NAZVY_KROKU } from './SeznamIntervenci';

const KROKY: KrokIntervence[] = ['nahrani', 'dohledani', 'schvalovani', 'export'];

export interface KrokProps {
  intervence: Intervence;
  zmen: (uprava: (puvodni: Intervence) => Intervence) => void;
  prejdiNa: (krok: KrokIntervence) => void;
}

/** Rozpracovaná intervence: název, kroky a obsah aktuálního kroku. */
export function DetailIntervence({ id }: { id: string }) {
  const { intervence, zmen, ukladani, ulozHned } = useIntervence(id);
  const [dlouhoNacita, setDlouhoNacita] = useState(false);
  const [zkousim, setZkousim] = useState(false);

  const nacita = intervence === undefined;
  useEffect(() => {
    if (!nacita) return;
    // Chybu načtení useIntervence nehlásí – po delší době aspoň poradíme, co dělat.
    const casovac = window.setTimeout(() => setDlouhoNacita(true), 10_000);
    return () => window.clearTimeout(casovac);
  }, [nacita]);

  const zkusitZnovu = async () => {
    setZkousim(true);
    await ulozHned();
    setZkousim(false);
  };

  if (intervence === undefined)
    return dlouhoNacita ? (
      <div className="p-6">
        <p className="mb-3 text-red-800">
          Intervenci se nedaří načíst. Obnovte stránku. Když to nepomůže, nepoužívejte anonymní okno a povolte
          ukládání dat pro tuto stránku.
        </p>
        <a className="tlacitko" href="#/">
          Zpět na seznam
        </a>
      </div>
    ) : (
      <p className="p-6 text-slate-500">Načítám…</p>
    );
  if (intervence === null)
    return (
      <div className="p-6">
        <p className="mb-3">Tato intervence už neexistuje (byla smazána).</p>
        <a className="tlacitko" href="#/">
          Zpět na seznam
        </a>
      </div>
    );

  const prejdiNa = (krok: KrokIntervence) => zmen((i) => ({ ...i, krok }));
  const indexAktualniho = KROKY.indexOf(intervence.krok);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <a href="#/" className="tlacitko-ikona" aria-label="Zpět na seznam" title="Zpět na seznam">
          <ChevronLeft size={22} />
        </a>
        <input
          className="pole max-w-sm flex-1 font-semibold"
          value={intervence.nazev}
          placeholder="Název intervence (např. číslo smlouvy)"
          onChange={(e) => zmen((i) => ({ ...i, nazev: e.target.value }))}
          aria-label="Název intervence"
        />
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          {KROKY.map((krok, i) => (
            <li key={krok} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">›</span>}
              <span
                className={`rounded-full px-3 py-1 ${
                  krok === intervence.krok
                    ? 'bg-blue-700 font-semibold text-white'
                    : i < indexAktualniho
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-500'
                }`}
              >
                {i + 1}. {NAZVY_KROKU[krok]}
              </span>
            </li>
          ))}
        </ol>
        <div className={`flex items-center gap-2 text-sm ${ukladani === 'chyba' ? 'basis-full' : 'ml-auto'}`}>
          <span className="flex items-center gap-1 text-slate-500" aria-live="polite">
            {ukladani === 'ulozeno' && (
              <>
                <Check size={16} /> Uloženo
              </>
            )}
            {ukladani === 'ceka' && (
              <>
                <Loader2 size={16} className="animate-spin" /> Ukládám…
              </>
            )}
            {ukladani === 'chyba' && (
              <span className="flex items-center gap-1 text-red-700">
                <CloudAlert size={16} className="shrink-0" /> Nepodařilo se uložit – v prohlížeči možná došlo místo.
                Uvolněte místo na disku počítače a klikněte na Zkusit znovu. Do té doby appku nezavírejte ani z intervence
                neodcházejte, jinak se poslední změny ztratí.
              </span>
            )}
          </span>
          {ukladani === 'chyba' && (
            <button className="tlacitko shrink-0" onClick={zkusitZnovu} disabled={zkousim}>
              <RotateCcw size={18} /> Zkusit znovu
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {intervence.krok === 'nahrani' && <KrokNahrani intervence={intervence} zmen={zmen} prejdiNa={prejdiNa} />}
        {intervence.krok === 'dohledani' && <KrokDohledani intervence={intervence} zmen={zmen} prejdiNa={prejdiNa} />}
        {intervence.krok === 'schvalovani' && <KrokSchvalovani intervence={intervence} zmen={zmen} prejdiNa={prejdiNa} />}
        {intervence.krok === 'export' && <KrokExport intervence={intervence} zmen={zmen} prejdiNa={prejdiNa} />}
      </div>
    </div>
  );
}
