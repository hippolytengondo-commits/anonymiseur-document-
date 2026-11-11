#!/usr/bin/env bash
# Exécute toute la suite de tests en local (nécessite Node, Python avec playwright, python-docx, reportlab, et Chrome).
set -euo pipefail
cd "$(dirname "$0")/.."
node build.js
python3 test/make_docx.py
python3 test/make_rich_docx.py
python3 test/make_pdf.py
node test/unit.js
node test/intl.js
node test/run.js > /dev/null
python3 test/ui2.py
python3 test/ui3.py
rm -f test/demo.docx test/demo.pdf test/anon.docx test/restored.docx test/rich.docx test/_logo.png test/_faithful.pdf
echo "Tous les tests ont réussi."
