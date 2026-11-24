# בדיקות רגרסיה לדף (דפדפן אוטומטי). הרצה: python3 tests/client_test.py  (מתוך תיקיית המאגר)
import asyncio, base64, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://localhost:8765/"
OUT = os.environ.get("OUT", "/tmp/v31")
os.makedirs(OUT, exist_ok=True)
URI = {"company":"אורי כלפה","companyId":"024592693","deductions":"904105525","address":"עירית 1, קריית שמונה","signer":"אורי כלפה"}
PRESET = "#s=" + base64.urlsafe_b64encode(json.dumps(URI, ensure_ascii=False).encode()).decode().rstrip("=")
results = []
def check(name, cond, info=""):
    results.append((name, bool(cond), info)); print(("✓ " if cond else "✗ ") + name + (f"  [{info}]" if info and not cond else ""))

async def sign(pg, sel):
    await pg.eval_on_selector(sel, "e => e.scrollIntoView({block:'center'})"); await pg.wait_for_timeout(200)
    b = await pg.locator(sel).bounding_box(); x,y,w,h = b["x"],b["y"],b["width"],b["height"]
    await pg.mouse.move(x+w*.2, y+h*.6); await pg.mouse.down()
    for i in range(1,14): await pg.mouse.move(x+w*(.2+i*.045), y+h*(.6-(i%3)*.17))
    await pg.mouse.up()

async def employer(pg, mode="new", f101="print", wage="40", sev="6", days=True, weekly=None, extra=None, confirm=True, sign_it=True):
    await pg.goto("about:blank"); await pg.goto(BASE + PRESET); await pg.wait_for_timeout(400)
    await pg.click(f"label:has(input[name=mode][value={mode}])")
    if mode == "new": await pg.click(f"label:has(input[name=f101][value={f101}])")
    vals = {"ephone":"0501234567","ownerEmail":"uri@example.com","empName":"ישראל בדיקה","empPhone":"0500000000","role":"עובד דלפק","wage":wage,"pensionFund":"מגדל מקפת"}
    if mode == "new": vals["start"] = "2026-12-01"
    else: vals.update({"effDate":"2027-01-01","origStart":"2026-12-01","changeText":"השכר השעתי עולה מ-40 ל-43 ₪"})
    if extra: vals.update(extra)
    for k,v in vals.items(): await pg.fill("#"+k, v)
    if days: await pg.click("#fillWeek")
    if weekly: await pg.fill("#weeklyHours", weekly)
    await pg.select_option("#sevPct", sev)
    if confirm: await pg.check("#confirm")
    if sign_it: await sign(pg, "#sigEmp")

async def make_link(pg):
    await pg.click("#makeLink"); await pg.wait_for_timeout(600)
    return (await pg.text_content("#linkTxt") or "").strip()

async def employee(pg, link, gender="נקבה", marital="רווק/ה", kids=None, other="none", coord="none", credits=("c1",), answers=None):
    """answers: list of True/False for modal dialogs in order"""
    await pg.goto("about:blank"); await pg.goto(link); await pg.wait_for_timeout(500)
    await pg.click("#go")
    for k,v in {"idNum":"000000018","birth":"1990-05-05","phone":"0500000000","email":"emp@example.com","street":"הרצל","house":"12","city":"קריית שמונה","zip":"1101101","bank":"12","branch":"718","account":"123456"}.items():
        el = pg.locator("#"+k)
        if await el.is_visible(): await el.fill(v)
    if await pg.locator("label:has(input[name=gender])").first.is_visible(): await pg.click(f"label:has(input[name=gender][value='{gender}'])")
    await pg.click("#next"); await pg.wait_for_timeout(300)
    await pg.check("#agree"); await sign(pg, "#sigE"); await pg.click("#next"); await pg.wait_for_timeout(400)
    return pg

async def fill101(pg, marital="רווק/ה", kids=None, other="none", coord="none", credits=("c1",), answers=None):
    await pg.click(f"label:has(input[name=marital][value='{marital}'])")
    await pg.click(f"label:has(input[name=hasKids][value={'yes' if kids else 'no'}])")
    if kids:
        for i,k in enumerate(kids):
            if i: await pg.click("#addKid")
            c = pg.locator("#kids .kidcard").nth(i)
            await c.locator("[data-k=name]").fill(k[0]); await c.locator("[data-k=id]").fill(k[1]); await c.locator("[data-k=birth]").fill(k[2])
    await pg.click(f"label:has(input[name=otherInc][value={other}])")
    if other == "yes": await pg.check("[data-oi=om]"); await pg.click("label:has(input[name=credHere][value=other])")
    for c in ("c1",):
        if c not in credits and await pg.is_checked(f"[data-cr={c}]"): await pg.uncheck(f"[data-cr={c}]")
    for c in credits:
        if not await pg.is_checked(f"[data-cr={c}]"): await pg.check(f"[data-cr={c}]")
    await pg.click(f"label:has(input[name=coord][value={coord}])")
    if coord == "more":
        await pg.fill("#co0n","מעסיק קודם"); await pg.fill("#co0m","4000"); await pg.fill("#co0x","100")
    dialogs = []
    await pg.click("#next")
    for ans in (answers or []):
        await pg.wait_for_timeout(300)
        box = pg.locator("#askModal")
        if await box.count():
            dialogs.append(await box.inner_text())
            await box.locator(f"[data-a='{1 if ans else 0}']").click()
            if ans is True and "סעיף 8" in dialogs[-1]: pass
    await pg.wait_for_timeout(400)
    return dialogs

async def finish_print(pg):
    await pg.set_input_files("input[data-kind=id]", "/tmp/test_id.jpg"); await pg.wait_for_timeout(500)
    await pg.check("#decl"); await pg.click("#next")

async def wait_docs(pg, n):
    for i in range(90):
        st = await pg.text_content("#pdfState")
        if st and "מכין" not in st: break
        await pg.wait_for_timeout(1000)
    return await pg.evaluate("DOCS.map(d => ({f:d.fname, s:d.blob.size}))")

async def save_docs(pg, prefix):
    names = await pg.evaluate("DOCS.map(d => d.fname)")
    for i in range(len(names)):
        b64 = await pg.evaluate(f"new Promise(r => {{ const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(DOCS[{i}].blob); }})")
        open(f"{OUT}/{prefix}_{i+1}.pdf","wb").write(base64.b64decode(b64))
    return names

def pdf_pages(path):
    out = subprocess.run(["pdfinfo", path], capture_output=True, text=True).stdout
    return int([l for l in out.splitlines() if l.startswith("Pages:")][0].split()[1])

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
            ctx = await b.new_context(viewport={"width":400,"height":860}, accept_downloads=True)
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))

            # ---------- מעסיק: בקרות ----------
            await employer(pg)
            await pg.fill("[data-day='6']", "10:00-14:00")   # עבודה ביום המנוחה
            link = await make_link(pg)
            check("מעסיק: שעות ביום המנוחה חוסמות יצירת קישור", not link and "ביום המנוחה" in await pg.inner_text("#checks"))
            await pg.fill("[data-day='6']", ""); await pg.fill("[data-day='0']", "06:00-20:00")
            link = await make_link(pg)
            check("מעסיק: יותר מ-12 שעות ביום חוסם", not link and "יותר מ-12 שעות" in await pg.inner_text("#checks"))
            await pg.fill("[data-day='0']", "09:00-17:00")
            await pg.fill("#wage", "30"); await pg.wait_for_timeout(200)
            check("מעסיק: אזהרת שכר מינימום שעתי", "שכר המינימום" in await pg.inner_text("#checks"))
            await pg.fill("#wage", "40"); await pg.fill("#weeklyHours", "42"); await pg.wait_for_timeout(200)
            check("מעסיק: אזהרת סתירה בין ימים לבין היקף", "שעות עבודה בשבוע" in await pg.inner_text("#checks"))
            await pg.click("#fixHours"); await pg.wait_for_timeout(200)
            check("מעסיק: תיקון היקף לפי הימים (36.25)", await pg.input_value("#weeklyHours") == "36.25", await pg.input_value("#weeklyHours"))
            await pg.select_option("#industry", "construction"); await pg.wait_for_timeout(200)
            check("מעסיק: אזהרת ענף עם צו הרחבה", "צו הרחבה ענפי" in await pg.inner_text("#checks"))
            await pg.select_option("#industry", "general")
            await pg.uncheck("#confirm"); link = await make_link(pg)
            check("מעסיק: חובה לאשר נכונות נתונים", not link)
            await pg.check("#confirm"); await pg.fill("#ownerEmail", "cpa.snir@gmail.com"); link = await make_link(pg)
            check("מעסיק: מייל המשרד בשדה המעסיק נחסם", not link)
            await pg.fill("#ownerEmail", "uri@example.com")
            await pg.select_option("#wageType", "monthly"); await pg.fill("#wage", "5000"); await pg.wait_for_timeout(200)
            check("מעסיק: אזהרת מינימום חודשי יחסי", "נמוך משכר המינימום היחסי" in await pg.inner_text("#checks"))

            # ---------- תרחיש 1: עובדת חדשה, 101 להדפסה ----------
            await employer(pg)
            link = await make_link(pg)
            check("קישור נוצר ומכיל מזהה (#k=)", "#k=" in link, link[:60])
            check("אורך הקישור", len(link) < 900, str(len(link)))
            await employee(pg, link)
            await fill101(pg)
            await finish_print(pg)
            docs = await wait_docs(pg, 2)
            check("תרחיש 1: נוצרו 2 מסמכים נפרדים (הסכם + 101)", len(docs) == 2, str(docs))
            names = await save_docs(pg, "s1_print")
            p1, p2 = pdf_pages(f"{OUT}/s1_print_1.pdf"), pdf_pages(f"{OUT}/s1_print_2.pdf")
            check("תרחיש 1: ב-101 – דף הוראות + 2 עמודי טופס + צילום ת\"ז", p2 == 4, f"pages={p2}")
            agr = await pg.evaluate("buildAgreementHtml()"); h101 = await pg.evaluate("build101Html()")
            check("הסכם: 72% ולא 72.03%", "72%" in agr and "72.03" not in agr)
            check("הסכם: בלי 'ההוראה המיטיבה' – רק 'ההוראה המחייבת'", "המיטיבה" not in agr and "ההוראה המחייבת" in agr)
            check("הסכם: הצהרה על הסכם קיבוצי/ארגון מעסיקים", "לא חל על העובד הסכם קיבוצי" in agr)
            check("הסכם: מועד מסירת ההודעה מופיע", "תאריך מסירת ההודעה" in agr)
            check("101: אין חתימה אלקטרונית של העובד על הטופס", h101.count("data:image/png") == 0)
            check("101: דף הוראות להדפסה וחתימה בכתב יד", "לחתום בכתב יד" in h101)
            check("בלי מכתב לקופה כשהפיצויים 6%", "הודעה לקופה" not in agr)
            await pg.screenshot(path=f"{OUT}/s1_send.png")

            # ---------- תרחיש 2: גבר נשוי עם ילדים, סעיף 7 – הדיאלוג, העובד משאיר ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, gender="זכר")
            d = await fill101(pg, marital="נשוי/אה", kids=[("נועה","000000026","2022-03-01")], credits=("c1","c7"), answers=[False])
            check("תרחיש 2: הוצעה העברה לסעיף 8 (לא שונה אוטומטית)", d and "סעיף 8" in d[0])
            check("תרחיש 2: העובד בחר להשאיר – סעיף 7 נשאר", await pg.evaluate("F.credits.includes('c7') && !F.credits.includes('c8')"))
            check("תרחיש 2: עבר לשלב הצילומים", await pg.locator("input[data-kind=id]").count() == 1)

            # ---------- תרחיש 3: אותו מקרה, העובד מאשר העברה ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, gender="זכר")
            d = await fill101(pg, marital="נשוי/אה", kids=[("נועה","000000026","2022-03-01")], credits=("c1","c7"), answers=[True])
            check("תרחיש 3: אחרי אישור – סעיף 8 מסומן, נשאר במסך לבדיקה", await pg.evaluate("F.credits.includes('c8') && !F.credits.includes('c7')") and await pg.locator("#addKid").count() == 1)

            # ---------- תרחיש 4: ילד בלי ת"ז ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link)
            await fill101(pg, kids=[("איתי","","2015-08-10")])
            check("תרחיש 4: ילד בלי ת\"ז – לא ממשיכים", await pg.locator("#addKid").count() == 1)

            # ---------- תרחיש 5: אין הכנסות אחרות + תיאום (עבודה קודמת) ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link)
            d = await fill101(pg, other="none", coord="more", answers=[True])
            check("תרחיש 5: תיאום עם 'אין הכנסות אחרות' – שאלה, לא חסימה", d and "עבודה קודמת" in d[0])
            check("תרחיש 5: אחרי 'כן' ממשיכים", await pg.locator("input[data-kind=id]").count() == 1)
            await employer(pg); link = await make_link(pg)
            await employee(pg, link)
            d = await fill101(pg, other="none", coord="noinc")
            check("תרחיש 5ב: ט.1 'לא הייתה הכנסה' עם 'אין הכנסות אחרות' – בלי שאלה", not d and await pg.locator("input[data-kind=id]").count() == 1)

            # ---------- תרחיש 6: הכנסה אחרת בלי תיאום ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link)
            d = await fill101(pg, other="yes", coord="none", answers=[False])
            check("תרחיש 6: הכנסה אחרת בלי תיאום – אזהרה, וחזרה לתיקון", d and "מס מרבי" in d[0] and await pg.locator("#addKid").count() == 1)

            # ---------- תרחיש 7: 101 דרך מיכפל ----------
            await employer(pg, f101="michpal"); link = await make_link(pg)
            await employee(pg, link)
            docs = await wait_docs(pg, 1)
            check("תרחיש 7 (מיכפל): בלי שלב 101, מסמך אחד", len(docs) == 1 and "הסכם עבודה" in docs[0]["f"], str(docs))
            await save_docs(pg, "s7_michpal")

            # ---------- תרחיש 8: פיצויים 8.33% – מכתב לקופה ----------
            await employer(pg, f101="michpal", sev="8.33"); link = await make_link(pg)
            await employee(pg, link)
            await wait_docs(pg, 1); agr = await pg.evaluate("buildAgreementHtml()")
            check("תרחיש 8: מכתב לקופה על סעיף 14 (8.33%) עם העתק לעובד", "הודעה לקופה" in agr and "העתק:" in agr and "במקום מלוא" in agr)
            await save_docs(pg, "s8_833")

            # ---------- תרחיש 9: שינוי תנאים לעובד קיים ----------
            await employer(pg, mode="change"); link = await make_link(pg)
            await employee(pg, link)
            docs = await wait_docs(pg, 1); agr = await pg.evaluate("buildAgreementHtml()")
            check("תרחיש 9: הודעה על שינוי תנאים – מסמך אחד", len(docs) == 1 and "שינוי" in docs[0]["f"], str(docs))
            check("תרחיש 9: נוסח השינוי ומועד התחולה", "40 ל-43" in agr and "01/01/2027" in agr)
            await save_docs(pg, "s9_change")

            # ---------- תרחיש 10: קישור ישן (v2, #e=) ----------
            old = {"v":2,"ownerEmail":"uri@example.com","empName":"ישן","company":"אורי כלפה","address":"עירית 1","signer":"אורי","role":"עובד","start":"2026-12-01","weeklyHours":"40","wage":"40","sec14":True}
            await pg.goto(BASE + "#e=" + base64.urlsafe_b64encode(json.dumps(old, ensure_ascii=False).encode()).decode().rstrip("="))
            await pg.wait_for_timeout(500)
            check("תרחיש 10: קישור ישן נפתח (תאימות לאחור)", await pg.locator("#go").count() == 1)

            # ---------- תרחיש 11: שליחה אוטומטית מול שרת דמה ----------
            reg, sub = [], []
            async def mock(route):
                d = json.loads(route.request.post_data or "{}")
                if d.get("action") == "register": reg.append(d); return await route.fulfill(json={"ok":True})
                sub.append(d)
                if d.get("linkId") not in [r["linkId"] for r in reg]: return await route.fulfill(json={"ok":False,"err":"unregistered-link"})
                return await route.fulfill(json={"ok":True, "dup": len([s for s in sub if s["docId"]==d["docId"]])>1})
            async def patch(route):
                r = await route.fetch(); body = (await r.text()).replace('const SEND_URL = "";', 'const SEND_URL = "/mock";')
                await route.fulfill(response=r, body=body, headers={**r.headers, "content-type":"text/html; charset=utf-8"})
            await pg.route("**/mock", mock); await pg.route(BASE + "", patch); await pg.route(BASE + "index.html", patch)
            await employer(pg); link = await make_link(pg)
            check("תרחיש 11: הקישור נרשם בשרת בזמן היצירה", len(reg) == 1 and reg[0]["ownerEmail"] == "uri@example.com")
            await employee(pg, link); await fill101(pg); await finish_print(pg); await wait_docs(pg, 2)
            await pg.click("#share"); await pg.wait_for_timeout(1500)
            check("תרחיש 11: נשלחו 2 קבצים עם מזהה קישור ומזהה מסמך", len(sub) == 1 and len(sub[0]["files"]) == 2 and sub[0]["linkId"] == reg[0]["linkId"] and len(sub[0]["docId"]) == 10)
            check("תרחיש 11: מסך תודה אחרי שליחה", "תודה" in (await pg.text_content("h1") or ""))

            check("אין שגיאות JavaScript בדף", not errs, "; ".join(errs[:3]))
            await b.close()
    finally:
        srv.terminate()
    ok = sum(1 for r in results if r[1]); print(f"\n{ok}/{len(results)} עברו")
    json.dump([{"name":n,"ok":o,"info":i} for n,o,i in results], open(f"{OUT}/results.json","w"), ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(results) else 1)

if __name__ == "__main__": asyncio.run(main())
