# Veille équipe

Site statique mis à jour automatiquement (lun–ven, 6h UTC) : collecte RSS → analyse LLM (score, thèmes, résumé FR, action à retenir) → publication GitHub Pages.

## Mise en route
1. Créez un dépôt GitHub, poussez ce dossier sur `main`.
2. Settings → Pages → Source : **GitHub Actions**.
3. Lancez le workflow **Veille** (Actions → Run workflow).

Sans configuration, l'analyse utilise **GitHub Models** (via `GITHUB_TOKEN`). Pour un autre fournisseur compatible OpenAI : secret `LLM_API_KEY`, variables `LLM_BASE_URL` et `LLM_MODEL`.

## Personnaliser
- `sources.json` : sujets et flux RSS.
- `scripts/update.js` : `MIN_SCORE` (seuil de pertinence), `MAX_AGE_DAYS`, `MAX_NEW_PER_RUN`.

## En local
`npm install && npm run update && npm run serve`
