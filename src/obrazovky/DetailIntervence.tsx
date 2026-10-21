import { Check, ChevronLeft, CloudAlert, Loader2 } from 'lucide-react';
import type { Intervence, KrokIntervence } from '../ulozeni/typy';
import { useIntervence } from '../ulozeni/useIntervence';
import { KrokNahrani } from './KrokNahrani';
import { NAZVY_KROKU } from './SeznamIntervenci';

const KROKY: KrokIntervence[] = ['nahrani', 'dohledani', 'schvalovani', 'export'];

export interface KrokProps {
  intervence: Intervence;
  zmen: (uprava: (puvodni: Intervence) => Intervence) => void;
  prejdiNa: (krok: KrokIntervence) => void;
}

/** Rozpracovaná intervence: název, kroky a obsah aktuálního kroku. */
export function DetailIntervence({ id }: { id: string }) {
  const { intervence, zmen, ukladani } = useIntervence(id);

  if (intervence === undefined) return <p className="p-6 text-slate-500">Načítám…</p>;
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
        <span className="ml-auto flex items-center gap-1 text-sm text-slate-500" aria-live="polite">
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
              <CloudAlert size={16} /> Nepodařilo se uložit – v prohlížeči možná došlo místo
            </span>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {intervence.krok === 'nahrani' && <KrokNahrani intervence={intervence} zmen={zmen} prejdiNa={prejdiNa} />}
        {intervence.krok !== 'nahrani' && (
          <div className="p-6">
            <p className="mb-4 text-slate-600">Tento krok se připravuje.</p>
            <button className="tlacitko" onClick={() => prejdiNa('nahrani')}>
              <ChevronLeft size={18} /> Zpět k nahrání
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
