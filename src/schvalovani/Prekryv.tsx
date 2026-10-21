import { useRef, useState } from 'react';
import type { Usek } from '../pdf/hledani';
import type { PdfViewport } from '../pdf/pdfjs';
import { obdelnikUseku, type Obdelnik } from './geometrie';

export interface ZnackaVNahledu {
  klic: string;
  useky: Usek[];
  /** Číslo bodu nebo jiný krátký popisek. */
  stitek: string;
  oprava?: string;
  barva: 'modra' | 'zelena' | 'seda' | 'oranzova' | 'fialova';
  aktivni?: boolean;
  /** Kandidát k výběru (čárkovaně, klikací). */
  kandidat?: boolean;
  onKlik?: () => void;
}

const BARVY = {
  modra: 'border-blue-600 bg-blue-500/15',
  zelena: 'border-green-600 bg-green-500/15',
  seda: 'border-slate-400 bg-slate-400/10',
  oranzova: 'border-amber-500 bg-amber-400/20',
  fialova: 'border-violet-600 bg-violet-500/15',
};

interface Props {
  viewport: PdfViewport;
  znacky: ZnackaVNahledu[];
  /** Režim výběru místa: natažení obdélníku (nebo kliknutí). */
  vyber?: { onHotovo: (o: Obdelnik) => void };
}

/** Vrstva přes stránku náhledu: zvýraznění výskytů, kandidáti a natahování obdélníku. */
export function Prekryv({ viewport, znacky, vyber }: Props) {
  const zacatek = useRef<{ x: number; y: number; id: number } | null>(null);
  const [tah, setTah] = useState<Obdelnik | null>(null);

  const bod = (e: React.PointerEvent<HTMLDivElement>) => {
    const ram = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - ram.left, y: e.clientY - ram.top };
  };
  const obdelnik = (a: { x: number; y: number }, b: { x: number; y: number }): Obdelnik => ({
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  return (
    <>
      {vyber && (
        <div
          className="absolute inset-0 z-10 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            zacatek.current = { ...bod(e), id: e.pointerId };
            setTah(null);
          }}
          onPointerMove={(e) => {
            if (zacatek.current?.id === e.pointerId) setTah(obdelnik(zacatek.current, bod(e)));
          }}
          onPointerUp={(e) => {
            const z = zacatek.current;
            zacatek.current = null;
            setTah(null);
            if (!z || z.id !== e.pointerId) return;
            vyber.onHotovo(obdelnik(z, bod(e)));
          }}
          onPointerCancel={() => {
            zacatek.current = null;
            setTah(null);
          }}
        >
        </div>
      )}
      {znacky.map((z) =>
        z.useky.map((u, i) => {
          const o = obdelnikUseku(u, viewport, 2);
          return (
            <div
              key={`${z.klic}-${i}`}
              className={`absolute rounded-sm border-2 ${BARVY[z.barva]} ${z.kandidat ? 'z-20 cursor-pointer border-dashed' : ''} ${
                z.aktivni ? 'ring-4 ring-blue-400/60' : ''
              }`}
              style={{ left: o.left, top: o.top, width: Math.max(o.width, 6), height: o.height }}
              onClick={(e) => {
                if (!z.onKlik) return;
                e.stopPropagation();
                z.onKlik();
              }}
              role={z.onKlik ? 'button' : undefined}
              title={z.kandidat ? 'Vybrat toto místo' : undefined}
            >
              {i === 0 && (
                <span className="absolute -top-2.5 -left-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1 text-xs font-bold text-white">
                  {z.stitek}
                </span>
              )}
              {i === z.useky.length - 1 && z.oprava && (
                <span className="pointer-events-none absolute -top-5 left-full ml-1 whitespace-nowrap rounded bg-white/90 px-1 text-xs font-semibold text-blue-800 shadow-sm">
                  → {z.oprava}
                </span>
              )}
            </div>
          );
        }),
      )}
      {tah && (
        <div
          className="pointer-events-none absolute z-20 border-2 border-blue-700 bg-blue-500/10"
          style={{ left: tah.left, top: tah.top, width: tah.width, height: tah.height }}
        />
      )}
    </>
  );
}
