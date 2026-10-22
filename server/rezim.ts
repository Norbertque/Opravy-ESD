/**
 * Testovací režim. Zapíná se jen lokálně v souboru .env.local
 * (MOCK_GEMINI=1, MOCK_DISK=1). Na ostrém serveru se tyto proměnné ignorují,
 * takže tam appka vždy volá skutečný model a skutečný Disk – i kdyby je tam
 * někdo omylem nastavil.
 */
export const rezim = {
  get mockGemini() {
    return zapnuto('MOCK_GEMINI');
  },
  get mockDisk() {
    return zapnuto('MOCK_DISK');
  },
};

type Promenna = 'MOCK_GEMINI' | 'MOCK_DISK';

/**
 * Ostrý server: produkční sestavení (NODE_ENV=production) nebo Cloud Run,
 * kde běží appky z AI Studia (Cloud Run nastavuje K_SERVICE).
 */
function ostryServer() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
}

let varovano = false;

function zapnuto(promenna: Promenna) {
  if (process.env[promenna] !== '1') return false;
  if (!ostryServer()) return true;
  if (!varovano) {
    varovano = true;
    const nastavene = (['MOCK_GEMINI', 'MOCK_DISK'] as const).filter((p) => process.env[p] === '1');
    console.warn(`Testovací režim (${nastavene.join(', ')}) na ostrém serveru nejde zapnout – proměnné se ignorují.`);
  }
  return false;
}
