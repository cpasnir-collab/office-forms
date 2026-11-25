// בדיקות לסקריפט Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל. הרצה: node tests/gas_test.js
const fs = require("fs"), vm = require("vm"), crypto = require("crypto"), path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");
const sb = a => a.map(b => b > 127 ? b - 256 : b);
const ME = "cpa.snir@gmail.com";

function makeEnv(opts = {}) {
  const props = {}, cache = {}, mails = [], files = [], folders = {}, sheets = {};
  let pdfSaves = 0, fid = 0;
  const mkFile = (name, folder, blob) => { const f = { id: "F" + files.length, name, blob, folder, desc: "", setDescription(d) { this.desc = d; }, getId() { return this.id; }, moveTo() {},
    getBlob() { return { getDataAsString: () => typeof blob.bytes === "string" ? blob.bytes : Buffer.from(blob.bytes.map(b => b & 255)).toString("utf8") }; } }; files.push(f); return f; };
  const user = m => ({ getEmail: () => m });
  const mkFolder = name => folders[name] || (folders[name] = {
    name, id: "D" + (fid++), getId() { return this.id; },
    getFoldersByName: n => { const f = folders[name + "/" + n]; return { hasNext: () => !!f, next: () => f }; },
    createFolder: n => mkFolder(name + "/" + n),
    getSharingAccess: () => (opts.sharedFolder && name.includes(opts.sharedFolder)) ? "ANYONE_WITH_LINK" : "PRIVATE",
    getEditors: () => [user(ME)].concat(opts.editorIn && name.includes(opts.editorIn) ? [user("stranger@x.com")] : []),
    getViewers: () => [],
    createFile: b => { if (b.type === "application/pdf") { pdfSaves++; if (opts.failSaveAt === pdfSaves) throw new Error("drive-down"); } return mkFile(b.name, name, b); },
    getFilesByName: n => { const f = files.find(x => x.folder === name && x.name === n); return { hasNext: () => !!f, next: () => f }; }
  });
  const root = mkFolder("root");
  const mkSheet = (name) => { const rows = []; const sh = { name, rows, appendRow: r => rows.push(r), protect: () => ({ setDescription() { return this; }, removeEditors() {}, getEditors: () => [], canDomainEdit: () => false }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }), getRange: (row) => ({ setValues: v => { rows[row - 1] = v[0]; } }) }; sheets[name] = sh; return sh; };
  let sets = 0;
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => Object.assign({}, props),
      setProperty: (k, v) => { sets++; if (opts.throwOnSet && opts.throwOnSet(k, v.startsWith("{") ? JSON.parse(v) : {}, sets)) { opts.throwOnSet = null; throw new Error("crash"); } props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: m => { (env._logged = env._logged || []).push(String(m)); } },
    Session: { getEffectiveUser: () => user(ME) },
    Utilities: {
      base64Decode: s => sb(Array.from(Buffer.from(s, "base64"))),
      base64EncodeWebSafe: (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      computeDigest: (alg, data) => sb(Array.from(crypto.createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.map(b => b & 255))).digest())),
      computeHmacSha256Signature: (v, k) => sb(Array.from(crypto.createHmac("sha256", k).update(v).digest())),
      getUuid: () => crypto.randomUUID(), formatDate: (d) => d.toISOString().slice(0, 10),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }
    },
    DriveApp: { getRootFolder: () => root, getFileById: id => files.find(f => f.id === id) || { moveTo() {} }, getFolderById: id => Object.values(folders).find(f => f.id === id), Access: { PRIVATE: "PRIVATE" } },
    SpreadsheetApp: { create: name => { mkSheet("log"); const ss = { getId: () => "SS", getSheets: () => [sheets["log"]], getSheetByName: n => sheets[n] || null, insertSheet: n => mkSheet(n) }; files.push({ name, folder: "root/קליטת עובדים", ss }); return ss; }, open: f => f.ss },
    MailApp: { getRemainingDailyQuota: () => opts.quota === undefined ? 100 : opts.quota,
      sendEmail: m => { const doc = !!m.attachments; if (doc && opts.failMail && opts.failMail-- > 0) throw new Error("mail-down"); mails.push(m); if (doc && opts.throwAfterMail && opts.throwAfterMail-- > 0) throw new Error("timeout-after-send"); } },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: "json" } }
  };
  vm.createContext(env); vm.runInContext(code, env);
  env.setup();
  env._state = { props, mails, files, sheets, opts };
  return env;
}
const tokFromMail = E => { const m = E._state.mails.filter(x => /קישור מעסיק/.test(x.subject)).pop(); return JSON.parse(Buffer.from(m.htmlBody.split("#s=")[1].split("<")[0], "base64").toString("utf8")).tok; };
const employer = (E, email, ind, cid) => { E.mintEmployer(email, "טייפון בע\"מ", "515151515", cid || "C-100", ind); const tok = tokFromMail(E); E._state.mails.length = 0; return tok; };
const pdfB = s => Buffer.from(s).toString("base64");
const pdf = pdfB("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /FitH null] >> endobj\n" + "x".repeat(200) + "\n%%EOF\n");
const pdf2 = pdfB("%PDF-1.4\n2 0 obj << /Type /Page >> endobj\n" + "y".repeat(200) + "\n%%EOF\n");
const post = (env, o) => env.doPost({ postData: { contents: JSON.stringify(Object.assign({ app: "office-forms-v2" }, o)) } });
const L1 = "0123456789abcdef0123456789abcdef", L2 = "fedcba9876543210fedcba9876543210";
const terms = (id, owner, extra) => Object.assign({ v: 5, linkId: id, ownerEmail: owner, company: "טייפון", empName: "בדיקה", role: "עובד", manager: "נדב", signer: "נדב", harassContact: "נדב 0501234567", wage: "43", wageType: "hourly", weeklyHours: "40", start: "2026-12-01", mode: "new", f101: "print" }, extra || {});
const OWN = "nadavlevvy@gmail.com";
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } };
const pdfCount = E => E._state.files.filter(f => f.blob && f.blob.type === "application/pdf").length;
function ready(opts, tm) { const E = makeEnv(opts); const tok = employer(E, OWN); const r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok, terms: terms(L1, OWN, tm) }); return { E, tok, sha: r.sha }; }
const sub2 = (E, sha, docId, extra) => post(E, Object.assign({ action: "submit", linkId: L1, docId, termsHash: sha, mode: "print", agrVer: "3.4", files: [{ fname: "הסכם.pdf", pdf }, { fname: "101.pdf", pdf: pdf2 }] }, extra || {}));
const mails = E => E._state.mails.filter(m => !/קישור מעסיק|אישור תבנית/.test(m.subject));
const regOf = (E, id) => JSON.parse(E._state.props["L:" + (id || L1)]);

// ---------- הרשאת מעסיק ----------
let E = makeEnv();
const tokA = employer(E, OWN);
t("G-30: קישור המעסיק לא נרשם ביומן הריצה – נשלח רק למייל המשרד", !(E._logged || []).some(x => /#s=|tok/.test(x)));
let r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, terms: terms(L1, OWN) });
t("G-30: רישום בלי טוקן מעסיק נדחה", r.err === "not-authorized");
t("G-30: טוקן מזויף נדחה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: "0".repeat(32), terms: terms(L1, OWN) }).err === "not-authorized");
t("G-34: טוקן של מעסיק אחד לא עובד למייל אחר", post(E, { action: "register", linkId: L1, ownerEmail: "o@x.com", tok: tokA, terms: terms(L1, "o@x.com") }).err === "not-authorized");
t("G-34: תנאים עם מייל אחר מהמורשה נדחים", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, "attacker@evil.com") }).err === "mismatch");
t("G-34: מייל אחד לעסק אחד – שיוך ללקוח אחר נחסם", (() => { try { E.mintEmployer(OWN, "עסק אחר", "1", "C-200"); return false; } catch (e) { return /משויך/.test(e.message); } })());
t("G-34: מזהה לקוח בפורמט לא תקין נחסם", (() => { try { E.mintEmployer("z@z.com", "עסק", "1", "C 1/../x"); return false; } catch (e) { return true; } })());
t("G-28: מזהה קישור קצר מ-128 ביט נדחה", post(E, { action: "register", linkId: "0123456789abcdef", ownerEmail: OWN, tok: tokA, terms: terms("0123456789abcdef", OWN) }).err === "bad-link");
t("G-40: גרסת תנאים לא נתמכת נדחית בשרת", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { v: 4 }) }).err === "schema:version");
t("G-40: סכימה – חסר ממונה ישיר נדחה בשרת", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { manager: "" }) }).err === "schema:required");
t("G-02: סכימה – שכר לא מספרי נדחה בשרת", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { wage: "abc" }) }).err === "schema:wage");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { company: "עסק מזויף", companyId: "999" }) });
t("רישום מורשה מצליח ומחזיר טביעת תנאים", r.ok === true && /^[0-9a-f]{64}$/.test(r.sha));
const sha = r.sha;
r = post(E, { action: "get", linkId: L1 });
t("G-34: שם העסק ומזהה הלקוח מרשומת המעסיק בשרת", r.terms.company === "טייפון בע\"מ" && r.terms.companyId === "515151515" && r.terms.tenantId === "C-100");
t("G-29: העובד מקבל את התנאים מהשרת, בלי טוקן", r.sha === sha && !("tok" in r.terms));
t("G-29: אי אפשר לדרוס תנאים של קישור קיים", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { wage: "10" }) }).err === "exists");
E.revokeEmployer(OWN);
t("R3-01: אחרי ביטול מעסיק – קישור קיים לא נפתח", post(E, { action: "get", linkId: L1 }).err === "employer-revoked");
t("R3-01: אחרי ביטול מעסיק – שליחה מקישור קיים נדחית", sub2(E, sha, "ABCDE11111").err === "employer-revoked");
t("G-30: אחרי ביטול – הטוקן הישן לא יוצר קישורים", post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tokA, terms: terms(L2, OWN) }).err === "not-authorized");
const tokNew = employer(E, OWN);
t("R3-01: רוטציה – קישורים מהגרסה הקודמת נשארים חסומים (מדיניות: ביטול גורף)", post(E, { action: "get", linkId: L1 }).err === "employer-revoked");
t("G-30: רוטציה – טוקן חדש עובד", tokNew !== tokA && post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tokNew, terms: terms(L2, OWN) }).ok === true);
const rec = JSON.parse(E._state.props["E:" + OWN]); rec.exp = "2020-01-01T00:00:00Z"; E._state.props["E:" + OWN] = JSON.stringify(rec);
t("G-30: הרשאת מעסיק שפגה – גם קישור קיים נחסם", post(E, { action: "get", linkId: L2 }).err === "employer-revoked");

// ---------- G-12 / R3-05: אישור = תבנית חתומה ----------
E = makeEnv(); let tk = employer(E, OWN, "construction", "C-1");
t("R3-05: מעסיק בענף מאומת שולח general – השרת מחיל את הענף ודורש אישור", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "general" }) }).err === "not-approved");
t("G-12: officeOk בדף אינו אישור", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { officeOk: true }) }).err === "not-approved");
const ap = E.mintApproval(OWN, { role: "מלצר", wageType: "hourly", minWage: 45, sevPct: 6 }, 30);
t("G-12: חתימה מזויפת על תבנית נדחית", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", okTpl: ap.okTpl, okSig: "f".repeat(32) }) }).err === "not-approved");
t("R3-05: שינוי התבנית אחרי האישור – החתימה לא תקפה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", okTpl: Object.assign({}, ap.okTpl, { minWage: 40 }), okSig: ap.okSig }) }).err === "not-approved");
t("R3-05: שכר נמוך מהמאושר בתבנית נדחה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "44", okTpl: ap.okTpl, okSig: ap.okSig }) }).err === "not-approved");
t("R3-05: תפקיד אחר מהמאושר נדחה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "טבח", wage: "50", okTpl: ap.okTpl, okSig: ap.okSig }) }).err === "not-approved");
t("G-03/G-04: לילה שלא בתבנית – נדחה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", night: true, okTpl: ap.okTpl, okSig: ap.okSig }) }).err === "not-approved");
t("R3-05: בתוך התבנית החתומה – מתקבל", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", okTpl: ap.okTpl, okSig: ap.okSig }) }).ok === true);
t("G-12: תבנית שפג תוקפה נדחית", post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tk, terms: terms(L2, OWN, { role: "מלצר", wage: "50", okTpl: Object.assign({}, ap.okTpl, { exp: "2020-01-01" }), okSig: ap.okSig }) }).err === "not-approved");

// ---------- שליחה: מבנה, PDF, גודל, פרטיות ----------
let x = ready();
t("G-29: שליחה עם טביעת תנאים שונה נדחית", sub2(x.E, "0".repeat(64), "ABCDEF0123").err === "terms-mismatch" && mails(x.E).length === 0);
t("G-32: מסלול print – קובץ אחד נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }] }).err === "files");
t("R3-07: paper בשנה נתמכת (2026) נדחה", sub2(x.E, x.sha, "ABCDEF0123", { mode: "paper", files: [{ fname: "a.pdf", pdf }] }).err === "schema");
t("G-32: PDF עם JavaScript נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }, { fname: "b.pdf", pdf: pdfB("%PDF-1.4\n/JavaScript (x)\n%%EOF") }] }).err === "pdf-active-content");
t("G-32: PDF קטוע נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }, { fname: "b.pdf", pdf: pdfB("%PDF-1.4\nקטוע") }] }).err === "not-pdf");
t("G-33: גודל מצטבר נבדק לפני פענוח", /size|too-big/.test(sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf: "A".repeat(33 * 1024 * 1024) }, { fname: "b.pdf", pdf }] }).err));
t("R3-07: paper כשתחילת העבודה ב-2027 – מתקבל, print נדחה", (() => { const y = ready({}, { start: "2027-01-05" }); return sub2(y.E, y.sha, "ABCDE22222").err === "schema" && sub2(y.E, y.sha, "ABCDE22222", { mode: "paper", files: [{ fname: "a.pdf", pdf }] }).ok === true; })());
t("G-33: מכסת מייל נגמרה – לא שומרים כלום", (() => { const y = ready({ quota: 1 }); return sub2(y.E, y.sha, "ABCDEF0123").err === "quota" && pdfCount(y.E) === 0; })());
t("G-37: תיקייה משותפת בקישור – לא שומרים", (() => { const y = ready({ sharedFolder: "C-100" }); return sub2(y.E, y.sha, "ABCDEF0123").ok === false && mails(y.E).length === 0; })());
t("R3-08: משתמש נוסף עם הרשאה לתיקיית הלקוח – לא שומרים", (() => { const y = ready({ editorIn: "C-100" }); return sub2(y.E, y.sha, "ABCDEF0123").err === "folder-has-users" && mails(y.E).length === 0; })());
t("R3-08: משתמש נוסף בתיקיית הקישורים – לא נרשם קישור", (() => { const E2 = makeEnv({ editorIn: "_קישורים" }); const k = employer(E2, OWN); return post(E2, { action: "register", linkId: L1, ownerEmail: OWN, tok: k, terms: terms(L1, OWN) }).err === "folder-has-users"; })());
r = sub2(x.E, x.sha, "ABCDEF0123", { employeeEmail: "emp@example.com", ownerEmail: "attacker@evil.com" });
t("שליחה תקינה מתקבלת", r.ok === true);
const m0 = mails(x.E)[0];
t("הנמען לפי הרישום בשרת, העתק למשרד; לא למייל שהקלידו", mails(x.E).length === 1 && m0.to === OWN && m0.cc === ME && !x.E._state.mails.some(m => m.to === "emp@example.com"));
t("G-29: המייל כולל את התנאים מהשרת וטביעת התנאים", m0.htmlBody.includes("43 ₪ לשעה") && m0.htmlBody.includes("נדב") && m0.htmlBody.includes(x.sha));
const tasks = x.E._state.sheets["משימות"].rows;
t("G-09/11/19: גיליון משימות – אחראי, יעד וסטטוס 'פתוח' לכל משימה", tasks.length >= 4 && tasks.slice(1).every(r => r[5] === "המשרד" && /\d{4}-\d{2}-\d{2}/.test(r[6]) && r[7] === "פתוח"));
t("G-16: 101 להדפסה תמיד מקבל משימת 'בדיקת משרד לפני שימוש' – לא תלוי בדגל מהדף", tasks.some(r => /בדיקת משרד לפני שימוש/.test(r[4])));
t("G-13: קופה לא ידועה – משימה לעדכן", tasks.some(r => /לקבל שם קופה/.test(r[4])));
t("שני הקבצים נשמרו בתיקיית הלקוח בשם יציב", pdfCount(x.E) === 2 && x.E._state.files.filter(f => /\[ABCDEF0123-[12]\]\.pdf$/.test(f.name)).length === 2);
t("G-31: אותו מסמך שוב – כפילות, בלי מייל", sub2(x.E, x.sha, "ABCDEF0123").dup && mails(x.E).length === 1);
t("G-31: קישור שכבר נשלח – מסמך חדש נדחה", sub2(x.E, x.sha, "1111122222").err === "used");
t("G-40: קישור משומש לא נפתח שוב", post(x.E, { action: "get", linkId: L1 }).err === "used");
post(x.E, { action: "revoke", linkId: L1, tok: x.tok });
t("G-31: מסמך שהושלם – תשובה עקבית גם אחרי ביטול הקישור", sub2(x.E, x.sha, "ABCDEF0123").dup === true);

// ---------- R3-02: claim אטומי ----------
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc;
t("R3-02: נפילה בכתיבת התפיסה עצמה – אין שום תופעת לוואי", sub2(x.E, x.sha, "AAAAA00000").ok === false && pdfCount(x.E) === 0 && mails(x.E).length === 0 && !regOf(x.E).doc);
t("R3-02: מסמך B אחרי כך – מתקבל (A לא נתפס)", sub2(x.E, x.sha, "BBBBB00000").ok === true);
t("R3-02: ניסיון חוזר של A – נדחה (הקישור שייך ל-B), בלי מייל נוסף", sub2(x.E, x.sha, "AAAAA00000").err === "used" && mails(x.E).length === 1);
x = ready({ failSaveAt: 2 });
sub2(x.E, x.sha, "CCCCC00000");
t("R3-02: A נתקע באמצע – B נדחה ('busy')", sub2(x.E, x.sha, "DDDDD00000").err === "busy");

// ---------- R3-03: נפילה אחרי createFile ולפני שמירת המזהה ----------
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.files.length === 1;
t("R3-03: נפילה אחרי יצירת הקובץ הראשון", sub2(x.E, x.sha, "EEEEE00000").ok === false && pdfCount(x.E) === 1 && regOf(x.E).doc.files.length === 0);
t("R3-03: ניסיון חוזר מאתר את הקובץ לפי השם היציב – בלי כפילות", sub2(x.E, x.sha, "EEEEE00000").ok === true && pdfCount(x.E) === 2 && mails(x.E).length === 1);
x = ready({ failSaveAt: 2 });
t("G-39: כשל בשמירת הקובץ השני", sub2(x.E, x.sha, "FFFFF00000").ok === false && pdfCount(x.E) === 1);
t("G-39: ניסיון חוזר – רק הקובץ החסר נוצר", sub2(x.E, x.sha, "FFFFF00000").ok === true && pdfCount(x.E) === 2);

// ---------- R3-04: מייל – תופעת לוואי ואז חריגה ----------
x = ready({ throwAfterMail: 1 });
r = sub2(x.E, x.sha, "AAAAA11111");
t("R3-04: המייל יצא ואז חריגה – needs-review", r.err === "needs-review" && mails(x.E).length === 1 && regOf(x.E).doc.mail === "needs-review");
t("R3-04: ניסיון חוזר – לא שולחים שוב", sub2(x.E, x.sha, "AAAAA11111").err === "needs-review" && mails(x.E).length === 1);
t("R3-04: נפתחה משימה לבדיקה ידנית של המייל", x.E._state.sheets["משימות"].rows.some(r => /לא ודאי אם נשלח/.test(r[4])));
x.E.resolveDoc("AAAAA11111", "sent");
t("R3-04: המשרד אישר 'נשלח' – השלמה בלי מייל נוסף", sub2(x.E, x.sha, "AAAAA11111").ok === true && mails(x.E).length === 1);
x = ready({ failMail: 1 });
t("G-39: כשל לפני מסירה – גם הוא needs-review (לא מניחים)", sub2(x.E, x.sha, "AAAAA22222").err === "needs-review" && mails(x.E).length === 0);
x.E.resolveDoc("AAAAA22222", "resend");
t("G-39: המשרד אישר 'לשלוח שוב' – נשלח פעם אחת", sub2(x.E, x.sha, "AAAAA22222").ok === true && mails(x.E).length === 1);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.mail === "sent";
t("G-39: נפילה בכתיבת 'sent' – נשאר pending", sub2(x.E, x.sha, "AAAAA33333").ok === false && regOf(x.E).doc.mail === "pending");
t("G-39: ניסיון חוזר – needs-review, בלי מייל שני", sub2(x.E, x.sha, "AAAAA33333").err === "needs-review" && mails(x.E).length === 1);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.state === "done";
sub2(x.E, x.sha, "AAAAA44444");
t("G-39: נפילה אחרי יומן – ניסיון חוזר לא משכפל יומן/משימות", sub2(x.E, x.sha, "AAAAA44444").ok === true && x.E._state.sheets["log"].rows.length === 2 && mails(x.E).length === 1 &&
  x.E._state.sheets["משימות"].rows.filter(r => /101: לקבל טופס חתום/.test(r[4])).length === 1);
x = ready({ failSaveAt: 2 }); sub2(x.E, x.sha, "AAAAA55555"); x.E._state.opts.quota = 0;
t("G-33: מכסה נבדקת גם בניסיון חוזר לפני מייל", sub2(x.E, x.sha, "AAAAA55555").err === "quota" && mails(x.E).length === 0);

// ---------- ביטול / תפוגה / קצב ----------
x = ready({ failSaveAt: 1 }); sub2(x.E, x.sha, "AAAAA66666"); post(x.E, { action: "revoke", linkId: L1, tok: x.tok });
t("G-31: ביטול באמצע – ניסיון חוזר נדחה", sub2(x.E, x.sha, "AAAAA66666").err === "revoked");
x = ready({ failSaveAt: 1 }); sub2(x.E, x.sha, "AAAAA77777");
let rg = regOf(x.E); rg.exp = new Date(Date.now() - 2 * 864e5).toISOString(); x.E._state.props["L:" + L1] = JSON.stringify(rg);
t("G-31: פג לפני יומיים – ניסיון חוזר מותר (חסד 7 ימים)", sub2(x.E, x.sha, "AAAAA77777").ok === true);
x = ready({ failSaveAt: 1 }); sub2(x.E, x.sha, "AAAAA88888");
rg = regOf(x.E); rg.exp = new Date(Date.now() - 10 * 864e5).toISOString(); x.E._state.props["L:" + L1] = JSON.stringify(rg);
t("G-31: אחרי תקופת החסד – נדחה", sub2(x.E, x.sha, "AAAAA88888").err === "expired");
x = ready();
t("G-40: ביטול קישור בלי טוקן נדחה", post(x.E, { action: "revoke", linkId: L1 }).ok === false);
t("G-40: המעסיק מבטל קישור", post(x.E, { action: "revoke", linkId: L1, tok: x.tok }).ok === true && post(x.E, { action: "get", linkId: L1 }).err === "revoked");
t("העלאה מקישור לא רשום נדחית", post(x.E, { action: "submit", linkId: "abcdefabcdefabcdefabcdefabcdefab", docId: "ABCDEF0123", files: [] }).err === "unregistered-link");
t("G-37: דוח רשומות ישנות לא מוחק", (() => { const n = Object.keys(x.E._state.props).length; x.E.reportStale(0); return Object.keys(x.E._state.props).length === n; })());
E = makeEnv(); let blocked = false;
for (let i = 0; i < 130; i++) { if (post(E, { action: "get", linkId: L1 }).err === "rate") blocked = true; }
t("הגבלת קצב עוצרת הצפה", blocked);

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
