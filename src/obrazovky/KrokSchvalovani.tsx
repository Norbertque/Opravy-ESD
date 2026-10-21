import { ArrowRight, CheckCheck, ChevronLeft, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NahledPdf } from '../komponenty/NahledPdf';
import type { Usek } from '../pdf/hledani';
import type { PdfViewport } from '../pdf/pdfjs';
import { sklonuj } from '../pomocne';
import { usekZBodu, usekZObdelniku, type Obdelnik } from '../schvalovani/geometrie';
import { KartaBodu } from '../schvalovani/KartaBodu';
import { Prekryv, type ZnackaVNahledu } from '../schvalovani/Prekryv';
import { DokumentyEsd, jeUmisteno, najdiVyskyt } from '../schvalovani/umisteni';
import { vyzadujePozornost, type BodIntervence } from '../sdilene/dohledani';
import type { RozhodnutiBodu, RucniOprava, StavSchvalovani } from '../ulozeni/typy';
import { nactiSoubor, noveId } from '../ulozeni/uloziste';
import type { KrokProps } from './DetailIntervence';

type Zalozka = { druh: 'esd'; id: string } | { druh: 'smlouva' };
type Vyber = { druh: 'vyskyt'; cislo: number; index: number } | { druh: 'rucni' };
interface NavrhRucni {
  souborId: string;
  strana: number;
  usek: Usek;
  typ: 'oprava' | 'doplneni';
  text: string;
}

/** Bod, který zahrne tlačítko Schválit vše. */
function doSchvalitVse(b: BodIntervence, r: RozhodnutiBodu | undefined) {
  return (
    !!r &&
    b.typ !== 'rucne' &&
    r.rozhodnuti === 'ceka' &&
    !vyzadujePozornost(b) &&
    r.oprava.trim() !== '' &&
    r.vyskyty.length > 0 &&
    r.vyskyty.every(jeUmisteno)
  );
}

/** Krok 3: schvalování navržených oprav. */
export function KrokSchvalovani({ intervence, zmen, prejdiNa }: KrokProps) {
  const vysledek = intervence.dohledani?.vysledek ?? null;
  const dokonceno = intervence.dohledani?.dokonceno ?? 0;
  const dokumenty = useMemo(() => new DokumentyEsd(intervence.esd), [intervence.esd]);
  useEffect(() => () => void dokumenty.zavri(), [dokumenty]);

  const [pripravuji, setPripravuji] = useState<string | null>(null);
  const [zalozka, setZalozka] = useState<Zalozka>({ druh: 'esd', id: intervence.esd[0]?.id ?? '' });
  const [prejitNa, setPrejitNa] = useState<{ strana: number; pozadavek: number }>();
  const [aktivni, setAktivni] = useState<{ cislo: number; index: number } | null>(null);
  const [vyber, setVyber] = useState<Vyber | null>(null);
  const [navrhRucni, setNavrhRucni] = useState<NavrhRucni | null>(null);
  const [hlaska, setHlaska] = useState<string | null>(null);

  // Založení schvalování: k výskytům z dohledání najít místa v PDF.
  const s = intervence.schvalovani;
  const aktualni = !!s && s.dohledaniZ === dokonceno;
  useEffect(() => {
    if (!vysledek || aktualni) return;
    let zruseno = false;
    (async () => {
      const body: StavSchvalovani['body'] = {};
      const celkem = vysledek.body.reduce((n, b) => n + b.vyskyty.length, 0);
      let hotovo = 0;
      for (const b of vysledek.body) {
        const vyskyty = [];
        for (const v of b.vyskyty) {
          if (zruseno) return;
          setPripravuji(`${++hotovo} z ${celkem}`);
          try {
            vyskyty.push(await najdiVyskyt(dokumenty, v));
          } catch (e) {
            if (zruseno) return;
            console.warn('Hledání místa v PDF selhalo:', e instanceof Error ? e.message : e);
            vyskyty.push({ stav: 'nenalezeno' as const, souborId: '', strana: v.strana, useky: [] });
          }
        }
        body[b.cislo] = { rozhodnuti: 'ceka', oprava: b.oprava, vyskyty };
      }
      if (zruseno) return;
      zmen((i) => ({ ...i, schvalovani: { dohledaniZ: dokonceno, body, rucni: [], hotoveUkoly: [] } }));
      setPripravuji(null);
    })();
    return () => {
      zruseno = true;
    };
  }, [vysledek, aktualni, dokonceno, dokumenty, zmen]);

  const smlouva = useBlob(intervence.smlouva?.id);
  const souborZalozky = zalozka.druh === 'esd' ? intervence.esd.find((x) => x.id === zalozka.id) : undefined;
  const dataZalozky = useBlob(zalozka.druh === 'esd' ? zalozka.id : undefined);

  if (!vysledek)
    return (
      <div className="p-6">
        <p className="mb-3">Nejdřív proveďte dohledání.</p>
        <button className="tlacitko" onClick={() => prejdiNa('dohledani')}>
          <ChevronLeft size={18} /> Zpět k dohledání
        </button>
      </div>
    );
  if (!s || !aktualni)
    return (
      <p className="flex items-center gap-2 p-6 text-slate-600">
        <Loader2 className="animate-spin" size={18} /> Hledám místa v PDF{pripravuji ? ` (${pripravuji})` : ''}…
      </p>
    );

  const upravSchvalovani = (uprava: (x: StavSchvalovani) => StavSchvalovani) =>
    zmen((i) => (i.schvalovani ? { ...i, schvalovani: uprava(i.schvalovani) } : i));
  const upravBod = (cislo: number, uprava: (r: RozhodnutiBodu) => RozhodnutiBodu) =>
    upravSchvalovani((x) => ({ ...x, body: { ...x.body, [cislo]: uprava(x.body[cislo]) } }));

  const ukaz = (souborId: string, strana: number) => {
    if (souborId) setZalozka({ druh: 'esd', id: souborId });
    setPrejitNa({ strana, pozadavek: Date.now() });
  };

  const bodyKOprave = vysledek.body.filter((b) => b.typ !== 'rucne');
  const rucniUkoly = vysledek.body.filter((b) => b.typ === 'rucne');
  const kHromadnemu = bodyKOprave.filter((b) => doSchvalitVse(b, s.body[b.cislo]));
  const schvalenych = bodyKOprave.filter((b) => s.body[b.cislo]?.rozhodnuti === 'schvaleno').length;
  const cekajicich = bodyKOprave.filter((b) => s.body[b.cislo]?.rozhodnuti === 'ceka').length;

  const schvalitVse = () =>
    upravSchvalovani((x) => {
      const body = { ...x.body };
      for (const b of kHromadnemu) body[b.cislo] = { ...body[b.cislo], rozhodnuti: 'schvaleno' };
      return { ...x, body };
    });

  /** Uživatel natáhl obdélník (nebo klikl) v náhledu. */
  const vybranoVNahledu = async (o: Obdelnik, strana: number, viewport: PdfViewport) => {
    if (!vyber || !souborZalozky) return;
    const polozky = await dokumenty.polozky(souborZalozky, strana).catch(() => []);
    const kliknuti = o.width < 5 && o.height < 5;
    if (vyber.druh === 'vyskyt') {
      const bod = vysledek.body.find((b) => b.cislo === vyber.cislo);
      if (kliknuti && bod?.typ !== 'doplneni') {
        setHlaska('Natáhněte obdélník přes celý chybný text (táhněte myší nebo prstem).');
        return;
      }
      const usek = kliknuti ? usekZBodu(o.left, o.top, viewport, polozky) : usekZObdelniku(o, viewport, polozky);
      upravBod(vyber.cislo, (r) => ({
        ...r,
        vyskyty: r.vyskyty.map((u, i) =>
          i === vyber.index ? { stav: 'vybrano', souborId: souborZalozky.id, strana, useky: [usek] } : u,
        ),
      }));
      setAktivni({ cislo: vyber.cislo, index: vyber.index });
    } else {
      const usek = kliknuti ? usekZBodu(o.left, o.top, viewport, polozky) : usekZObdelniku(o, viewport, polozky);
      setNavrhRucni({ souborId: souborZalozky.id, strana, usek, typ: kliknuti ? 'doplneni' : 'oprava', text: '' });
    }
    setHlaska(null);
    setVyber(null);
  };

  /** Značky pro stránku aktuálního ESD. */
  const znackyStrany = (strana: number): ZnackaVNahledu[] => {
    if (!souborZalozky) return [];
    const znacky: ZnackaVNahledu[] = [];
    for (const b of bodyKOprave) {
      const r = s.body[b.cislo];
      r?.vyskyty.forEach((u, i) => {
        const jeVyberTohoto = vyber?.druh === 'vyskyt' && vyber.cislo === b.cislo && vyber.index === i;
        if (jeVyberTohoto && u.stav === 'vice')
          u.kandidati
            ?.filter((k) => k.strana === strana && u.souborId === souborZalozky.id)
            .forEach((k, ki) =>
              znacky.push({
                klic: `k${b.cislo}-${i}-${ki}`,
                useky: k.useky,
                stitek: `${b.cislo}?`,
                barva: 'oranzova',
                kandidat: true,
                onKlik: () => {
                  upravBod(b.cislo, (x) => ({
                    ...x,
                    vyskyty: x.vyskyty.map((v, vi) => (vi === i ? { ...v, stav: 'vybrano', strana: k.strana, useky: k.useky } : v)),
                  }));
                  setVyber(null);
                  setAktivni({ cislo: b.cislo, index: i });
                },
              }),
            );
        if (!jeUmisteno(u) || u.souborId !== souborZalozky.id || u.strana !== strana) return;
        znacky.push({
          klic: `b${b.cislo}-${i}`,
          useky: u.useky,
          stitek: String(b.cislo),
          oprava: r.rozhodnuti !== 'zamitnuto' ? r.oprava : undefined,
          barva: r.rozhodnuti === 'schvaleno' ? 'zelena' : r.rozhodnuti === 'zamitnuto' ? 'seda' : vyzadujePozornost(b) ? 'oranzova' : 'modra',
          aktivni: aktivni?.cislo === b.cislo && aktivni.index === i,
          onKlik: () => setAktivni({ cislo: b.cislo, index: i }),
        });
      });
    }
    for (const r of s.rucni)
      if (r.souborId === souborZalozky.id && r.strana === strana)
        znacky.push({ klic: r.id, useky: r.useky, stitek: 'R', oprava: r.oprava, barva: 'fialova' });
    if (navrhRucni && navrhRucni.souborId === souborZalozky.id && navrhRucni.strana === strana)
      znacky.push({ klic: 'navrh', useky: [navrhRucni.usek], stitek: 'R', oprava: navrhRucni.text || '…', barva: 'fialova', aktivni: true });
    return znacky;
  };

  const napovedaVyberu =
    vyber?.druh === 'rucni'
      ? 'Natáhněte obdélník přes chybný text, nebo klikněte, kam se má doplnit'
      : vyber
        ? 'Natáhněte obdélník přes chybný text' + (vysledek.body.find((b) => b.cislo === vyber.cislo)?.typ === 'doplneni' ? ', nebo klikněte, kam doplnit' : '')
        : '';

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Náhled */}
      <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-2 pt-2" role="tablist">
          {intervence.esd.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={zalozka.druh === 'esd' && zalozka.id === x.id}
              className={`max-w-56 truncate rounded-t-lg border border-b-0 px-3 py-2 text-sm ${
                zalozka.druh === 'esd' && zalozka.id === x.id ? 'border-slate-300 bg-slate-100 font-semibold' : 'border-transparent text-slate-600'
              }`}
              onClick={() => setZalozka({ druh: 'esd', id: x.id })}
              title={x.nazev}
            >
              {x.nazev}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={zalozka.druh === 'smlouva'}
            className={`rounded-t-lg border border-b-0 px-3 py-2 text-sm ${
              zalozka.druh === 'smlouva' ? 'border-slate-300 bg-slate-100 font-semibold' : 'border-transparent text-slate-600'
            }`}
            onClick={() => {
              setZalozka({ druh: 'smlouva' });
              setVyber(null);
            }}
          >
            Smlouva
          </button>
        </div>
        {vyber && zalozka.druh === 'esd' && (
          <div className="flex items-center gap-3 bg-blue-800 px-3 py-2 text-sm text-white" role="status">
            <span className="flex-1">{napovedaVyberu}.</span>
            <button className="rounded-md border border-white/60 px-3 py-1 hover:bg-white/10" onClick={() => setVyber(null)}>
              Zrušit
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {zalozka.druh === 'smlouva' && smlouva && <NahledPdf key="smlouva" data={smlouva} prejitNa={prejitNa} />}
          {zalozka.druh === 'esd' && dataZalozky && (
            <NahledPdf
              key={zalozka.id}
              data={dataZalozky}
              prejitNa={prejitNa}
              prekryv={(strana, viewport) => (
                <Prekryv
                  viewport={viewport}
                  znacky={znackyStrany(strana)}
                  vyber={vyber ? { onHotovo: (o) => void vybranoVNahledu(o, strana, viewport) } : undefined}
                />
              )}
            />
          )}
        </div>
      </div>

      {/* Karty */}
      <aside className="flex min-h-0 flex-col border-slate-200 lg:w-[27rem] lg:shrink-0 lg:border-l">
        <div className="border-b border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm text-slate-600">
            Schváleno {schvalenych} z {sklonuj(bodyKOprave.length, 'bodu', 'bodů', 'bodů')}
            {cekajicich > 0 && ` · ${cekajicich} čeká na rozhodnutí`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="tlacitko-hlavni" disabled={kHromadnemu.length === 0} onClick={schvalitVse}>
              <CheckCheck size={18} /> Schválit vše ({kHromadnemu.length})
            </button>
            <button
              className="tlacitko"
              disabled={schvalenych === 0 && s.rucni.length === 0}
              onClick={() => prejdiNa('export')}
            >
              Pokračovat ke stažení <ArrowRight size={18} />
            </button>
          </div>
          {kHromadnemu.length < cekajicich && (
            <p className="mt-2 text-xs text-amber-900">
              Body zvýrazněné oranžově (nízká jistota, konflikt, chybějící oprava nebo místo) Schválit vše nezahrne – projděte je zvlášť.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-slate-50 p-3">
          {hlaska && <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">{hlaska}</p>}

          {navrhRucni && (
            <div className="rounded-xl border-2 border-violet-400 bg-white p-3">
              <p className="mb-2 font-semibold">Ruční oprava – strana {navrhRucni.strana}</p>
              <div className="mb-2 flex flex-wrap gap-3 text-sm">
                {(['oprava', 'doplneni'] as const).map((t) => (
                  <label key={t} className="flex min-h-11 items-center gap-2">
                    <input type="radio" checked={navrhRucni.typ === t} onChange={() => setNavrhRucni({ ...navrhRucni, typ: t })} />
                    {t === 'oprava' ? 'Škrtnout a opravit' : 'Jen doplnit (bez škrtnutí)'}
                  </label>
                ))}
              </div>
              <input
                className="pole mb-2"
                placeholder="Správný text"
                value={navrhRucni.text}
                autoFocus
                onChange={(e) => setNavrhRucni({ ...navrhRucni, text: e.target.value })}
              />
              <div className="flex gap-2">
                <button
                  className="tlacitko-hlavni"
                  disabled={!navrhRucni.text.trim()}
                  onClick={() => {
                    const nova: RucniOprava = {
                      id: noveId(),
                      souborId: navrhRucni.souborId,
                      strana: navrhRucni.strana,
                      typ: navrhRucni.typ,
                      useky: [navrhRucni.usek],
                      oprava: navrhRucni.text.trim(),
                    };
                    upravSchvalovani((x) => ({ ...x, rucni: [...x.rucni, nova] }));
                    setNavrhRucni(null);
                  }}
                >
                  Přidat opravu
                </button>
                <button className="tlacitko" onClick={() => setNavrhRucni(null)}>
                  Zrušit
                </button>
              </div>
            </div>
          )}

          {bodyKOprave.map((b) => {
            const r = s.body[b.cislo];
            if (!r) return null;
            return (
              <KartaBodu
                key={b.cislo}
                bod={b}
                rozhodnuti={r}
                esd={intervence.esd}
                aktivniVyskyt={aktivni?.cislo === b.cislo ? aktivni.index : null}
                vyberVyskytu={vyber?.druh === 'vyskyt' && vyber.cislo === b.cislo ? vyber.index : null}
                onUkazVyskyt={(i) => {
                  setAktivni({ cislo: b.cislo, index: i });
                  const u = r.vyskyty[i];
                  ukaz(u.souborId, u.stav === 'vice' ? (u.kandidati?.[0]?.strana ?? u.strana) : u.strana);
                }}
                onVybratMisto={(i) => {
                  if (vyber?.druh === 'vyskyt' && vyber.cislo === b.cislo && vyber.index === i) return setVyber(null);
                  const u = r.vyskyty[i];
                  setVyber({ druh: 'vyskyt', cislo: b.cislo, index: i });
                  setNavrhRucni(null);
                  ukaz(u.souborId || intervence.esd[0]?.id, u.stav === 'vice' ? (u.kandidati?.[0]?.strana ?? u.strana) : u.strana);
                }}
                onUkazSmlouvu={(strana) => {
                  setZalozka({ druh: 'smlouva' });
                  setVyber(null);
                  setPrejitNa({ strana, pozadavek: Date.now() });
                }}
                onZmen={(uprava) => upravBod(b.cislo, uprava)}
              />
            );
          })}

          {rucniUkoly.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <ListChecks size={18} /> Ruční úkoly
              </h3>
              <p className="mb-2 text-sm text-slate-600">Tyto body nejde vyřešit škrtnutím a dopsáním – udělejte je ručně.</p>
              <ul className="space-y-2">
                {rucniUkoly.map((b) => (
                  <li key={b.cislo}>
                    <label className="flex min-h-11 gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5"
                        checked={s.hotoveUkoly.includes(b.cislo)}
                        onChange={(e) =>
                          upravSchvalovani((x) => ({
                            ...x,
                            hotoveUkoly: e.target.checked ? [...x.hotoveUkoly, b.cislo] : x.hotoveUkoly.filter((c) => c !== b.cislo),
                          }))
                        }
                      />
                      <span>
                        <strong>{b.cislo}.</strong> {b.bod_intervence}
                        {b.zduvodneni && <span className="block text-sm text-slate-600">{b.zduvodneni}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="mb-2 font-semibold">Ruční opravy</h3>
            {s.rucni.length === 0 && <p className="mb-2 text-sm text-slate-600">Opravu, kterou appka nenavrhla, můžete přidat sami: označte místo v náhledu a napište opravu.</p>}
            <ul className="mb-2 space-y-1">
              {s.rucni.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => ukaz(r.souborId, r.strana)}>
                    <span className="text-slate-500">str. {r.strana}:</span> {r.typ === 'oprava' ? 'oprava' : 'doplnění'}{' '}
                    <strong className="text-blue-800">{r.oprava}</strong>
                  </button>
                  <button
                    className="tlacitko-ikona text-red-700"
                    aria-label="Smazat ruční opravu"
                    onClick={() => upravSchvalovani((x) => ({ ...x, rucni: x.rucni.filter((y) => y.id !== r.id) }))}
                  >
                    <Trash2 size={18} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="tlacitko"
              disabled={zalozka.druh !== 'esd'}
              onClick={() => {
                setVyber(vyber?.druh === 'rucni' ? null : { druh: 'rucni' });
                setNavrhRucni(null);
              }}
            >
              <Plus size={18} /> {vyber?.druh === 'rucni' ? 'Zrušit výběr' : 'Přidat ruční opravu'}
            </button>
          </section>

          <button className="tlacitko" onClick={() => prejdiNa('dohledani')}>
            <ChevronLeft size={18} /> Zpět k dohledání
          </button>
        </div>
      </aside>
    </div>
  );
}

function useBlob(id: string | undefined) {
  const [blob, setBlob] = useState<{ id: string; data: Blob } | null>(null);
  useEffect(() => {
    if (!id) return;
    let zruseno = false;
    nactiSoubor(id).then((data) => !zruseno && data && setBlob({ id, data }));
    return () => {
      zruseno = true;
    };
  }, [id]);
  return blob && blob.id === id ? blob.data : null;
}
