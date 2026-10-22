import { Minus, Plus, MoveHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { jeChybaHesla, otevriPdf, zavriPdf, type PdfDokument, type PdfStrana, type PdfViewport } from '../pdf/pdfjs';

export interface KlikVPdf {
  strana: number;
  /** Bod v souřadnicích PDF stránky (body, počátek vlevo dole). */
  bodPdf: [number, number];
  viewport: PdfViewport;
}

interface Props {
  data: Blob;
  /** Na kterou stranu posunout (posune se při každé změně `pozadavek`). */
  prejitNa?: { strana: number; pozadavek: number };
  /** Vrstva přes stránku (zvýraznění, návrhy oprav…). */
  prekryv?: (strana: number, viewport: PdfViewport) => ReactNode;
  onKlik?: (klik: KlikVPdf) => void;
  /** Kurzor nad stránkou, např. 'crosshair' při výběru místa. */
  kurzor?: string;
}

const MIN_MERITKO = 0.4;
const MAX_MERITKO = 4;
/** Nejvíc pixelů jednoho plátna (64 MB paměti). Větší plátno Safari na iPhonu a iPadu ani nevykreslí. */
const MAX_PIXELU_PLATNA = 4096 * 4096;

/** Náhled PDF přes pdf.js: stránky pod sebou, vykreslují se až když jsou vidět. */
export function NahledPdf({ data, prejitNa, prekryv, onKlik, kurzor }: Props) {
  const [dokument, setDokument] = useState<PdfDokument | null>(null);
  const [rozmery, setRozmery] = useState<{ sirka: number; vyska: number }[]>([]);
  const [chyba, setChyba] = useState<string | null>(null);
  const [meritko, setMeritko] = useState<number | 'sirka'>('sirka');
  const [sirkaOkna, setSirkaOkna] = useState(0);
  const [aktualniStrana, setAktualniStrana] = useState(1);
  const posuvnik = useRef<HTMLDivElement>(null);
  const stranky = useRef<(HTMLDivElement | null)[]>([]);

  // Otevření dokumentu
  useEffect(() => {
    let zruseno = false;
    let otevreny: PdfDokument | null = null;
    setDokument(null);
    setChyba(null);
    (async () => {
      try {
        const doc = await otevriPdf(await data.arrayBuffer());
        otevreny = doc;
        const velikosti = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const v = (await doc.getPage(i)).getViewport({ scale: 1 });
          velikosti.push({ sirka: v.width, vyska: v.height });
        }
        if (zruseno) return;
        setRozmery(velikosti);
        setDokument(doc);
      } catch (e) {
        if (!zruseno)
          setChyba(
            jeChybaHesla(e)
              ? 'PDF je zašifrované heslem, takže ho nejde zobrazit. Nahrajte verzi bez hesla.'
              : 'Soubor se nepodařilo zobrazit. Možná je poškozený nebo to není PDF – nahrajte jinou verzi.',
          );
      } finally {
        if (zruseno && otevreny) void zavriPdf(otevreny);
      }
    })();
    return () => {
      zruseno = true;
      if (otevreny) void zavriPdf(otevreny);
    };
  }, [data]);

  // Šířka okna pro „na šířku“
  useEffect(() => {
    const el = posuvnik.current;
    if (!el) return;
    const pozorovatel = new ResizeObserver(() => setSirkaOkna(el.clientWidth));
    pozorovatel.observe(el);
    return () => pozorovatel.disconnect();
  }, []);

  const nejsirsi = useMemo(() => Math.max(1, ...rozmery.map((r) => r.sirka)), [rozmery]);
  // Dokud nejsou známé rozměry stránek, „na šířku" nejde spočítat – zatím 100 %.
  const skutecneMeritko =
    meritko !== 'sirka' ? meritko : rozmery.length ? Math.min(MAX_MERITKO, Math.max(MIN_MERITKO, (sirkaOkna - 32) / nejsirsi)) : 1;

  // Přechod na stranu
  useEffect(() => {
    if (!prejitNa || !dokument) return;
    stranky.current[prejitNa.strana - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [prejitNa?.pozadavek, dokument]); // eslint-disable-line react-hooks/exhaustive-deps

  // Která strana je právě nejvíc vidět
  useEffect(() => {
    const koren = posuvnik.current;
    if (!koren || !dokument) return;
    const viditelnost = new Map<number, number>();
    const pozorovatel = new IntersectionObserver(
      (zaznamy) => {
        for (const z of zaznamy) viditelnost.set(Number((z.target as HTMLElement).dataset.strana), z.intersectionRatio);
        let nej = 1;
        let nejPomer = -1;
        for (const [strana, pomer] of viditelnost) {
          if (pomer > nejPomer) [nej, nejPomer] = [strana, pomer];
        }
        setAktualniStrana(nej);
      },
      { root: koren, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    stranky.current.forEach((el) => el && pozorovatel.observe(el));
    return () => pozorovatel.disconnect();
  }, [dokument, rozmery.length]);

  const zmenMeritko = (krat: number) =>
    setMeritko(Math.min(MAX_MERITKO, Math.max(MIN_MERITKO, Math.round(skutecneMeritko * krat * 100) / 100)));

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1 text-sm">
        <button className="tlacitko-ikona" onClick={() => zmenMeritko(1 / 1.2)} title="Zmenšit" aria-label="Zmenšit">
          <Minus size={18} />
        </button>
        <span className="w-14 text-center tabular-nums">{rozmery.length ? `${Math.round(skutecneMeritko * 100)} %` : ''}</span>
        <button className="tlacitko-ikona" onClick={() => zmenMeritko(1.2)} title="Zvětšit" aria-label="Zvětšit">
          <Plus size={18} />
        </button>
        <button
          className="tlacitko-ikona"
          onClick={() => setMeritko('sirka')}
          title="Přizpůsobit šířce"
          aria-label="Přizpůsobit šířce"
        >
          <MoveHorizontal size={18} />
        </button>
        <span className="ml-auto pr-2 text-slate-600">
          {dokument ? `Strana ${aktualniStrana} z ${dokument.numPages}` : ''}
        </span>
      </div>
      <div ref={posuvnik} className="min-h-0 flex-1 overflow-auto p-4">
        {chyba && <p className="text-red-700">{chyba}</p>}
        {!chyba && !dokument && <p className="text-slate-500">Načítám náhled…</p>}
        {dokument &&
          rozmery.map((r, i) => (
            <div
              key={i}
              ref={(el) => {
                stranky.current[i] = el;
              }}
              data-strana={i + 1}
              className="mx-auto mb-4"
              style={{ width: r.sirka * skutecneMeritko }}
            >
              <StranaPdf
                dokument={dokument}
                cislo={i + 1}
                meritko={skutecneMeritko}
                koren={posuvnik}
                prekryv={prekryv}
                onKlik={onKlik}
                kurzor={kurzor}
                vychoziRozmer={{ sirka: r.sirka * skutecneMeritko, vyska: r.vyska * skutecneMeritko }}
              />
              <div className="mt-1 text-center text-xs text-slate-500">strana {i + 1}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

interface StranaProps {
  dokument: PdfDokument;
  cislo: number;
  meritko: number;
  koren: React.RefObject<HTMLDivElement | null>;
  prekryv?: Props['prekryv'];
  onKlik?: Props['onKlik'];
  kurzor?: string;
  vychoziRozmer: { sirka: number; vyska: number };
}

function StranaPdf({ dokument, cislo, meritko, koren, prekryv, onKlik, kurzor, vychoziRozmer }: StranaProps) {
  const obal = useRef<HTMLDivElement>(null);
  const platno = useRef<HTMLCanvasElement>(null);
  const [videt, setVidet] = useState(false);
  const [strana, setStrana] = useState<PdfStrana | null>(null);
  const viewport = useMemo(() => strana?.getViewport({ scale: meritko }) ?? null, [strana, meritko]);

  useEffect(() => {
    let zruseno = false;
    dokument.getPage(cislo).then((s) => !zruseno && setStrana(s));
    return () => {
      zruseno = true;
    };
  }, [dokument, cislo]);

  useEffect(() => {
    const el = obal.current;
    if (!el) return;
    const pozorovatel = new IntersectionObserver(([z]) => setVidet(z.isIntersecting), {
      root: koren.current,
      rootMargin: '800px 0px',
    });
    pozorovatel.observe(el);
    return () => pozorovatel.disconnect();
  }, [koren]);

  useEffect(() => {
    const canvas = platno.current;
    if (!canvas) return;
    if (!videt || !strana || !viewport) {
      // Mimo obrazovku plátno i data stránky uvolnit – jedno plátno má klidně desítky MB.
      // Až se strana vrátí do dohledu, vykreslí se znovu.
      canvas.width = canvas.height = 0;
      strana?.cleanup();
      return;
    }
    // Ostrost podle displeje, ale u velkého zvětšení jen do limitu pixelů.
    const pomer = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(MAX_PIXELU_PLATNA / (viewport.width * viewport.height)),
    );
    canvas.width = Math.floor(viewport.width * pomer);
    canvas.height = Math.floor(viewport.height * pomer);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ukol = strana.render({
      canvas,
      viewport,
      transform: pomer !== 1 ? [pomer, 0, 0, pomer, 0, 0] : undefined,
    });
    // Zrušené vykreslování (změna měřítka, odscrollování) není chyba.
    ukol.promise.catch(() => {});
    return () => ukol.cancel();
  }, [videt, strana, viewport]);

  const klik = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onKlik || !viewport || !obal.current) return;
    const ram = obal.current.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(e.clientX - ram.left, e.clientY - ram.top);
    onKlik({ strana: cislo, bodPdf: [x, y], viewport });
  };

  return (
    <div
      ref={obal}
      className="relative bg-white shadow"
      style={{ width: vychoziRozmer.sirka, height: vychoziRozmer.vyska, cursor: kurzor }}
      onClick={klik}
    >
      <canvas ref={platno} className="absolute inset-0" />
      {viewport && prekryv && <div className="absolute inset-0">{prekryv(cislo, viewport)}</div>}
    </div>
  );
}
