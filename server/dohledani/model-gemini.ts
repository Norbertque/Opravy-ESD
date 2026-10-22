/**
 * Skutečné Gemini přes Interactions API (@google/genai ≥ 2.0).
 *
 * - Konverzace je uložená u Googlu (store: true) a další krok navazuje přes
 *   previous_interaction_id, takže se dokumenty neposílají znovu.
 * - Google Search a URL context běží u Googlu, my obsluhujeme jen vlastní funkce
 *   (drive_search, drive_read, ares_hledej).
 * - Výsledek nástroje smí obsahovat jen text nebo obrázek. PDF z Disku se proto
 *   pošle jako vytažený text; když je to sken bez textu, přiloží se jako dokument
 *   v dalším kroku vstupu.
 */
import { ApiError, FileState, GoogleGenAI } from '@google/genai';
import type { GoogleGenAIInteraction, GoogleGenAIRequestOptions, Interactions, RetryConfig } from '@google/genai';
import { konfigurace } from '../../konfigurace';
import { SCHEMA_VYSLEDKU } from '../../src/sdilene/dohledani';
import { textZPdf } from '../nastroje/pdf-text';
import { ChybaModelu, HLASKY, type KrokModelu, type ModelKlient, type NastrojeProModel, type Pozadavek, type VysledekNastroje } from './model';
import type { Blok } from './vstupy';

type ParametryVytvoreni = Interactions.InteractionCreateParams.CreateModelInteractionParamsNonStreaming;

/** AI Studio vyžaduje hlavičku User-Agent: aistudio-build. Interactions API ji jinak přepíše. */
function fetchSUserAgentem(vstup: RequestInfo | URL, init?: RequestInit) {
  const pozadavek = new Request(vstup, init);
  pozadavek.headers.set('User-Agent', 'aistudio-build');
  return fetch(pozadavek);
}

/** 429 a chyby serveru zkusit ještě dvakrát; vypršený čas už ne. */
const OPAKOVANI: RetryConfig = {
  strategy: 'attempt-count-backoff',
  maxRetries: 2,
  retryConnectionErrors: false,
  backoff: { initialInterval: 1_000, maxInterval: 8_000, exponent: 2 },
};

export function moznostiPozadavku(signal: AbortSignal): GoogleGenAIRequestOptions {
  return {
    signal: AbortSignal.any([signal, AbortSignal.timeout(konfigurace.gemini.timeoutMs)]),
    retries: OPAKOVANI,
    retry_codes: ['429', '500', '502', '503', '504'],
  };
}

/** Klient Gemini s hlavičkou pro AI Studio. `adresaApi` jen pro testy (lokální falešný server). */
export function vytvorKlientaGemini(klic: string, adresaApi?: string) {
  return new GoogleGenAI({
    apiKey: klic,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' }, fetch: fetchSUserAgentem, ...(adresaApi ? { baseUrl: adresaApi } : {}) },
  });
}

export function modelGemini(klic: string, adresaApi?: string): ModelKlient {
  const ai = vytvorKlientaGemini(klic, adresaApi);
  const model = konfigurace.gemini.model;
  let system = '';

  const nastroje = (n: NastrojeProModel): Interactions.Tool[] => [
    ...n.funkce.map((f): Interactions.Tool => ({ type: 'function', name: f.nazev, description: f.popis, parameters: f.parametry })),
    ...(n.googleSearch ? [{ type: 'google_search' } as Interactions.Tool] : []),
    ...(n.urlContext ? [{ type: 'url_context' } as Interactions.Tool] : []),
  ];

  const parametry = (p: Pozadavek): Omit<ParametryVytvoreni, 'input'> => ({
    model,
    system_instruction: system,
    tools: nastroje(p.nastroje),
    generation_config: { tool_choice: p.bezNastroju ? 'none' : konfigurace.gemini.volbaNastroju },
    ...(p.json
      ? {
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: SCHEMA_VYSLEDKU,
          } satisfies Interactions.TextResponseFormat,
        }
      : {}),
    store: true,
  });

  const vytvor = async (p: Pozadavek, params: ParametryVytvoreni): Promise<KrokModelu> => {
    let interakce: GoogleGenAIInteraction;
    try {
      interakce = await ai.interactions.create(params, moznostiPozadavku(p.signal));
    } catch (chyba) {
      throw prelozChybu(chyba, p.signal);
    }
    return naKrok(interakce);
  };

  return {
    nazev: model,
    testovaci: false,

    async zacni(p) {
      system = p.system;
      return vytvor(p, { ...parametry(p), input: p.vstup.map(naObsah) });
    },

    async pokracuj(p) {
      let input: ParametryVytvoreni['input'];
      if (p.vysledky?.length) {
        const kroky: Interactions.Step[] = [];
        const prilohy: Interactions.Content[] = [];
        for (const v of p.vysledky) {
          const { vysledek, dokumenty } = await vysledekNastroje(v);
          kroky.push({ type: 'function_result', call_id: v.id, name: v.nazev, result: vysledek });
          prilohy.push(...dokumenty);
        }
        if (prilohy.length) kroky.push({ type: 'user_input', content: prilohy });
        input = kroky;
      } else {
        input = p.pokyn ?? '';
      }
      return vytvor(p, { ...parametry(p), previous_interaction_id: p.predchozi, input });
    },

    async nahrajSoubor(data, mimeType, nazev) {
      try {
        let soubor = await ai.files.upload({
          file: new Blob([new Uint8Array(data)], { type: mimeType }),
          config: { mimeType, displayName: nazev },
        });
        const konec = Date.now() + 120_000;
        while (soubor.state !== FileState.ACTIVE) {
          if (soubor.state === FileState.FAILED || Date.now() > konec || !soubor.name)
            throw new ChybaModelu('jina', `Soubor „${nazev}“ se nepodařilo připravit pro Gemini.`);
          await new Promise((hotovo) => setTimeout(hotovo, 1_000));
          soubor = await ai.files.get({ name: soubor.name });
        }
        return { uri: soubor.uri ?? '', mimeType: soubor.mimeType ?? mimeType, name: soubor.name ?? '' };
      } catch (chyba) {
        if (chyba instanceof ChybaModelu) throw chyba;
        throw prelozChybu(chyba);
      }
    },

    async smazSoubor(name) {
      await ai.files.delete({ name });
    },
  };
}

function naObsah(b: Blok): Interactions.Content {
  if (b.druh === 'text') return { type: 'text', text: b.text };
  const data = b.data ? { data: b.data.toString('base64') } : { uri: b.uri };
  return b.druh === 'dokument' ? { type: 'document', mime_type: b.mimeType, ...data } : { type: 'image', mime_type: b.mimeType, ...data };
}

/** Výsledek nástroje: text a obrázky přímo, PDF jako text (sken jako příloha dalšího kroku). */
async function vysledekNastroje(v: VysledekNastroje) {
  const vysledek: (Interactions.TextContent | Interactions.ImageContent)[] = [];
  const dokumenty: Interactions.Content[] = [];
  for (const b of v.obsah) {
    if (b.druh === 'text') vysledek.push({ type: 'text', text: b.text });
    else if (b.druh === 'obrazek') vysledek.push(naObsah(b) as Interactions.ImageContent);
    else {
      const text = b.data ? await textZPdf(b.data, konfigurace.disk.maxZnakuTextu).catch(() => '') : '';
      if (text.replace(/\[strana \d+\]|\s/g, '').length >= 50) vysledek.push({ type: 'text', text: `Obsah PDF:\n${text}` });
      else {
        vysledek.push({ type: 'text', text: 'PDF nemá textovou vrstvu (sken) – je přiložené v následující zprávě.' });
        dokumenty.push(naObsah(b));
      }
    }
  }
  return { vysledek, dokumenty };
}

function naKrok(i: GoogleGenAIInteraction): KrokModelu {
  if (i.status !== 'completed' && i.status !== 'requires_action') {
    console.warn('Gemini: interakce skončila stavem', i.status);
    throw new ChybaModelu('model', i.status === 'budget_exceeded' ? HLASKY.limit : HLASKY.model);
  }
  const zodpovezene = new Set(i.steps.filter((s) => s.type === 'function_result').map((s) => (s as Interactions.FunctionResultStep).call_id));
  const krok: KrokModelu = { id: i.id, volani: [], hledaniGoogle: [], cteneStranky: [], text: i.output_text ?? '' };
  for (const s of i.steps) {
    if (s.type === 'function_call' && !zodpovezene.has(s.id))
      krok.volani.push({ id: s.id, nazev: s.name, argumenty: (s.arguments ?? {}) as Record<string, unknown> });
    else if (s.type === 'google_search_call') krok.hledaniGoogle.push(...(s.arguments?.queries ?? []));
    else if (s.type === 'url_context_call') krok.cteneStranky.push(...(s.arguments?.urls ?? []));
  }
  return krok;
}

/** Chyba SDK → česká chyba s kódem. Do logu jde jen druh chyby. */
export function prelozChybu(chyba: unknown, signal?: AbortSignal): ChybaModelu {
  if (chyba instanceof ChybaModelu) return chyba;
  if (signal?.aborted && !(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'))
    return new ChybaModelu('jina', 'Dohledání bylo zrušeno.');
  const e = chyba as Error & { status?: unknown; error?: { error?: { message?: string; details?: { reason?: string }[] } } };
  const status = chyba instanceof ApiError ? chyba.status : typeof e?.status === 'number' ? e.status : undefined;
  const nazev = e?.name ?? typeof chyba;
  console.warn('Gemini: chyba', nazev, status ?? '');
  const duvody = (e?.error?.error?.details ?? []).map((d) => d.reason);
  if (status === 429) return new ChybaModelu('limit', HLASKY.limit);
  if (status === 401 || status === 403 || duvody.includes('API_KEY_INVALID')) return new ChybaModelu('klic', HLASKY.klic);
  if (status === 400 || status === 422) {
    const zprava = e?.error?.error?.message;
    return new ChybaModelu('model', zprava ? `Gemini dotaz odmítlo: ${zprava}` : HLASKY.model);
  }
  if (status === 408 || status === 504 || nazev === 'APIConnectionTimeoutError' || nazev === 'TimeoutError' || nazev === 'AbortError')
    return new ChybaModelu('timeout', HLASKY.timeout);
  return new ChybaModelu('jina', HLASKY.jina);
}
