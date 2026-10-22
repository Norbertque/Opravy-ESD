import { useEffect, useState } from 'react';
import type { SouborInfo } from '../ulozeni/typy';
import { nactiSoubor } from '../ulozeni/uloziste';
import { NahledPdf } from './NahledPdf';

/** Náhled libovolného nahraného souboru: PDF, obrázek nebo text. */
export function NahledSouboru({ soubor }: { soubor: SouborInfo }) {
  const [data, setData] = useState<Blob | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [adresaObrazku, setAdresaObrazku] = useState<string | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    let zruseno = false;
    let adresa: string | null = null;
    setData(null);
    setText(null);
    setAdresaObrazku(null);
    setChyba(null);
    nactiSoubor(soubor.id)
      .then(async (blob) => {
        if (zruseno) return;
        if (!blob) return setChyba('Soubor v prohlížeči chybí – odeberte ho a nahrajte znovu.');
        setData(blob);
        if (soubor.mime.startsWith('image/')) {
          adresa = URL.createObjectURL(blob);
          setAdresaObrazku(adresa);
        } else if (soubor.mime === 'text/plain') {
          const obsah = await blob.text();
          if (!zruseno) setText(obsah);
        }
      })
      .catch(() => {
        if (!zruseno) setChyba('Soubor se nepodařilo načíst z prohlížeče – odeberte ho a nahrajte znovu.');
      });
    return () => {
      zruseno = true;
      if (adresa) URL.revokeObjectURL(adresa);
    };
  }, [soubor.id, soubor.mime]);

  if (chyba) return <p className="p-4 text-red-700">{chyba}</p>;
  if (!data) return <p className="p-4 text-slate-500">Načítám…</p>;
  if (soubor.mime === 'application/pdf') return <NahledPdf data={data} />;
  if (adresaObrazku)
    return (
      <div className="h-full overflow-auto bg-slate-100 p-4">
        <img src={adresaObrazku} alt={soubor.nazev} className="mx-auto max-w-full bg-white shadow" />
      </div>
    );
  if (text !== null)
    return <pre className="h-full overflow-auto whitespace-pre-wrap bg-white p-4 text-sm">{text}</pre>;
  return (
    <p className="p-4 text-slate-600">
      Soubor „{soubor.nazev}“ nejde zobrazit přímo. Jeho obsah appka přečte při dohledání.
    </p>
  );
}
