import asyncio, os
from playwright.async_api import async_playwright
async def wait_msg(pg, sel, word):
    for _ in range(300):
        t = await pg.inner_text(sel)
        cls = await pg.get_attribute(sel, "class")
        if word in t or "err" in (cls or ""): return
        await asyncio.sleep(0.2)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(accept_downloads=True, viewport={"width":390,"height":844})
        pg = await ctx.new_page()
        errs=[]
        pg.on("pageerror", lambda e: errs.append("PAGEERR "+str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type in("error",) else None)
        await pg.goto("file://"+os.path.abspath("dist/anonymiseur.html"))
        # 1. PDF
        await pg.set_input_files("#file","test/demo.pdf")
        await wait_msg(pg,"#m1","chargé")
        print("M1:", await pg.inner_text("#m1"))
        await pg.click("#analyze")
        await pg.wait_for_selector("#s3:not([hidden])")
        print("M2:", await pg.inner_text("#m2"))
        await pg.click("#run")
        await pg.wait_for_selector("#s4:not([hidden])")
        print("STATS:", (await pg.inner_text("#stats")).replace("\n"," "))
        print("PREVIEW:\n"+await pg.inner_text("#preview"))
        print("BOUTONS:", await pg.locator("#dl-box button").all_inner_texts())
        for i,ext in enumerate(["pdf","docx","txt"]):
            async with pg.expect_download() as d: await pg.locator("#dl-box button").nth(i).click()
            dl=await d.value; await dl.save_as(f"test/pdf_anon.{ext}"); print("DL", dl.suggested_filename)
        async with pg.expect_download() as d: await pg.click("#dl-json")
        await (await d.value).save_as("test/pdf_map.json")
        await pg.click("#save-map"); print("M4:", await pg.inner_text("#m4"))
        # 2. Restauration : table de la session + PDF anonymisé
        await pg.set_input_files("#r-doc","test/pdf_anon.pdf")
        await pg.click("#r-run")
        await wait_msg(pg,"#m5","remplac")
        print("M5:", await pg.inner_text("#m5"))
        print("RESTAURÉ:\n"+await pg.inner_text("#r-preview"))
        print("BOUTONS R:", await pg.locator("#r-dl button").all_inner_texts())
        async with pg.expect_download() as d: await pg.locator("#r-dl button").nth(0).click()
        await (await d.value).save_as("test/pdf_restored.pdf")
        # 3. Recharger la page : la table mémorisée doit rester disponible
        await pg.reload()
        print("TABLES APRÈS RECHARGEMENT:", (await pg.inner_text("#map-choices")).strip())
        await pg.set_input_files("#r-doc","test/pdf_anon.docx")
        await pg.click("#r-run")
        await wait_msg(pg,"#m5","remplac")
        print("M5b:", await pg.inner_text("#m5"))
        print("ERREURS:", errs)
        await b.close()
asyncio.run(main())
