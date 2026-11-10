from docx import Document
d = Document()
d.core_properties.author = "Auteur Fictif"
d.core_properties.title = "Contrat Alpha Conseil SARL"
d.sections[0].header.paragraphs[0].text = "Confidentiel — Alpha Conseil SARL — contact@alpha-exemple.test"
p = d.add_paragraph()
p.add_run("Entre la société Alpha Con").bold = True
p.add_run("seil SARL, représentée par Monsieur Paul Dupont, et Beta Industries SA, ")
p.add_run("RCCM CD/XXX/RCCM/00-B-0000").italic = True
d.add_paragraph("Madame Anne Martin (tél. +243 80 000 0000) verse 1 000 000 USD à Alpha Conseil avant le 1 janvier 2030.")
d.add_paragraph("DUPONT Paul signe au nom du Cabinet Exemple & Associés. Écrire à contact@exemple.test ; IBAN CD00 0000 0000 0000 0000.")
d.save("test/demo.docx")
