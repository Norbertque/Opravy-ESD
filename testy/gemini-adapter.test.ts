/**
 * Adaptér skutečného Gemini proti lokálnímu falešnému serveru (nic nejde ke Googlu):
 * tvar dotazů Interactions API, smyčka nástrojů, hlavička User-Agent a překlad chyb.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dohledej } from '../server/dohledani/dohledej';
import { ChybaModelu } from '../server/dohledani/model';
import { modelGemini } from '../server/dohledani/model-gemini';
import { diskMock } from '../server/nastroje/disk-mock';

type Obsluha = (telo: Record<string, any>, res: http.ServerResponse) => void;
const zaznam: { hlavicky: http.IncomingHttpHeaders; telo: Record<string, any> }[] = [];
let obsluha: Obsluha = () => {};
let server: http.Server;
let adresa = '';

const json = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const kusy: Buffer[] = [];
    req.on('data', (k) => kusy.push(k));
    req.on('end', () => {
      const telo = JSON.parse(Buffer.concat(kusy).toString('utf8') || '{}');
      zaznam.push({ hlavicky: req.headers, telo });
      obsluha(telo, res);
    });
  });
  await new Promise<void>((hotovo) => server.listen(0, '127.0.0.1', hotovo));
  adresa = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((hotovo) => server.close(() => hotovo())));

const VYSLEDEK = {
  body: [
    {
      bod_intervence: 'Chybné získatelské číslo.',
      typ: 'oprava',
      vyskyty: [{ soubor: 'esd.pdf', strana: 1, presny_text: '401234', kontext_pred: 'číslo', kontext_za: '' }],
      oprava: '401243',
      zdroj_typ: 'disk',
      zdroj_odkaz: 'Seznam zprostředkovatelů 2026 – https://drive.google.com/x',
      zdroj_strana: 0,
      konflikt: false,
      zduvodneni: 'Podle seznamu na Disku.',
      jistota: 'vysoka',
    },
  ],
};

const parametry = (signal = new AbortController().signal) => ({
  model: modelGemini('test-klic', adresa),
  disk: diskMock(),
  vstup: [{ druh: 'text' as const, text: 'INTERVENCE: chybné získatelské číslo' }],
  nazvyEsd: ['esd.pdf'],
  signal,
});

describe('adaptér Gemini (Interactions API)', () => {
  it('projde smyčkou nástrojů a vrátí body', async () => {
    zaznam.length = 0;
    obsluha = (telo, res) => {
      if (!telo.previous_interaction_id)
        return json(res, 200, {
          id: 'i1',
          status: 'requires_action',
          steps: [
            { type: 'google_search_call', id: 'g1', arguments: { queries: ['registr zprostředkovatelů'] } },
            { type: 'function_call', id: 'c1', name: 'drive_search', arguments: { dotaz: 'získatelské číslo' } },
          ],
        });
      return json(res, 200, {
        id: 'i2',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(VYSLEDEK) }] }],
      });
    };
    const prubeh: string[] = [];
    const vysledek = await dohledej({ ...parametry(), prubeh: (t) => prubeh.push(t) });

    expect(vysledek.body).toHaveLength(1);
    expect(vysledek.body[0].oprava).toBe('401243');
    expect(vysledek.testovaci).toBe(false);
    expect(vysledek.pocetVolaniNastroju).toBe(2);
    expect(prubeh).toContain('Hledám na internetu: „registr zprostředkovatelů"');
    expect(prubeh).toContain('Hledám na Disku: „získatelské číslo"');

    expect(zaznam).toHaveLength(2);
    const [prvni, druhy] = zaznam;
    for (const z of zaznam) expect(z.hlavicky['user-agent']).toBe('aistudio-build');
    expect(prvni.telo.system_instruction).toContain('intervence');
    expect(prvni.telo.store).toBe(true);
    expect(prvni.telo.tools.map((t: { type: string; name?: string }) => t.name ?? t.type)).toEqual(
      expect.arrayContaining(['drive_search', 'drive_read', 'google_search', 'url_context']),
    );
    expect(prvni.telo.response_format.mime_type).toBe('application/json');
    expect(prvni.telo.input[0]).toEqual({ type: 'text', text: 'INTERVENCE: chybné získatelské číslo' });
    expect(druhy.telo.previous_interaction_id).toBe('i1');
    expect(druhy.telo.input[0]).toMatchObject({ type: 'function_result', call_id: 'c1', name: 'drive_search' });
    expect(JSON.stringify(druhy.telo.input[0].result)).toContain('Seznam zprostředkovatelů 2026');
  });

  it('chybu 429 přeloží na kód limit (po opakování)', async () => {
    zaznam.length = 0;
    obsluha = (_t, res) => json(res, 429, { error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } });
    const chyba = await dohledej({ ...parametry(), prubeh: () => {} }).catch((e) => e);
    expect(chyba).toBeInstanceOf(ChybaModelu);
    expect(chyba.kod).toBe('limit');
    expect(zaznam.length).toBe(3); // 1 pokus + 2 opakování
  });

  it('chybu 400 přeloží na kód model se zprávou od Gemini', async () => {
    obsluha = (_t, res) => json(res, 400, { error: { code: 400, message: 'tool_choice auto is not supported', status: 'INVALID_ARGUMENT' } });
    const chyba = await dohledej({ ...parametry(), prubeh: () => {} }).catch((e) => e);
    expect(chyba.kod).toBe('model');
    expect(chyba.message).toContain('tool_choice auto is not supported');
  });

  it('neplatný klíč přeloží na kód klic', async () => {
    obsluha = (_t, res) =>
      json(res, 400, { error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
    const chyba = await dohledej({ ...parametry(), prubeh: () => {} }).catch((e) => e);
    expect(chyba.kod).toBe('klic');
  });
});
