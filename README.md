# Cycling FIT Analyzer

Jednoducha web appka pro analyzu jizdy z `.fit` souboru.

## Produkce

- Aplikace bezi online na: [https://cycling-fit-analyzer.vercel.app](https://cycling-fit-analyzer.vercel.app)

## Co umi

- Upload FIT souboru z exportu Stravy.
- Vypocet zakladnich metrik:
  - prumerna rychlost
  - vzdalenost
  - nastoupane vyskove metry
- Nejrychlejsi usek, na kterem je ujetych 100 km:
  - cas
  - prumerna rychlost (zastavky jsou v case zahrnute, protoze se pocita realny elapsed time z timestampu)
  - download tohoto useku jako `.fit`
- Nejrychlejsi usek, na kterem je nastoupano 1609 m:
  - cas
  - ujetou vzdalenost
  - prumernou rychlost
  - download tohoto useku jako `.fit`
- Zobrazeni tras na neklikacich mapach:
  - realny mapovy podklad (OpenStreetMap)
  - cela vyjizdka
  - segment 100 km nad celou trasou
  - segment 1609 m nad celou trasou

## Lokalni spusteni

Je to staticka appka:

1. Otevri `index.html` v prohlizeci.
2. Nebo pust lokalni server (napr. `python -m http.server`) a otevri `http://localhost:8000`.

Poznamka: pro realny mapovy podklad je potreba internet (Leaflet + OpenStreetMap tiles).

## Automaticky release workflow (Git -> Vercel)

Repo je private, ale Vercel umi auto deploy i z private GitHub repozitare, pokud je Git integrace autorizovana.

### Jednorazove nastaveni ve Vercelu

1. `Project -> Settings -> Git`
2. Over, ze je pripojene repo `superpiero/cycling-fit-analyzer`.
3. `Production Branch` nastav na `main`.

Po tomto nastaveni:

- push do `main` -> nova produkcni verze na Vercelu
- push do jine branche -> Preview deployment

### Automaticke nahrani nove verze jednim prikazem

Pouzij skript:

```bash
./scripts/release.sh "kratky popis zmeny"
```

Skript udela:

1. `git add -A`
2. `git commit -m "..."`
3. `git push origin main`
