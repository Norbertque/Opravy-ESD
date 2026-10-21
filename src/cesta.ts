import { useEffect, useState } from 'react';

/**
 * Jednoduché „stránky" appky podle části adresy za #:
 *   #/                   seznam intervencí
 *   #/intervence/<id>    rozpracovaná intervence
 * Díky tomu funguje tlačítko Zpět v prohlížeči a obnovení stránky.
 */
export type Cesta = { obrazovka: 'seznam' } | { obrazovka: 'intervence'; id: string };

function precti(): Cesta {
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
  window.location.hash = cesta.obrazovka === 'intervence' ? `#/intervence/${cesta.id}` : '#/';
}
