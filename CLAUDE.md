# ANONYX — instructions du projet

Application web **100 % locale** (PWA, un seul fichier HTML) qui pseudonymise des documents confidentiels (PDF, Word, texte) en remplaçant noms, sociétés et données identifiantes par « Société A », « Personne B », « [E-MAIL 1] »… puis restaure les noms d'origine à partir d'une table de correspondance. Signature : « Protect identities. Preserve information. »

## Règles impératives
- Aucune donnée ne doit jamais quitter l'appareil : pas de requête réseau, pas d'analytique, pas de CDN. La CSP de `src/template.html` l'interdit ; ne pas l'assouplir. Seule exception validée : `manifest-src 'self'` et `worker-src 'self'` (installation PWA, mise en cache des seuls fichiers du site, aucune requête externe).
- Utiliser **uniquement des noms fictifs** dans les exemples, tests et documentation (Alpha Conseil SARL, Beta Industries, Jean Exemple…). Ne jamais mettre de noms réels de clients ou de contrats.
- Ne jamais déposer dans ce dépôt un document réel ni une table de correspondance (.json).
- **Pseudonymisation ≠ anonymisation** : tant qu'une table de correspondance existe, l'opération est réversible. Ne jamais présenter un résultat comme « irréversiblement anonymisé ».
- **Les tables de correspondance ne sont conservées que chiffrées** (coffre : AES-256-GCM, clé PBKDF2 ≥ 600 000 itérations, clé en mémoire uniquement). Aucune identité, aucun contenu de document, aucun nom de fichier (sauf option explicite) dans `localStorage`. Pas de stockage ni de synchronisation distants sans validation.
- Identité visuelle : logo officiel fourni par le propriétaire (bouclier + A), `src/brand/`. Ne pas le redessiner. Palette : #101827, #1769AA, #39B9FF, #E9F1F8. Pas de statistique inventée : les indicateurs viennent des données réelles de l'appareil.
- Interface **bilingue FR/EN** : tout texte visible passe par `t('clé')` (`src/i18n.js`). Le build échoue si une clé manque dans une langue. Ton très professionnel.

## Structure
- `src/engine.js` : lecture/écriture .docx (ZIP maison), détection, remplacement, génération Word, désignations FR/EN. Moteur éprouvé : ne le modifier qu'avec tests.
- `src/i18n.js` : dictionnaire `[clé, français, anglais]`, `t()`, `applyI18n()`.
- `src/store.js` : préférences, historique (métadonnées), journal, coffre chiffré, neutralisation CSV.
- `src/app.js` : espace d'anonymisation et de restauration (import PDF/Word/texte, contrôle, export, PDF via pdf.js et pdf-lib).
- `src/ui.js` : coque (menu latéral / barre mobile), tableau de bord, documents, correspondances, activités, sécurité, abonnement (maquette), profil, fenêtres.
- `src/template.html` : page, système de design (variables CSS). `vendor/` : pdf.js, worker et pdf-lib embarqués. `src/brand/`, `src/icons/` : logo et icônes.
- `src/manifest.webmanifest`, `src/sw.js` : application installable (PWA) et mode hors ligne (cache versionné par empreinte).
- `build.js` : assemble tout (`node build.js`) → `index.html`, `manifest.webmanifest`, `sw.js` à la racine, `dist/`. Vérifie les traductions.
- `test/` : `unit.js` et `run.js` (Node), `ui2.py` (parcours PDF) et `ui3.py` (espaces, coffre, FR/EN, mobile, hors ligne) en Playwright + Chrome, `run_all.sh` pour tout exécuter. Fixtures : `make_docx.py`, `make_pdf.py`.

## Déploiement (GitHub Pages)
- Publié : `index.html`, `manifest.webmanifest`, `sw.js` (dossier `_site` assemblé par le workflow). Workflow : `.github/workflows/pages.yml` (tests, puis déploiement uniquement depuis `main`).
- Réglage à faire une fois : Settings → Pages → Source : **GitHub Actions**. Adresse : https://hippolytengondo-commits.github.io/anonymiseur-document-/
- Après toute modification : `node build.js`, lancer `test/run_all.sh`, commit (y compris `index.html`, `manifest.webmanifest`, `sw.js` régénérés), push. La CI refuse un `index.html` qui ne correspond pas aux sources.

## Pistes d'amélioration
- OCR pour les PDF numérisés (hors ligne), conservation de la mise en page PDF, glossaire de noms réutilisable, détection pour documents en anglais, comptes et licences (nécessitent un serveur : décision à valider).
