// בדיקות לסקריפט Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל. הרצה: node tests/gas_test.js
const fs = require("fs"), vm = require("vm"), crypto = require("crypto"), path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");

function makeEnv() {
  const props = {}, cache = {}, mails = [], files = [], folders = {}, logRows = [];
  const mkFolder = name => folders[name] || (folders[name] = {
    name, getFoldersByName: n => { const f = folders[name + "/" + n]; return { hasNext: () => !!f, next: () => f }; },
    createFolder: n => mkFolder(name + "/" + n),
    createFile: b => { const f = { id: "F" + files.length, blob: b, folder: name, desc: "", setDescription(d) { this.desc = d; }, getId() { return this.id; }, moveTo() {} }; files.push(f); return f; },
    getFilesByName: n => { const f = files.find(x => x.folder === name && x.name === n); return { hasNext: () => !!f, next: () => f }; }
  });
  const root = mkFolder("root");
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      base64Decode: s => Array.from(Buffer.from(s, "base64")).map(b => b > 127 ? b - 256 : b),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      computeDigest: (alg, bytes) => Array.from(crypto.createHash("sha256").update(Buffer.from(bytes.map(b => b & 255))).digest()).map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { SHA_256: "sha256" }
    },
    DriveApp: { getRootFolder: () => root, getFileById: () => ({ moveTo() {} }) },
    SpreadsheetApp: {
      create: name => { const sheet = { rows: logRows, appendRow: r => logRows.push(r), protect: () => ({ setDescription() { return this; }, removeEditors() {}, getEditors: () => [], canDomainEdit: () => false }) };
        const ss = { getId: () => "SS", getSheets: () => [sheet] }; files.push({ name, folder: "root/קליטת עובדים", ss }); return ss; },
      open: f => f.ss
    },
    MailApp: { sendEmail: m => mails.push(m) },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: "json" } }
  };
  vm.createContext(env); vm.runInContext(code, env);
  env._state = { props, mails, files, logRows };
  return env;
}
const pdf = "JVBERi0xLjQKJcfsj6IK" + "A".repeat(40); // "%PDF-1.4..."
const post = (env, o) => env.doPost({ postData: { contents: JSON.stringify(Object.assign({ app: "office-forms-v2" }, o)) } });
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } };

// 1. submit ללא רישום נדחה
let E = makeEnv();
let r = post(E, { action: "submit", linkId: "0123456789abcdef", docId: "ABCDEF0123", files: [{ fname: "a.pdf", pdf }] });
t("העלאה מקישור לא רשום נדחית", r.ok === false && r.err === "unregistered-link" && E._state.mails.length === 0);

// 2. רישום + שליחה למעסיק מאושר
r = post(E, { action: "register", linkId: "0123456789abcdef", ownerEmail: "nadavlevvy@gmail.com", company: "טייפון", employee: "בדיקה" });
t("רישום קישור", r.ok === true);
r = post(E, { action: "submit", linkId: "0123456789abcdef", docId: "ABCDEF0123", mode: "print", agrVer: "3.1", employee: "בדיקה", employeeEmail: "emp@example.com", ownerEmail: "attacker@evil.com",
  files: [{ fname: "הסכם.pdf", pdf }, { fname: "101.pdf", pdf }] });
t("שליחה תקינה מתקבלת", r.ok === true && r.toEmployer === true);
t("הנמען נקבע לפי הרישום ולא לפי הדף (לא attacker)", E._state.mails[0].to === "nadavlevvy@gmail.com" && E._state.mails[0].cc === "cpa.snir@gmail.com");
t("שני הקבצים צורפו למייל", E._state.mails[0].attachments.length === 2);
t("עותק לעובד – רק ההסכם", E._state.mails[1].to === "emp@example.com" && E._state.mails[1].attachments.length === 1);
t("נשמרו 2 קבצים בתיקיית המעסיק", E._state.files.filter(f => f.blob && /טייפון – nadavlevvy/.test(f.folder)).length === 2);
t("טביעת SHA-256 בתיאור הקובץ", /SHA-256 [0-9a-f]{64}/.test(E._state.files[0].desc));
t("שורה ביומן הקליטות", E._state.logRows.length === 2 && E._state.logRows[1][1] === "ABCDEF0123");

// 3. שליחה כפולה
const before = E._state.mails.length;
r = post(E, { action: "submit", linkId: "0123456789abcdef", docId: "ABCDEF0123", files: [{ fname: "a.pdf", pdf }] });
t("שליחה כפולה לא נשלחת שוב", r.ok === true && r.dup === true && E._state.mails.length === before);

// 4. מעסיק לא מאושר -> משרד בלבד
post(E, { action: "register", linkId: "fedcba9876543210", ownerEmail: "someone@new.com", company: "חדש" });
r = post(E, { action: "submit", linkId: "fedcba9876543210", docId: "1111122222", files: [{ fname: "a.pdf", pdf }] });
const last = E._state.mails[E._state.mails.length - 1];
t("מעסיק שלא ברשימה – נשלח רק למשרד", r.ok && r.toEmployer === false && last.to === "cpa.snir@gmail.com" && !last.cc);

// 5. קובץ שאינו PDF
post(E, { action: "register", linkId: "aaaaaaaaaaaaaaaa", ownerEmail: "nadavlevvy@gmail.com", company: "טייפון" });
r = post(E, { action: "submit", linkId: "aaaaaaaaaaaaaaaa", docId: "3333344444", files: [{ fname: "x.pdf", pdf: Buffer.from("hello world").toString("base64") }] });
t("קובץ שאינו PDF נדחה", r.ok === false && /not-pdf/.test(r.err));

// 6. מזהים לא תקינים
r = post(E, { action: "register", linkId: "../../etc", ownerEmail: "a@b.c" });
t("מזהה קישור לא תקין נדחה", r.ok === false);
r = post(E, { action: "submit", linkId: "aaaaaaaaaaaaaaaa", docId: "<script>", files: [{ fname: "a.pdf", pdf }] });
t("מזהה מסמך לא תקין נדחה", r.ok === false);

// 7. הגבלת קצב
E = makeEnv(); let blocked = false;
for (let i = 0; i < 70; i++) { const x = post(E, { action: "register", linkId: (i.toString(16) + "0000000000000000").slice(0, 16), ownerEmail: "a@b.c" }); if (x.err === "rate") blocked = true; }
t("הגבלת קצב עוצרת הצפה", blocked);

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
