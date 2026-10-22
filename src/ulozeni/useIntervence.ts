import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nactiIntervenci, ulozIntervenci } from './uloziste';
import type { Intervence } from './typy';

/** Kolik prací, které intervenci ještě změní, právě běží – podle id intervence. */
const rozpracovano = new Map<string, number>();
const posluchaci = new Set<() => void>();

function oznamPraci() {
  for (const posluchac of posluchaci) posluchac();
}

function odebirejPraci(posluchac: () => void) {
  posluchaci.add(posluchac);
  return () => {
    posluchaci.delete(posluchac);
  };
}

/**
 * Označí práci, která intervenci ještě změní (nahrání souboru, kontrola PDF).
 * Dokud běží, ukazatel ukládání ukazuje „Ukládám…“ a zavření stránky se zeptá, jestli odejít.
 */
export async function pracujNa<T>(intervenceId: string, prace: () => Promise<T>): Promise<T> {
  rozpracovano.set(intervenceId, (rozpracovano.get(intervenceId) ?? 0) + 1);
  oznamPraci();
  try {
    return await prace();
  } finally {
    const zbyva = (rozpracovano.get(intervenceId) ?? 1) - 1;
    if (zbyva > 0) rozpracovano.set(intervenceId, zbyva);
    else rozpracovano.delete(intervenceId);
    oznamPraci();
  }
}

/** Běží u intervence nějaká práce označená přes pracujNa? */
export function usePracuje(intervenceId: string) {
  return useSyncExternalStore(odebirejPraci, () => rozpracovano.has(intervenceId));
}

/**
 * Načte intervenci a každou změnu automaticky uloží do prohlížeče
 * (s krátkým zpožděním, aby se při psaní neukládalo po každém písmenu).
 * Při zavírání stránky se neuložená změna uloží hned.
 */
export function useIntervence(id: string) {
  // undefined = načítá se, null = neexistuje
  const [intervence, setIntervence] = useState<Intervence | null | undefined>(undefined);
  const [ukladani, setUkladani] = useState<'ulozeno' | 'ceka' | 'chyba'>('ulozeno');
  const pracuje = usePracuje(id);
  const aktualni = useRef<Intervence | null>(null);
  const neulozena = useRef<Intervence | null>(null);
  const casovac = useRef<number | undefined>(undefined);

  useEffect(() => {
    let zruseno = false;
    nactiIntervenci(id).then((nactena) => {
      if (zruseno) return;
      aktualni.current = nactena ?? null;
      setIntervence(nactena ?? null);
    });
    return () => {
      zruseno = true;
    };
  }, [id]);

  const ulozHned = useCallback(async () => {
    window.clearTimeout(casovac.current);
    const k_ulozeni = neulozena.current;
    if (!k_ulozeni) return;
    neulozena.current = null;
    try {
      await ulozIntervenci(k_ulozeni);
      if (!neulozena.current) setUkladani('ulozeno');
    } catch {
      neulozena.current ??= k_ulozeni;
      setUkladani('chyba');
    }
  }, []);

  const zmen = useCallback(
    (uprava: (puvodni: Intervence) => Intervence) => {
      const puvodni = aktualni.current;
      if (!puvodni) return;
      const nova = uprava(puvodni);
      aktualni.current = nova;
      neulozena.current = nova;
      setIntervence(nova);
      setUkladani('ceka');
      window.clearTimeout(casovac.current);
      casovac.current = window.setTimeout(() => void ulozHned(), 400);
    },
    [ulozHned],
  );

  useEffect(() => {
    const priSkryti = () => {
      if (document.visibilityState === 'hidden') void ulozHned();
    };
    const predOdchodem = (e: BeforeUnloadEvent) => {
      if (neulozena.current || rozpracovano.has(id)) {
        void ulozHned();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', priSkryti);
    window.addEventListener('pagehide', ulozHned);
    window.addEventListener('beforeunload', predOdchodem);
    return () => {
      document.removeEventListener('visibilitychange', priSkryti);
      window.removeEventListener('pagehide', ulozHned);
      window.removeEventListener('beforeunload', predOdchodem);
      void ulozHned();
    };
  }, [ulozHned, id]);

  // Nahrávání a kontrola PDF ještě intervenci změní – do jejich konce není „uloženo“.
  const stavUkladani: typeof ukladani = pracuje && ukladani === 'ulozeno' ? 'ceka' : ukladani;
  return { intervence, zmen, ukladani: stavUkladani, ulozHned };
}
