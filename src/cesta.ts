import { useEffect, useState } from 'react';

/**
 * Jednoduché „stránky" appky podle části adresy za #:
 *   #/                   seznam intervencí
 *   #/intervence/<id>    rozpracovaná intervence
 *   #/diagnostika        kontrola, že v AI Studiu funguje Gemini, Disk a podpis
 * Díky tomu funguje tlačítko Zpět v prohlížeči a obnovení stránky.
 */
export type Cesta = { obrazovka: 'seznam' } | { obrazovka: 'diagnostika' } | { obrazovka: 'intervence'; id: string };

function precti(): Cesta {
  if (window.location.hash.startsWith('#/diagnostika')) return { obrazovka: 'diagnostika' };
  const shoda = window.location.hash.match(/^#\/intervence\/([\w-]+)/);
  return shoda ? { obrazovka: 'intervence', id: shoda[1] } : { obrazovka: 'seznam' };
}

export function useCesta() {
  const [cesta, setCesta] = useState(precti);
  useEffect(() => {
    const priZmene = () => setCesta(precti());
    window.addEventListener('hashchange', priZmene);
    return () => window.removeEventListener('hashchange', priZmene);
  }, []);
  return cesta;
}

export function jdiNa(cesta: Cesta) {
  window.location.hash =
    cesta.obrazovka === 'intervence' ? `#/intervence/${cesta.id}` : cesta.obrazovka === 'diagnostika' ? '#/diagnostika' : '#/';
}
