# Cycling FIT Analyzer

Jednoduchá webová appka pro analýzu jízdy z `.fit` souboru.

## Produkce

- Aplikace běží online na: [https://cycling-fit-analyzer.vercel.app](https://cycling-fit-analyzer.vercel.app)

## Co umí

- Upload FIT souboru z exportu Stravy.
- Výpočet základních metrik:
  - průměrná rychlost
  - vzdálenost
  - nastoupané výškové metry
- Nejrychlejší úsek, na kterém je ujetých 100 km:
  - čas
  - průměrná rychlost (zastávky jsou v čase zahrnuté, počítá se elapsed time)
  - download tohoto úseku jako `.fit`
- Nejrychlejší úsek, na kterém je nastoupáno 1609 m:
  - čas
  - ujetá vzdálenost
  - průměrná rychlost
  - download tohoto úseku jako `.fit`
- Zobrazení tras na neklikacích mapách:
  - reálný mapový podklad (OpenStreetMap)
  - celá vyjížďka
  - segment 100 km nad celou trasou
  - segment 1609 m nad celou trasou
- Historie posledních 2 uploadů:
  - na úvodní straně pod uploadem
  - rychlý proklik na výsledkovou obrazovku konkrétní jízdy
  - globální historie napříč zařízeními (uložená na Vercelu)

## Globální historie (Vercel Blob)

Historie se ukládá přes API `/api/history` do Vercel Blob storage.

Je potřeba mít ve Vercelu připojený Blob store k tomuto projektu:

1. `Project -> Storage -> Connect Database -> Blob`
2. Připojit store k projektu (Production)
3. Vercel automaticky doplní `BLOB_READ_WRITE_TOKEN`

Pokud Blob není nastavený, aplikace přepne historii na lokální fallback (IndexedDB jen v daném prohlížeči).

## Lokální spuštění

Frontend můžeš spustit jako statickou stránku, ale globální historie funguje jen při běhu API.

1. Otevři `index.html` v prohlížeči (funguje analýza + lokální historie).
2. Pro plnou funkci s globální historií nasazuj přes Vercel.

Poznámka: pro reálný mapový podklad je potřeba internet (Leaflet + OpenStreetMap tiles).

## Automatický release workflow (Git -> Vercel)

Repo je private, ale Vercel umí auto deploy i z private GitHub repozitáře, pokud je Git integrace autorizovaná.

### Jednorázové nastavení ve Vercelu

1. `Project -> Settings -> Git`
2. Ověř, že je připojené repo `superpiero/cycling-fit-analyzer`
3. `Production Branch` nastav na `main`

Po tomto nastavení:

- push do `main` -> nová produkční verze na Vercelu
- push do jiné branche -> Preview deployment

### Fallback: vynucený deploy přes GitHub Actions

Pokud se změny na Vercelu neobjevují, použij deploy hook:

1. Ve Vercelu otevři `Project -> Settings -> Git -> Deploy Hooks`
2. Vytvoř nový hook pro branch `main`
3. V GitHub repozitáři nastav secret `VERCEL_DEPLOY_HOOK_URL` s hodnotou hook URL:
   - `Settings -> Secrets and variables -> Actions -> New repository secret`
4. Workflow [`vercel-deploy-hook.yml`](./.github/workflows/vercel-deploy-hook.yml) na každý push do `main` zavolá hook a vynutí nový deploy

### Automatické nahrání nové verze jedním příkazem

Použij skript:

```bash
./scripts/release.sh "krátký popis změny"
```

Skript udělá:

1. `git add -A`
2. `git commit -m "..."`
3. `git push origin main`
