# Cycling FIT Analyzer

Jednoducha web appka pro analyzu jizdy z `.fit` souboru.

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
  - segment 100 km nad celou trasou (pro lepsi orientaci)
  - segment 1609 m nad celou trasou (pro lepsi orientaci)

## Spusteni

Je to staticka appka, staci otevrit [index.html](/Users/pierosestak/Library/Mobile Documents/com~apple~CloudDocs/Codex/index.html) v prohlizeci.

Alternativne lze pustit lokalni server (napr. `python -m http.server`) a otevrit `http://localhost:8000`.

Poznamka: pro realny mapovy podklad je potreba internet (Leaflet + OpenStreetMap tiles).
