/** Drobné pomocné funkce pro zobrazení. */

export function formatVelikost(bajty: number) {
  if (bajty < 1024) return `${bajty} B`;
  if (bajty < 1024 * 1024) return `${Math.round(bajty / 1024)} kB`;
  return `${(bajty / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatDatum(cas: number) {
  return new Date(cas).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 1 strana, 2 strany, 5 stran */
export function sklonuj(pocet: number, jedna: string, dve: string, pet: string) {
  if (pocet === 1) return `${pocet} ${jedna}`;
  if (pocet >= 2 && pocet <= 4) return `${pocet} ${dve}`;
  return `${pocet} ${pet}`;
}

/** Seznam stran „2, 3 a 5". */
export function vyctiStrany(strany: number[]) {
  if (strany.length <= 1) return strany.join('');
  return `${strany.slice(0, -1).join(', ')} a ${strany[strany.length - 1]}`;
}

export function bezPripony(nazev: string) {
  return nazev.replace(/\.[^.]+$/, '');
}
