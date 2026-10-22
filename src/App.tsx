import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DetailIntervence } from './obrazovky/DetailIntervence';
import { SeznamIntervenci } from './obrazovky/SeznamIntervenci';
import { useCesta } from './cesta';

interface StavServeru {
  model: string;
  klicNastaven: boolean;
  mockGemini: boolean;
  mockDisk: boolean;
}

export function App() {
  const cesta = useCesta();
  // null = ještě se zjišťuje, 'nezjisteno' = server neodpověděl, jak má
  const [stav, setStav] = useState<StavServeru | 'nezjisteno' | null>(null);

  useEffect(() => {
    fetch('/api/stav')
      .then((r) => (r.ok ? (r.json() as Promise<StavServeru>) : null))
      .then((s) => {
        // Když se stav nedá ověřit, nesmí to vypadat jako ostrý režim.
        if (typeof s?.mockGemini !== 'boolean' || typeof s.mockDisk !== 'boolean') throw new Error('Neplatný stav');
        setStav(s);
      })
      .catch(() => setStav('nezjisteno'));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <a href="#/" className="text-lg font-bold text-blue-800">
          Opravy ESD
        </a>
        <span className="hidden text-sm text-slate-500 sm:inline">vyřízení intervencí ke smluvní dokumentaci</span>
      </header>
      {stav === 'nezjisteno' && (
        <div className="flex items-center gap-2 border-b border-red-300 bg-red-100 px-4 py-1.5 text-sm text-red-900" role="alert">
          <TriangleAlert size={16} className="shrink-0" />
          <span>Nepodařilo se ověřit stav serveru – výsledky dohledání nemusí být skutečné.</span>
        </div>
      )}
      {stav && stav !== 'nezjisteno' && (stav.mockGemini || stav.mockDisk) && (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-sm text-amber-900">
          <FlaskConical size={16} />
          <span>
            <strong>Testovací režim:</strong>{' '}
            {[stav.mockGemini && 'místo modelu Gemini připravené výsledky', stav.mockDisk && 'místo Google Disku složka test-drive']
              .filter(Boolean)
              .join(', ')}
            . Výsledky nejsou skutečné.
          </span>
        </div>
      )}
      <main className="min-h-0 flex-1">
        {cesta.obrazovka === 'intervence' ? <DetailIntervence key={cesta.id} id={cesta.id} /> : <SeznamIntervenci />}
      </main>
    </div>
  );
}
