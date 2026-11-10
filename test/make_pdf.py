# Génère test/demo.pdf (contenu entièrement fictif) pour les tests d'interface.
from reportlab.pdfgen import canvas
c = canvas.Canvas("test/demo.pdf")
y = 800
for line in ["Contrat entre Alpha Conseil SARL, representee par Monsieur Paul Dupont,",
             "et Beta Industries SA. Contact : contact@alpha-exemple.test.",
             "Madame Anne Martin verse 1 000 000 USD avant le 1 janvier 2030.",
             "IBAN CD00 0000 0000 0000 0000."]:
    c.drawString(60, y, line); y -= 22
c.save()
