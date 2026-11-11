# Génère test/rich.docx : lettre fictive avec mise en forme (titre, gras, italique, couleur, liste, tableau, en-tête, pied de page, image).
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import struct, zlib
def png(path, w=120, h=40):
    raw = b"".join(b"\x00" + bytes([30, 80, 160] * w) for _ in range(h))
    def chunk(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
png("test/_logo.png")
d = Document()
sec = d.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.5); sec.top_margin = Cm(2.5); sec.bottom_margin = Cm(2)
sec.header.paragraphs[0].text = "Cabinet Exemple & Associés — Confidentiel — Alpha Conseil SARL"
sec.footer.paragraphs[0].text = "Page de démonstration — contact@alpha-exemple.test"
d.add_picture("test/_logo.png", width=Cm(3))
t = d.add_paragraph(); r = t.add_run("CONVENTION DE SERVICES"); r.bold = True; r.font.size = Pt(18); r.font.color.rgb = RGBColor(0x1F, 0x3A, 0x6E)
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
p = d.add_paragraph()
p.add_run("Entre la société ").font.size = Pt(11)
b = p.add_run("Alpha Conseil SARL"); b.bold = True
p.add_run(", représentée par Monsieur Paul Dupont, et ")
i = p.add_run("Beta Industries SA"); i.italic = True
p.add_run(", il est convenu ce qui suit. ")
u = p.add_run("Texte souligné."); u.underline = True
p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
p.paragraph_format.space_after = Pt(12); p.paragraph_format.line_spacing = 1.5
d.add_paragraph("Premier engagement : livraison des documents.", style="List Bullet")
d.add_paragraph("Second engagement : confidentialité totale.", style="List Bullet")
d.add_paragraph("Étape numérotée un.", style="List Number")
d.add_paragraph("Étape numérotée deux.", style="List Number")
tb = d.add_table(rows=3, cols=3); tb.style = "Table Grid"
for ci, h in enumerate(["Désignation", "Responsable", "Échéance"]):
    c = tb.rows[0].cells[ci]; c.text = h
    for r_ in c.paragraphs[0].runs: r_.bold = True
    sh = OxmlElement("w:shd"); sh.set(qn("w:val"), "clear"); sh.set(qn("w:fill"), "D9E2F3"); c._tc.get_or_add_tcPr().append(sh)
rows = [("Audit", "Anne Martin", "1 janvier 2030"), ("Rapport", "Paul Dupont", "15 février 2030")]
for ri, row in enumerate(rows, start=1):
    for ci, v in enumerate(row): tb.rows[ri].cells[ci].text = v
r2 = d.add_paragraph().add_run("Signature de Monsieur Paul Dupont — Madame Anne Martin"); r2.font.name = "Times New Roman"; r2.font.size = Pt(12)
for _ in range(30): d.add_paragraph("Ligne de remplissage pour provoquer une seconde page — Alpha Conseil SARL.")
d.save("test/rich.docx")
