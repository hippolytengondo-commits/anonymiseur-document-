# Bibliothèques tierces embarquées (aucun chargement réseau)

| Fichier | Projet | Version | Licence | SHA-256 |
|---|---|---|---|---|
| `pdf.min.mjs`, `pdf.worker.min.mjs` | pdf.js (Mozilla) | — | Apache-2.0 | — |
| `pdf-lib.min.js` | pdf-lib (Andrew Dillon) | — | MIT | — |
| `jszip.min.js` | JSZip (Stuart Knightley et contributeurs) | 3.10.2 | MIT (double licence MIT ou GPL-3.0-ou-ultérieure ; MIT retenue) | 7f839b2d4688b845c105ebf5d2f9803075f91ea0fe72bdaac176c3a04dd3d2c1 |
| `docx-preview.min.js` | docx-preview (Volodymyr Baydalka) | 0.4.1 | Apache-2.0 | c4a133c65a112799e35b143c572dfff9e923a3bf39b5fd3b07a06aa0f8f530c2 |

`jszip.min.js` et `docx-preview.min.js` proviennent des archives npm `jszip@3.10.2` et `docx-preview@0.4.1`, dont l'intégrité (SHA-512) a été vérifiée par rapport au registre npm. Ils servent au « PDF fidèle » : le Word anonymisé est affiché localement puis enregistré en PDF par l'impression du navigateur.
