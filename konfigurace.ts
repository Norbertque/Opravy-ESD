/**
 * KONFIGURACE APPKY „OPRAVY ESD"
 *
 * Všechno nastavení je na tomhle jednom místě. Kolega v appce obrazovku
 * s nastavením nemá. Když je potřeba něco změnit, upraví se hodnota tady
 * (nebo se o to požádá agent v AI Studiu) a appka se znovu spustí.
 *
 * Délky a velikosti v PDF jsou v bodech (pt): 1 pt = 1/72 palce ≈ 0,35 mm.
 */
export const konfigurace = {
  /** Gemini – dohledávání správných údajů (volá se jen ze serveru). */
  gemini: {
    /** Model. Výchozí je nejnovější stabilní Flash. */
    model: 'gemini-3.8-flash',
    /** Kolikrát nejvýš smí model během jedné intervence použít nástroj (Disk, ARES, internet). */
    maxVolaniNastroju: 15,
    /**
     * 'spolecne'    = jeden dotaz: Google Search + nástroje Disku + JSON výstup najednou
     *                 (u Gemini 3 zatím ve zkušebním režimu – preview).
     * 'dvoukrokove' = nejdřív se hledá, pak se v druhém dotazu sestaví výsledek.
     *                 Použijte, když 'spolecne' hlásí chyby.
     */
    rezimNastroju: 'spolecne' as 'spolecne' | 'dvoukrokove',
    /** Jak dlouho nejvýš čekat na odpověď modelu na jeden krok (ms). */
    timeoutMs: 180_000,
    /** Soubory větší než tolik MB se k modelu posílají přes Files API, menší přímo v dotazu. */
    inlineLimitMB: 15,
  },

  /** Google Disk – materiály a podpis. */
  disk: {
    /** Složka s materiály (název nebo ID). Hledá se i v podsložkách. Prázdné = celý Disk. */
    slozka: '',
    /** Soubor s podpisem (PNG) – název nebo ID. Když se nenajde, appka nechá podpis vybrat. */
    podpis: 'podpis.png',
    /** Kolik souborů nejvýš vrátí jedno hledání. */
    maxVysledkuHledani: 10,
    /** Větší soubory se modelu nepošlou celé (MB). */
    maxVelikostSouboruMB: 10,
    /** Text z Google dokumentu, tabulky nebo TXT se zkrátí na tolik znaků. */
    maxZnakuTextu: 60_000,
  },

  /** Internet – použije se až po smlouvě a Disku. */
  internet: {
    /** Registr ARES (IČO, název a sídlo firem). */
    ares: true,
    /** Vyhledávání Google. */
    googleSearch: true,
    /** Čtení konkrétních webových stránek (URL context). */
    urlContext: true,
  },

  /** Vzhled oprav v PDF. */
  vzhled: {
    /** Barva opravy a škrtnutí (RGB 0–1). Výchozí je modrá. */
    barvaOpravy: { r: 0.08, g: 0.25, b: 0.75 },
    barvaSkrtu: { r: 0.08, g: 0.25, b: 0.75 },
    /** Tloušťka škrtací čáry (pt). */
    tloustkaSkrtu: 0.7,
    /** Velikost písma opravy: podle původního textu, ale v těchto mezích (pt). */
    velikostPismaMin: 7,
    velikostPismaMax: 11,
    /** Výška podpisu (pt). 20 pt ≈ 7 mm. */
    vyskaPodpisu: 20,
    /** Mezera mezi textem, opravou a podpisem (pt). */
    mezera: 3,
    /** Nejmenší vzdálenost opravy od okraje stránky (pt). */
    okrajStranky: 14,
    /** Datum vedle podpisu. */
    datumUPodpisu: false,
    /**
     * Citlivost kontroly volného místa na vyrenderované stránce:
     * pixel tmavší než tato hodnota (0 = černá, 255 = bílá) se bere jako obsah.
     */
    prahObsahu: 235,
  },

  /** Ukládání rozpracované práce v prohlížeči. */
  ulozeni: {
    /** Intervence bez úprav se po tolika dnech sama smaže. */
    smazatPoDnech: 30,
    /** Kolik dní předem na smazání upozornit. */
    upozornitDniPredem: 5,
  },

  /** Výstup. */
  vystup: {
    /** Přípona názvu opraveného souboru: smlouva.pdf → smlouva_opraveno.pdf */
    priponaSouboru: '_opraveno',
    /** Název ZIPu při stažení více souborů najednou (doplní se datum). */
    nazevZip: 'opravy-ESD',
  },
};

export type Konfigurace = typeof konfigurace;
