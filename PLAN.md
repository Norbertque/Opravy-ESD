# Plán – appka „Opravy ESD"

Appka pomáhá vyřídit intervenci k smluvní dokumentaci (ESD). Uživatel nahraje smlouvu, ESD a intervenci. Appka rozdělí intervenci na body, ke každému dohledá správný údaj, nechá ho schválit a do kopie ESD opravu zakreslí: škrtne chybný text, vedle napíše opravu a připojí podpis. Sama chyby nehledá, řeší jen to, co je v intervenci.

Kód píšeme tady. Kolega si appku naimportuje z GitHubu do **svého** Google AI Studia a tam se doladí. Gemini klíč i přihlášení na Disk zajistí jeho účet.

## Rozhodnutí

| Téma | Rozhodnutí |
|---|---|
| Základ | Kostru píšeme sami podle šablony full-stack appky z AI Studia (React + Vite + Express server v `server.ts`). |
| Kde appka běží | V kolegově AI Studiu, pod jeho Google účtem. |
| Gemini | Volá se jen ze serveru klíčem `GEMINI_API_KEY`, který nastaví AI Studio. Kolegův účet musí mít **placený tier**, jinak Google smí data použít ke zlepšování produktů. Dokud tier není placený, nenahrávat skutečné smlouvy. |
| Model | `gemini-3.8-flash` (nejnovější stabilní Flash). Přepíná se v konfiguraci. |
| Lokální vývoj | Bez Gemini klíče. Gemini i Disk nahrazují mocky. Naostro se dohledání ověří až v AI Studiu podle checklistu v README. K tomu slouží i `/api/diagnostika`. |
| Disk | Integrace AI Studia: „Sign in with Google" (Firebase), oprávnění `drive.readonly`. Přístupový token je jen v paměti prohlížeče, server ho dostává s každým dotazem a nikam ho neukládá. Po znovuotevření appky se kolega znovu přihlásí. Může se objevit varování „aplikace není ověřena", jde odkliknout. |
| Přístup k Disku v kódu | Jeden serverový modul se třemi funkcemi: hledat ve složce, přečíst soubor, stáhnout podpis. Lokálně za ním je složka `test-drive/`. V AI Studiu ho napojí připravený prompt z README. |
| Internet | Nejdřív registr ARES (firmy: IČO, název, sídlo), pak Google Search a URL context. Do dotazů na internet se nesmí dostat osobní údaje. |
| Zpracování PDF | V prohlížeči: náhled, hledání textu, OCR, kontrola volného místa, kreslení, ZIP. Server jen volá Gemini, Disk a ARES. |
| Zařízení | Primárně 14" notebook (od cca 1280×720), náhled vlevo a karty vpravo. Ovládání musí jít i dotykem. |
| Ukládání | Automaticky po každé změně v prohlížeči (IndexedDB), včetně PDF a rozhodnutí. Na serveru nic. Úvodní obrazovka zobrazí seznam rozpracovaných intervencí. „Dokončit a smazat" po stažení. Intervence bez úprav 30 dní se smaže sama, s upozorněním předem. |
| Nastavení | Jeden konfigurační soubor (složka na Disku, podpis, vzhled, model, limity). Kolega nemá obrazovku nastavení. Když se podpis nenajde, nechá se vybrat ručně. |
| Bod na víc místech | Bod má seznam **výskytů**. Každý výskyt má vlastní škrt, opravu a podpis. Schvaluje se za celý bod. |
| Vstupy intervence | Vložený text, PDF, obrázek, TXT, DOCX (text), EML (text zprávy + přílohy). |
| Soubory u Google | Soubory nahrané přes Files API se smažou hned po dohledání (jinak je Google smaže sám po 48 h). |

## Jak to bude fungovat

1. **Nahrání:** smlouva (PDF), ESD (1 a více PDF), intervence (text nebo soubor). Šifrované PDF appka odmítne srozumitelnou hláškou. U digitálně podepsaného PDF upozorní, že úpravou podpis přestane platit.
2. **Dohledání (server):** Gemini dostane smlouvu, ESD a intervenci jako dokumenty a systémové instrukce z `prompts/intervence.md`. Má k dispozici nástroje `drive_search`, `drive_read`, `ares_hledej`, Google Search a URL context. Nejvýš 15 volání nástrojů na intervenci. Průběh se ukazuje živě („Hledám na Disku: …"). Výsledek přijde jako JSON podle schématu níže. Při chybě 429 nebo timeoutu se zobrazí česká hláška a tlačítko Zkusit znovu.
3. **Schvalování:** náhled ESD přes pdf.js a vedle karty bodů. Kliknutí na bod zvýrazní výskyt v PDF. Kliknutí na zdroj otevře smlouvu na dané straně, nebo odkaz na Disk či web. Na kartě jsou tlačítka Upravit a Zamítnout, nahoře Schválit vše. Body s nízkou jistotou, konfliktem nebo prázdnou opravou jsou zvýrazněné a Schválit vše je nezahrne. Ruční body se jen vypíšou jako úkoly. Ruční opravu jde přidat označením textu nebo tažením obdélníku. Když se text nenajde nebo se najde víckrát, uživatel klikne na správné místo.
4. **Export:** škrtnutí jednou tenkou čarou přes střed textu. Oprava modře vpravo, hned za ní podpis (PNG z Disku). Když vpravo není místo, zkusí se místo nad textem, pak pod ním, nakonec okraj stránky se spojovací čarou. Volné místo se ověřuje podle textové vrstvy i podle vyrenderované stránky. Doplnění je bez škrtu. Kreslí se přímo do obsahu stránky písmem Noto Sans (čeština). Výstup se jmenuje `<název>_opraveno.pdf`, víc souborů jde stáhnout i jako ZIP. Originály se nemění.
5. **OCR:** stránky bez textové vrstvy projde tesseract.js s češtinou a použijí se souřadnice slov.

### Výstup dohledání (JSON)

Pro každý bod: `bod_intervence` (doslova), `typ` (oprava / doplneni / rucne), `vyskyty[]` (každý: `soubor`, `strana` od 1, `presny_text`, `kontext_pred`, `kontext_za`), `oprava`, `zdroj_typ` (smlouva / disk / web), `zdroj_odkaz`, `zdroj_strana` (strana smlouvy, je-li zdrojem smlouva), `konflikt` (ano/ne), `zduvodneni` (u nenalezeného údaje i kde se hledalo), `jistota` (vysoka / stredni / nizka).

U doplnění je `presny_text` text, za který se dopisuje.

## Kroky

Po každém kroku následuje krátké shrnutí, co funguje, a push na GitHub.

1. **Kostra, nahrání a náhled:** struktura podle AI Studia, nahrání souborů, kontrola šifrování a digitálního podpisu, náhled pdf.js, ukládání do IndexedDB a seznam intervencí.
2. **Rozdělení intervence a dohledání:** serverová smyčka nad Gemini (Interactions API, `@google/genai`), nástroje, JSON schéma, živý průběh, mock Gemini, mock Disku a ARES. Čtení EML a DOCX.
3. **Schvalování:** hledání textu v textové vrstvě (normalizace mezer, nezlomitelných mezer, dělení slov, text přes víc řádků), karty, zvýraznění, ruční výběr místa a ruční oprava.
4. **Export s podpisem:** převod souřadnic z pdf.js do pdf-lib (otočení, CropBox, různé rozměry) s testy, umístění opravy, kontrola volného místa, kreslení, podpis, ZIP.
5. **OCR:** tesseract.js s češtinou pro naskenované stránky.
6. **Testy a README:** syntetické testovací dokumenty, automatické testy, test v prohlížeči. České README: lokální spuštění, GitHub, import do AI Studia, prompt pro napojení Disku, kontrola placeného tieru, diagnostika, checklist, kde je nastavení.

## Testovací data (vše smyšlené)

- Smlouva (PDF).
- ESD ze dvou PDF.
- Intervence s 5 body: dva vyřešitelné ze smlouvy, dva z `test-drive/`, jeden ruční.
- Podpis jako PNG.
- Naskenovaná (rastrová) verze jednoho ESD.

## Hotovo, když

- na testovacích dokumentech se vyřeší všechny body se správným zdrojem (lokálně s mockem, naostro v AI Studiu podle checklistu),
- škrtnutí sedí přesně na textu,
- oprava ani podpis se nepřekrývají s ničím na stránce,
- čeština se vykreslí správně,
- originály zůstanou beze změny,
- appka jde ovládat na 14" notebooku i dotykem.

## Rizika

- Kombinace vestavěných nástrojů (Google Search) s vlastními funkcemi a JSON výstupem je u Gemini 3 zatím ve zkušebním režimu (preview). Kód proto umí i záložní dvoukrokový režim: nejdřív hledání, pak sestavení výsledku. Přepíná se v konfiguraci.
- Dokumentace neuvádí, jestli jde v odpovědi nástroje modelu vrátit PDF. Když ne, `drive_read` u PDF vrátí vytažený text.
- Kód integrace Disku, který vygeneruje AI Studio, se může lišit od zjištěného vzoru. Prompt v README proto popisuje, co se má napojit, ne jak přesně.
