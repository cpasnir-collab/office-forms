/**
 * office-forms 3.5 – קליטת מסמכי עובד (הסכם עבודה, טופס 101 להדפסה, הודעה על שינוי תנאים)
 * רץ בחשבון הגוגל של המשרד. שומר את תנאי ההעסקה בצד השרת, מקבל PDF חתום, שומר בדרייב, מתעד ושולח במייל.
 *
 * פריסה (שניר, פעם אחת – לא לפני החלטות G-29/G-37/G-38):
 *   1. setup() – יוצר סוד חתימה (SECRET).
 *   2. Deploy → Web app → Execute as: Me → Who has access: Anyone (בסביבת בדיקה עד אישור).
 *   3. לכל מעסיק: mintEmployer("mail", "שם העסק", "ח.פ", "מזהה-לקוח", "ענף") – קישור המעסיק נשלח למייל המשרד בלבד (לא נרשם ביומן).
 *      תבנית ענפית/חריגה: mintApproval("mail", {role, wageType, minWage, empPct, erPct, sevPct, collective, breakPermit, night}, 30).
 *      ביטול/רוטציה: revokeEmployer("mail") – כל הקישורים הפעילים של המעסיק נחסמים מיד (get/submit), ולא רק יצירת קישורים חדשים.
 *   4. מסמך שנתקע בבדיקה (needs-review): resolveDoc("<linkId>", "resend") או resolveDoc("<linkId>", "sent").
 *   קבצי הפרויקט: Code.gs + rules.gs (עותק זהה של rules.js מהמאגר – אותם כללים בדף ובשרת).
 *
 * עקרונות:
 *  - מקור אמת אחד לכל קישור (L:<linkId>). הקישור "נתפס" למסמך אחד (claim) לפני כל פעולה חיצונית.
 *  - כל קובץ בדרייב מקבל שם יציב עם מזהה המסמך; לפני יצירה מחפשים אותו (reconcile) – אין כפילות גם אחרי נפילה.
 *  - מייל: כל חריגה בזמן השליחה = מצב לא ודאי → needs-review. לא שולחים שוב אוטומטית.
 *  - משימות פתוחות נרשמות בגיליון "משימות" עם אחראי, יעד וסטטוס; הסקריפט לא סוגר משימות.
 */
const OFFICE_EMAIL = "cpa.snir@gmail.com";
const ROOT_FOLDER = "קליטת עובדים";
const LINKS_FOLDER = "_קישורים (נוצר אוטומטית)";
const LOG_NAME = "יומן קליטות עובדים (נוצר אוטומטית – לא לערוך)";
const MAX_BYTES = 20 * 1024 * 1024, MAX_TOTAL_B64 = 32 * 1024 * 1024, MAX_TERMS = 60000, MAX_DECODED = 20 * 1024 * 1024;
const LINK_DAYS = 30, RETRY_GRACE_DAYS = 7, MAX_SUBMITS_PER_LINK = 5;
const TERMS_VER = 5; // F101_YEAR, INDUSTRIES, TPL_KEYS, checkTerms, hoursPlan, tplMiss, validDate – ב-rules.gs
const SITE = "https://cpasnir-collab.github.io/office-forms/";
const MODE_FILES = { print: 2, michpal: 1, paper: 1, change: 1 };

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const raw = e.postData.contents;
    if (raw.length > MAX_TOTAL_B64 + 200000) return out_({ ok: false, err: "too-big" });
    const d = JSON.parse(raw);
    if (d.app !== "office-forms-v2") return out_({ ok: false, err: "bad-app" });
    if (!rate_("all", 120)) return out_({ ok: false, err: "rate" });
    if (d.action === "register") return register_(d);
    if (d.action === "get") return get_(d);
    if (d.action === "revoke") return revoke_(d);
    if (d.action === "submit") return submit_(d);
    return out_({ ok: false, err: "bad-action" });
  } catch (err) {
    return out_({ ok: false, err: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
function doGet() { return out_({ ok: true, service: "office-forms", ver: "3.5" }); }

/* ---------- הרשאות מעסיק ---------- */
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty("SECRET")) p.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
}
function emp_(email) { return JSON.parse(PropertiesService.getScriptProperties().getProperty("E:" + String(email || "").trim().toLowerCase()) || "null"); }
/* מעסיק = מייל מורשה אחד ↔ עסק אחד (מזהה לקוח קבוע). ריבוי עסקים לאותו מייל חסום במפורש. */
function mintEmployer(email, company, companyId, clientId, industry, days) {
  email = String(email || "").trim().toLowerCase(); clientId = String(clientId || ""); industry = industry || "general";
  if (!/^\S+@\S+\.\S+$/.test(email) || !company) throw new Error("חסר מייל או שם עסק");
  if (!/^[A-Za-z0-9-]{1,32}$/.test(clientId)) throw new Error("מזהה לקוח: אותיות לטיניות, ספרות ומקף, עד 32");
  if (INDUSTRIES.map(function (x) { return x[0]; }).indexOf(industry) < 0) throw new Error("ענף לא מוכר");
  const p = PropertiesService.getScriptProperties();
  const old = emp_(email) || { ver: 0 };
  if (old.tenantId && old.tenantId !== clientId) throw new Error("המייל כבר משויך ללקוח " + old.tenantId + " – מייל אחד לעסק אחד");
  const owner = p.getProperty("T:" + clientId);
  if (owner && owner !== email) throw new Error("מזהה הלקוח כבר משויך למייל אחר");
  const rec = { tenantId: clientId, company: String(company).trim().slice(0, 120), companyId: clean_(companyId), industry: industry,
    ver: (old.ver || 0) + 1, revoked: false, exp: new Date(Date.now() + (days || 365) * 864e5).toISOString(), at: new Date().toISOString() };
  p.setProperty("E:" + email, JSON.stringify(rec)); p.setProperty("T:" + clientId, email);
  const preset = { company: rec.company, companyId: rec.companyId, ownerEmail: email, industry: industry, tok: tok_(email, rec) };
  const link = SITE + "#s=" + Utilities.base64EncodeWebSafe(JSON.stringify(preset), Utilities.Charset.UTF_8).replace(/=+$/, "");
  // הקישור הוא הרשאה – לא נרשם ביומן. נשלח רק לתיבת המשרד, שממנה שניר מעביר למעסיק.
  MailApp.sendEmail({ to: OFFICE_EMAIL, subject: "קישור מעסיק – " + rec.company + " (" + clientId + ")", htmlBody: "<div dir='rtl'>קישור המעסיק (הרשאה – להעביר רק למעסיק):<br>" + esc_(link) + "</div>" });
  return "נשלח למייל המשרד";
}
function revokeEmployer(email) {
  const rec = emp_(email); if (!rec) return false;
  rec.revoked = true; rec.ver = (rec.ver || 0) + 1; rec.revokedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty("E:" + String(email).trim().toLowerCase(), JSON.stringify(rec));
  return true;
}
/* אישור משרד = תבנית תנאים חתומה (לא רק ענף): תפקיד, סוג שכר, שכר מינימלי שאושר, שיעורי פנסיה, הסכם קיבוצי, היתר הפסקות, לילה. */
function mintApproval(email, tpl, days) {
  const rec = emp_(email); if (!rec || rec.revoked) throw new Error("מעסיק לא רשום או מבוטל");
  const t = {}; TPL_KEYS.forEach(function (k) { t[k] = tpl && tpl[k] !== undefined ? tpl[k] : ""; });
  t.exp = new Date(Date.now() + (days || 30) * 864e5).toISOString().slice(0, 10);
  const sig = okSig_(String(email).trim().toLowerCase(), rec, t);
  MailApp.sendEmail({ to: OFFICE_EMAIL, subject: "אישור תבנית – " + rec.company, htmlBody: "<div dir='rtl'>להוסיף לקישור המעסיק: okTpl=" + esc_(JSON.stringify(t)) + " okSig=" + sig + "</div>" });
  return { okTpl: t, okSig: sig };
}
function secret_() { const s = PropertiesService.getScriptProperties().getProperty("SECRET"); if (!s) throw new Error("no-secret"); return s; }
function hmac_(v) { return hex_(Utilities.computeHmacSha256Signature(v, secret_())); }
function tok_(email, rec) { return hmac_("tok|" + email + "|" + rec.tenantId + "|" + rec.ver).slice(0, 32); }
function okSig_(email, rec, tpl) { return hmac_("ok|" + email + "|" + rec.tenantId + "|" + rec.ver + "|" + rec.industry + "|" + canon_(tpl)).slice(0, 32); }
function auth_(email, tok) {
  email = String(email || "").trim().toLowerCase();
  const rec = emp_(email);
  if (!rec || rec.revoked || new Date(rec.exp) < new Date() || !tok) return null;
  try { return safeEq_(tok_(email, rec), String(tok)) ? rec : null; } catch (e) { return null; }
}
function employerOk_(reg) { // לפני כל get/submit: המעסיק לא בוטל, לא פג, ולא הוחלפה ההרשאה מאז יצירת הקישור
  const rec = emp_(reg.owner);
  return !!rec && !rec.revoked && new Date(rec.exp) >= new Date() && rec.ver === reg.ver && rec.tenantId === reg.tenantId;
}
function safeEq_(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/* ---------- סכימת תנאים ---------- */
function schema_(t) {
  const num = function (v) { return v !== "" && v !== undefined && isFinite(Number(v)) && Number(v) > 0; };
  if (Number(t.v) !== TERMS_VER) return "version";
  if (["new", "change"].indexOf(t.mode || "new") < 0) return "mode";
  if ((t.mode || "new") === "new" && ["print", "michpal"].indexOf(t.f101) < 0) return "f101";
  if (!num(t.wage) || ["hourly", "monthly"].indexOf(t.wageType) < 0 || !num(t.weeklyHours)) return "wage";
  if (!t.role || !t.manager || !t.harassContact || !t.signer) return "required";
  if (!validDate(String(t.mode === "change" ? t.effDate : t.start))) return "date";
  if (t.days && (!Array.isArray(t.days) || t.days.length !== 7)) return "days";
  return "";
}
/* ---------- קישורים ---------- */
function register_(d) {
  const linkId = String(d.linkId || "");
  if (!/^[0-9a-f]{32}$/.test(linkId)) return out_({ ok: false, err: "bad-link" });
  const owner = String(d.ownerEmail || "").trim().toLowerCase();
  const rec = auth_(owner, d.tok);
  if (!rec) return out_({ ok: false, err: "not-authorized" });
  if (!rate_("reg:" + owner, 30)) return out_({ ok: false, err: "rate" });
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("L:" + linkId)) return out_({ ok: false, err: "exists" });
  const terms = d.terms && typeof d.terms === "object" ? d.terms : null;
  if (!terms) return out_({ ok: false, err: "no-terms" });
  delete terms.tok;
  if (String(terms.ownerEmail || "").trim().toLowerCase() !== owner || terms.linkId !== linkId) return out_({ ok: false, err: "mismatch" });
  const bad = schema_(terms); if (bad) return out_({ ok: false, err: "schema:" + bad });
  // זהות העסק והענף – מרשומת המעסיק בשרת, לא מהדף
  terms.company = rec.company; terms.companyId = rec.companyId; terms.tenantId = rec.tenantId;
  if (rec.industry !== "general") terms.industry = rec.industry;
  // אישור: תבנית חתומה ובתוקף. הצורך באישור והחריגה מהתבנית מחושבים מהסידור עצמו (לילה, הפסקה קצרה) – לא מדגלים שהדף שלח.
  const tpl = terms.okTpl && typeof terms.okTpl === "object" ? terms.okTpl : null;
  const verified = !!(tpl && terms.okSig && tpl.exp && tpl.exp >= new Date().toISOString().slice(0, 10) && safeEq_(okSig_(owner, rec, tpl), String(terms.okSig)));
  const plan = hoursPlan(terms), shortBreak = plan.rows.some(function (r) { return r && r.g >= 360 && r.brk < 45; });
  if (plan.night) terms.night = true; else delete terms.night;                 // נגזר בשרת, לא מהדף
  const needApproval = rec.industry !== "general" || (terms.industry && terms.industry !== "general") || terms.collective || terms.breakPermit || plan.night || shortBreak;
  if ((needApproval && !verified) || (verified && tplMiss(terms).length)) return out_({ ok: false, err: "not-approved" });
  // כל כללי ההעסקה – אותו קוד כמו בדף (rules.gs): מינימום לפי תאריך וסוג, שעות, הפסקות, מנוחה, היקף, תאריכים
  const ruleErr = checkTerms(terms, { approved: verified }).err;
  if (ruleErr.length) return out_({ ok: false, err: "rules", detail: ruleErr.slice(0, 5) });
  const json = canon_(terms);
  if (json.length > MAX_TERMS) return out_({ ok: false, err: "terms-size" });
  const sha = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8));
  const lf = linksFolder_();
  privateOk_(lf);
  const f = lf.createFile(Utilities.newBlob(json, "application/json", linkId + ".json"));
  props.setProperty("L:" + linkId, JSON.stringify({
    owner: owner, tenantId: rec.tenantId, ver: rec.ver, company: rec.company, employee: clean_(terms.empName),
    mode: terms.mode === "change" ? "change" : "new", f101: clean_(terms.f101), start: String(terms.start || terms.effDate || ""),
    sha: sha, file: f.getId(), state: "active", submits: 0, sev833: !!(terms.sec14 && Number(terms.sevPct) >= 8.33), fundKnown: !!terms.pensionFund,
    at: new Date().toISOString(), exp: new Date(Date.now() + LINK_DAYS * 864e5).toISOString()
  }));
  return out_({ ok: true, sha: sha });
}
function reg_(linkId) {
  if (!/^[0-9a-f]{32}$/.test(String(linkId || ""))) return null;
  return JSON.parse(PropertiesService.getScriptProperties().getProperty("L:" + linkId) || "null");
}
function regState_(reg) {
  if (!reg) return "not-found";
  if (reg.state === "revoked") return "revoked";
  if (!employerOk_(reg)) return "employer-revoked";
  if (reg.state === "used") return "used";
  if (new Date(reg.exp) < new Date()) return "expired";
  return "active";
}
function get_(d) {
  if (!rate_("get", 300)) return out_({ ok: false, err: "rate" });
  const reg = reg_(d.linkId), st = regState_(reg);
  if (st !== "active") return out_({ ok: false, err: st });
  const terms = JSON.parse(DriveApp.getFileById(reg.file).getBlob().getDataAsString());
  return out_({ ok: true, terms: terms, sha: reg.sha });
}
function revoke_(d) {
  const reg = reg_(d.linkId);
  if (!reg || !auth_(reg.owner, d.tok)) return out_({ ok: false, err: "not-authorized" });
  reg.state = "revoked"; reg.revokedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty("L:" + d.linkId, JSON.stringify(reg));
  return out_({ ok: true });
}

/* ---------- קבלת מסמכים ----------
   מקור האמת: L:<linkId>.doc. המפתח החיצוני לכל דבר (יומן, משימות, הכרעה) הוא linkId – 128 ביט מהשרת, לא docId מהדף.
   ב-claim נקבע manifest קנוני: שם קובץ שרתי, סוג, SHA-256 ומסלול. אחר כך רק הוא קובע. */
const DOC_KINDS = { print: ["הסכם עבודה", "טופס 101 להדפסה"], michpal: ["הסכם עבודה"], paper: ["הסכם עבודה"], change: ["הודעה על שינוי תנאים"] };
function submit_(d) {
  const props = PropertiesService.getScriptProperties();
  const linkId = String(d.linkId || "");
  let reg = reg_(linkId);
  if (!reg) return out_({ ok: false, err: "unregistered-link" });
  const docId = clean_(d.docId);
  if (!/^[0-9A-F]{10}$/.test(docId)) return out_({ ok: false, err: "bad-doc" });
  const save = function () { props.setProperty("L:" + linkId, JSON.stringify(reg)); };
  let st = reg.doc || null;
  if (st && st.id !== docId) return out_({ ok: false, err: reg.state === "used" ? "used" : "busy" });
  if (st && st.state === "done") return out_({ ok: true, dup: true });
  const s0 = regState_(reg);
  if (s0 === "revoked" || s0 === "employer-revoked") return out_({ ok: false, err: s0 });
  if (!st) {
    if (s0 !== "active") return out_({ ok: false, err: s0 });
    if ((reg.submits || 0) >= MAX_SUBMITS_PER_LINK) return out_({ ok: false, err: "too-many" });
    if (String(d.termsHash || "") !== reg.sha) return out_({ ok: false, err: "terms-mismatch" });
  } else if (s0 === "expired" && new Date(reg.exp).getTime() + RETRY_GRACE_DAYS * 864e5 < Date.now()) return out_({ ok: false, err: "expired" });
  if (st && (st.mail === "pending" || st.mail === "needs-review")) {        // reconcile: המשימה לבדיקה תמיד קיימת
    tasksUpsert_(linkId, reg, [["mail-review", "מייל: לא ודאי אם נשלח – לבדוק בתיבת היוצאים ואז resolveDoc", 1, "now"]]);
    return out_({ ok: false, err: "needs-review" });
  }

  // מסלול: נקבע ב-claim ונשמר. paper רק כששנת המס אינה F101_YEAR.
  const mode = String(d.mode || "");
  if (st) { if (mode !== st.mode) return out_({ ok: false, err: "schema" }); }
  else {
    const taxYear = Math.max(Number(String(reg.start).slice(0, 4)) || 0, new Date().getFullYear());
    const allowed = reg.mode === "change" ? ["change"] : reg.f101 === "print" ? (taxYear !== F101_YEAR ? ["paper"] : ["print"]) : ["michpal"];
    if (allowed.indexOf(mode) < 0) return out_({ ok: false, err: "schema" });
  }
  const files = Array.isArray(d.files) ? d.files : [];
  if (files.length !== MODE_FILES[mode]) return out_({ ok: false, err: "files" });
  const total = files.reduce(function (a, f) { return a + String(f.pdf || "").length; }, 0);
  if (total > MAX_TOTAL_B64) return out_({ ok: false, err: "size" });
  if ((!st || st.mail !== "sent") && MailApp.getRemainingDailyQuota() < 2) return out_({ ok: false, err: "quota" });

  const emp = reg.employee || "עובד", company = reg.company || "מעסיק", owner = reg.owner;
  const bytesList = [], shas = []; let decoded = 0;
  files.forEach(function (f) {
    const bytes = Utilities.base64Decode(String(f.pdf || ""));
    decoded += bytes.length; if (decoded > MAX_DECODED) throw new Error("size");
    pdfOk_(bytes); bytesList.push(bytes); shas.push(sha_(bytes));
  });
  if (st && st.sha.join() !== shas.join()) return out_({ ok: false, err: "retry-differs" });

  if (!st) {                                   // claim אטומי + manifest קנוני (שמות קבצים שרתיים, לא מהדף)
    const kinds = DOC_KINDS[mode];
    st = { id: docId, state: "received", sha: shas, mode: mode, files: [], at: new Date().toISOString(), complex: (d.complex101 || []).map(clean_).slice(0, 5),
      manifest: kinds.map(function (k, i) { return { name: k + " - " + clean_(emp) + " [" + linkId + "-" + (i + 1) + "].pdf", kind: k, sha: shas[i] }; }) };
    reg.doc = st; reg.submits = (reg.submits || 0) + 1; save();
  }
  // שלב 1: דרייב – לכל פריט ב-manifest: קובץ קיים מאומת לפי SHA של הבתים; אחרת יצירה. אי-התאמה = עצירה.
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const sub = tenantFolder_(root, reg.tenantId, company);
  privateOk_(root); privateOk_(sub);
  const blobs = st.manifest.map(function (m, i) { return Utilities.newBlob(bytesList[i], "application/pdf", m.name); });
  for (let i = 0; i < st.manifest.length; i++) {
    const m = st.manifest[i];
    if (st.files[i]) {
      let f = null; try { f = DriveApp.getFileById(st.files[i]); } catch (e) {}
      if (!f || f.isTrashed() || sha_(f.getBlob().getBytes()) !== m.sha) { st.state = "file-problem"; save(); tasksUpsert_(linkId, reg, [["file-" + i, "קובץ בדרייב חסר או שונה: " + m.name, 1, "now"]]); return out_({ ok: false, err: "file-problem" }); }
      continue;
    }
    const it = sub.getFilesByName(m.name), found = [];
    while (it.hasNext()) found.push(it.next());
    if (found.length > 1) { tasksUpsert_(linkId, reg, [["file-" + i, "כמה קבצים באותו שם: " + m.name, 1, "now"]]); return out_({ ok: false, err: "file-problem" }); }
    let f;
    if (found.length === 1) {
      if (sha_(found[0].getBlob().getBytes()) !== m.sha) { tasksUpsert_(linkId, reg, [["file-" + i, "קובץ קיים בשם הצפוי עם תוכן שונה: " + m.name, 1, "now"]]); return out_({ ok: false, err: "file-problem" }); }
      f = found[0];
    } else f = sub.createFile(blobs[i]);
    f.setDescription("קישור " + linkId + " | מזהה מסמך " + docId + " | " + m.kind + " | גרסה " + clean_(d.agrVer) + " | SHA-256 " + m.sha + " | תנאים " + reg.sha);
    st.files[i] = f.getId(); st.state = "saving"; save();
  }
  // שלב 2: מייל. pending לפני; כל חריגה = לא ודאי → needs-review + משימה.
  if (st.mail !== "sent") {
    const terms = JSON.parse(DriveApp.getFileById(reg.file).getBlob().getDataAsString());
    st.mail = "pending"; save();
    try {
      MailApp.sendEmail({ to: owner, cc: OFFICE_EMAIL, subject: subject_(reg, emp, company), htmlBody: body_(d, reg, terms, emp, company, docId, shas, st, linkId), attachments: blobs, name: "משרד רו\"ח שניר טרמצ'י" });
    } catch (e) {
      st.mail = "needs-review"; st.mailErr = String(e && e.message || e).slice(0, 200); save();
      tasksUpsert_(linkId, reg, [["mail-review", "מייל: לא ודאי אם נשלח – לבדוק בתיבת היוצאים ואז resolveDoc", 1, "now"]]);
      return out_({ ok: false, err: "needs-review" });
    }
    st.mail = "sent"; st.mailedAt = new Date().toISOString(); save();
  }
  // שלב 3: יומן ומשימות – upsert לפי linkId (וסוג משימה). ניסיון חוזר לא משכפל ולא דורס סטטוס/אסמכתה.
  log_(linkId, [new Date(), docId, clean_(d.agrVer), mode, company, reg.tenantId, owner, emp, shas.join(" "), reg.sha, st.files.join(" "), linkId]);
  tasksUpsert_(linkId, reg, tasks_(reg, mode, st));
  st.state = "done"; reg.state = "used"; reg.usedAt = new Date().toISOString(); save();
  return out_({ ok: true });
}
/* הכרעת המשרד על מסמך תקוע. how: "sent" (וידאתי שיצא) | "resend" (וידאתי שלא יצא). נעילה מול submit, ותיעוד. */
function resolveDoc(linkId, how) {
  if (how !== "sent" && how !== "resend") throw new Error("how חייב להיות sent או resend");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties(), reg = reg_(linkId);
    if (!reg || !reg.doc) throw new Error("לא נמצא");
    if (reg.doc.mail !== "needs-review" && reg.doc.mail !== "pending") throw new Error("המסמך לא במצב בדיקה");
    reg.doc.mail = how === "sent" ? "sent" : "retry";
    reg.doc.resolution = { how: how, by: Session.getEffectiveUser().getEmail(), at: new Date().toISOString() };
    props.setProperty("L:" + linkId, JSON.stringify(reg));
    tasksUpsert_(linkId, reg, [["mail-review", "מייל: הוכרע – " + (how === "sent" ? "נשלח" : "לשלוח שוב"), 0, "now"]]);
    return reg.doc.mail;
  } finally { lock.releaseLock(); }
}
/* משימות: [סוג קבוע, תיאור, ימים, בסיס]. בסיס "start" = מתחילת העבודה (יעד חוקי – לא נדחה בגלל קליטה מאוחרת), "now" = ממועד האירוע. */
function tasks_(reg, mode, st) {
  const t = [];
  if (mode === "print") { t.push(["101-sign", "101: לקבל טופס חתום בכתב יד", 7, "start"]); t.push(["101-review", "101: בדיקת משרד לפני שימוש לחישוב מס (כולל אסמכתאות)", 7, "start"]); }
  if (mode === "paper") { t.push(["101-paper", "101: לא הופק – למלא טופס רשמי ידני", 7, "start"]); t.push(["101-review", "101: בדיקת משרד לפני שימוש לחישוב מס", 7, "start"]); }
  if (mode === "michpal") t.push(["101-michpal", "101 בפורטל מיכפל: לוודא שהעובד מילא וחתם, ולבדוק לפני שימוש", 7, "start"]);
  if ((st.complex || []).length) t.push(["101-complex", "101 מורכב: " + st.complex.join(", "), 3, "start"]);
  if (reg.mode !== "change") {
    t.push(["pension", "פנסיה: לאמת ביטוח קודם, סוג מוצר ובסיס – לפני חישוב השכר הראשון", "firstPay", "start"]);
    if (!reg.fundKnown) t.push(["pension-fund", "פנסיה: לקבל שם קופה ולעדכן", "firstPay", "start"]);
  }
  if (reg.sev833) t.push(["fund-letter", "מכתב לקופה 8.33%: למסור לפני תחילת ההפקדות בשיעור המלא ולקבל אסמכתה", 0, "start"]);
  return t;
}
function dueOf_(reg, days, base) {
  const start = validDate(reg.start) ? new Date(reg.start + "T00:00:00Z") : new Date();
  if (days === "firstPay") return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); // לפני השכר הראשון (משולם עד ה-9 בחודש שאחרי)
  return new Date((base === "now" ? Date.now() : start.getTime()) + days * 864e5);
}
function tasksUpsert_(linkId, reg, list) {
  const sh = sheet_("משימות", ["מפתח", "נוצר", "קישור", "לקוח", "עובד", "משימה", "אחראי", "יעד", "באיחור בקליטה", "סטטוס", "אסמכתה / הערה"]);
  const keys = sh.getDataRange().getValues().map(function (r) { return String(r[0]); });
  list.forEach(function (x) {
    const key = reg.tenantId + "|" + linkId + "|" + x[0], due = dueOf_(reg, x[2], x[3]);
    const row = [key, new Date(), linkId, reg.tenantId, reg.employee, x[1], "המשרד", Utilities.formatDate(due, "Asia/Jerusalem", "dd/MM/yyyy"), due.getTime() < Date.now() ? "כן" : "", "פתוח", ""];
    const at = keys.indexOf(key);
    if (at < 0) { sh.appendRow(row); keys.push(key); return; }
    // קיים: מעדכנים רק את התיאור והיעד; סטטוס ואסמכתה של המשרד לא נדרסים
    const cur = sh.getDataRange().getValues()[at];
    row[1] = cur[1]; row[9] = cur[9]; row[10] = cur[10];
    sh.getRange(at + 1, 1, 1, row.length).setValues([row]);
  });
}
function sha_(bytes) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)); }
function pdfOk_(bytes) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("size");
  const head = String.fromCharCode.apply(null, bytes.slice(0, 5).map(function (b) { return b & 255; }));
  if (head !== "%PDF-") throw new Error("not-pdf");
  const tail = String.fromCharCode.apply(null, bytes.slice(-1024).map(function (b) { return b & 255; }));
  if (tail.indexOf("%%EOF") < 0) throw new Error("not-pdf");
  const txt = latin_(bytes);
  ["/JavaScript", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"].forEach(function (k) { if (txt.indexOf(k) >= 0) throw new Error("pdf-active-content"); });
}
function latin_(bytes) { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode.apply(null, bytes.slice(i, i + 8192).map(function (b) { return b & 255; }))); return parts.join(""); }
function subject_(reg, emp, company) { return (reg.mode === "change" ? "הודעה על שינוי תנאי עבודה – " : "מסמכי עובד – ") + emp + " – " + company; }
function body_(d, reg, t, emp, company, docId, shas, st, linkId) {
  const row = function (k, v) { return v ? "<tr><td style='color:#555;padding:2px 8px'>" + esc_(k) + "</td><td style='padding:2px 8px'><b>" + esc_(v) + "</b></td></tr>" : ""; };
  return "<div dir='rtl' style='font-family:Arial'><p>שלום,</p>" +
    "<p>מצורפים המסמכים החתומים של <b>" + esc_(emp) + "</b> ב" + esc_(company) + ".</p>" +
    (st.mode === "print" ? "<p><b>טופס 101:</b> להדפיס, להחתים את העובד בכתב יד בחלק י' בשבוע הראשון לעבודה, ולשמור בתיק. עד החתימה ובדיקת המשרד – טיוטה, לא לחישוב מס.</p>" : "") +
    (st.mode === "paper" ? "<p><b>טופס 101:</b> לא הופק – גרסת השנה עוד לא קיימת בכלי. יש למלא עם העובד טופס 101 רשמי.</p>" : "") +
    ((st.complex || []).length ? "<p style='color:#a00'><b>טופס 101 לבדיקת משרד לפני שימוש:</b> " + esc_(st.complex.join(", ")) + "</p>" : "") +
    (Number(t.sevPct) >= 8.33 && t.sec14 ? "<p><b>פיצויים 8.33%:</b> בקובץ ההסכם יש מכתב הודעה לקופה – ההחלה מותנית במסירה בפועל. למסור ולשמור אסמכתה.</p>" : "") +
    "<p><b>התנאים כפי שנרשמו על ידך בשרת</b> (להשוואה מול ה-PDF):</p><table style='border-collapse:collapse;font-size:13px'>" +
    row("תפקיד", t.role) + row(t.mode === "change" ? "בתוקף מ" : "תחילת עבודה", t.mode === "change" ? t.effDate : t.start) +
    row("שכר", (t.wage || "") + " ₪ " + (t.wageType === "monthly" ? "לחודש" : "לשעה")) + row("היקף", (t.weeklyHours || "") + " שעות בשבוע") +
    row("פנסיה", "עובד " + (t.empPct || 6) + "% · מעסיק " + (t.erPct || 6.5) + "% · פיצויים " + (t.sevPct || 6) + "%" + (t.sec14 ? " (סעיף 14)" : "")) +
    row("ממונה ישיר", t.manager) + row("ימים ושעות", (t.days || []).map(function (x, i) { return x ? ["א", "ב", "ג", "ד", "ה", "ו", "ש"][i] + " " + x : ""; }).filter(String).join(", ")) +
    row("יום מנוחה", t.restDay) + row("הפסקה", (t.breakMin || 0) + " דקות" + (t.breakPaid ? " (משולמת)" : "")) +
    row("גמול גלובלי", t.globalOT ? t.globalOT + " שעות · " + t.globalOTAmount + " ₪" : "") + row("עמלות", t.commission) + row("נסיעות", t.travel) +
    row("קרן השתלמות", t.hishEr ? "מעסיק " + t.hishEr + "% · עובד " + (t.hishEmp || "") + "%" : "") + row("תנאים נוספים", t.extras) +
    "</table><p style='font-size:12px;color:#555'>הטבלה מציגה את התנאים כפי שנשמרו בשרת. ה-PDF נוצר בטלפון של העובד; אם יש הבדל בין ה-PDF לטבלה – לא להשתמש במסמך ולפנות למשרד.</p>" +
    "<p><b>משימות פתוחות:</b> " + esc_(tasks_(reg, st.mode, st).map(function (x) { return x[1]; }).join(" · ")) + "</p>" +
    "<p>הקבצים נשמרו בדרייב של המשרד: " + esc_(ROOT_FOLDER + " / " + company) + "</p>" +
    "<p style='color:#555;font-size:12px'>קישור " + esc_(linkId) + " · מזהה מסמך " + esc_(docId) + " · גרסה " + esc_(clean_(d.agrVer)) + "<br>טביעת התנאים (SHA-256): " + reg.sha + "<br>טביעות הקבצים: " + shas.join("<br>") + "</p>" +
    (reg.mode === "change" ? "" : "<p>תזכורת: בתחילת כל שנת מס יש לבקש מהעובד טופס 101 מעודכן.</p>") +
    "<p>משרד רו\"ח שניר טרמצ'י</p></div>";
}

/* ---------- כלים ---------- */
function logBook_() {
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const it = root.getFilesByName(LOG_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(LOG_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  const sh0 = ss.getSheets()[0];
  sh0.appendRow(["התקבל", "מזהה מסמך", "גרסה", "מסלול", "מעסיק", "מזהה לקוח", "מייל מעסיק", "עובד", "SHA-256 קבצים", "SHA-256 תנאים", "קבצים בדרייב", "מזהה קישור"]);
  const p = sh0.protect().setDescription("יומן קליטות – נכתב רק על ידי הסקריפט");
  p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false);
  return ss;
}
function sheet_(name, head) { const ss = logBook_(); let sh = ss.getSheetByName(name); if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); } return sh; }
function log_(linkId, row) { // upsert לפי linkId (עמודה אחרונה) – ייחודי ושרתי
  const sh = logBook_().getSheets()[0], ids = sh.getDataRange().getValues().map(function (r) { return String(r[11]); });
  const at = ids.indexOf(linkId);
  if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}
/* תיקייה לפי מזהה לקוח קבוע (F:<tenant> → מזהה תיקייה); שינוי שם העסק לא יוצר תיקייה חדשה */
function tenantFolder_(root, tenantId, company) {
  const p = PropertiesService.getScriptProperties(), id = p.getProperty("F:" + tenantId);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = root.createFolder(clean_(company) + " – " + clean_(tenantId)); p.setProperty("F:" + tenantId, f.getId()); return f;
}
/* פרטיות תיקייה: לא משותפת בקישור, ואין עורכים/צופים מלבד בעל החשבון (כולל הרשאות שירשו) */
function privateOk_(folder) {
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error("folder-shared");
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const others = folder.getEditors().concat(folder.getViewers()).map(function (u) { return u.getEmail().toLowerCase(); }).filter(function (m) { return m !== me; });
  if (others.length) throw new Error("folder-has-users");
}
/* ניקוי: רק דוח – לא מוחק. מחיקה לפי מדיניות שמירה שהמשרד יקבע (ממתין להחלטת שניר). */
function reportStale(days) {
  const all = PropertiesService.getScriptProperties().getProperties(), cut = Date.now() - (days || 90) * 864e5, out = [];
  Object.keys(all).forEach(function (k) { if (/^L:/.test(k)) { const o = JSON.parse(all[k]); if (new Date(o.usedAt || o.exp || o.at).getTime() < cut) out.push(k); } });
  return out;
}
function linksFolder_() { return folder_(folder_(DriveApp.getRootFolder(), ROOT_FOLDER), LINKS_FOLDER); }
function rate_(k, max) {
  const c = CacheService.getScriptCache(); const n = Number(c.get("r:" + k) || 0);
  if (n >= max) return false; c.put("r:" + k, String(n + 1), 3600); return true;
}
function canon_(o) {
  if (Array.isArray(o)) return "[" + o.map(canon_).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).filter(function (k) { return o[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + canon_(o[k]); }).join(",") + "}";
  return JSON.stringify(o);
}
function hex_(bytes) { return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
function folder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function clean_(s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120); }
function esc_(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
