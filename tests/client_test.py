# בדיקות רגרסיה לדף (דפדפן אוטומטי). הרצה: python3 tests/client_test.py  (מתוך תיקיית המאגר)
import asyncio, base64, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://localhost:8765/"
OUT = os.environ.get("OUT", "/tmp/v37")
os.makedirs(OUT, exist_ok=True)
URI = {"company":"אורי כלפה","companyId":"024592693","deductions":"904105525","address":"עירית 1, קריית שמונה","signer":"אורי כלפה"}
def preset(extra=None):
    d = dict(URI, **(extra or {}))
    return "#s=" + base64.urlsafe_b64encode(json.dumps(d, ensure_ascii=False).encode()).decode().rstrip("=")
PRESET = preset()
results = []
def check(name, cond, info=""):
    results.append((name, bool(cond), info)); print(("✓ " if cond else "✗ ") + name + (f"  [{info}]" if info and not cond else ""))

async def sign(pg, sel):
    await pg.eval_on_selector(sel, "e => e.scrollIntoView({block:'center'})"); await pg.wait_for_timeout(200)
    b = await pg.locator(sel).bounding_box(); x,y,w,h = b["x"],b["y"],b["width"],b["height"]
    await pg.mouse.move(x+w*.2, y+h*.6); await pg.mouse.down()
    for i in range(1,14): await pg.mouse.move(x+w*(.2+i*.045), y+h*(.6-(i%3)*.17))
    await pg.mouse.up()

async def employer(pg, mode="new", f101="print", wage="40", sev="6", days=True, weekly=None, extra=None, confirm=True, sign_it=True, pre=None, changes=None):
    await pg.goto("about:blank"); await pg.goto(BASE + (pre or PRESET)); await pg.wait_for_timeout(400)
    if not pre: await pg.select_option("#industry", "general")
    await pg.click(f"label:has(input[name=mode][value={mode}])")
    if mode == "new": await pg.click(f"label:has(input[name=f101][value={f101}])")
    vals = {"ephone":"0501234567","ownerEmail":"uri@example.com","empName":"ישראל בדיקה","empPhone":"0500000000","role":"עובד דלפק","wage":wage,"pensionFund":"מגדל מקפת","harassContact":"אורי כלפה 0501234567","manager":"אורי כלפה, בעלים"}
    if mode == "new": vals["start"] = "2026-12-01"
    else:
        vals.update({"effDate":"2027-01-01","origStart":"2026-12-01"})
        for k,v in (changes or {"wage":"40"}).items():
            await pg.check(f"[data-chg={k}]")
            if k == "wage" and isinstance(v, tuple): vals["prev_wage"] = v[0]; await pg.select_option("#prev_wageType", v[1])
            else: vals["prev_"+k] = v
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

async def put(pg, k, v):
    el = pg.locator("#"+k)
    if await el.evaluate("e => e.tagName") == "SELECT":
        await el.select_option(v); await pg.wait_for_timeout(50)
    else: await el.fill(v)

async def employee(pg, link, gender="נקבה", marital="רווק/ה", kids=None, other="none", coord="none", credits=("c1",), answers=None, birth="1990-05-05", pens="no"):
    """answers: list of True/False for modal dialogs in order"""
    await pg.goto("about:blank"); await pg.goto(link); await pg.wait_for_timeout(500)
    await pg.check("#privOk"); await pg.click("#go")
    for k,v in {"idNum":"000000018","birth":birth,"phone":"0500000000","email":"emp@example.com","street":"הרצל","house":"12","city":"קריית שמונה","zip":"1101101","bank":"12","branch":"718","account":"123456"}.items():
        el = pg.locator("#"+k)
        if await el.is_visible(): await put(pg, k, v)
    if await pg.locator("label:has(input[name=gender])").first.is_visible(): await pg.click(f"label:has(input[name=gender][value='{gender}'])")
    if await pg.locator("label:has(input[name=pens])").first.is_visible(): await pg.click(f"label:has(input[name=pens][value={pens}])")
    await pg.click("#next"); await pg.wait_for_timeout(300)
    if not await pg.locator("#agree").count(): return pg
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
    await pg.set_input_files("input[data-kind=id]", "/tmp/test_id.jpg"); await pg.set_input_files("input[data-kind=sefach]", "/tmp/test_id.jpg"); await pg.wait_for_timeout(500)
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
            async def checks(): await pg.wait_for_timeout(150); return await pg.inner_text("#checks")
            await employer(pg)
            await pg.fill("[data-day='6']", "10:00-14:00")   # עבודה ביום המנוחה
            link = await make_link(pg)
            check("מעסיק: שעות ביום המנוחה חוסמות יצירת קישור", not link and "ביום המנוחה" in await checks())
            await pg.fill("[data-day='6']", ""); await pg.fill("[data-day='0']", "06:00-20:00")
            link = await make_link(pg)
            check("מעסיק: יותר מ-12 שעות ביום חוסם", not link and "יותר מ-12 שעות" in await checks())
            await pg.fill("[data-day='0']", "22:00-06:00"); link = await make_link(pg)
            check("G-04: משמרת שחוצה חצות חוסמת (לא נבלעת כ-0)", not link and "חוצה את חצות" in await checks())
            await pg.fill("[data-day='0']", "9-17:00x"); 
            check("מעסיק: פורמט שעות שגוי מזוהה", "לא בפורמט" in await checks())
            await pg.fill("[data-day='0']", "06:00-17:00"); await pg.fill("[data-day='5']", "09:00-23:00")
            check("G-06: מנוחה רצופה קצרה מ-36 שעות חוסמת", "36 שעות" in await checks())
            await pg.fill("[data-day='5']", ""); await pg.fill("[data-day='0']", "09:00-17:00")
            await pg.fill("#wage", "30")
            check("G-02: שכר שעתי מתחת למינימום – שגיאה חוסמת", "⛔" in await checks() and "נמוך משכר המינימום לשעה" in await checks())
            link = await make_link(pg); check("G-02: לא נוצר קישור בשכר מתחת למינימום", not link)
            await pg.fill("#start", "2026-03-01"); await pg.fill("#wage", "35")
            check("G-02: מינימום לפי מועד התחולה (3/2026: 34.32 – 35 תקין)", "נמוך משכר המינימום" not in await checks())
            await pg.fill("#wage", "34"); check("G-02: 34 ₪ במרץ 2026 – מתחת ל-34.32", "34.32" in await checks())
            await pg.fill("#start", "2026-12-01"); await pg.fill("#wage", "40"); await pg.fill("#weeklyHours", "42")
            check("מעסיק: אזהרת סתירה בין ימים לבין היקף", "שעות עבודה בשבוע" in await checks())
            await pg.click("#fixHours")
            check("מעסיק: תיקון היקף לפי הימים (36.25)", await pg.input_value("#weeklyHours") == "36.25", await pg.input_value("#weeklyHours"))
            await pg.select_option("#breakMin", "0")
            c = await checks(); check("G-03: הפסקה 0 – אזהרה לפי סעיף 20, וחישוב השעות בלי ניכוי הפסקה (40)", "סעיף 20" in c and "יוצאות 40 שעות" in c, c[:200])
            await pg.select_option("#breakMin", "30"); check("G-03: הפסקה 30 דקות ביום של 8 שעות – חוסם (מחייב היתר ואישור משרד)", "30 דקות" in await checks() and "⛔" in await checks())
            await pg.select_option("#breakMin", "45"); check("G-03: הפסקה 45 – בלי אזהרת סעיף 20", "סעיף 20" not in await checks())
            for i in range(5): await pg.fill(f"[data-day='{i}']", "08:00-18:00")
            await pg.fill("#weeklyHours", "46.25"); c = await checks()
            check("G-04/05: עם יום מקוצר (חמישי 7:36) – 4.25 נוספות יומיות, 0 שבועיות, 42 רגילות", "42 שעות רגילות ו-4.25 שעות נוספות" in c and "4.25 יומיות, 0 שבועיות" in c, c[:300])
            await pg.select_option("#pattern", "6")
            for i in range(6): await pg.fill(f"[data-day='{i}']", "07:00-19:00")
            c = await checks()
            check("G-04/05: 6 ימים × 11.25 – מעל 16 שעות נוספות חוסם (שישי = ערב מנוחה, 7 שעות)", "מעל 16." in c, c[:300])
            await pg.select_option("#pattern", "5"); await pg.fill("[data-day='5']", "")
            await pg.click("#fillWeek"); await pg.click("#clearWeek"); await pg.click("#fillWeek"); await pg.fill("#weeklyHours", "36.25")
            await pg.select_option("#industry", "construction")
            check("G-12: ענף עם צו – חוסם עד אישור משרד", "⛔" in await checks() and "אישור משרד חתום" in await checks())
            link = await make_link(pg); check("G-12: לא נוצר קישור בענף לא מאושר", not link)
            await pg.select_option("#industry", "general"); await pg.fill("#collective", "הסכם קיבוצי בדיקה")
            check("G-12: הסכם קיבוצי – חוסם עד אישור משרד, ודורש פרטי ארגון העובדים", "אישור משרד חתום" in await checks() and "ארגון העובדים" in await checks())
            await pg.fill("#collective", "")
            await pg.fill("#harassContact", ""); check("G-26: חובה אחראי הטרדה מינית", "הטרדה מינית" in await checks())
            await pg.fill("#harassContact", "אורי 050")
            await pg.check("#youth"); check("G-20: עובד מתחת ל-18 – חוסם ומפנה למשרד", "גיל 18" in await checks())
            await pg.uncheck("#youth")
            await pg.fill("#start", "2027-01-10"); check("G-17: 101 להדפסה לשנת 2027 – חוסם עד עדכון הטופס", "גרסת 2026" in await checks())
            await pg.fill("#start", "2026-12-01")
            await pg.uncheck("#confirm"); link = await make_link(pg)
            check("מעסיק: חובה לאשר נכונות נתונים", not link)
            await pg.check("#confirm"); await pg.fill("#ownerEmail", "cpa.snir@gmail.com"); link = await make_link(pg)
            check("מעסיק: מייל המשרד בשדה המעסיק נחסם", not link)
            await pg.fill("#ownerEmail", "uri@example.com")
            await pg.select_option("#wageType", "monthly"); await pg.fill("#wage", "5000")
            check("G-02: חודשי מתחת למינימום היחסי – חוסם", "⛔" in await checks() and "נמוך משכר המינימום היחסי" in await checks())

            # ---------- סבב 2: בדיקות קצה ----------
            await employer(pg); await pg.fill("#start", "2023-05-01"); await pg.fill("#wage", "30")
            check("R2-02: מאי 2023 – 30 ₪ נחסם (מינימום 30.61)", "30.61" in await checks())
            await pg.fill("#wage", "30.61"); check("R2-02: מאי 2023 – 30.61 עובר", "נמוך משכר המינימום" not in await checks())
            await pg.fill("#start", "2023-01-10"); check("R2-02: לפני 4/2023 – אין טבלה, חוסם", "לפני 1.4.2023" in await checks())
            await pg.fill("#start", "2027-05-01"); check("R2-02: אחרי 3/2027 – חוסם עד עדכון", "טבלת שכר המינימום בכלי עוד לא עודכנה" in await checks())
            await pg.fill("#start", "2026-12-01"); await pg.fill("#wage", "-5"); check("R2-02: שכר שלילי לא תקין", "השכר לא תקין" in await checks())
            await pg.fill("#wage", "abc"); check("R2-02: שכר לא מספרי לא תקין", "השכר לא תקין" in await checks())
            await pg.select_option("#wageType", "monthly"); await pg.fill("#wage", "3500")
            for i in range(5): await pg.fill(f"[data-day='{i}']", "08:00-17:21")
            await pg.fill("[data-day='4']", "08:00-16:21"); await pg.fill("#weeklyHours", "20"); c = await checks()
            check("R2-02: סידור של 42 שעות והיקף מוצהר 20 – סתירה חוסמת ומינימום לפי 42", "יש להתאים" in c and "6443.85" in c, c[:300])
            await pg.fill("#weeklyHours", "42"); await pg.select_option("#wageType", "hourly"); await pg.fill("#wage", "40"); c = await checks()
            check("R2-03: 4×8:36 + יום מקוצר 7:36 = 42 בלי שעות נוספות", "שעות נוספות" not in c and "יש להתאים" not in c, c[:300])
            await pg.fill("[data-day='4']", "08:00-17:21"); await pg.fill("[data-day='3']", "08:00-16:21"); c = await checks()
            check("R2-03: 8:36 ביום המקוצר – שעה נוספת יומית למרות 42 בשבוע", "41 שעות רגילות ו-1 שעות נוספות" in c and "1 יומיות, 0 שבועיות" in c, c[:300])
            await pg.select_option("#shortDay", "3"); c = await checks()
            check("R2-03: בחירת יום מקוצר אחר (רביעי) – בלי נוספות", "שעות נוספות" not in c, c[:200])
            await pg.select_option("#shortDay", "5"); check("R2-03: יום מקוצר שאינו יום עבודה – חוסם", "היום המקוצר שנבחר אינו יום עבודה" in await checks())
            await pg.select_option("#shortDay", "4"); await pg.click("#clearWeek")
            await pg.fill("[data-day='0']", "12:00-23:00"); await pg.fill("[data-day='1']", "06:00-12:00")
            check("R2-04: 7 שעות בין ראשון לשני – חוסם (סעיף 21)", "סעיף 21" in await checks())
            await pg.fill("[data-day='1']", "07:00-12:00"); check("R2-04: 8 שעות בדיוק – תקין", "סעיף 21" not in await checks())
            await pg.fill("[data-day='0']", "09:00-17:00/90"); await pg.fill("[data-day='1']", "09:00-11:00/150")
            check("G-03: הפסקה ארוכה מהמשמרת – חוסם", "ההפסקה ארוכה מהמשמרת" in await checks())
            await pg.fill("[data-day='1']", "09:00-17:00/30"); c = await checks()
            check("G-03: הפסקה שונה ביום מסוים (/30) – אזהרה רק על היום הזה", "ביום שני" in c and "30 דקות" in c and "ביום ראשון (8 שעות) מוגדרת" not in c, c[:300])
            await pg.check("#breakPermit"); check("G-03: היתר להפסקות – בלי אישור משרד חתום חוסם", "סעיף 20" not in await checks() and "מחייבת אישור משרד" in await checks())
            await pg.uncheck("#breakPermit"); await pg.check("#breakPaid"); check("G-03: הפסקה משולמת לא פוטרת מההפסקה עצמה", "גם כשהעובד נדרש להישאר" in await checks())
            await pg.uncheck("#breakPaid"); await pg.click("#clearWeek"); await pg.click("#fillWeek"); await pg.fill("#weeklyHours", "36.25")
            await pg.fill("#globalOT", "10"); check("G-23: גלובלי בלי סכום – חוסם", "גם מכסת שעות וגם סכום" in await checks())
            await pg.fill("#globalOTAmount", "500"); check("G-23: גלובלי נמוך מ-150% (10×40×1.5=600) – חוסם", "נמוך מ-150%" in await checks())
            await pg.fill("#globalOTAmount", "600"); check("G-23: גלובלי מספיק – עובר", "גלובלי" not in await checks())
            await pg.select_option("#wageType", "monthly"); await pg.fill("#wage", "3500")
            for i in range(3): await pg.fill(f"[data-day='{i}']", "")
            await pg.fill("#weeklyHours", "14.5"); await pg.fill("#globalOTAmount", "800"); c = await checks()
            check("R3-06: משרה חלקית – ערך שעה לפי השעות הרגילות (3500/62.83=55.7, לא 3500/182=19.23)", "ערך שעה 55.7 ₪" in c and "נמוך מ-150%" in c, c[:400])
            await pg.select_option("#wageType", "hourly"); await pg.fill("#wage", "40"); await pg.click("#fillWeek"); await pg.fill("#weeklyHours", "36.25")
            await pg.fill("#globalOT", ""); await pg.fill("#globalOTAmount", "")
            await pg.fill("[data-day='0']", "16:00-24:00"); check("G-04: משמרת לילה בלי אישור משרד – חוסם", "סעיף 22" in await checks() and "⛔" in await checks())
            await pg.fill("[data-day='0']", "09:00-17:00")
            await pg.check("#cameras"); check("G-25: מצלמות בלי אישור מסירת מדיניות – חוסם", "מדיניות המצלמות" in await checks())
            await pg.check("#camPolicy"); check("G-25: עם אישור מסירה – עובר", "מדיניות המצלמות" not in await checks())
            await pg.uncheck("#sec14"); check("G-07: ביטול סעיף 14 ב-6% – חוסם", "מכוח צו ההרחבה" in await checks())
            await pg.check("#sec14"); await pg.fill("#harassContact", "אורי"); check("G-26: אחראי הטרדה בלי דרך פנייה – חוסם", "דרך פנייה" in await checks())
            await pg.fill("#harassContact", "אורי 0501234567"); await pg.fill("#manager", ""); check("G-13: ממונה ישיר חובה", "הממונה הישיר" in await checks())
            await pg.fill("#manager", "אורי"); await pg.fill("#weeklyHours", "100"); check("R4-01: היקף 100 – חוסם (מעל 58)", "מעל 58" in await checks())
            await pg.click("#clearWeek"); check("R4-01: בלי ימים ושעות – חוסם", "יש למלא את ימי ושעות העבודה" in await checks())
            await pg.click("#fillWeek"); await pg.fill("#weeklyHours", "36.25")

            # דגל ענף בקישור מעסיק ידני
            await employer(pg, pre=preset({"officeOk":True,"industry":"construction"}))
            await pg.select_option("#industry", "construction")
            check("G-12: דגל officeOk בקישור ידני אינו אישור – עדיין חוסם", "אישור משרד חתום" in await checks())
            link = await make_link(pg); check("G-12: במצב ידני אין קישור לענף גם עם הדגל", not link)

            # ---------- תרחיש 1: עובדת חדשה, 101 להדפסה ----------
            await employer(pg)
            link = await make_link(pg)
            check("קישור נוצר ומכיל מזהה (#k=)", "#k=" in link, link[:60])
            check("G-28: במצב ידני מוצג שהקישור דחוס ולא מוצפן", "לא מוצפנים" in await pg.inner_text("#linkNote"))
            tj = await pg.evaluate("l => unpackK(l.split('#k=')[1]).then(JSON.stringify)", link)
            check("טלפון העובד לא נכנס לקישור; גרסת קישור 5; מזהה 128 ביט", "0500000000" not in tj and '"v":5' in tj and len(json.loads(tj)["linkId"]) == 32)
            check("אורך הקישור", len(link) < 900, str(len(link)))
            await pg.goto("about:blank"); await pg.goto(link); await pg.wait_for_timeout(400); await pg.click("#go"); await pg.wait_for_timeout(200)
            check("G-36: בלי אישור הודעת הפרטיות לא ממשיכים", await pg.locator("#privOk").count() == 1 and await pg.locator("#first").count() == 0)
            app_txt = await pg.inner_text("#app")
            check("G-36: הודעת פרטיות מפרטת אחראי, מטרות, חובה/רשות, נמענים וזכויות", all(x in app_txt for x in ["מי מקבל","למה","חובה או רשות","למי עוד","הזכויות שלך"]))
            await employee(pg, link)
            bk = await pg.evaluate("({n: BANKS && BANKS.banks.length, br: BANKS && BANKS.banks.reduce((a,b)=>a+b.branches.length,0), asOf: BANKS && BANKS.asOf, e: E.bankName + '|' + E.branchName})")
            check("בנקים: רשימת בנק ישראל נטענה – 18 בנקים, 1403 סניפים, מעודכנת ל-11/05/2026", bk["n"] == 18 and bk["br"] == 1403 and bk["asOf"] == "11/05/2026", str(bk))
            check("בנקים: 12/718 מזוהה כ'בנק הפועלים' סניף 'קרית שמונה'", "הפועלים" in bk["e"] and "קרית שמונה" in bk["e"], bk["e"])
            await fill101(pg)
            await finish_print(pg)
            docs = await wait_docs(pg, 2)
            check("תרחיש 1: נוצרו 2 מסמכים נפרדים (הסכם + 101)", len(docs) == 2, str(docs))
            names = await save_docs(pg, "s1_print")
            p1, p2 = pdf_pages(f"{OUT}/s1_print_1.pdf"), pdf_pages(f"{OUT}/s1_print_2.pdf")
            check("תרחיש 1: ב-101 – דף הוראות + 2 עמודי טופס + ת\"ז + ספח", p2 == 5, f"pages={p2}")
            agr = await pg.evaluate("buildAgreementHtml()"); h101 = await pg.evaluate("build101Html()")
            check("הסכם: 72% ולא 72.03%", "72%" in agr and "72.03" not in agr)
            check("הסכם: בלי 'ההוראה המיטיבה' – רק 'ההוראה המחייבת'", "המיטיבה" not in agr and "ההוראה המחייבת" in agr)
            check("הסכם: הצהרה על הסכם קיבוצי/ארגון מעסיקים", "לא חל על העובד הסכם קיבוצי" in agr)
            check("הסכם: מועד מסירת ההודעה מופיע", "תאריך מסירת ההודעה" in agr)
            check("101: אין חתימה אלקטרונית של העובד על הטופס", h101.count("data:image/png") == 0)
            check("101: דף הוראות להדפסה וחתימה בכתב יד", "לחתום בכתב יד" in h101)
            check("בלי מכתב לקופה כשהפיצויים 6%", "הודעה לקופה" not in agr)
            check("G-07: 6% – סעיף 14 מכוח צו ההרחבה, 72%, בלי 'האישור הכללי' כמקור", "המתחייבות לפי צו ההרחבה" in agr and "72%" in agr)
            check("G-08: חריג החזר כספים רק לפי סעיפים 16/17 או משיכה שלא לרגל אירוע מזכה", "סעיף 16 או 17" in agr and "בפסק דין או בהסכם" not in agr)
            check("G-10: עובדת בלי ביטוח קודם – נוסח 6 חודשים לפי הצו", "אין לו ביטוח פנסיוני קודם" in agr)
            check("G-03: נוסח הפסקה בפועל (45 דקות)", "הפסקה של 45 דקות" in agr)
            check("G-21: חגים לעובד שעתי לפי תנאי הצו", "יום שלפני החג" in agr)
            check("G-22: מועד שכר מול 'שכר מולן'", "שכר מולן" in agr)
            check("G-14: שינוי מחויב יימסר גם אם ניהולי; אישור קבלה אינו הסכמה להרעה", "גם אם נעשה במסגרת סמכויות הניהול" in agr and "אינו הסכמה להרעה" in agr)
            check("G-27: שמירת זכויות מכוח הסדר אחר המחייב", "הסדר אחר המחייב את הצדדים" in agr)
            check("G-24: קניין רוחני לפי סעיף 34 / 132, בלי זכות מוסרית", "סעיף 34" in agr and "הזכות המוסרית" in agr)
            check("G-38: נוסח חתימה – לא מאובטחת, עותק יימסר", "אין זו חתימה אלקטרונית מאובטחת" in agr)
            check("G-19: דף ה-101 – מעקב קבלת טופס חתום תוך שבוע", "בתוך שבוע מתחילת העבודה" in h101)
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
            await employer(pg, mode="change", wage="40")
            check("G-01: לפני=אחרי (שכחו לעדכן את השכר ל-43) – חוסם", "זהים" in await pg.inner_text("#checks"))
            check("G-01: אין שדה הערות חופשי בהודעת שינוי", await pg.locator("#changeText").count() == 0)
            await employer(pg, mode="change", wage="40", changes={"wage":("40","monthly")})
            check("R2-01: שינוי מ-40 לחודש ל-40 לשעה אינו 'זהה'", "זהים" not in await pg.inner_text("#checks"))
            await employer(pg, mode="change", wage="43", changes={"wage":"40","hours":"36.25","pension":"עובד 6% · מעסיק 6.5% · פיצויים 6%"})
            await pg.wait_for_timeout(150); ct = await pg.inner_text("#checks")
            check("R2-01: היקף זהה ופנסיה זהה – נחסמים", "ההיקף הקודם והחדש זהים" in ct and "הפרשות לפנסיה זהים" in ct)
            await employer(pg, mode="change", wage="43")
            await pg.select_option("#chgReason", "העלאת שכר")
            link = await make_link(pg)
            await employee(pg, link)
            docs = await wait_docs(pg, 1); agr = await pg.evaluate("buildAgreementHtml()")
            check("תרחיש 9: הודעה על שינוי תנאים – מסמך אחד", len(docs) == 1 and "שינוי" in docs[0]["f"], str(docs))
            check("G-01: טבלת לפני/אחרי – 40 לפני, 43 אחרי, ומועד תחולה", "40 ₪ לשעה" in agr and "43 ₪ לשעה" in agr and "01/01/2027" in agr and agr.index("40 ₪ לשעה") < agr.index("43 ₪ לשעה"))
            check("G-01: אין 40 בעמודת 'אחרי' (אותו אובייקט מזין טבלה ותנאים)", "<b>40 ₪ לשעה</b>" not in agr)
            check("G-01: סיבת שינוי מרשימה סגורה מופיעה", "סיבת השינוי: העלאת שכר" in agr)
            await save_docs(pg, "s9_change")

            # ---------- תרחיש 10: קישור ישן (v2, #e=) ----------
            old = {"v":2,"ownerEmail":"uri@example.com","empName":"ישן","company":"אורי כלפה","address":"עירית 1","signer":"אורי","role":"עובד","start":"2026-12-01","weeklyHours":"40","wage":"40","sec14":True}
            await pg.goto(BASE + "#e=" + base64.urlsafe_b64encode(json.dumps(old, ensure_ascii=False).encode()).decode().rstrip("="))
            await pg.wait_for_timeout(500)
            check("G-40: קישור מגרסה קודמת נחסם עם הסבר", await pg.locator("#go").count() == 0 and "גרסה קודמת" in await pg.inner_text("#app"))

            # ---------- תרחיש 12: אב נשוי, ילד בן 10, סעיף 8 ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, gender="זכר")
            await fill101(pg, marital="נשוי/אה", kids=[("דן","000000034","2016-04-04")], credits=("c1","c8"))
            check("G-13: הסבר סעיף 8 כולל גילאי 6–17 (לא 'עד גיל 5')", "6–17" in await pg.evaluate("CREDITS.find(c=>c[0]=='c8')[3]") and "עד גיל 5" not in await pg.evaluate("JSON.stringify(CREDITS)"))
            check("G-13: ילד בן 10 נספר בסעיף 8 בקבוצת 6–17", await pg.evaluate("kidCounts(F.kids, 2026).a617") == 1 and await pg.evaluate("F.credits.includes('c8')"))
            check("G-13: אב נשוי + סעיף 8 – בלי שאלה, ממשיכים", await pg.locator("input[data-kind=id]").count() == 1)

            # ---------- תרחיש 13: ת"ז כפולה של ילדים ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link)
            await fill101(pg, kids=[("א","000000042","2015-01-01"),("ב","000000042","2017-01-01")])
            check("G-18: ת\"ז כפולה ברשימת הילדים – לא ממשיכים", await pg.locator("#addKid").count() == 1)

            # ---------- תרחיש 14: עובד בן 17 ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, birth="2009-12-15")
            check("G-20: עובד שטרם מלאו לו 18 – נעצר ומופנה, בלי הסכם", await pg.locator("#agree").count() == 0 and "טרם מלאו לך 18" in await pg.inner_text("#app"))

            # ---------- תרחיש 15: שעות נוספות בהסכם + עובד עם ביטוח קודם ----------
            await employer(pg)
            for i in range(5): await pg.fill(f"[data-day='{i}']", "08:00-18:00")
            await pg.fill("#weeklyHours", "46.25"); link = await make_link(pg)
            await employee(pg, link, pens="yes"); agr = await pg.evaluate("buildAgreementHtml()")
            check("G-05: ההסכם מציג שעות רגילות ונוספות לפי הסידור", "42 שעות רגילות ו-4.25 שעות נוספות" in agr)
            check("G-10: עובד עם ביטוח קודם – 3 חודשים / סוף שנת המס", "3 חודשי עבודה או מתום שנת המס" in agr)

            # ---------- תרחיש 16: 8.33% – מכתב לקופה עם תיעוד מסירה ----------
            await employer(pg, f101="michpal", sev="8.33"); link = await make_link(pg)
            await employee(pg, link); await wait_docs(pg, 1); agr = await pg.evaluate("buildAgreementHtml()")
            check("G-09: מכתב לקופה – מכוח הצו, לא רטרואקטיבי, עם שורת תיעוד מסירה", "בהתאם לצו ההרחבה" in agr and "אינה חלה רטרואקטיבית" in agr and "תיעוד מסירה" in agr)

            # ---------- תרחיש 17: 101 מורכב – ילד שאינו בחזקה ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, gender="זכר")
            await fill101(pg, marital="גרוש/ה", kids=[("רון","000000059","2014-02-02")])
            check("G-16: גרוש עם ילדים – מסומן לבדיקת משרד לפני שימוש", "לבדיקת משרד" in await pg.evaluate("cover101()") and len(await pg.evaluate("F.complex")) >= 1)

            # ---------- תרחיש 18: שנת מס בלי טופס – מסלול נייר, לא מיכפל ----------
            await employer(pg); link = await make_link(pg)
            await pg.goto("about:blank"); await pg.goto(link); await pg.wait_for_timeout(400)
            await pg.evaluate("T.start = '2027-01-05'")
            await pg.check("#privOk"); await pg.click("#go")
            for k,v in {"first":"דנה","last":"בדיקה","idNum":"000000018","birth":"1990-05-05","phone":"0500000000","street":"הרצל","house":"1","city":"חיפה","bank":"12","branch":"718","account":"1"}.items(): await put(pg, k, v)
            await pg.click("label:has(input[name=gender][value='נקבה'])"); await pg.click("label:has(input[name=pens][value=no])")
            await pg.click("#next"); await pg.wait_for_timeout(300); await pg.check("#agree"); await sign(pg, "#sigE"); await pg.click("#next"); await pg.wait_for_timeout(300)
            check("G-17: שנת מס 2027 – הסבר שהטופס לא עודכן", "עדיין לא עודכן" in await pg.inner_text("#app"))
            await pg.click("#next"); await wait_docs(pg, 1)
            check("G-17: המסלול מסומן 'paper' ולא מיכפל, ומסך הסיום לא מבטיח לינק מיכפל", await pg.evaluate("MODE()") == "paper" and await pg.evaluate("T.f101") == "paper")

            # ---------- תרחיש 19: גבר בן 20 – גיל זכאות לפנסיה ----------
            await employer(pg); link = await make_link(pg)
            await employee(pg, link, gender="זכר", birth="2006-06-01"); agr = await pg.evaluate("buildAgreementHtml()")
            check("G-10: גבר בן 20 – ההסכם מציין גיל זכאות 21", "טרם מלאו לו 21" in agr)
            check("G-10: בלי ביטוח קודם – בלי טענה על תשלום רטרואקטיבי", "רטרואקטיבי" not in agr.split("סעיף 14")[0])
            check("G-21: מחלה – 'יום וחצי' בלי 'עד'", "צבירה של יום וחצי" in agr and "צבירה של עד" not in agr)

            # ---------- סבב 3 ----------
            await employer(pg, mode="change", wage="43", changes={"other":"שעות נוספות 5"})
            await pg.fill("#otherAfter", "תוספת 10%"); await pg.wait_for_timeout(150)
            check("G-01: 'תנאי אחר' עם שכר/שעות/מספרים – חוסם", "שדות מובנים" in await pg.inner_text("#checks"))
            await employer(pg, mode="change", wage="43"); link = await make_link(pg)
            await employee(pg, link, birth="2010-03-03")
            check("R3-10: עובד קיים קטין במסלול שינוי – נעצר ומופנה", await pg.locator("#agree").count() == 0 and "טרם מלאו לך 18" in await pg.inner_text("#app"))
            await employer(pg); link = await make_link(pg)
            await employee(pg, link); await fill101(pg, credits=("c1","c14"))
            await pg.set_input_files("input[data-kind=id]", "/tmp/test_id.jpg"); await pg.wait_for_timeout(300); await pg.check("#decl"); await pg.click("#next"); await pg.wait_for_timeout(300)
            check("R3-09: בלי ספח – לא ממשיכים", await pg.locator("#decl").count() == 1)
            await pg.set_input_files("input[data-kind=sefach]", "/tmp/test_id.jpg"); await pg.wait_for_timeout(300); await pg.click("#next"); await pg.wait_for_timeout(300)
            check("R3-09: אסמכתה לסעיף 14 חסרה ולא סומן 'אמסור בנפרד' – לא ממשיכים", await pg.locator("#decl").count() == 1 and "תעודת שחרור" in await pg.inner_text("#toast"))
            await pg.check('[data-later="need:0"]'); await pg.click("#next"); await wait_docs(pg, 2)
            cv = await pg.evaluate("cover101()")
            check("R3-09: 'אמסור בנפרד' – ממשיכים, ודף ה-101 מסמן אסמכתה חסרה לבדיקת משרד", "אסמכתאות חסרות: תעודת שחרור" in cv and "לבדיקת משרד" in cv)
            await employer(pg); link = await make_link(pg)
            await employee(pg, link); await fill101(pg)
            await pg.check("#noTz"); await pg.set_input_files("input[data-kind=idalt]", "/tmp/test_id.jpg"); await pg.wait_for_timeout(300); await pg.check("#decl"); await pg.click("#next"); await wait_docs(pg, 2)
            check("G-18: בלי ת\"ז ישראלית – מסמך זיהוי חלופי מתקבל", len(await pg.evaluate("DOCS")) == 2 and "מסמך זיהוי" in await pg.evaluate("attachPages()"))

            # ---------- תרחיש 11: שליחה אוטומטית מול שרת דמה (קישור אטום) ----------
            reg, sub, store = [], [], {}
            async def mock(route):
                d = json.loads(route.request.post_data or "{}")
                if d.get("action") == "register":
                    if d.get("tok") != "TESTTOK": return await route.fulfill(json={"ok":False,"err":"not-authorized"})
                    reg.append(d); store[d["linkId"]] = d["terms"]; return await route.fulfill(json={"ok":True,"sha":"a"*64})
                if d.get("action") == "get":
                    t = store.get(d.get("linkId")); return await route.fulfill(json={"ok":True,"terms":t,"sha":"a"*64} if t else {"ok":False,"err":"not-found"})
                sub.append(d)
                if d.get("linkId") not in store: return await route.fulfill(json={"ok":False,"err":"unregistered-link"})
                if d.get("termsHash") != "a"*64: return await route.fulfill(json={"ok":False,"err":"terms-mismatch"})
                return await route.fulfill(json={"ok":True})
            async def patch(route):
                r = await route.fetch(); body = (await r.text()).replace('const SEND_URL = "";', 'const SEND_URL = "/mock";')
                await route.fulfill(response=r, body=body, headers={**r.headers, "content-type":"text/html; charset=utf-8"})
            await pg.route("**/mock", mock); await pg.route(BASE + "", patch); await pg.route(BASE + "index.html", patch)
            await employer(pg); link = await make_link(pg)
            check("G-30: במצב שרת, בלי טוקן מעסיק – אין קישור", not link and not reg)
            await employer(pg, pre=preset({"tok":"TESTTOK"})); link = await make_link(pg)
            check("G-28/29: קישור אטום (#r=, 32 תווים) והתנאים נשמרו בשרת", "#r=" in link and len(link.split("#r=")[1]) == 32 and len(reg) == 1 and reg[0]["terms"]["wage"] == "40" and "tok" not in reg[0]["terms"])
            check("G-28: אין תנאים בתוך הקישור", "#k=" not in link and len(link) < 120)
            await pg.goto("about:blank"); await pg.goto(BASE + "#k=AAAA"); await pg.wait_for_timeout(400)
            check("G-28/G-40: במצב שרת קישור ידני (#k=) נדחה", "גרסה ידנית" in await pg.inner_text("#app"))
            await employer(pg, pre=preset({"tok":"TESTTOK","industry":"construction","okSig":"S"*32,"okTpl":{"role":"עובד דלפק","exp":"2099-01-01"}}))
            c = await pg.inner_text("#checks")
            check("G-12: במצב שרת עם אישור חתום – אזהרה, והשדות נעולים", "השרת יאמת" in c and await pg.is_disabled("#industry"))
            l2 = await make_link(pg); check("G-12: האישור נשלח לשרת לאימות", "#r=" in l2 and reg[-1]["terms"]["okSig"] == "S"*32)
            await employee(pg, link); await fill101(pg); await finish_print(pg); await wait_docs(pg, 2)
            await pg.click("#share"); await pg.wait_for_timeout(1500)
            check("תרחיש 11: נשלחו 2 קבצים עם מזהה קישור, מזהה מסמך וטביעת תנאים", len(sub) == 1 and len(sub[0]["files"]) == 2 and sub[0]["linkId"] == reg[0]["linkId"] and sub[0]["mode"] == "print" and len(sub[0]["docId"]) == 10 and sub[0]["termsHash"] == "a"*64)
            check("G-35: הדף לא שולח מייל עובד לשרת", "employeeEmail" not in sub[0])
            check("תרחיש 11: מסך תודה אחרי שליחה", "תודה" in (await pg.text_content("h1") or ""))
            await pg.goto("about:blank"); await pg.goto(BASE + "#r=" + "0"*32); await pg.wait_for_timeout(600)
            check("G-40: קישור אטום לא קיים – הודעה ברורה", "לא נמצא" in await pg.inner_text("#app"))

            check("אין שגיאות JavaScript בדף", not errs, "; ".join(errs[:3]))
            await b.close()
    finally:
        srv.terminate()
    ok = sum(1 for r in results if r[1]); print(f"\n{ok}/{len(results)} עברו")
    json.dump([{"name":n,"ok":o,"info":i} for n,o,i in results], open(f"{OUT}/results.json","w"), ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(results) else 1)

if __name__ == "__main__": asyncio.run(main())
