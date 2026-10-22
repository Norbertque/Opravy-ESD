# Opravy ESD

Appka pro vyřízení **intervence** ke smluvní dokumentaci (ESD). Do appky se nahraje
smlouva, ESD a intervence od centrály. Appka:

1. rozdělí intervenci na jednotlivé body,
2. ke každému bodu dohledá správný údaj: nejdřív ve smlouvě, pak na Google Disku a nakonec na internetu,
3. nechá každou navrženou opravu schválit, upravit nebo zamítnout,
4. do **kopie** ESD chybný text škrtne, vedle napíše opravu a připojí podpis,
5. dá opravená PDF ke stažení (víc souborů i jako ZIP). Originály se nikdy nemění.

Sama žádné další chyby nehledá, řeší jen to, co je v intervenci.

Appka je postavená pro **Google AI Studio** (Build, full-stack: React + Node.js server).
Gemini i Google Disk se volají jen ze serveru, Gemini klíč se do prohlížeče nedostane.

---

## Obsah

1. [Ochrana dat – čtěte jako první](#1-ochrana-dat--čtěte-jako-první)
2. [Zprovoznění v AI Studiu](#2-zprovoznění-v-ai-studiu)
3. [Ověření na testovacích dokumentech](#3-ověření-na-testovacích-dokumentech)
4. [Jak appku používat](#4-jak-appku-používat)
5. [Nastavení](#5-nastavení)
6. [Řešení problémů](#6-řešení-problémů)
7. [Lokální spuštění a testy (pro vývoj)](#7-lokální-spuštění-a-testy-pro-vývoj)
8. [Co je kde v projektu](#8-co-je-kde-v-projektu)

---

## 1. Ochrana dat – čtěte jako první

- Smlouvy a ESD obsahují osobní údaje klientů. Při dohledání je appka posílá do Gemini (Google).
- **Na free tieru smí Google odeslaný obsah použít ke zlepšování svých produktů** a mohou ho číst
  i lidští hodnotitelé. Na **placeném tieru** to neplatí.
- Proto: **dokud v AI Studiu není zapnutý placený tier, nahrávejte jen testovací dokumenty**
  ze složky `testovaci-data/`. Jak tier ověřit, je v kroku 2.3.
- Ověřte si u zaměstnavatele, že posílání klientských smluv do Gemini je povolené.
- Na serveru appky se nic neukládá ani neloguje. Rozpracované intervence jsou uložené jen
  v prohlížeči na vašem počítači. Po 30 dnech bez úprav se samy smažou, po stažení
  opravených PDF je smažete tlačítkem **Dokončit a smazat**.
- Velké soubory se k Gemini nahrávají přes Files API a appka je hned po dohledání smaže
  (jinak by je Google smazal sám po 48 hodinách).
- Do hledání na internetu appka podle pokynů nesmí dávat osobní údaje (jména, data narození,
  adresy bydliště, čísla smluv a účtů). Internet slouží jen pro veřejné údaje (firmy, úřady, registry).

---

## 2. Zprovoznění v AI Studiu

### 2.1 Import projektu

1. Otevřete [Google AI Studio](https://aistudio.google.com) → **Build**.
2. V poli pro zadání klikněte na **+** (Add files) → **Import from GitHub** a vložte adresu
   repozitáře: `https://github.com/Norbertque/Opravy-ESD`.
3. AI Studio projekt načte a samo nainstaluje balíčky. Klíč `GEMINI_API_KEY` nastaví
   automaticky (je vidět v **Nastavení → Secrets**).

**Import do jiného účtu:** stejně – kdokoli s přístupem k repozitáři ho může naimportovat
do svého AI Studia. Každý účet má pak vlastní klíč, vlastní tier a vlastní přihlášení k Disku.

**Synchronizace s GitHubem:** v **Nastavení → GitHub** jde repozitář připojit. Změny z AI Studia
se pak posílají na GitHub a změny udělané mimo AI Studio (např. úpravy kódu z jiného počítače)
se do AI Studia stáhnou (*pull*). Když se změny rozcházejí, AI Studio u každého souboru nabídne,
kterou verzi ponechat.

### 2.2 Zapnutí Google Disku

Appka potřebuje číst z Disku materiály (seznamy, adresy…) a soubor s podpisem.

1. V pravém panelu otevřete **Integrations** a zapněte **Google Drive**.
2. Do chatu AI Studia vložte tento pokyn (doslova):

   > Zapni integraci Google Drive jen pro čtení. Přihlášení „Sign in with Google“ napoj na soubor
   > `src/disk/prihlaseni.ts`: funkce `tokenDisku()` má vracet aktuální přístupový token k Disku
   > (nebo `null`, když uživatel není přihlášený), `prihlasitKDisku()` má otevřít přihlášení Google
   > a vrátit token, `odhlasitZDisku()` má uživatele odhlásit. Konstantu `PRIHLASENI_NAPOJENO`
   > nastav na `true`. Požaduj jen oprávnění `https://www.googleapis.com/auth/drive.readonly`
   > (žádné jiné oprávnění k Disku, ani `drive.file`). Token drž jen v paměti, neukládej ho do
   > localStorage ani sessionStorage. Serverovou část pro Drive API negeneruj – server už Disk volá
   > sám (`server/nastroje/disk.ts`) s tokenem z hlavičky `Authorization`. Nic jiného v appce neměň.

3. Po úpravě otevřete appku a na stránce **Diagnostika** (odkaz vpravo nahoře) klikněte
   na **Spustit diagnostiku**. Appka si řekne o přihlášení ke Google účtu.

Při prvním přihlášení se může objevit varování **„Aplikace není ověřena“** (oprávnění číst celý
Disk patří u Googlu mezi „omezená“). U appky pro pár lidí je to v pořádku: klikněte na
*Rozšířené* → *Pokračovat*. Přístupový token platí zhruba hodinu a drží se jen v otevřené
stránce – po obnovení stránky se appka přihlásí znovu, rozpracovaná práce zůstane.

### 2.3 Kontrola placeného tieru

V AI Studiu otevřete **Get API key** (seznam klíčů a projektů). U projektu, ke kterému patří klíč
appky, musí být uvedený **placený tier** (Paid / Tier 1 a vyšší, s propojeným fakturačním účtem).
Pokud je tam *Free*, zapněte placení (Set up billing) – jinak nahrávejte jen testovací dokumenty.

### 2.4 Diagnostika

Stránka **Diagnostika** ověří postupně:

| Kontrola | Co znamená zelená |
|---|---|
| Režim | appka volá skutečné Gemini a Disk (ne testovací náhrady) |
| Klíč Gemini | klíč je nastavený |
| Model | model z konfigurace odpovídá |
| Hledání Google | funguje vyhledávání na internetu |
| Nástroje + JSON | model umí v jednom dotazu kombinovat Google a nástroje appky a vrátit výsledek jako JSON (u Gemini 3 je to zatím „preview“) |
| Google Disk | přihlášení k Disku funguje, složka z konfigurace existuje |
| Podpis | soubor s podpisem se na Disku našel |
| Registr ARES | funguje dohledávání firem v ARES |

Když něco svítí červeně, zpráva u kontroly říká, co udělat. Viz také [Řešení problémů](#6-řešení-problémů).

---

## 3. Ověření na testovacích dokumentech

Ve složce `testovaci-data/` jsou smyšlené dokumenty (žádná reálná data), ve složce `test-drive/`
materiály, které v testu představují Google Disk.

**Příprava Disku:**

1. Na Google Disku vytvořte složku např. `Opravy ESD – test` a nahrajte do ní soubory
   ze složky `test-drive/` (`Seznam zprostředkovatelů 2026.csv`, `Adresy poboček.txt`,
   složku `Směrnice` a `podpis.png`). Soubor `_metadata.json` nenahrávejte.
2. V `konfigurace.ts` nastavte `disk.slozka: 'Opravy ESD – test'` (viz [Nastavení](#5-nastavení)).
3. Spusťte Diagnostiku – Disk i Podpis musí být zelené.

**Test:**

1. **Nová intervence** → nahrajte `smlouva.pdf`, jako ESD `esd-1-zaznam.pdf` a `esd-2-plna-moc.pdf`,
   jako intervenci vložte text ze souboru `intervence.txt`.
2. **Pokračovat k dohledání** → **Spustit dohledání**. Očekávaný výsledek (5 bodů):

   | # | Bod | Správně | Zdroj |
   |---|---|---|---|
   | 1 | Datum narození neodpovídá smlouvě | `14. 5. 1985` → `14. 5. 1983`, v **obou** ESD | Smlouva, čl. 1, str. 1 |
   | 2 | V záznamu chybí číslo smlouvy | doplnit `7712345678` za „Číslo smlouvy:“ | Smlouva, str. 1 |
   | 3 | Chybné získatelské číslo | `401234` → `401243` | Disk: Seznam zprostředkovatelů 2026 |
   | 4 | Chybná adresa pobočky | `Masarykova 132/45, 602 00 Brno` → `Masarykova 123/45, 602 00 Brno` | Disk: Adresy poboček |
   | 5 | Chybí podpis klienta na plné moci | ruční úkol (bez opravy) | – |

3. **Schvalování:** kliknutím na bod se v náhledu zvýrazní místo, kliknutím na zdroj se otevře
   smlouva na dané straně nebo soubor na Disku. **Schválit vše** schválí body 1–4.
4. **Stažení:** podpis se načte z Disku, **Vytvořit opravená PDF** → zkontrolujte náhled:
   - škrt vede jednou tenkou čarou středem chybného textu a text zůstává čitelný,
   - oprava je modře vedle (případně nad/pod) textem a hned za ní podpis,
   - nic se nepřekrývá s textem ani s čarami tabulky,
   - čeština (háčky, čárky) je správně.
5. Stáhněte soubory (`esd-1-zaznam_opraveno.pdf`, `esd-2-plna-moc_opraveno.pdf`) i ZIP.

**Další varianty:** intervence jako soubor `intervence.eml` nebo `intervence.docx` (bez vloženého
textu); místo `esd-2-plna-moc.pdf` naskenovaná verze `esd-2-plna-moc-sken.pdf` (text se rozpozná
pomocí OCR – na skenu to trvá pár sekund na stránku).

Když model vrátí jiné výsledky, upravte pokyny v `prompts/intervence.md` (viz [Nastavení](#5-nastavení)).

---

## 4. Jak appku používat

1. **Nová intervence** – nahrajte smlouvu (PDF), ESD (jedno nebo víc PDF) a intervenci
   (vložený text, nebo soubor PDF / obrázek / TXT / e-mail EML / Word DOCX).
   Appka u PDF zkontroluje šifrování a digitální podpis a pozná naskenované stránky.
2. **Dohledání** – appka ukazuje průběh („Hledám na Disku: …“). Při přetížení Gemini
   (chyba 429) nebo vypršení času nabídne **Zkusit znovu**.
3. **Schvalování** – u každého bodu: původní text → oprava, zdroj, jistota a tlačítka
   **Schválit / Upravit / Zamítnout**. Oranžově zvýrazněné body (nízká jistota, konflikt zdrojů,
   chybějící oprava nebo nenalezené místo) **Schválit vše** nezahrne – projděte je zvlášť.
   Když appka text v PDF nenajde nebo ho najde víckrát, klikněte **Vybrat místo** a natáhněte
   obdélník přes chybný text (myší nebo prstem). Opravu, kterou appka nenavrhla, přidáte
   tlačítkem **Přidat ruční opravu**. Ruční úkoly (např. chybějící podpis klienta) jsou
   vypsané zvlášť jako seznam.
4. **Stažení** – podpis se načte z Disku (když ne, vyberte ho nebo nahrajte z počítače),
   **Vytvořit opravená PDF**, zkontrolujte náhled, stáhněte. Pak **Dokončit a smazat**.

Rozpracovaná práce se ukládá průběžně. Appku můžete zavřít a později pokračovat
(seznam intervencí na úvodní obrazovce).

---

## 5. Nastavení

Všechno nastavení je v jednom souboru **`konfigurace.ts`** v kořeni projektu. V AI Studiu ho
můžete upravit přímo, nebo agenta požádat (např. *„V konfigurace.ts nastav disk.slozka na
'Materiály ESD'“*).

| Co | Kde v `konfigurace.ts` | Výchozí |
|---|---|---|
| **Složka s materiály na Disku** (název nebo ID; hledá se i v podsložkách) | `disk.slozka` | `''` = celý Disk |
| **Soubor s podpisem** (PNG, název nebo ID) | `disk.podpis` | `'podpis.png'` |
| Velikost podpisu (výška v bodech, 20 ≈ 7 mm) | `vzhled.vyskaPodpisu` | `20` |
| Datum vedle podpisu | `vzhled.datumUPodpisu` | `false` |
| Barva opravy a škrtu, tloušťka škrtu, velikost písma | `vzhled.*` | modrá, 0,7 b, 7–11 b |
| Model Gemini | `gemini.model` | `'gemini-3.8-flash'` |
| Nejvyšší počet hledání na intervenci | `gemini.maxVolaniNastroju` | `15` |
| Způsob práce s nástroji | `gemini.rezimNastroju`, `gemini.volbaNastroju` | `'spolecne'`, `'validated'` |
| Internet (ARES, Google, čtení stránek) | `internet.*` | vše zapnuto |
| Po kolika dnech se rozpracovaná intervence smaže | `ulozeni.smazatPoDnech` | `30` |
| Přípona opraveného souboru | `vystup.priponaSouboru` | `'_opraveno'` |

**Pokyny pro model** (jak rozdělit intervenci, v jakém pořadí hledat, co dělat při konfliktu)
jsou v souboru **`prompts/intervence.md`**. Úpravy se projeví hned při dalším dohledání,
bez zásahu do kódu.

---

## 6. Řešení problémů

| Problém | Co udělat |
|---|---|
| „Gemini je teď přetížené nebo byl vyčerpán limit dotazů“ | Počkat chvíli a **Zkusit znovu**. Na free tieru jsou limity nízké. |
| „Gemini nejde použít: chybí nebo je neplatný klíč“ | V AI Studiu **Nastavení → Secrets** zkontrolovat `GEMINI_API_KEY`. |
| „Gemini dotaz odmítlo: … tool_choice …“ nebo kontrola *Nástroje + JSON* je červená | V `konfigurace.ts` nastavit `gemini.volbaNastroju: 'auto'`; když to nepomůže, `gemini.rezimNastroju: 'dvoukrokove'` (hledání a sestavení výsledku ve dvou krocích). |
| Body z Disku mají „Nenalezeno“ | Diagnostika → Google Disk. Zkontrolovat `disk.slozka` a že jsou materiály v té složce (i v podsložkách). |
| „Google Disk není v appce připojený“ | Provést krok [2.2](#22-zapnutí-google-disku). |
| Při přihlášení „Aplikace není ověřena“ | Rozšířené → Pokračovat (viz 2.2). |
| Podpis se nenašel | Opravit `disk.podpis` (přesný název souboru), nebo podpis vybrat/nahrát ručně v kroku Stažení. Podpis má být PNG, ideálně s průhledným pozadím. |
| U opravy „nenašlo se volné místo“ | Oprava je zakreslená vpravo i přes možné překrytí – zkontrolujte náhled, případně opravu zamítněte a přidejte ruční opravu jinam. |
| Zašifrované PDF | Nahrát verzi bez hesla / bez zabezpečení proti úpravám. |
| Digitálně podepsané ESD | Appka upozorní, že úpravou podpis přestane platit – rozhodnutí je na vás. |
| Appka hlásí „Nepodařilo se uložit“ | Uvolnit místo na disku počítače, nepoužívat anonymní okno, kliknout **Zkusit znovu**. |

---

## 7. Lokální spuštění a testy (pro vývoj)

Potřeba: Node.js 20 nebo novější.

```bash
npm install
npm run dev                     # http://localhost:3000
```

Do souboru `.env.local` (není v gitu) zapište:

- `GEMINI_API_KEY=...` – vlastní klíč, když chcete zkoušet skutečný model,
- nebo bez klíče testovací režim: `MOCK_GEMINI=1` (připravené výsledky pro testovací dokumenty)
  a `MOCK_DISK=1` (místo Google Disku složka `test-drive/`). Testovací režim jde zapnout jen
  lokálně – na serveru v AI Studiu / Cloud Run se tyto proměnné ignorují.

Testy:

```bash
npm run lint             # kontrola typů
npm test                 # jednotkové testy (hledání textu, souřadnice, napojení na Gemini proti falešnému serveru)
npm run test:prohlizec   # testy v prohlížeči po krocích 1–5 (appka musí běžet s MOCK_GEMINI=1 a MOCK_DISK=1)
npm run testovaci-data   # znovu vyrobí testovací dokumenty
```

Testy v prohlížeči používají Chromium přes `playwright-core`. Když ho Playwright nenajde sám,
nastavte cestu v proměnné `CHROMIUM_PATH` (např. po `npx playwright@1.64.0 install chromium-headless-shell`).
Snímky obrazovky a stažená PDF z testů jsou ve složce `test-vystupy/` (není v gitu). Test kroku 4
a 5 kontroluje přímo výsledná PDF: škrt musí sedět na textu s přesností 1,5 bodu (≈ 0,5 mm),
oprava a podpis nesmí překrývat text ani čáry originálu.

Změny na GitHub:

```bash
git add -A
git commit -m "Popis změny"
git push
```

V AI Studiu pak **Nastavení → GitHub → Pull** (stáhnout změny).

---

## 8. Co je kde v projektu

| Soubor / složka | Co obsahuje |
|---|---|
| `konfigurace.ts` | veškeré nastavení |
| `prompts/intervence.md` | pokyny pro model |
| `server.ts` | server (Express + Vite, šablona AI Studia) |
| `server/dohledani/` | dohledání: smyčka nástrojů, napojení na Gemini (`model-gemini.ts`), testovací náhrada (`model-mock.ts`), čtení EML/DOCX |
| `server/nastroje/` | Google Disk (`disk.ts`, jen čtení), náhrada Disku (`disk-mock.ts`), registr ARES |
| `server/podpis.ts`, `server/diagnostika.ts` | podpis z Disku, diagnostika |
| `src/disk/prihlaseni.ts` | místo pro napojení přihlášení k Disku z AI Studia |
| `src/obrazovky/` | obrazovky: seznam, nahrání, dohledání, schvalování, stažení, diagnostika |
| `src/pdf/` | práce s PDF v prohlížeči: náhled, kontrola, hledání textu, OCR |
| `src/schvalovani/` | hledání míst v PDF, karty bodů, výběr místa v náhledu |
| `src/export/` | rozmístění a zakreslení oprav s podpisem (pdf-lib, písmo Noto Sans) |
| `src/ulozeni/` | ukládání rozpracovaných intervencí v prohlížeči (IndexedDB) |
| `testovaci-data/`, `test-drive/` | smyšlené testovací dokumenty a náhrada Disku |
| `scripts/testovaci-data.ts` | generátor testovacích dokumentů |
| `testy/` | jednotkové testy a testy v prohlížeči |
| `PLAN.md` | rozhodnutí a plán projektu |

Písmo Noto Sans (`public/fonty/`) je pod licencí SIL Open Font License (`public/fonty/OFL-NotoSans.txt`).
