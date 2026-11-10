# Anonymiseur de documents — instructions du projet

Application web **100 % locale** (un seul fichier HTML) qui anonymise des documents confidentiels (PDF, Word, texte) en remplaçant noms, sociétés et données identifiantes par « Société A », « Personne B », « [E-MAIL 1] »… puis restaure les noms d'origine à partir d'une table de correspondance.

## Règles impératives
- Aucune donnée ne doit jamais quitter l'appareil : pas de requête réseau, pas d'analytique, pas de CDN. La CSP de `src/template.html` l'interdit ; ne pas l'assouplir. Seule exception validée : `manifest-src 'self'` et `worker-src 'self'` (installation PWA, mise en cache des seuls fichiers du site, aucune requête externe).
- Utiliser **uniquement des noms fictifs** dans les exemples, tests et documentation (Alpha Conseil SARL, Beta Industries, Jean Exemple…). Ne jamais mettre de noms réels de clients ou de contrats.
- Ne jamais déposer dans ce dépôt un document réel ni une table de correspondance (.json).
- Interface et messages en français, ton très professionnel.

## Structure
- `src/engine.js` : lecture/écriture .docx (ZIP maison), détection, remplacement, génération Word.
- `src/app.js` : interface (import PDF/Word/texte, contrôle, export, restauration, PDF via pdf.js et pdf-lib).
- `src/template.html` : page et styles. `vendor/` : pdf.js, worker et pdf-lib embarqués.
- `build.js` : assemble tout dans `index.html` (`node build.js` — dist/anonymiseur.html puis copier en `index.html`) et génère `manifest.webmanifest` et `sw.js` (versionné par empreinte) à la racine et dans `dist/`.
- `src/manifest.webmanifest`, `src/sw.js`, `src/icons/` : application installable (PWA) sur téléphone et ordinateur. Publier ensemble `index.html`, `manifest.webmanifest` et `sw.js`.
- `test/` : `run.js` (moteur, Node) et `ui2.py` (interface, Playwright + Chrome).

## Déploiement (GitHub Pages)
- Le fichier publié est `index.html` à la racine. Workflow : `.github/workflows/pages.yml`.
- Réglage à faire une fois : Settings → Pages → Source : **GitHub Actions**. Adresse : https://hippolytengondo-commits.github.io/anonymiseur-document-/
- Après toute modification : `node build.js`, copier `dist/anonymiseur.html` vers `index.html`, commit, push.

## Pistes d'amélioration
- OCR pour les PDF numérisés (hors ligne), conservation de la mise en page PDF, glossaire de noms réutilisable.
