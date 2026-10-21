import { FlaskConical } from 'lucide-react';
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
  const [stav, setStav] = useState<StavServeru | null>(null);

  useEffect(() => {
    fetch('/api/stav')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStav)
      .catch(() => setStav(null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <a href="#/" className="text-lg font-bold text-blue-800">
          Opravy ESD
        </a>
        <span className="hidden text-sm text-slate-500 sm:inline">vyřízení intervencí k smluvní dokumentaci</span>
      </header>
      {stav && (stav.mockGemini || stav.mockDisk) && (
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
