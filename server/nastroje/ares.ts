/**
 * Registr ARES (Ministerstvo financí ČR) – veřejné údaje o firmách: IČO, obchodní jméno, sídlo.
 * Veřejné API bez klíče: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest
 */
const API = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';

export interface FirmaAres {
  ico: string;
  obchodniJmeno: string;
  sidlo: string;
  dic?: string;
  pravniForma?: string;
  datumVzniku?: string;
  datumZaniku?: string;
  odkaz: string;
}

interface SubjektAres {
  ico?: string;
  obchodniJmeno?: string;
  sidlo?: { textovaAdresa?: string };
  dic?: string;
  pravniForma?: string;
  datumVzniku?: string;
  datumZaniku?: string;
}

function naFirmu(s: SubjektAres): FirmaAres {
  const ico = s.ico ?? '';
  return {
    ico,
    obchodniJmeno: s.obchodniJmeno ?? '',
    sidlo: s.sidlo?.textovaAdresa ?? '',
    dic: s.dic,
    pravniForma: s.pravniForma,
    datumVzniku: s.datumVzniku,
    datumZaniku: s.datumZaniku,
    odkaz: `https://ares.gov.cz/ekonomicke-subjekty?ico=${ico}`,
  };
}

/** Hledá firmu podle IČO (přesně) nebo podle názvu (nejvýš 5 výsledků). */
export async function aresHledej(parametry: { ico?: string; nazev?: string }): Promise<{ firmy: FirmaAres[]; poznamka?: string }> {
  const ico = (parametry.ico ?? '').replace(/\s+/g, '');
  const nazev = (parametry.nazev ?? '').trim();
  if (ico) {
    if (!/^\d{8}$/.test(ico)) return { firmy: [], poznamka: 'IČO musí mít 8 číslic.' };
    const odpoved = await fetch(`${API}/ekonomicke-subjekty/${ico}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (odpoved.status === 404) return { firmy: [], poznamka: 'Firma s tímto IČO v ARES není.' };
    if (!odpoved.ok) throw new Error(`ARES odpověděl chybou ${odpoved.status}.`);
    return { firmy: [naFirmu((await odpoved.json()) as SubjektAres)] };
  }
  if (nazev.length < 3) return { firmy: [], poznamka: 'Zadejte IČO nebo aspoň 3 znaky názvu firmy.' };
  const odpoved = await fetch(`${API}/ekonomicke-subjekty/vyhledat`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ obchodniJmeno: nazev, pocet: 5, start: 0 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!odpoved.ok) throw new Error(`ARES odpověděl chybou ${odpoved.status}.`);
  const data = (await odpoved.json()) as { ekonomickeSubjekty?: SubjektAres[]; pocetCelkem?: number };
  return {
    firmy: (data.ekonomickeSubjekty ?? []).map(naFirmu),
    poznamka: (data.pocetCelkem ?? 0) > 5 ? `Nalezeno ${data.pocetCelkem} firem, zobrazeno prvních 5 – upřesněte název.` : undefined,
  };
}
