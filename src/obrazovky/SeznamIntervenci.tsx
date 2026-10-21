import { Clock, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { konfigurace } from '../../konfigurace';
import { jdiNa } from '../cesta';
import { formatDatum, sklonuj } from '../pomocne';
import type { Intervence, KrokIntervence } from '../ulozeni/typy';
import {
  dniDoSmazani,
  novaIntervence,
  seznamIntervenci,
  smazIntervenci,
  ulozIntervenci,
  uklidStarych,
} from '../ulozeni/uloziste';

export const NAZVY_KROKU: Record<KrokIntervence, string> = {
  nahrani: 'Nahrání',
  dohledani: 'Dohledání',
  schvalovani: 'Schvalování',
  export: 'Stažení',
};

/** Úvodní obrazovka: rozpracované intervence a tlačítko Nová intervence. */
export function SeznamIntervenci() {
  const [seznam, setSeznam] = useState<Intervence[] | null>(null);
  const [smazanoStarych, setSmazanoStarych] = useState(0);
  const [chyba, setChyba] = useState<string | null>(null);

  const nacti = () =>
    seznamIntervenci()
      .then(setSeznam)
      .catch(() => setChyba('Uložené intervence se nepodařilo načíst. Prohlížeč možná blokuje ukládání dat.'));

  useEffect(() => {
    uklidStarych()
      .then(setSmazanoStarych)
      .catch(() => {})
      .finally(nacti);
  }, []);

  const zalozit = async () => {
    try {
      const nova = await ulozIntervenci(novaIntervence());
      jdiNa({ obrazovka: 'intervence', id: nova.id });
    } catch {
      setChyba('Novou intervenci se nepodařilo založit. Prohlížeč možná blokuje ukládání dat.');
    }
  };

  const smazat = async (i: Intervence) => {
    if (!window.confirm(`Opravdu smazat intervenci „${i.nazev || 'bez názvu'}" včetně nahraných souborů?`)) return;
    await smazIntervenci(i.id);
    await nacti();
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Intervence</h1>
        <button className="tlacitko-hlavni" onClick={zalozit}>
          <Plus size={20} /> Nová intervence
        </button>
      </div>

      {chyba && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{chyba}</p>}
      {smazanoStarych > 0 && (
        <p className="mb-4 rounded-lg bg-slate-100 p-3 text-slate-700">
          {sklonuj(smazanoStarych, 'stará intervence byla smazána', 'staré intervence byly smazány', 'starých intervencí bylo smazáno')}{' '}
          (bez úprav déle než {konfigurace.ulozeni.smazatPoDnech} dní).
        </p>
      )}

      {seznam === null && !chyba && <p className="text-slate-500">Načítám…</p>}
      {seznam?.length === 0 && (
        <div className="karta p-8 text-center text-slate-600">
          <p className="mb-1 text-lg">Zatím tu nejsou žádné rozpracované intervence.</p>
          <p>Začněte tlačítkem Nová intervence.</p>
        </div>
      )}

      <ul className="space-y-3">
        {seznam?.map((i) => {
          const zbyva = dniDoSmazani(i);
          return (
            <li key={i.id} className="karta flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{i.nazev || 'Bez názvu'}</p>
                <p className="text-sm text-slate-600">
                  Krok: {NAZVY_KROKU[i.krok]} · ESD: {sklonuj(i.esd.length, 'soubor', 'soubory', 'souborů')} · upraveno{' '}
                  {formatDatum(i.upraveno)}
                </p>
                {zbyva <= konfigurace.ulozeni.upozornitDniPredem && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-amber-800">
                    <Clock size={14} />
                    {zbyva === 0
                      ? 'Smaže se ještě dnes, pokud ji neupravíte.'
                      : `Smaže se za ${sklonuj(zbyva, 'den', 'dny', 'dní')}, pokud ji neupravíte.`}
                  </p>
                )}
              </div>
              <button className="tlacitko" onClick={() => jdiNa({ obrazovka: 'intervence', id: i.id })}>
                <FolderOpen size={18} /> Otevřít
              </button>
              <button className="tlacitko-nebezpecne" onClick={() => smazat(i)} aria-label="Smazat">
                <Trash2 size={18} /> Smazat
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
