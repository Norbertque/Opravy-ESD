import { AlertTriangle, Check, ExternalLink, FileText, MapPin, Pencil, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { NAZVY_JISTOTY, NAZVY_TYPU, NAZVY_ZDROJU } from '../obrazovky/KrokDohledani';
import { vyzadujePozornost, type BodIntervence } from '../sdilene/dohledani';
import type { RozhodnutiBodu, SouborInfo } from '../ulozeni/typy';
import { jeUmisteno, type UmisteniVyskytu } from './umisteni';

interface Props {
  bod: BodIntervence;
  rozhodnuti: RozhodnutiBodu;
  esd: SouborInfo[];
  aktivniVyskyt: number | null;
  vyberVyskytu: number | null;
  onUkazVyskyt: (index: number) => void;
  onVybratMisto: (index: number) => void;
  onUkazSmlouvu: (strana: number) => void;
  onZmen: (uprava: (r: RozhodnutiBodu) => RozhodnutiBodu) => void;
}

const POPIS_STAVU: Record<UmisteniVyskytu['stav'], string> = {
  nalezeno: '',
  vybrano: 'místo vybráno ručně',
  vice: 'Text je v PDF víckrát – vyberte správné místo.',
  nenalezeno: 'Text se v PDF nenašel – vyberte místo ručně.',
  sken: 'Strana je sken – vyberte místo ručně.',
};

/** Karta jednoho bodu intervence: výskyty, oprava, zdroj a tlačítka. */
export function KartaBodu(p: Props) {
  const { bod, rozhodnuti: r } = p;
  const [upravuji, setUpravuji] = useState(false);
  const [text, setText] = useState(r.oprava);
  const pozornost = vyzadujePozornost(bod);
  const vseUmisteno = r.vyskyty.length > 0 && r.vyskyty.every(jeUmisteno);
  const lzeSchvalit = r.oprava.trim() !== '' && vseUmisteno;
  const odkaz = bod.zdroj_odkaz.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, '');

  const barva =
    r.rozhodnuti === 'schvaleno'
      ? 'border-green-300 bg-green-50/40'
      : r.rozhodnuti === 'zamitnuto'
        ? 'border-slate-200 bg-slate-50 opacity-75'
        : pozornost || !vseUmisteno
          ? 'border-amber-300 bg-amber-50/40'
          : 'border-slate-200 bg-white';

  return (
    <article className={`rounded-xl border p-3 shadow-sm ${barva}`} aria-label={`Bod ${bod.cislo}`}>
      <header className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">{bod.cislo}.</span>
        <span className="rounded bg-slate-100 px-2 py-0.5">{NAZVY_TYPU[bod.typ]}</span>
        <span
          className={`rounded px-2 py-0.5 ${
            bod.jistota === 'vysoka' ? 'bg-green-100 text-green-900' : bod.jistota === 'stredni' ? 'bg-blue-100 text-blue-900' : 'bg-amber-100 text-amber-900'
          }`}
        >
          jistota {NAZVY_JISTOTY[bod.jistota]}
        </span>
        {bod.konflikt && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">zdroje si odporují</span>}
        {r.rozhodnuti === 'schvaleno' && (
          <span className="ml-auto flex items-center gap-1 font-semibold text-green-800">
            <Check size={16} /> Schváleno
          </span>
        )}
        {r.rozhodnuti === 'zamitnuto' && <span className="ml-auto font-semibold text-slate-500">Zamítnuto</span>}
      </header>

      <p className="mb-2">{bod.bod_intervence}</p>

      <ul className="mb-2 space-y-1">
        {bod.vyskyty.map((v, i) => {
          const u = r.vyskyty[i];
          const soubor = p.esd.find((s) => s.id === u?.souborId);
          return (
            <li key={i} className={`rounded-lg p-1.5 ${p.aktivniVyskyt === i ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}>
              <button className="w-full text-left" onClick={() => p.onUkazVyskyt(i)} title="Ukázat v náhledu">
                <span className="block text-xs text-slate-500">
                  <MapPin size={12} className="mr-1 inline" />
                  {soubor?.nazev ?? v.soubor}, str. {u?.strana ?? v.strana}
                </span>
                <span>
                  {bod.typ === 'doplneni' ? (
                    <>za „{v.presny_text}" doplnit </>
                  ) : (
                    <span className="text-slate-500 line-through decoration-slate-700">{v.presny_text}</span>
                  )}
                  {r.oprava && <strong className="ml-1 text-blue-800">→ {r.oprava}</strong>}
                </span>
              </button>
              {u && !jeUmisteno(u) && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-amber-900">
                  <AlertTriangle size={14} /> {POPIS_STAVU[u.stav]}
                </p>
              )}
              {u && r.rozhodnuti !== 'zamitnuto' && (
                <button
                  className={`mt-1 text-sm underline ${p.vyberVyskytu === i ? 'font-semibold text-blue-800' : 'text-slate-600'}`}
                  onClick={() => p.onVybratMisto(i)}
                >
                  {p.vyberVyskytu === i ? 'Vybírám místo v náhledu… (zrušit)' : jeUmisteno(u) ? 'Změnit místo' : 'Vybrat místo'}
                </button>
              )}
            </li>
          );
        })}
        {bod.vyskyty.length === 0 && <li className="text-sm text-amber-900">Model neuvedl, kde v ESD je chyba.</li>}
      </ul>

      {upravuji ? (
        <div className="mb-2 flex flex-wrap gap-2">
          <input className="pole flex-1" value={text} onChange={(e) => setText(e.target.value)} aria-label="Oprava" autoFocus />
          <button
            className="tlacitko-hlavni"
            onClick={() => {
              p.onZmen((x) => ({ ...x, oprava: text.trim(), rozhodnuti: x.rozhodnuti === 'schvaleno' ? 'ceka' : x.rozhodnuti }));
              setUpravuji(false);
            }}
          >
            Uložit
          </button>
          <button className="tlacitko" onClick={() => setUpravuji(false)}>
            Zrušit
          </button>
        </div>
      ) : (
        !r.oprava && <p className="mb-2 text-sm font-medium text-amber-900">Bez navržené opravy – doplňte ji tlačítkem Upravit, nebo bod zamítněte.</p>
      )}

      <p className="mb-1 text-sm">
        <span className="text-slate-500">Zdroj: </span>
        {bod.zdroj_typ === 'smlouva' && bod.zdroj_strana > 0 ? (
          <button className="font-medium text-blue-800 underline" onClick={() => p.onUkazSmlouvu(bod.zdroj_strana)}>
            <FileText size={14} className="mr-1 inline" />
            {bod.zdroj_odkaz || `Smlouva, str. ${bod.zdroj_strana}`}
          </button>
        ) : odkaz ? (
          <a className="font-medium text-blue-800 underline" href={odkaz} target="_blank" rel="noreferrer">
            <ExternalLink size={14} className="mr-1 inline" />
            {NAZVY_ZDROJU[bod.zdroj_typ]}: {bod.zdroj_odkaz.replace(odkaz, '').replace(/[\s–-]+$/, '') || odkaz}
          </a>
        ) : (
          <span>{bod.zdroj_odkaz || NAZVY_ZDROJU[bod.zdroj_typ]}</span>
        )}
      </p>
      {bod.zduvodneni && <p className="mb-2 text-sm text-slate-600">{bod.zduvodneni}</p>}

      <div className="flex flex-wrap gap-2">
        {r.rozhodnuti === 'ceka' && (
          <>
            <button
              className="tlacitko-hlavni"
              disabled={!lzeSchvalit}
              title={!lzeSchvalit ? 'Nejdřív doplňte opravu a vyberte místo v PDF.' : undefined}
              onClick={() => p.onZmen((x) => ({ ...x, rozhodnuti: 'schvaleno' }))}
            >
              <Check size={18} /> Schválit
            </button>
            <button
              className="tlacitko"
              onClick={() => {
                setText(r.oprava);
                setUpravuji(true);
              }}
            >
              <Pencil size={16} /> Upravit
            </button>
            <button className="tlacitko" onClick={() => p.onZmen((x) => ({ ...x, rozhodnuti: 'zamitnuto' }))}>
              <X size={16} /> Zamítnout
            </button>
          </>
        )}
        {r.rozhodnuti !== 'ceka' && (
          <button className="tlacitko" onClick={() => p.onZmen((x) => ({ ...x, rozhodnuti: 'ceka' }))}>
            <RotateCcw size={16} /> {r.rozhodnuti === 'schvaleno' ? 'Zrušit schválení' : 'Obnovit'}
          </button>
        )}
      </div>
    </article>
  );
}
