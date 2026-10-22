/**
 * /api/diagnostika – ověří, že v AI Studiu funguje vše, co appka potřebuje:
 * klíč a model Gemini, hledání Google, kombinace nástrojů s JSON výstupem,
 * Google Disk, podpis a registr ARES. Každá kontrola vrátí srozumitelnou českou zprávu.
 * Spouští se jen tlačítkem v appce (volání Gemini stojí pár haléřů).
 */
import express from 'express';
import type { Interactions } from '@google/genai';
import { konfigurace } from '../konfigurace';
import { moznostiPozadavku, prelozChybu as prelozChybuModelu, vytvorKlientaGemini } from './dohledani/model-gemini';
import { aresHledej } from './nastroje/ares';
import { diskZPozadavku } from './nastroje/vyber-disku';
import { rezim } from './rezim';

/** Česká zpráva + původní zpráva od Googlu (pomáhá při ladění v AI Studiu). */
function prelozChybu(e: unknown) {
  const ch = prelozChybuModelu(e);
  return { message: ch.detail ? `${ch.message} (Google: ${ch.detail})` : ch.message, kod: ch.kod };
}

interface Kontrola {
  nazev: string;
  stav: 'ok' | 'chyba' | 'varovani' | 'preskoceno';
  zprava: string;
}

export function routerDiagnostiky() {
  const router = express.Router();

  router.post('/diagnostika', async (req, res) => {
    const vysledky: Kontrola[] = [];
    const pridej = (k: Kontrola) => vysledky.push(k);
    const cas = async <T>(fn: () => Promise<T>) => {
      const start = Date.now();
      const v = await fn();
      return { v, s: ((Date.now() - start) / 1000).toFixed(1).replace('.', ',') };
    };

    // 1) režim
    pridej(
      rezim.mockGemini || rezim.mockDisk
        ? { nazev: 'Režim', stav: 'varovani', zprava: 'Běží testovací režim (MOCK_GEMINI / MOCK_DISK) – výsledky dohledání nejsou skutečné.' }
        : { nazev: 'Režim', stav: 'ok', zprava: 'Ostrý režim – appka volá skutečné Gemini a Google Disk.' },
    );

    // 2) Gemini
    const klic = process.env.GEMINI_API_KEY;
    const model = konfigurace.gemini.model;
    if (!klic || klic === 'MY_GEMINI_API_KEY') {
      pridej({ nazev: 'Klíč Gemini', stav: 'chyba', zprava: 'Chybí GEMINI_API_KEY. V AI Studiu ho zkontrolujte v Nastavení → Secrets.' });
    } else {
      pridej({ nazev: 'Klíč Gemini', stav: 'ok', zprava: 'Klíč je nastavený.' });
      const ai = vytvorKlientaGemini(klic);
      const signal = AbortSignal.timeout(90_000);
      const zavolej = (params: Interactions.InteractionCreateParams.CreateModelInteractionParamsNonStreaming) =>
        ai.interactions.create({ ...params, store: false }, moznostiPozadavku(signal));

      try {
        const { v, s } = await cas(() => zavolej({ model, input: 'Odpověz jen slovem OK.' }));
        pridej({ nazev: 'Model', stav: 'ok', zprava: `Model ${model} odpovídá (${s} s): „${(v.output_text ?? '').trim().slice(0, 40)}“` });
      } catch (e) {
        pridej({ nazev: 'Model', stav: 'chyba', zprava: `Model ${model} neodpovídá: ${prelozChybu(e).message}` });
      }

      if (konfigurace.internet.googleSearch) {
        try {
          const { v, s } = await cas(() =>
            zavolej({
              model,
              input: 'Vyhledej na internetu, kde sídlí Ministerstvo financí České republiky. Odpověz jednou větou.',
              tools: [{ type: 'google_search' }],
            }),
          );
          const hledal = v.steps.some((k) => k.type === 'google_search_call');
          pridej({
            nazev: 'Hledání Google',
            stav: hledal ? 'ok' : 'varovani',
            zprava: hledal ? `Funguje (${s} s).` : 'Model nástroj Google Search nepoužil – zkuste diagnostiku znovu.',
          });
        } catch (e) {
          pridej({ nazev: 'Hledání Google', stav: 'chyba', zprava: prelozChybu(e).message });
        }
      }

      try {
        const { v, s } = await cas(() =>
          zavolej({
            model,
            input: 'Zavolej funkci ping s textem „ahoj“.',
            tools: [
              { type: 'function', name: 'ping', description: 'Test spojení.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
              ...(konfigurace.internet.googleSearch ? [{ type: 'google_search' } as Interactions.Tool] : []),
            ],
            generation_config: { tool_choice: konfigurace.gemini.volbaNastroju },
            response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
          }),
        );
        const volal = v.steps.some((k) => k.type === 'function_call');
        pridej({
          nazev: 'Nástroje + JSON (režim „společně“)',
          stav: volal ? 'ok' : 'varovani',
          zprava: volal
            ? `Funguje (${s} s).`
            : 'Model funkci nezavolal. Kdyby dohledání nefungovalo, nastavte v konfigurace.ts rezimNastroju na „dvoukrokove“.',
        });
      } catch (e) {
        pridej({
          nazev: 'Nástroje + JSON (režim „společně“)',
          stav: konfigurace.gemini.rezimNastroju === 'spolecne' ? 'chyba' : 'varovani',
          zprava:
            prelozChybu(e).kod === 'tarif' || prelozChybu(e).kod === 'limit'
              ? prelozChybu(e).message
              : `${prelozChybu(e).message} Řešení: v konfigurace.ts zkuste volbaNastroju: 'auto', případně rezimNastroju: 'dvoukrokove'.`,
        });
      }
    }

    // 3) Disk a podpis
    const { disk, poznamka } = diskZPozadavku(req);
    if (poznamka) {
      pridej({ nazev: 'Google Disk', stav: 'chyba', zprava: 'Nepřihlášeno. Přihlaste se k Google Disku (nebo v AI Studiu zapněte integraci Google Drive podle README).' });
      pridej({ nazev: 'Podpis', stav: 'preskoceno', zprava: 'Bez Disku nejde ověřit.' });
    } else {
      try {
        await disk.hledat('smlouva');
        pridej({ nazev: 'Google Disk', stav: 'ok', zprava: `Disk odpovídá (hledá se v: ${konfigurace.disk.slozka || 'celý Disk'}).` });
      } catch (e) {
        pridej({ nazev: 'Google Disk', stav: 'chyba', zprava: e instanceof Error ? e.message : 'Disk nejde přečíst.' });
      }
      try {
        const p = await disk.najdiPodpis(konfigurace.disk.podpis);
        pridej(
          'soubor' in p
            ? { nazev: 'Podpis', stav: 'ok', zprava: `Nalezen: ${p.soubor.nazev}.` }
            : { nazev: 'Podpis', stav: 'chyba', zprava: `Soubor „${konfigurace.disk.podpis}“ nenalezen (PNG v dosahu: ${p.kandidati.length}). Upravte konfigurace.disk.podpis.` },
        );
      } catch (e) {
        pridej({ nazev: 'Podpis', stav: 'chyba', zprava: e instanceof Error ? e.message : 'Podpis nejde načíst.' });
      }
    }

    // 4) ARES
    if (konfigurace.internet.ares) {
      try {
        const { firmy } = await aresHledej({ ico: '00006947' });
        pridej(
          firmy.length
            ? { nazev: 'Registr ARES', stav: 'ok', zprava: `Funguje (${firmy[0].obchodniJmeno}).` }
            : { nazev: 'Registr ARES', stav: 'varovani', zprava: 'ARES odpověděl, ale zkušební firmu nenašel.' },
        );
      } catch (e) {
        pridej({ nazev: 'Registr ARES', stav: 'chyba', zprava: e instanceof Error ? e.message : 'ARES neodpovídá.' });
      }
    }

    res.json({ vysledky });
  });

  return router;
}
