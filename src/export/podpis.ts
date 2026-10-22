/**
 * Příprava obrázku podpisu (PNG, JPG nebo WebP) v prohlížeči:
 *  - světlé pozadí (papír, bílá) se zprůhlední, aby podpis nepřekryl stránku obdélníkem,
 *  - prázdné okraje se oříznou, aby velikost podpisu odpovídala jen samotnému podpisu,
 *  - výsledek je vždy PNG (pdf-lib ho vloží i s průhledností).
 * Obrázek, který už průhledné pozadí má, se jen ořízne.
 */
const MAX_STRANA = 1600;

export async function pripravPodpis(obrazek: Blob): Promise<Blob> {
  let bitmapa: ImageBitmap;
  try {
    bitmapa = await createImageBitmap(obrazek);
  } catch {
    throw new Error('Obrázek podpisu se nepodařilo načíst. Použijte PNG nebo JPG.');
  }
  const meritko = Math.min(1, MAX_STRANA / Math.max(bitmapa.width, bitmapa.height));
  const sirka = Math.max(1, Math.round(bitmapa.width * meritko));
  const vyska = Math.max(1, Math.round(bitmapa.height * meritko));
  const platno = document.createElement('canvas');
  platno.width = sirka;
  platno.height = vyska;
  const ctx = platno.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmapa, 0, 0, sirka, vyska);
  bitmapa.close();
  const obraz = ctx.getImageData(0, 0, sirka, vyska);
  const d = obraz.data;
  const jas = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Má už průhledné pozadí? (aspoň 5 % průhledných pixelů)
  let pruhlednych = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) pruhlednych++;
  const uzPruhledny = pruhlednych > (sirka * vyska) / 20;

  if (!uzPruhledny) {
    // Barva papíru = medián jasu pixelů na okraji obrázku
    const okraj: number[] = [];
    for (let x = 0; x < sirka; x += 2) okraj.push(jas(x * 4), jas(((vyska - 1) * sirka + x) * 4));
    for (let y = 0; y < vyska; y += 2) okraj.push(jas(y * sirka * 4), jas((y * sirka + sirka - 1) * 4));
    okraj.sort((a, b) => a - b);
    const papir = okraj[Math.floor(okraj.length / 2)];
    // Od papíru (průhledné) po tmavý inkoust (neprůhledné) plynule, ať jsou okraje tahů hladké
    const svetle = papir - 25;
    const tmave = Math.max(0, papir - 110);
    for (let i = 0; i < d.length; i += 4) {
      const krytí = Math.min(1, Math.max(0, (svetle - jas(i)) / (svetle - tmave)));
      d[i + 3] = Math.round(d[i + 3] * krytí);
    }
  }

  // Oříznout na samotný podpis
  let x0 = sirka;
  let y0 = vyska;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < vyska; y++)
    for (let x = 0; x < sirka; x++)
      if (d[(y * sirka + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error('Na obrázku není vidět žádný podpis (je prázdný nebo celý světlý).');
  const odsazeni = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - odsazeni);
  y0 = Math.max(0, y0 - odsazeni);
  x1 = Math.min(sirka - 1, x1 + odsazeni);
  y1 = Math.min(vyska - 1, y1 + odsazeni);
  ctx.putImageData(obraz, 0, 0);

  const vystup = document.createElement('canvas');
  vystup.width = x1 - x0 + 1;
  vystup.height = y1 - y0 + 1;
  vystup.getContext('2d')!.drawImage(platno, x0, y0, vystup.width, vystup.height, 0, 0, vystup.width, vystup.height);
  platno.width = platno.height = 0;
  const png = await new Promise<Blob | null>((hotovo) => vystup.toBlob(hotovo, 'image/png'));
  vystup.width = vystup.height = 0;
  if (!png) throw new Error('Podpis se nepodařilo převést.');
  return png;
}
