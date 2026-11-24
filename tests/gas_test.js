// בדיקות לסקריפט Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל. הרצה: node tests/gas_test.js
const fs = require("fs"), vm = require("vm"), crypto = require("crypto"), path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");
const sb = a => a.map(b => b > 127 ? b - 256 : b);

function makeEnv(opts = {}) {
  const props = {}, cache = {}, mails = [], files = [], folders = {}, logRows = [];
  const mkFile = (name, folder, blob) => { const f = { id: "F" + files.length, name, blob, folder, desc: "", setDescription(d) { this.desc = d; }, getId() { return this.id; }, moveTo() {},
    getBlob() { return { getDataAsString: () => typeof blob.bytes === "string" ? blob.bytes : Buffer.from(blob.bytes.map(b => b & 255)).toString("utf8") }; } }; files.push(f); return f; };
  const mkFolder = name => folders[name] || (folders[name] = {
    name, getFoldersByName: n => { const f = folders[name + "/" + n]; return { hasNext: () => !!f, next: () => f }; },
    createFolder: n => mkFolder(name + "/" + n),
    createFile: b => { if (opts.failSave && b.type === "application/pdf" && opts.failSave-- > 0) throw new Error("drive-down"); return mkFile(b.name, name, b); },
    getFilesByName: n => { const f = files.find(x => x.folder === name && x.name === n); return { hasNext: () => !!f, next: () => f }; }
  });
  const root = mkFolder("root");
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Utilities: {
      base64Decode: s => sb(Array.from(Buffer.from(s, "base64"))),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      computeDigest: (alg, data) => sb(Array.from(crypto.createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.map(b => b & 255))).digest())),
      computeHmacSha256Signature: (v, k) => sb(Array.from(crypto.createHmac("sha256", k).update(v).digest())),
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }
    },
    DriveApp: { getRootFolder: () => root, getFileById: id => files.find(f => f.id === id) || { moveTo() {} } },
    SpreadsheetApp: {
      create: name => { const sheet = { rows: logRows, appendRow: r => logRows.push(r), protect: () => ({ setDescription() { return this; }, removeEditors() {}, getEditors: () => [], canDomainEdit: () => false }) };
        const ss = { getId: () => "SS", getSheets: () => [sheet] }; files.push({ name, folder: "root/קליטת עובדים", ss }); return ss; },
      open: f => f.ss
    },
    MailApp: { sendEmail: m => { if (opts.failMail && opts.failMail-- > 0) throw new Error("mail-down"); mails.push(m); } },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: "json" } }
  };
  vm.createContext(env); vm.runInContext(code, env);
  env.setup();
  env._state = { props, mails, files, logRows, opts };
  return env;
}
const pdfB = s => Buffer.from(s).toString("base64");
const pdf = pdfB("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /FitH null] >> endobj\n" + "x".repeat(200) + "\n%%EOF\n");
const post = (env, o) => env.doPost({ postData: { contents: JSON.stringify(Object.assign({ app: "office-forms-v2" }, o)) } });
const L1 = "0123456789abcdef0123456789abcdef", L2 = "fedcba9876543210fedcba9876543210";
const terms = (id, owner, extra) => Object.assign({ v: 4, linkId: id, ownerEmail: owner, company: "טייפון", empName: "בדיקה", role: "עובד", wage: "43", wageType: "hourly", weeklyHours: "40", start: "2026-12-01", mode: "new", f101: "print" }, extra || {});
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } };

let E = makeEnv();
const tokA = E.mintToken("nadavlevvy@gmail.com");

// רישום
let r = post(E, { action: "register", linkId: L1, ownerEmail: "nadavlevvy@gmail.com", terms: terms(L1, "nadavlevvy@gmail.com") });
t("G-30: רישום בלי טוקן מעסיק נדחה", r.ok === false && r.err === "not-authorized");
r = post(E, { action: "register", linkId: L1, ownerEmail: "nadavlevvy@gmail.com", tok: E.mintToken("other@x.com"), terms: terms(L1, "nadavlevvy@gmail.com") });
t("G-34: טוקן של מעסיק אחר נדחה", r.ok === false && r.err === "not-authorized");
r = post(E, { action: "register", linkId: L1, ownerEmail: "nadavlevvy@gmail.com", tok: tokA, terms: terms(L1, "attacker@evil.com") });
t("G-34: תנאים עם מייל אחר מהמורשה נדחים", r.ok === false && r.err === "mismatch");
r = post(E, { action: "register", linkId: "0123456789abcdef", ownerEmail: "nadavlevvy@gmail.com", tok: tokA, terms: terms("0123456789abcdef", "nadavlevvy@gmail.com") });
t("G-28: מזהה קישור קצר מ-128 ביט נדחה", r.ok === false && r.err === "bad-link");
r = post(E, { action: "register", linkId: L1, ownerEmail: "nadavlevvy@gmail.com", tok: tokA, terms: terms(L1, "nadavlevvy@gmail.com") });
t("רישום מורשה מצליח ומחזיר טביעת תנאים", r.ok === true && /^[0-9a-f]{64}$/.test(r.sha));
const sha = r.sha;
r = post(E, { action: "register", linkId: L1, ownerEmail: "nadavlevvy@gmail.com", tok: tokA, terms: terms(L1, "nadavlevvy@gmail.com", { wage: "10" }) });
t("G-29: אי אפשר לדרוס תנאים של קישור קיים", r.ok === false && r.err === "exists");

// שליפה
r = post(E, { action: "get", linkId: L1 });
t("G-29: העובד מקבל את התנאים מהשרת, כולל טביעה", r.ok && r.terms.wage === "43" && r.sha === sha && !("tok" in r.terms));

// שליחה
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: "0".repeat(64), files: [{ fname: "a.pdf", pdf }] });
t("G-29: שליחה עם טביעת תנאים שונה נדחית", r.ok === false && r.err === "terms-mismatch" && E._state.mails.length === 0);
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, files: [{ fname: "a.pdf", pdf: pdfB("%PDF-1.4\n/JavaScript (app.alert(1))\n%%EOF") }] });
t("G-32: PDF עם JavaScript נדחה", r.ok === false && r.err === "pdf-active-content");
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, files: [{ fname: "a.pdf", pdf: pdfB("%PDF-1.4\nחתוך") }] });
t("G-32: PDF בלי %%EOF (קטוע) נדחה", r.ok === false && r.err === "not-pdf");
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, files: [{ fname: "x.pdf", pdf: pdfB("hello world") }] });
t("קובץ שאינו PDF נדחה", r.ok === false && r.err === "not-pdf");
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, files: [{ fname: "a.pdf", pdf: "A".repeat(33 * 1024 * 1024) }] });
t("G-33: גודל מצטבר נבדק לפני פענוח", r.ok === false && /size|too-big/.test(r.err));
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, mode: "print", agrVer: "3.2", employeeEmail: "emp@example.com", ownerEmail: "attacker@evil.com",
  files: [{ fname: "הסכם.pdf", pdf }, { fname: "101.pdf", pdf }] });
t("שליחה תקינה מתקבלת", r.ok === true);
const m0 = E._state.mails[0];
t("הנמען לפי הרישום בשרת, העתק למשרד", E._state.mails.length === 1 && m0.to === "nadavlevvy@gmail.com" && m0.cc === "cpa.snir@gmail.com");
t("G-35: אין מייל לכתובת שהעובד הקליד", !E._state.mails.some(m => m.to === "emp@example.com" || m.to === "attacker@evil.com"));
t("המייל כולל את התנאים מהשרת ואת טביעת התנאים", m0.htmlBody.includes("43 ₪ לשעה") && m0.htmlBody.includes(sha));
t("שני הקבצים צורפו ונשמרו בתיקיית המעסיק", m0.attachments.length === 2 && E._state.files.filter(f => /טייפון – nadavlevvy/.test(f.folder)).length === 2);
t("שורה ביומן עם טביעת תנאים", E._state.logRows.length === 2 && E._state.logRows[1][9] === sha);

// כפילות וקישור משומש
r = post(E, { action: "submit", linkId: L1, docId: "ABCDEF0123", termsHash: sha, files: [{ fname: "a.pdf", pdf }, { fname: "b.pdf", pdf }] });
t("G-31: אותו מסמך שוב – לא נשלח שוב", r.ok && r.dup && E._state.mails.length === 1);
r = post(E, { action: "submit", linkId: L1, docId: "1111122222", termsHash: sha, files: [{ fname: "a.pdf", pdf }] });
t("G-31: קישור שכבר נשלח – מסמך חדש נדחה", r.ok === false && r.err === "used");
r = post(E, { action: "get", linkId: L1 });
t("G-40: קישור משומש לא נפתח שוב", r.ok === false && r.err === "used");

// כשל חלקי: המייל נכשל אחרי שמירה – ניסיון חוזר לא שומר שוב ולא שולח פעמיים
E = makeEnv({ failMail: 1 });
let tok = E.mintToken("a@b.co"), s2 = post(E, { action: "register", linkId: L2, ownerEmail: "a@b.co", tok, terms: terms(L2, "a@b.co") }).sha;
r = post(E, { action: "submit", linkId: L2, docId: "AAAAA00000", termsHash: s2, files: [{ fname: "a.pdf", pdf }] });
t("G-39: כשל מייל מחזיר שגיאה", r.ok === false && E._state.mails.length === 0);
const savedAfterFail = E._state.files.filter(f => f.blob && f.blob.type === "application/pdf").length;
r = post(E, { action: "submit", linkId: L2, docId: "AAAAA00000", termsHash: s2, files: [{ fname: "a.pdf", pdf }] });
t("G-39: ניסיון חוזר משלים – בלי שמירה כפולה, מייל אחד", r.ok === true && E._state.mails.length === 1 && E._state.files.filter(f => f.blob && f.blob.type === "application/pdf").length === savedAfterFail);
r = post(E, { action: "submit", linkId: L2, docId: "AAAAA00000", termsHash: s2, files: [{ fname: "a.pdf", pdf }] });
t("G-39: ניסיון שלישי – כפילות, בלי מייל נוסף", r.dup === true && E._state.mails.length === 1);

// ביטול ותפוגה
E = makeEnv(); tok = E.mintToken("a@b.co");
post(E, { action: "register", linkId: L2, ownerEmail: "a@b.co", tok, terms: terms(L2, "a@b.co") });
t("G-40: ביטול בלי טוקן נדחה", post(E, { action: "revoke", linkId: L2 }).ok === false);
t("G-40: המעסיק מבטל קישור", post(E, { action: "revoke", linkId: L2, tok }).ok === true && post(E, { action: "get", linkId: L2 }).err === "revoked");
post(E, { action: "register", linkId: L1, ownerEmail: "a@b.co", tok, terms: terms(L1, "a@b.co") });
const reg = JSON.parse(E._state.props["L:" + L1]); reg.exp = "2020-01-01T00:00:00Z"; E._state.props["L:" + L1] = JSON.stringify(reg);
t("G-40: קישור שפג תוקפו לא נפתח", post(E, { action: "get", linkId: L1 }).err === "expired");

// קישור לא רשום, מזהים לא תקינים, קצב
r = post(E, { action: "submit", linkId: "abcdefabcdefabcdefabcdefabcdefab", docId: "ABCDEF0123", files: [{ fname: "a.pdf", pdf }] });
t("העלאה מקישור לא רשום נדחית", r.ok === false && r.err === "unregistered-link");
t("מזהה מסמך לא תקין נדחה", post(E, { action: "submit", linkId: L2, docId: "<script>", files: [{ fname: "a.pdf", pdf }] }).ok === false);
E = makeEnv(); let blocked = false;
for (let i = 0; i < 130; i++) { const x = post(E, { action: "get", linkId: L1 }); if (x.err === "rate") blocked = true; }
t("הגבלת קצב עוצרת הצפה", blocked);

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
