// בדיקות לסקריפט Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל. הרצה: node tests/gas_test.js
const fs = require("fs"), vm = require("vm"), crypto = require("crypto"), path = require("path");
// השרת = rules.gs (עותק זהה של rules.js) + Code.gs – בדיוק כמו בפרויקט Apps Script
const rulesSrc = fs.readFileSync(path.join(__dirname, "..", "rules.js"), "utf8");
if (rulesSrc !== fs.readFileSync(path.join(__dirname, "..", "apps-script", "rules.gs"), "utf8")) { console.log("✗ apps-script/rules.gs שונה מ-rules.js"); process.exit(1); }
const code = rulesSrc + "\n" + fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");
const sb = a => a.map(b => b > 127 ? b - 256 : b);
const ME = "cpa.snir@gmail.com";

function makeEnv(opts = {}) {
  const props = {}, cache = {}, mails = [], files = [], folders = {}, sheets = {};
  let pdfSaves = 0, fid = 0;
  const mkFile = (name, folder, blob) => { const f = { id: "F" + files.length, name, blob, folder, desc: "", trashed: false, shared: false, extraUser: null, setDescription(d) { this.desc = d; }, getId() { return this.id; }, moveTo() {}, isTrashed() { return this.trashed; },
    getParents() { const p = [folders[this.folder]]; let i = 0; return { hasNext: () => i < p.length, next: () => p[i++] }; }, getMimeType() { return this.blob.type || "application/json"; },
    getSharingAccess() { return this.shared ? "ANYONE_WITH_LINK" : "PRIVATE"; }, getEditors() { return [user(ME)].concat(this.extraUser ? [user(this.extraUser)] : []); }, getViewers() { return []; },
    getBlob() { const b = this.blob; return { getBytes: () => b.bytes, getDataAsString: () => typeof b.bytes === "string" ? b.bytes : Buffer.from(b.bytes.map(x => x & 255)).toString("utf8") }; } }; files.push(f); return f; };
  const user = m => ({ getEmail: () => m });
  const mkFolder = name => folders[name] || (folders[name] = {
    name, id: "D" + (fid++), getId() { return this.id; },
    getFoldersByName: n => { const f = folders[name + "/" + n]; return { hasNext: () => !!f, next: () => f }; },
    createFolder: n => mkFolder(name + "/" + n),
    getSharingAccess: () => (opts.sharedFolder && name.includes(opts.sharedFolder)) ? "ANYONE_WITH_LINK" : "PRIVATE",
    getEditors: () => [user(ME)].concat(opts.editorIn && name.includes(opts.editorIn) ? [user("stranger@x.com")] : []),
    getViewers: () => [],
    createFile: b => { if (b.type === "application/pdf") { pdfSaves++; if (opts.failSaveAt === pdfSaves) throw new Error("drive-down"); } return mkFile(b.name, name, b); },
    getFilesByName: n => { const l = files.filter(x => x.folder === name && x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }
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
      formatDateX: null,
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
const WEEK = ["09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-17:00", "", ""];
const terms = (id, owner, extra) => Object.assign({ v: 5, linkId: id, ownerEmail: owner, company: "טייפון", address: "הרצל 1, חיפה", empName: "בדיקה", role: "עובד", manager: "נדב", signer: "נדב", harassContact: "נדב 0501234567",
  agrVer: "3.6 (11/2026)", wage: "43", wageType: "hourly", weeklyHours: "36.25", days: WEEK, pattern: "5", shortDay: "4", breakMin: "45", restDay: "שבת", sec14: true, sevPct: "6", start: "2026-12-01", mode: "new", f101: "print" }, extra || {});
const OWN = "nadavlevvy@gmail.com";
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } };
const pdfCount = E => E._state.files.filter(f => f.blob && f.blob.type === "application/pdf").length;
function vmSet(E, name, fn) { E[name] = fn; }
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
const NIGHT = ["16:00-24:00", "16:00-24:00", "16:00-24:00", "16:00-24:00", "16:00-24:00", "", ""];
t("R4-02: סידור לילה עם night=false (דף ששונה) – השרת מחשב מהשעות ודוחה", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", days: NIGHT, night: false, okTpl: ap.okTpl, okSig: ap.okSig }) }).err === "not-approved");
t("R4-02: הפסקה חסרה (0) בלי היתר בתבנית – השרת דוחה גם בלי דגל", post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN, { role: "מלצר", wage: "50", breakMin: "0", weeklyHours: "40", okTpl: ap.okTpl, okSig: ap.okSig }) }).err === "not-approved");
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
t("R3-07: כששנת המס אינה 2026 – paper מתקבל, print נדחה", (() => { const y = ready(); const g = regOf(y.E); g.start = "2027-01-05"; y.E._state.props["L:" + L1] = JSON.stringify(g); return sub2(y.E, y.sha, "ABCDE22222").err === "schema" && sub2(y.E, y.sha, "ABCDE22222", { mode: "paper", files: [{ fname: "a.pdf", pdf }] }).ok === true; })());
t("R4-07: retry שחוצה שנה – המסלול שנקבע ב-claim נשמר (print), בלי תקיעה", (() => { const y = ready({ failSaveAt: 2 }); sub2(y.E, y.sha, "ABCDE33333"); const g = regOf(y.E); g.start = "2027-01-05"; y.E._state.props["L:" + L1] = JSON.stringify(g); return sub2(y.E, y.sha, "ABCDE33333").ok === true && sub2(y.E, y.sha, "ABCDE33333", { mode: "paper", files: [{ fname: "a.pdf", pdf }] }).dup === true; })());
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
t("G-09/11/19: גיליון משימות – מפתח יציב, אחראי, יעד וסטטוס 'פתוח'", tasks.length >= 4 && tasks.slice(1).every(r => r[0].includes("|" + L1 + "|") && r[6] === "המשרד" && /\d{4}-\d{2}-\d{2}/.test(r[7]) && r[9] === "פתוח"));
t("G-16: 101 להדפסה תמיד מקבל משימת 'בדיקת משרד לפני שימוש' – לא תלוי בדגל מהדף", tasks.some(r => /בדיקת משרד לפני שימוש/.test(r[5])));
t("G-13: קופה לא ידועה – משימה לעדכן", tasks.some(r => /לקבל שם קופה/.test(r[5])));
t("G-11: משימת פנסיה – יעד לפני השכר הראשון (1.1.2027 לעובד שמתחיל 1.12.2026)", tasks.some(r => r[0].endsWith("|pension") && r[7] === "2027-01-01"));
t("G-39: שני הקבצים נשמרו בשם שרתי לפי ה-manifest (linkId), לא לפי שם מהדף", pdfCount(x.E) === 2 && x.E._state.files.filter(f => f.name.includes("[" + L1 + "-") && !f.name.includes("101.pdf")).length === 2);
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
t("R3-04: נפתחה משימה לבדיקה ידנית של המייל", x.E._state.sheets["משימות"].rows.some(r => /לא ודאי אם נשלח/.test(r[5])));
x.E.resolveDoc(L1, "sent");
t("R3-04: המשרד אישר 'נשלח' – השלמה בלי מייל נוסף", sub2(x.E, x.sha, "AAAAA11111").ok === true && mails(x.E).length === 1);
x = ready({ failMail: 1 });
t("G-39: כשל לפני מסירה – גם הוא needs-review (לא מניחים)", sub2(x.E, x.sha, "AAAAA22222").err === "needs-review" && mails(x.E).length === 0);
x.E.resolveDoc(L1, "resend");
t("G-39: המשרד אישר 'לשלוח שוב' – נשלח פעם אחת", sub2(x.E, x.sha, "AAAAA22222").ok === true && mails(x.E).length === 1);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.mail === "sent";
t("G-39: נפילה בכתיבת 'sent' – נשאר pending", sub2(x.E, x.sha, "AAAAA33333").ok === false && regOf(x.E).doc.mail === "pending");
t("G-39: ניסיון חוזר – needs-review, בלי מייל שני", sub2(x.E, x.sha, "AAAAA33333").err === "needs-review" && mails(x.E).length === 1);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.state === "done";
sub2(x.E, x.sha, "AAAAA44444");
t("G-39: נפילה אחרי יומן – ניסיון חוזר לא משכפל יומן/משימות", sub2(x.E, x.sha, "AAAAA44444").ok === true && x.E._state.sheets["log"].rows.length === 2 && mails(x.E).length === 1 &&
  x.E._state.sheets["משימות"].rows.filter(r => /101: לקבל טופס חתום/.test(r[5])).length === 1);
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

// ---------- סבב 4 ----------
E = makeEnv(); tk = employer(E, OWN);
const bad = (extra, code) => { const q = post(E, { action: "register", linkId: L3x(), ownerEmail: OWN, tok: tk, terms: terms(lastL, OWN, extra) }); return q.err === code ? q : null; };
let lastL = ""; let nL = 0; function L3x() { nL++; lastL = (nL.toString(16).padStart(2, "0")).repeat(16); return lastL; }
t("R4-01: שכר שעתי 1 – השרת דוחה (כללי שכר מינימום משותפים)", !!bad({ wage: "1" }, "rules"));
t("R4-01: היקף 100 – השרת דוחה", !!bad({ weeklyHours: "100" }, "rules"));
t("R4-01: תאריך שלא קיים (31.2) – השרת דוחה", !!bad({ start: "2026-02-31" }, "schema:date"));
t("R4-01: חודשי מתחת למינימום היחסי – השרת דוחה, עם פירוט", (() => { const q = bad({ wageType: "monthly", wage: "3000" }, "rules"); return q && q.detail.some(x => /נמוך משכר המינימום היחסי/.test(x)); })());
t("R4-01: מינימום לפי מועד – 35 ₪ במרץ 2026 תקין, במאי 2026 נדחה", !bad({ wage: "35", start: "2026-03-01" }, "rules") && !!bad({ wage: "35", start: "2026-05-01" }, "rules"));
t("R4-01: סידור שלא תואם להיקף – השרת דוחה", !!bad({ weeklyHours: "20" }, "rules"));
t("R4-01: בלי ימים ושעות – השרת דוחה", !!bad({ days: ["", "", "", "", "", "", ""] }, "rules"));

// R4-03: יעד לפי תחילת העבודה, לא לפי מועד הקליטה
x = ready({}, { start: "2025-11-02" });
let qq = sub2(x.E, x.sha, "AAAAA99999");
const tk3 = x.E._state.sheets["משימות"].rows;
t("R4-03: קליטה מאוחרת – יעד 101 נשאר תחילה+7 (2025-11-09) ומסומן באיחור", qq.ok && tk3.some(r => r[0].endsWith("|101-sign") && r[7] === "2025-11-09" && r[8] === "כן"));

// R4-04: כשל אחרי appendRow ראשון / אחרון; לא מוחק אסמכתה
x = ready(); let appends = 0;
const shOrig = () => x.E._state.sheets["משימות"];
x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.state === "done";
sub2(x.E, x.sha, "BBBBB99999");
const before4 = shOrig().rows.length;
shOrig().rows[1][10] = "אסמכתה 123"; shOrig().rows[1][9] = "סגור";
t("R4-04: אחרי כשל לפני save – ניסיון חוזר לא משכפל משימות ולא דורס סטטוס/אסמכתה", sub2(x.E, x.sha, "BBBBB99999").ok === true && shOrig().rows.length === before4 && shOrig().rows[1][10] === "אסמכתה 123" && shOrig().rows[1][9] === "סגור");
x = ready(); sub2(x.E, x.sha, "CCCCC99999");
const sh4 = x.E._state.sheets["משימות"]; const n4 = sh4.rows.length;
t("R4-04: upsert לפי מפתח – הפעלה חוזרת של הוספת משימות לא מוסיפה שורות", (x.E.tasksUpsert_(L1, regOf(x.E), x.E.tasks_(regOf(x.E), "print", regOf(x.E).doc)), sh4.rows.length === n4));
x = ready(); const sh6 = () => x.E._state.sheets["משימות"];
x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.state === "done";
sub2(x.E, x.sha, "CCCCC88888"); const mid = sh6().rows.length; sh6().rows.splice(3);  // מדמה נפילה אחרי השורה הראשונה במשימות
t("R4-04: כשל אחרי appendRow ראשון – ניסיון חוזר משלים בלי כפילות", sub2(x.E, x.sha, "CCCCC88888").ok === true && sh6().rows.length === mid && new Set(sh6().rows.map(r => r[0])).size === mid);

// R4-05: קבצים לפי manifest ו-SHA
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.files.length === 1;
sub2(x.E, x.sha, "EEEEE99999");
t("R4-05: ניסיון חוזר עם fname אחר ו-SHA זהה – לא נוצר קובץ נוסף", sub2(x.E, x.sha, "EEEEE99999", { files: [{ fname: "שם אחר.pdf", pdf }, { fname: "עוד שם.pdf", pdf: pdf2 }] }).ok === true && pdfCount(x.E) === 2);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.files.length === 1;
sub2(x.E, x.sha, "FFFFF99999");
const f0 = x.E._state.files.find(f => f.blob && f.blob.type === "application/pdf"); f0.blob = { bytes: Array.from(Buffer.from("%PDF-1.4 אחר %%EOF")), type: "application/pdf", name: f0.name };
t("R4-05: קובץ בשם הצפוי עם תוכן שונה – נעצר, לא דורס, משימה למשרד", sub2(x.E, x.sha, "FFFFF99999").err === "file-problem" && pdfCount(x.E) === 1 && x.E._state.sheets["משימות"].rows.some(r => /תוכן שונה/.test(r[5])));
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABABA99999"); x.E.resolveDoc(L1, "resend");
x.E._state.files.find(f => f.blob && f.blob.type === "application/pdf").trashed = true;
t("R4-05: קובץ שנמחק אחרי שמירת המזהה – מזוהה, לא נשלח מייל", sub2(x.E, x.sha, "ABABA99999").err === "file-problem" && mails(x.E).length === 0);

// R4-06: מפתח = linkId; docId זהה בשני קישורים לא מתערבב
E = makeEnv(); tk = employer(E, OWN);
const sA = post(E, { action: "register", linkId: L1, ownerEmail: OWN, tok: tk, terms: terms(L1, OWN) }).sha, sB = post(E, { action: "register", linkId: L2, ownerEmail: OWN, tok: tk, terms: terms(L2, OWN, { empName: "שני" }) }).sha;
post(E, { action: "submit", linkId: L1, docId: "1234512345", termsHash: sA, mode: "print", files: [{ fname: "a", pdf }, { fname: "b", pdf: pdf2 }] });
post(E, { action: "submit", linkId: L2, docId: "1234512345", termsHash: sB, mode: "print", files: [{ fname: "a", pdf }, { fname: "b", pdf: pdf2 }] });
t("R4-06: אותו docId בשני קישורים – שתי שורות יומן נפרדות ומשימות נפרדות", E._state.sheets["log"].rows.length === 3 && E._state.sheets["משימות"].rows.filter(r => r[0].endsWith("|101-sign")).length === 2);
t("R4-06: resolveDoc עם ערך לא מוכר – נדחה", (() => { try { E.resolveDoc(L1, "yes"); return false; } catch (e) { return /sent או resend/.test(e.message); } })());
t("R4-06: resolveDoc מתעד מי ומתי", (() => { const y = ready({ failMail: 1 }); sub2(y.E, y.sha, "BCBCB99999"); y.E.resolveDoc(L1, "sent"); const r0 = regOf(y.E).doc.resolution; return r0.how === "sent" && r0.by === ME && !!r0.at; })());

// R4-08: נפילה אחרי needs-review ולפני משימה – reconcile יוצר משימה אחת
x = ready({ failMail: 1 });
const realUpsert = x.E.tasksUpsert_;
vmSet(x.E, "tasksUpsert_", function () { throw new Error("sheet-down"); });
sub2(x.E, x.sha, "CDCDC99999");
vmSet(x.E, "tasksUpsert_", realUpsert);
const noTask = !(x.E._state.sheets["משימות"] || { rows: [] }).rows.some(r => /mail-review/.test(r[0]));
sub2(x.E, x.sha, "CDCDC99999"); sub2(x.E, x.sha, "CDCDC99999");
t("R4-08: אחרי כשל ביצירת משימה – ניסיון חוזר יוצר משימת בדיקה אחת בלבד", noTask && x.E._state.sheets["משימות"].rows.filter(r => /\|mail-review$/.test(r[0])).length === 1 && mails(x.E).length === 0);

// ---------- סבב 5 ----------
// R5-01: הקלט הסינתטי של ChatGPT, בדיוק – גם ב-checkTerms וגם ב-register עם הרשאה תקפה
const R5 = { mode: "new", start: "2026-05-01", f101: "michpal", company: "test", address: "test", role: "test", manager: "test", harassContact: "0501234567", restDay: "שבת", pattern: "bogus",
  days: ["08:00-17:00", "08:00-17:00", "08:00-17:00", "08:00-17:00", "08:00-17:00", "08:00-17:00", ""], breakMin: "bad", weeklyHours: 42, wage: 1, wageType: "monthly", empPct: 0.1, erPct: 0.1, sevPct: 0.1, sec14: true };
E = makeEnv(); tk = employer(E, OWN);
const ctR5 = vm.runInContext("checkTerms", E)(JSON.parse(JSON.stringify(R5)), { approved: false });
t("R5-01: הקלט של ChatGPT – checkTerms מחזיר שגיאות (לא err:[])", ctR5.err.length >= 3 && ctR5.err.some(x => /5 או 6/.test(x)) && ctR5.err.some(x => /הפסקה/.test(x)) && ctR5.err.some(x => /פנסיה/.test(x)));
const regR5 = post(E, { action: "register", linkId: "ab".repeat(16), ownerEmail: OWN, tok: tk, terms: Object.assign({ v: 5, linkId: "ab".repeat(16), ownerEmail: OWN, signer: "x", empName: "x" }, JSON.parse(JSON.stringify(R5))) });
t("R5-01: אותו קלט ב-register עם הרשאה תקפה – נדחה", regR5.ok === false && regR5.err === "rules");
const ruleCase = (extra) => { const q = post(E, { action: "register", linkId: L3x(), ownerEmail: OWN, tok: tk, terms: terms(lastL, OWN, extra) }); return q; };
[["breakMin 'bad'", { breakMin: "bad" }], ["breakMin -60", { breakMin: "-60" }], ["breakMin 999", { breakMin: "999" }], ["breakMin null", { breakMin: null }], ["breakMin true", { breakMin: true }],
 ["pattern לא מוכר", { pattern: "7" }], ["restDay לא מוכר", { restDay: "שני" }], ["24:59", { days: ["09:00-24:59", "09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-17:00", "", ""] }],
 ["פנסיה 0.1", { empPct: "0.1", erPct: "0.1" }], ["פיצויים 7", { sevPct: "7" }], ["boolean כמחרוזת 'false'", { sec14: "false" }], ["שכר Infinity", { wage: "Infinity" }], ["היקף NaN", { weeklyHours: "NaN" }],
 ["ימים לא מחרוזות", { days: [1, 2, 3, 4, 5, 6, 7] }], ["shortDay 9", { shortDay: "9" }]].forEach(([n, x]) => {
  const q = ruleCase(x); t("R5-01: " + n + " – נדחה בשרת", q.ok === false && /^(rules|schema)/.test(q.err));
});
t("R5-01: קלט תקין – מתקבל (לא חוסמים יתר)", ruleCase({}).ok === true);
t("R5-01: 24:00 כסוף יום – הפורמט תקין (נדחה רק בגלל לילה בלי אישור, לא בגלל השעה)", (() => { const c = vm.runInContext("checkTerms", E)(terms(L1, OWN, { days: ["16:00-24:00", "", "", "", "", "", ""], weeklyHours: "7.25" }), { approved: false }); return !c.err.some(x => /לא בפורמט/.test(x)) && c.err.some(x => /22:00/.test(x)); })());
t("G-03: גם עם היתר – הפסקה 0 ביום של 8 שעות נדחית (מינימום 30)", vm.runInContext("checkTerms", E)(terms(L1, OWN, { breakPermit: true, breakMin: "0", weeklyHours: "40" }), { approved: true }).err.some(x => /לפחות 30 דקות/.test(x)));

// R5-02: retry של משימת תקלה – לא דוחה יעד, לא דורס אחראי/סטטוס/אסמכתה
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABCDE55555");
let shm = x.E._state.sheets["משימות"]; let rowM = shm.rows.find(r => /\|mail-review$/.test(r[0]));
const due0 = rowM[7]; rowM[6] = "רותי"; rowM[9] = "בטיפול"; rowM[10] = "בדקתי תיבה";
const realNow = Date.now; Date.now = () => realNow() + 2 * 864e5;
sub2(x.E, x.sha, "ABCDE55555"); Date.now = realNow;
rowM = shm.rows.find(r => /\|mail-review$/.test(r[0]));
t("R5-02: ניסיון חוזר אחרי יומיים – יעד התקלה לא זז, אחראי/סטטוס/אסמכתה נשמרים", rowM[7] === due0 && rowM[6] === "רותי" && rowM[9] === "בטיפול" && rowM[10] === "בדקתי תיבה");
x = ready({ failMail: 1 }); const keep = x.E.tasksUpsert_; vmSet(x.E, "tasksUpsert_", function () { throw new Error("sheet-down"); });
sub2(x.E, x.sha, "ABCDE66666"); vmSet(x.E, "tasksUpsert_", keep);
const rc = x.E.reconcile();
t("R5-02: כשל בלי retry – reconcile יוצר משימת בדיקה, בלי שליחה", rc.some(z => /review/.test(z)) && x.E._state.sheets["משימות"].rows.some(r => /\|mail-review$/.test(r[0])) && mails(x.E).length === 0);
x = ready(); x.E._state.opts.throwOnSet = (k, v) => k.startsWith("L:") && v.doc && v.doc.state === "done";
sub2(x.E, x.sha, "ABCDE77777"); const rc2 = x.E.reconcile();
t("R5-02: מייל יצא אבל לא נסגר – reconcile סוגר בלי מייל נוסף", rc2.some(z => /closed/.test(z)) && regOf(x.E).doc.state === "done" && mails(x.E).length === 1);
t("R5-02: resolveDoc נכשל לפני יצירת משימה – reconcile משלים", (() => { const y = ready({ failMail: 1 }); sub2(y.E, y.sha, "ABCDE88888"); const k2 = y.E.tasksUpsert_; vmSet(y.E, "tasksUpsert_", function () { throw new Error("x"); });
  try { y.E.resolveDoc(L1, "sent"); } catch (e) {} vmSet(y.E, "tasksUpsert_", k2); const out = y.E.reconcile(); return regOf(y.E).doc.state === "done" && out.some(z => /closed/.test(z)) && mails(y.E).length === 0; })());

// R5-03: קובץ שהועבר / שותף, תנאים ששונו, agrVer שונה ב-retry
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABCDE99999"); x.E.resolveDoc(L1, "resend");
x.E._state.files.find(f => f.blob && f.blob.type === "application/pdf").folder = "root";
t("R5-03: קובץ שהועבר לתיקייה אחרת – נעצר", sub2(x.E, x.sha, "ABCDE99999").err === "file-problem" && mails(x.E).length === 0);
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABCDEAAAAA"); x.E.resolveDoc(L1, "resend");
x.E._state.files.find(f => f.blob && f.blob.type === "application/pdf").shared = true;
t("R5-03: קובץ ששותף בקישור – נעצר", sub2(x.E, x.sha, "ABCDEAAAAA").err === "file-problem");
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABCDEBBBBB"); x.E.resolveDoc(L1, "resend");
x.E._state.files.find(f => f.blob && f.blob.type === "application/pdf").extraUser = "spy@x.com";
t("R5-03: קובץ עם משתמש נוסף – נעצר", sub2(x.E, x.sha, "ABCDEBBBBB").err === "file-problem");
x = ready(); const tf = x.E._state.files.find(f => f.id === regOf(x.E).file); tf.blob = Object.assign({}, tf.blob, { bytes: tf.blob.bytes.replace('"43"', '"99"') });
t("R5-03: תנאים ששונו בקובץ אחרי הרישום – get ו-submit נעצרים", post(x.E, { action: "get", linkId: L1 }).ok === false && sub2(x.E, x.sha, "ABCDECCCCC").err === "terms-tampered" && mails(x.E).length === 0);
x = ready({ failMail: 1 }); sub2(x.E, x.sha, "ABCDEDDDDD", { agrVer: "9.9" }); x.E.resolveDoc(L1, "resend"); sub2(x.E, x.sha, "ABCDEDDDDD", { agrVer: "1.0-זיוף" });
t("R5-03: agrVer מהדף לא נכנס – הגרסה נקבעת מהתנאים הקנוניים ב-claim", regOf(x.E).doc.agrVer === "3.6 (11/2026)" && x.E._state.sheets["log"].rows[1][2] === "3.6 (11/2026)" && !mails(x.E)[0].htmlBody.includes("זיוף"));

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
