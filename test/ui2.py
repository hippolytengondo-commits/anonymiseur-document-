"""Parcours complet (PDF) : import, contrôle, export, coffre chiffré, restauration. Chrome + Playwright."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
fails = []
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: fails.append(m)
async def wait_msg(pg, sel, word):
    for _ in range(300):
        t = await pg.inner_text(sel); cls = await pg.get_attribute(sel, "class")
        if word in t or "err" in (cls or ""): return
        await asyncio.sleep(0.2)
PW = "Phrase-test-1234"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        ctx = await b.new_context(accept_downloads=True, viewport={"width": 390, "height": 844}, locale="fr-FR")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto("file://" + os.path.abspath("dist/anonymiseur.html"))
        await pg.evaluate("location.hash='#/anonymize'")
        await pg.set_input_files("#file", "test/demo.pdf")
        await wait_msg(pg, "#m1", "chargé")
        check("chargé" in await pg.inner_text("#m1"), "PDF chargé")
        await pg.click("#analyze"); await pg.wait_for_selector("#s3:not([hidden])")
        await pg.click("#run"); await pg.wait_for_selector("#s4:not([hidden])")
        stats = (await pg.inner_text("#stats")).replace("\n", " ")
        prev = await pg.inner_text("#preview")
        check("0 occurrence(s) résiduelle(s)" in stats, "aucune occurrence résiduelle : " + stats)
        check("Alpha Conseil" not in prev and "Paul Dupont" not in prev, "aperçu sans identité d'origine")
        check("Société A" in prev and "[E-MAIL 1]" in prev, "désignations présentes")
        check("pseudonymis" in (await pg.inner_text("#s4")).lower(), "avertissement de pseudonymisation affiché")
        btn = await pg.locator("#dl-box button").all_inner_texts()
        check(btn == ["Document PDF (.pdf)", "Version Word (.docx)", "Texte (.txt)"], "boutons d'export : " + str(btn))
        for i, ext in enumerate(["pdf", "docx", "txt"]):
            async with pg.expect_download() as d: await pg.locator("#dl-box button").nth(i).click()
            await (await d.value).save_as(f"test/pdf_anon.{ext}")
        async with pg.expect_download() as d: await pg.click("#dl-json")
        await (await d.value).save_as("test/pdf_map.json")
        m = json.load(open("test/pdf_map.json", encoding="utf-8"))
        check(len(m["entries"]) >= 5 and all(e["values"] for e in m["entries"]), "table .json valide")
        async with pg.expect_download() as d: await pg.click("#dl-csv")
        await (await d.value).save_as("test/pdf_map.csv")
        check(open("test/pdf_map.csv", encoding="utf-8-sig").read().startswith('"Désignation";"Type"'), "table .csv valide")
        # coffre chiffré
        await pg.click("#save-map")
        await pg.fill("#pp-pass", PW); await pg.fill("#pp-confirm", PW); await pg.click("#pp-ok")
        await pg.wait_for_selector("#pp-form", state="detached")
        await wait_msg(pg, "#m4", "coffre")
        check("coffre" in await pg.inner_text("#m4"), "table enregistrée dans le coffre")
        ls = await pg.evaluate("JSON.stringify(Object.entries(localStorage))")
        check("Alpha" not in ls and "Dupont" not in ls, "aucune identité en clair dans le stockage du navigateur")
        # restauration (table de session)
        await pg.evaluate("location.hash='#/restore'")
        await pg.set_input_files("#r-doc", "test/pdf_anon.pdf"); await pg.click("#r-run")
        await wait_msg(pg, "#m5", "remplac")
        check("6 désignation(s) remplacée(s)" in await pg.inner_text("#m5"), "restauration PDF : " + await pg.inner_text("#m5"))
        rp = await pg.inner_text("#r-preview")
        check("Alpha Conseil SARL" in rp and "contact@alpha-exemple.test" in rp, "identités restaurées")
        async with pg.expect_download() as d: await pg.locator("#r-dl button").nth(0).click()
        await (await d.value).save_as("test/pdf_restored.pdf")
        # rechargement : coffre verrouillé, puis déverrouillage et restauration depuis le coffre
        await pg.reload()
        await pg.evaluate("location.hash='#/restore'")
        check(await pg.locator("#map-unlock").count() == 1, "coffre verrouillé après rechargement")
        await pg.click("#map-unlock")
        await pg.fill("#pp-pass", "mauvaise-phrase-xx"); await pg.click("#pp-ok")
        await pg.wait_for_selector("#pp-err.err")
        check("incorrecte" in await pg.inner_text("#pp-err"), "phrase incorrecte refusée")
        await pg.fill("#pp-pass", PW); await pg.click("#pp-ok")
        await pg.wait_for_selector("#pp-form", state="detached")
        check(await pg.locator("#map-choices input[value^='vault:']").count() == 1, "table du coffre proposée")
        await pg.set_input_files("#r-doc", "test/pdf_anon.docx"); await pg.click("#r-run")
        await wait_msg(pg, "#m5", "remplac")
        check("6 désignation(s) remplacée(s)" in await pg.inner_text("#m5"), "restauration depuis le coffre : " + await pg.inner_text("#m5"))
        check(errs == [], "aucune erreur de console : " + str(errs))
        await b.close()
asyncio.run(main())
for f in ["pdf_anon.pdf", "pdf_anon.docx", "pdf_anon.txt", "pdf_map.json", "pdf_map.csv", "pdf_restored.pdf"]:
    try: os.remove("test/" + f)
    except OSError: pass
sys.exit(1 if fails else 0)
