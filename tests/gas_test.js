// בדיקות לסקריפט Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל. הרצה: node tests/gas_test.js
const fs = require("fs"), vm = require("vm"), crypto = require("crypto"), path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");
const sb = a => a.map(b => b > 127 ? b - 256 : b);

function makeEnv(opts = {}) {
  const props = {}, cache = {}, mails = [], files = [], folders = {}, logRows = [];
  const mkFile = (name, folder, blob) => { const f = { id: "F" + files.length, name, blob, folder, desc: "", setDescription(d) { this.desc = d; }, getId() { return this.id; }, moveTo() {},
    getBlob() { return { getDataAsString: () => typeof blob.bytes === "string" ? blob.bytes : Buffer.from(blob.bytes.map(b => b & 255)).toString("utf8") }; } }; files.push(f); return f; };
  let pdfSaves = 0;
  const mkFolder = name => folders[name] || (folders[name] = {
    name, getFoldersByName: n => { const f = folders[name + "/" + n]; return { hasNext: () => !!f, next: () => f }; },
    createFolder: n => mkFolder(name + "/" + n),
    getSharingAccess: () => (opts.sharedFolder && name.includes(opts.sharedFolder)) ? "ANYONE_WITH_LINK" : "PRIVATE",
    createFile: b => { if (b.type === "application/pdf") { pdfSaves++; if (opts.failSaveAt === pdfSaves) throw new Error("drive-down"); } return mkFile(b.name, name, b); },
    getFilesByName: n => { const f = files.find(x => x.folder === name && x.name === n); return { hasNext: () => !!f, next: () => f }; }
  });
  const root = mkFolder("root");
  let sets = 0;
  const sheet = { rows: logRows, appendRow: r => logRows.push(r), protect: () => ({ setDescription() { return this; }, removeEditors() {}, getEditors: () => [], canDomainEdit: () => false }),
    getDataRange: () => ({ getValues: () => logRows.map(r => r.slice()) }), getRange: (row, col, n, w) => ({ setValues: v => { logRows[row - 1] = v[0]; } }) };
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => Object.assign({}, props),
      setProperty: (k, v) => { sets++; if (opts.throwOnSet && opts.throwOnSet(k, JSON.parse(v.startsWith("{") ? v : "{}"), sets)) { opts.throwOnSet = null; throw new Error("crash"); } props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Utilities: {
      base64Decode: s => sb(Array.from(Buffer.from(s, "base64"))),
      base64EncodeWebSafe: (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      computeDigest: (alg, data) => sb(Array.from(crypto.createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.map(b => b & 255))).digest())),
      computeHmacSha256Signature: (v, k) => sb(Array.from(crypto.createHmac("sha256", k).update(v).digest())),
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }
    },
    DriveApp: { getRootFolder: () => root, getFileById: id => files.find(f => f.id === id) || { moveTo() {} }, Access: { PRIVATE: "PRIVATE" } },
    SpreadsheetApp: { create: name => { const ss = { getId: () => "SS", getSheets: () => [sheet] }; files.push({ name, folder: "root/קליטת עובדים", ss }); return ss; }, open: f => f.ss },
    MailApp: { getRemainingDailyQuota: () => opts.quota === undefined ? 100 : opts.quota,
      sendEmail: m => { if (opts.failMail && opts.failMail-- > 0) throw new Error("mail-down"); mails.push(m); } },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: "json" } }
  };
  vm.createContext(env); vm.runInContext(code, env);
  env.setup();
  env._state = { props, mails, files, logRows, opts };
  return env;
}
const tokOf = link => JSON.parse(Buffer.from(link.split("#s=")[1], "base64").toString("utf8")).tok;
const pdfB = s => Buffer.from(s).toString("base64");
const pdf = pdfB("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /FitH null] >> endobj\n" + "x".repeat(200) + "\n%%EOF\n");
const pdf2 = pdfB("%PDF-1.4\n2 0 obj << /Type /Page >> endobj\n" + "y".repeat(200) + "\n%%EOF\n");
const post = (env, o) => env.doPost({ postData: { contents: JSON.stringify(Object.assign({ app: "office-forms-v2" }, o)) } });
const L1 = "0123456789abcdef0123456789abcdef", L2 = "fedcba9876543210fedcba9876543210", L3 = "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb";
const terms = (id, owner, extra) => Object.assign({ v: 5, linkId: id, ownerEmail: owner, company: "טייפון", empName: "בדיקה", role: "עובד", manager: "נדב", wage: "43", wageType: "hourly", weeklyHours: "40", start: "2026-12-01", mode: "new", f101: "print" }, extra || {});
const OWN = "nadavlevvy@gmail.com";
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } };
const pdfCount = E => E._state.files.filter(f => f.blob && f.blob.type === "application/pdf").length;
function ready(opts, tm) { const E = makeEnv(opts); const tok = tokOf(E.mintEmployer(OWN, "טייפון בע\"מ", "515151515", "C-100")); const r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok, terms: terms(L1, OWN, tm) }); return { E, tok, sha: r.sha }; }
const sub2 = (E, sha, docId, extra) => post(E, Object.assign({ action: "submit", linkId: L1, docId, termsHash: sha, mode: "print", agrVer: "3.3", files: [{ fname: "הסכם.pdf", pdf }, { fname: "101.pdf", pdf: pdf2 }] }, extra || {}));

// ---------- הרשאת מעסיק ----------
let E = makeEnv();
const link = E.mintEmployer(OWN, "טייפון בע\"מ", "515151515", "C-100"), tokA = tokOf(link);
let r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, terms: terms(L1, OWN) });
t("G-30: רישום בלי טוקן מעסיק נדחה", r.ok === false && r.err === "not-authorized");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: "0".repeat(32), terms: terms(L1, OWN) });
t("G-30: טוקן מזויף נדחה", r.err === "not-authorized");
r = post(E, { action: "register", linkId: L1, ownerEmail: "other@x.com", tok: tokA, terms: terms(L1, "other@x.com") });
t("G-34: טוקן של מעסיק אחד לא עובד למייל אחר", r.err === "not-authorized");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, "attacker@evil.com") });
t("G-34: תנאים עם מייל אחר מהמורשה נדחים", r.err === "mismatch");
r = post(E, { action: "register", linkId: "0123456789abcdef", ownerEmail: OWN, tok: tokA, terms: terms("0123456789abcdef", OWN) });
t("G-28: מזהה קישור קצר מ-128 ביט נדחה", r.err === "bad-link");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { company: "עסק מזויף", companyId: "999" }) });
t("רישום מורשה מצליח ומחזיר טביעת תנאים", r.ok === true && /^[0-9a-f]{64}$/.test(r.sha));
const sha = r.sha;
r = post(E, { action: "get", linkId: L1 });
t("G-34: שם העסק ומזהה הלקוח נקבעים מרשומת המעסיק בשרת, לא מהדף", r.terms.company === "טייפון בע\"מ" && r.terms.companyId === "515151515" && r.terms.tenantId === "C-100");
t("G-29: העובד מקבל את התנאים מהשרת, בלי טוקן", r.ok && r.terms.wage === "43" && r.sha === sha && !("tok" in r.terms));
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tokA, terms: terms(L1, OWN, { wage: "10" }) });
t("G-29: אי אפשר לדרוס תנאים של קישור קיים", r.err === "exists");
E.revokeEmployer(OWN);
r = post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tokA, terms: terms(L2, OWN) });
t("G-30: אחרי ביטול מעסיק – הטוקן הישן לא עובד", r.err === "not-authorized");
const tokNew = tokOf(E.mintEmployer(OWN, "טייפון בע\"מ", "515151515", "C-100"));
t("G-30: רוטציה – טוקן חדש שונה ועובד, הישן לא", tokNew !== tokA && post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tokNew, terms: terms(L2, OWN) }).ok === true);
const rec = JSON.parse(E._state.props["E:" + OWN]); rec.exp = "2020-01-01T00:00:00Z"; E._state.props["E:" + OWN] = JSON.stringify(rec);
t("G-30: הרשאת מעסיק שפג תוקפה נדחית", post(E, { action: "register", linkId: L3, ownerEmail: OWN, tok: tokNew, terms: terms(L3, OWN) }).err === "not-authorized");

// ---------- G-12: אישור ענף חתום בשרת ----------
E = makeEnv(); let tk = tokOf(E.mintEmployer(OWN, "טייפון", "1", "C-1"));
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "construction", officeOk: true }) });
t("G-12: ענף בלי אישור חתום נדחה בשרת (גם עם טוקן תקף ו-officeOk)", r.err === "branch-not-approved");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "construction", okSig: "f".repeat(32), okExp: "2099-01-01" }) });
t("G-12: חתימת אישור מזויפת נדחית", r.err === "branch-not-approved");
const ap = E.mintApproval(OWN, "cleaning", "", 30);
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "construction", okSig: ap.okSig, okExp: ap.okExp }) });
t("G-12: אישור לענף אחר לא תקף לענף הזה", r.err === "branch-not-approved");
r = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "construction", collective: "הסכם", okSig: ap.okSig, okExp: ap.okExp }) });
t("G-12: אישור בלי ההסכם הקיבוצי לא תקף כשמוזן הסכם", r.err === "branch-not-approved");
const ap2 = E.mintApproval(OWN, "construction", "", 30);
t("G-12: אישור חתום לענף ולמעסיק – מתקבל", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { industry: "construction", okSig: ap2.okSig, okExp: ap2.okExp }) }).ok === true);
const ap3 = E.mintApproval(OWN, "construction", "", 30); ap3.okExp = "2020-01-01";
t("G-12: אישור שפג תוקפו נדחה", post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tk, terms: terms(L2, OWN, { industry: "construction", okSig: ap3.okSig, okExp: "2020-01-01" }) }).err === "branch-not-approved");
const tk2 = tokOf(E.mintEmployer(OWN, "טייפון", "1", "C-1"));
t("G-12: אחרי רוטציה, אישור ענף ישן לא תקף", post(E, { action: "register", linkId: L3, ownerEmail: OWN, tok: tk2, terms: terms(L3, OWN, { industry: "construction", okSig: ap2.okSig, okExp: ap2.okExp }) }).err === "branch-not-approved");

// ---------- שליחה: מבנה, PDF, גודל ----------
let x = ready();
r = sub2(x.E, "0".repeat(64), "ABCDEF0123");
t("G-29: שליחה עם טביעת תנאים שונה נדחית", r.err === "terms-mismatch" && x.E._state.mails.length === 0);
t("G-32: מסלול 101 להדפסה – קובץ אחד במקום שניים נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }] }).err === "files");
t("G-32: מסלול שלא נרשם לקישור נדחה (change על קישור עובד חדש)", sub2(x.E, x.sha, "ABCDEF0123", { mode: "change", files: [{ fname: "a.pdf", pdf }] }).err === "schema");
t("G-32: PDF עם JavaScript נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }, { fname: "b.pdf", pdf: pdfB("%PDF-1.4\n/JavaScript (app.alert(1))\n%%EOF") }] }).err === "pdf-active-content");
t("G-32: PDF קטוע (בלי %%EOF) נדחה", sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf }, { fname: "b.pdf", pdf: pdfB("%PDF-1.4\nקטוע") }] }).err === "not-pdf");
t("G-33: גודל מצטבר נבדק לפני פענוח", /size|too-big/.test(sub2(x.E, x.sha, "ABCDEF0123", { files: [{ fname: "a.pdf", pdf: "A".repeat(33 * 1024 * 1024) }, { fname: "b.pdf", pdf }] }).err));
t("G-33: אין שליחה כשמכסת המייל היומית נגמרה – לפני כל שמירה", (() => { const y = ready({ quota: 1 }); const q = sub2(y.E, y.sha, "ABCDEF0123"); return q.err === "quota" && pdfCount(y.E) === 0; })());
t("G-37: תיקייה משותפת בקישור – לא שומרים בה", (() => { const y = ready({ sharedFolder: "C-100" }); return sub2(y.E, y.sha, "ABCDEF0123").ok === false && y.E._state.mails.length === 0; })());
r = sub2(x.E, x.sha, "ABCDEF0123", { employeeEmail: "emp@example.com", ownerEmail: "attacker@evil.com" });
t("שליחה תקינה מתקבלת", r.ok === true);
const m0 = x.E._state.mails[0];
t("הנמען לפי הרישום בשרת, העתק למשרד", x.E._state.mails.length === 1 && m0.to === OWN && m0.cc === "cpa.snir@gmail.com");
t("G-35: אין מייל לכתובת שהעובד או הדף הקלידו", !x.E._state.mails.some(m => m.to === "emp@example.com" || m.to === "attacker@evil.com"));
t("G-29: המייל כולל את התנאים מהשרת (כולל ממונה ושעות) ואת טביעת התנאים", m0.htmlBody.includes("43 ₪ לשעה") && m0.htmlBody.includes("נדב") && m0.htmlBody.includes(x.sha));
t("G-19/G-11: המייל והיומן כוללים משימות פתוחות (101 ממתין לחתימה, פנסיה)", m0.htmlBody.includes("101 ממתין לחתימה") && x.E._state.logRows[1][12].includes("פנסיה"));
t("שני הקבצים נשמרו בתיקיית הלקוח לפי מזהה לקוח", pdfCount(x.E) === 2 && x.E._state.files.filter(f => /טייפון בע מ – C-100/.test(f.folder)).length === 2);
r = sub2(x.E, x.sha, "ABCDEF0123");
t("G-31: אותו מסמך שוב – לא נשלח שוב", r.dup && x.E._state.mails.length === 1);
t("G-31: קישור שכבר נשלח – מסמך חדש נדחה", sub2(x.E, x.sha, "1111122222").err === "used");
t("G-40: קישור משומש לא נפתח שוב", post(x.E, { action: "get", linkId: L1 }).err === "used");

// ---------- G-31 + G-39: כשלים ----------
x = ready({ failMail: 1 });
t("G-39: כשל מייל ודאי מחזיר שגיאה", sub2(x.E, x.sha, "AAAAA00000").ok === false && x.E._state.mails.length === 0);
t("G-31: בזמן ש-A תקוע, מסמך B מאותו קישור נדחה", sub2(x.E, x.sha, "BBBBB00000").err === "busy");
r = sub2(x.E, x.sha, "AAAAA00000");
t("G-39: ניסיון חוזר של A משלים – בלי שמירה כפולה, מייל אחד", r.ok === true && x.E._state.mails.length === 1 && pdfCount(x.E) === 2);

x = ready({ failSaveAt: 2 });
t("G-39: כשל בשמירת הקובץ השני", sub2(x.E, x.sha, "CCCCC00000").ok === false && pdfCount(x.E) === 1);
r = sub2(x.E, x.sha, "CCCCC00000");
t("G-39: ניסיון חוזר שומר רק את הקובץ החסר (בלי כפילות של הראשון)", r.ok === true && pdfCount(x.E) === 2 && x.E._state.mails.length === 1);

x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("D:") && v.mail === "sent";
t("G-39: נפילה אחרי שהמייל יצא ולפני שנרשם", sub2(x.E, x.sha, "DDDDD00000").ok === false && x.E._state.mails.length === 1);
r = sub2(x.E, x.sha, "DDDDD00000");
t("G-39: מצב לא ודאי – לא שולחים שוב, עוצרים לבדיקה", r.err === "needs-review" && x.E._state.mails.length === 1);

x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("D:") && v.state === "done";
t("G-39: נפילה אחרי כתיבת היומן", sub2(x.E, x.sha, "EEEEE00000").ok === false && x.E._state.logRows.length === 2);
r = sub2(x.E, x.sha, "EEEEE00000");
t("G-39: ניסיון חוזר – היומן מתעדכן ולא משוכפל, בלי מייל נוסף", r.ok === true && x.E._state.logRows.length === 2 && x.E._state.mails.length === 1);

x = ready({ failMail: 1 }); sub2(x.E, x.sha, "FFFFF00000"); post(x.E, { action: "revoke", linkId: L1, tok: x.tok });
t("G-31: אחרי ביטול באמצע – ניסיון חוזר נדחה", sub2(x.E, x.sha, "FFFFF00000").err === "revoked" && x.E._state.mails.length === 0);

x = ready({ failMail: 1 }); sub2(x.E, x.sha, "AAAAA11111");
let rg = JSON.parse(x.E._state.props["L:" + L1]); rg.exp = new Date(Date.now() - 2 * 864e5).toISOString(); x.E._state.props["L:" + L1] = JSON.stringify(rg);
t("G-31: קישור שפג לפני יומיים – ניסיון חוזר של המסמך הפעיל מותר (חסד 7 ימים)", sub2(x.E, x.sha, "AAAAA11111").ok === true);
rg = JSON.parse(x.E._state.props["L:" + L1]);
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "AAAAA22222");
rg = JSON.parse(x.E._state.props["L:" + L1]); rg.exp = new Date(Date.now() - 10 * 864e5).toISOString(); x.E._state.props["L:" + L1] = JSON.stringify(rg);
t("G-31: אחרי תקופת החסד – נדחה", sub2(x.E, x.sha, "AAAAA22222").err === "expired");

// ---------- ביטול, תפוגה, קצב ----------
x = ready();
t("G-40: ביטול בלי טוקן נדחה", post(x.E, { action: "revoke", linkId: L1 }).ok === false);
t("G-40: המעסיק מבטל קישור", post(x.E, { action: "revoke", linkId: L1, tok: x.tok }).ok === true && post(x.E, { action: "get", linkId: L1 }).err === "revoked");
x = ready(); rg = JSON.parse(x.E._state.props["L:" + L1]); rg.exp = "2020-01-01T00:00:00Z"; x.E._state.props["L:" + L1] = JSON.stringify(rg);
t("G-40: קישור שפג תוקפו לא נפתח", post(x.E, { action: "get", linkId: L1 }).err === "expired");
t("העלאה מקישור לא רשום נדחית", post(x.E, { action: "submit", linkId: "abcdefabcdefabcdefabcdefabcdefab", docId: "ABCDEF0123", files: [{ fname: "a.pdf", pdf }] }).err === "unregistered-link");
t("מזהה מסמך לא תקין נדחה", post(x.E, { action: "submit", linkId: L1, docId: "<script>", files: [] }).ok === false);
t("G-37: דוח רשומות ישנות לא מוחק כלום", (() => { const before = Object.keys(x.E._state.props).length; x.E.reportStale(0); return Object.keys(x.E._state.props).length === before; })());
E = makeEnv(); let blocked = false;
for (let i = 0; i < 130; i++) { const y = post(E, { action: "get", linkId: L1 }); if (y.err === "rate") blocked = true; }
t("הגבלת קצב עוצרת הצפה", blocked);

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
