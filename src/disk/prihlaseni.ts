/**
 * PŘIHLÁŠENÍ K GOOGLE DISKU – místo pro napojení integrace z AI Studia.
 *
 * V AI Studiu se v panelu Integrations zapne Google Drive. AI Studio vygeneruje
 * přihlášení „Sign in with Google" (Firebase), které vrací přístupový token.
 * Agent AI Studia pak podle promptu v README napojí tři funkce níže na
 * vygenerovaný kód (typicky googleSignIn / getAccessToken / logout)
 * a nastaví PRIHLASENI_NAPOJENO na true.
 *
 * Pravidla:
 *  - Oprávnění jen pro čtení: https://www.googleapis.com/auth/drive.readonly
 *  - Token se drží jen v paměti stránky (ne v localStorage). Po obnovení
 *    stránky se uživatel přihlásí znovu, rozpracovaná práce zůstane uložená.
 *
 * Lokální testy používají náhradu Disku (MOCK_DISK=1) a token nepotřebují.
 */

/** Je přihlášení k Disku v appce napojené? (false = ještě nebylo napojeno v AI Studiu) */
export const PRIHLASENI_NAPOJENO = false;

/** Aktuální přístupový token k Disku, nebo null, když uživatel není přihlášen. */
export async function tokenDisku(): Promise<string | null> {
  return null;
}

/** Otevře přihlášení Google (volat přímo z kliknutí uživatele). Vrací token. */
export async function prihlasitKDisku(): Promise<string> {
  throw new Error(
    'Přihlášení k Google Disku zatím není v appce zapnuté. V AI Studiu zapněte integraci Google Drive podle README.',
  );
}

/** Odhlášení z Disku. */
export async function odhlasitZDisku(): Promise<void> {}
