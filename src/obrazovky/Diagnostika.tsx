import { CheckCircle2, CircleSlash, Loader2, Stethoscope, TriangleAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { PRIHLASENI_NAPOJENO, prihlasitKDisku, tokenDisku } from '../disk/prihlaseni';

interface Kontrola {
  nazev: string;
  stav: 'ok' | 'chyba' | 'varovani' | 'preskoceno';
  zprava: string;
}

const IKONY = {
  ok: <CheckCircle2 size={20} className="shrink-0 text-green-700" />,
  chyba: <XCircle size={20} className="shrink-0 text-red-700" />,
  varovani: <TriangleAlert size={20} className="shrink-0 text-amber-700" />,
  preskoceno: <CircleSlash size={20} className="shrink-0 text-slate-400" />,
};

/** Diagnostika: ověří v AI Studiu Gemini, hledání Google, Disk, podpis a ARES. */
export function Diagnostika() {
  const [vysledky, setVysledky] = useState<Kontrola[] | null>(null);
  const [bezi, setBezi] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const spustit = async () => {
    setBezi(true);
    setChyba(null);
    setVysledky(null);
    try {
      let token = PRIHLASENI_NAPOJENO ? await tokenDisku() : null;
      if (PRIHLASENI_NAPOJENO && !token) token = await prihlasitKDisku().catch(() => null);
      const odpoved = await fetch('/api/diagnostika', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!odpoved.ok) throw new Error(`Server odpověděl chybou ${odpoved.status}.`);
      setVysledky((await odpoved.json()).vysledky);
    } catch (e) {
      setChyba(`Diagnostika se nepovedla: ${e instanceof Error ? e.message : 'neznámá chyba'}`);
    } finally {
      setBezi(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
        <Stethoscope size={24} /> Diagnostika
      </h1>
      <p className="mb-4 text-slate-600">
        Ověří, že funguje vše, co appka potřebuje: model Gemini, hledání Google, Google Disk, podpis a registr ARES. Trvá to asi
        půl minuty a zavolá Gemini několikrát (stojí to pár haléřů).
      </p>
      <button className="tlacitko-hlavni mb-4" onClick={spustit} disabled={bezi}>
        {bezi ? <Loader2 size={18} className="animate-spin" /> : <Stethoscope size={18} />} {bezi ? 'Ověřuji…' : 'Spustit diagnostiku'}
      </button>
      {chyba && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{chyba}</p>}
      {vysledky && (
        <ul className="karta divide-y divide-slate-100">
          {vysledky.map((k) => (
            <li key={k.nazev} className="flex gap-3 p-3">
              {IKONY[k.stav]}
              <div>
                <p className="font-semibold">{k.nazev}</p>
                <p className="text-sm text-slate-700">{k.zprava}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
