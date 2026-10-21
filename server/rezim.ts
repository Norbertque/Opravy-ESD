/**
 * Testovací režim. Zapíná se jen lokálně v souboru .env.local
 * (MOCK_GEMINI=1, MOCK_DISK=1). V AI Studiu tyto proměnné nejsou,
 * takže tam appka vždy volá skutečný model a skutečný Disk.
 */
export const rezim = {
  get mockGemini() {
    return process.env.MOCK_GEMINI === '1';
  },
  get mockDisk() {
    return process.env.MOCK_DISK === '1';
  },
};
