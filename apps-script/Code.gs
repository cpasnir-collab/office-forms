/**
 * office-forms 3.3 – קליטת מסמכי עובד (הסכם עבודה, טופס 101 להדפסה, הודעה על שינוי תנאים)
 * רץ בחשבון הגוגל של המשרד. שומר את תנאי ההעסקה בצד השרת, מקבל PDF חתום, שומר בדרייב, מתעד ושולח במייל.
 *
 * פריסה (שניר, פעם אחת):
 *   1. להריץ את setup() מהעורך – יוצר סוד חתימה (SECRET) במאפייני הסקריפט.
 *   2. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 *   3. לכל מעסיק: mintEmployer("mail", "שם העסק", "ח.פ", "מזהה לקוח") – מחזיר קישור מעסיק מוכן (עם טוקן).
 *      ענף/הסכם קיבוצי: mintApproval("mail", "construction", "", 30) – אישור חתום, מוגבל למעסיק, לענף ולזמן.
 *      ביטול/רוטציה: revokeEmployer("mail") – כל הטוקנים והאישורים הקודמים של המעסיק מפסיקים לעבוד.
 *
 * מודל אבטחה:
 *  - register: רק מי שמחזיק טוקן מעסיק תקף (HMAC של המייל בסוד השרת). התנאים נשמרים בשרת עם SHA-256.
 *  - העובד מקבל קישור אטום (#r=<128 ביט>), תקף 30 יום, לשליחה אחת, וניתן לביטול (revoke).
 *  - get: מחזיר את התנאים כפי שנשמרו – הדף לא יכול לשנות אותם; submit מאמת את ה-hash מול השרת.
 *  - הנמען נקבע רק לפי הרישום בשרת; אין שליחת מייל לכתובת שהעובד הקליד.
 *  - submit: מכונת מצבים (received → saved → mailed → done) – ניסיון חוזר לא שולח שוב מי שכבר קיבל.
 *  - בדיקות PDF: מבנה (%PDF- … %%EOF), גודל לכל קובץ ומצטבר לפני פענוח, דחיית /JavaScript, /Launch, /EmbeddedFile.
 *  - המייל כולל את התנאים כפי שנרשמו בשרת – מקור ההשוואה למה שבתוך ה-PDF.
 */
const OFFICE_EMAIL = "cpa.snir@gmail.com";
const ROOT_FOLDER = "קליטת עובדים";
const LINKS_FOLDER = "_קישורים (נוצר אוטומטית)";
const LOG_NAME = "יומן קליטות עובדים (נוצר אוטומטית – לא לערוך)";
const MAX_BYTES = 20 * 1024 * 1024, MAX_TOTAL_B64 = 32 * 1024 * 1024, MAX_TERMS = 60000;
const LINK_DAYS = 30, RETRY_GRACE_DAYS = 7, MAX_SUBMITS_PER_LINK = 5, MAX_DECODED = 20 * 1024 * 1024;
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
function doGet() { return out_({ ok: true, service: "office-forms", ver: "3.3" }); }

/* ---------- הרשאות מעסיק: רשומה לכל מעסיק (מזהה לקוח קבוע), טוקן עם גרסה – ניתן לביטול ולרוטציה ---------- */
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty("SECRET")) p.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  Logger.log("SECRET קיים. להפקת קישור למעסיק: mintEmployer(mail, company, companyId, clientId)");
}
function emp_(email) { return JSON.parse(PropertiesService.getScriptProperties().getProperty("E:" + String(email || "").trim().toLowerCase()) || "null"); }
function mintEmployer(email, company, companyId, clientId, days) {
  email = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || !company || !clientId) throw new Error("חסר מייל, שם עסק או מזהה לקוח");
  const old = emp_(email) || { ver: 0 };
  const rec = { tenantId: String(clientId), company: String(company).trim().slice(0, 120), companyId: clean_(companyId), ver: (old.ver || 0) + 1, revoked: false,
    exp: new Date(Date.now() + (days || 365) * 864e5).toISOString(), at: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty("E:" + email, JSON.stringify(rec));
  const preset = { company: rec.company, companyId: rec.companyId, ownerEmail: email, tok: tok_(email, rec) };
  const link = SITE + "#s=" + Utilities.base64EncodeWebSafe(JSON.stringify(preset), Utilities.Charset.UTF_8).replace(/=+$/, "");
  Logger.log("קישור מעסיק (לשלוח רק למעסיק): " + link); // היומן נגיש רק לבעל הסקריפט; הסוד עצמו לא נרשם
  return link;
}
function revokeEmployer(email) {
  const rec = emp_(email); if (!rec) return false;
  rec.revoked = true; rec.ver = (rec.ver || 0) + 1; rec.revokedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty("E:" + String(email).trim().toLowerCase(), JSON.stringify(rec));
  return true;
}
function mintApproval(email, industry, collective, days) {
  const rec = emp_(email); if (!rec || rec.revoked) throw new Error("מעסיק לא רשום או מבוטל");
  const exp = new Date(Date.now() + (days || 30) * 864e5).toISOString().slice(0, 10);
  const sig = okSig_(email, rec, industry, collective, exp);
  Logger.log("אישור ענף: okSig=" + sig + " okExp=" + exp + " (להוסיף לקישור המעסיק יחד עם industry/collective)");
  return { okSig: sig, okExp: exp, industry: industry, collective: collective || "" };
}
function secret_() { const s = PropertiesService.getScriptProperties().getProperty("SECRET"); if (!s) throw new Error("no-secret"); return s; }
function hmac_(v) { return hex_(Utilities.computeHmacSha256Signature(v, secret_())); }
function tok_(email, rec) { return hmac_("tok|" + email + "|" + rec.tenantId + "|" + rec.ver).slice(0, 32); }
function okSig_(email, rec, industry, collective, exp) { return hmac_("ok|" + email + "|" + rec.tenantId + "|" + rec.ver + "|" + (industry || "general") + "|" + (collective || "") + "|" + exp).slice(0, 32); }
function auth_(email, tok) { // מחזיר את רשומת המעסיק אם הטוקן תקף, לא מבוטל ולא פג
  email = String(email || "").trim().toLowerCase();
  const rec = emp_(email);
  if (!rec || rec.revoked || new Date(rec.exp) < new Date() || !tok) return null;
  try { return safeEq_(tok_(email, rec), String(tok)) ? rec : null; } catch (e) { return null; }
}
function safeEq_(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

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
  // זהות העסק נקבעת לפי רשומת המעסיק בשרת, לא לפי מה שהוזן בדף
  terms.company = rec.company; terms.companyId = rec.companyId; terms.tenantId = rec.tenantId;
  // ענף / הסכם קיבוצי: רק עם אישור משרד חתום, למעסיק הזה, לענף ולהסכם האלה, ובתוקף
  const branch = (terms.industry && terms.industry !== "general") || terms.collective;
  if (branch) {
    const exp = String(terms.okExp || "");
    if (!terms.okSig || !exp || exp < new Date().toISOString().slice(0, 10) ||
        !safeEq_(okSig_(owner, rec, terms.industry, terms.collective, exp), String(terms.okSig))) return out_({ ok: false, err: "branch-not-approved" });
  }
  const want = terms.mode === "change" ? 1 : terms.f101 === "print" ? 2 : 1;
  if (!want) return out_({ ok: false, err: "schema" });
  const json = canon_(terms);
  if (json.length > MAX_TERMS) return out_({ ok: false, err: "terms-size" });
  const sha = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8));
  const lf = linksFolder_();
  if (lf.getSharingAccess() !== DriveApp.Access.PRIVATE) return out_({ ok: false, err: "folder-shared" });
  const f = lf.createFile(Utilities.newBlob(json, "application/json", linkId + ".json"));
  props.setProperty("L:" + linkId, JSON.stringify({
    owner: owner, tenantId: rec.tenantId, company: rec.company, employee: clean_(terms.empName), mode: terms.mode === "change" ? "change" : "new", f101: clean_(terms.f101),
    sha: sha, file: f.getId(), state: "active", submits: 0, sev833: !!(terms.sec14 && Number(terms.sevPct) >= 8.33),
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
   קישור אחד = מסמך אחד (activeDocId נקבע לפני כל פעולה חיצונית).
   שמירה – קובץ אחר קובץ, והמצב נשמר אחרי כל קובץ. מייל – מסומן "pending" לפני השליחה:
   אם התהליך נפל באמצע ואין ודאות שהמייל יצא – לא שולחים שוב, אלא עוצרים לבדיקה (needs-review).
   היומן – עדכון לפי מזהה מסמך (upsert), לא שורה נוספת. */
function submit_(d) {
  const props = PropertiesService.getScriptProperties();
  const linkId = String(d.linkId || "");
  const reg = reg_(linkId);
  if (!reg) return out_({ ok: false, err: "unregistered-link" });
  const docId = clean_(d.docId);
  if (!/^[0-9A-F]{10}$/.test(docId)) return out_({ ok: false, err: "bad-doc" });
  const key = "D:" + docId;
  let st = JSON.parse(props.getProperty(key) || "null");
  if (st && st.linkId !== linkId) return out_({ ok: false, err: "doc-conflict" });
  if (st && st.state === "done") return out_({ ok: true, dup: true });
  if (reg.activeDocId && reg.activeDocId !== docId) return out_({ ok: false, err: reg.state === "used" ? "used" : "busy" });
  const s0 = regState_(reg);
  if (s0 === "revoked") return out_({ ok: false, err: "revoked" });
  if (!st) {                                                     // מסמך חדש – הקישור חייב להיות פעיל
    if (s0 !== "active") return out_({ ok: false, err: s0 });
    if ((reg.submits || 0) >= MAX_SUBMITS_PER_LINK) return out_({ ok: false, err: "too-many" });
    if (String(d.termsHash || "") !== reg.sha) return out_({ ok: false, err: "terms-mismatch" });
  } else if (s0 === "expired" && new Date(reg.exp).getTime() + RETRY_GRACE_DAYS * 864e5 < Date.now()) return out_({ ok: false, err: "expired" });
  if (st && st.mail === "pending") return out_({ ok: false, err: "needs-review" }); // לא ידוע אם המייל יצא – לא שולחים שוב

  // מבנה: מספר הקבצים לפי המסלול שנרשם
  const mode = String(d.mode || "");
  const allowed = reg.mode === "change" ? ["change"] : reg.f101 === "print" ? ["print", "paper"] : ["michpal"];
  if (allowed.indexOf(mode) < 0) return out_({ ok: false, err: "schema" });
  const files = Array.isArray(d.files) ? d.files : [];
  if (files.length !== MODE_FILES[mode]) return out_({ ok: false, err: "files" });
  const total = files.reduce(function (a, f) { return a + String(f.pdf || "").length; }, 0);
  if (total > MAX_TOTAL_B64) return out_({ ok: false, err: "size" });   // לפני פענוח
  if (!st && MailApp.getRemainingDailyQuota() < 2) return out_({ ok: false, err: "quota" }); // מעסיק + העתק למשרד

  const emp = reg.employee || "עובד", company = reg.company || "מעסיק", owner = reg.owner;
  const blobs = [], shas = []; let decoded = 0;
  files.forEach(function (f, i) {
    const bytes = Utilities.base64Decode(String(f.pdf || ""));
    decoded += bytes.length; if (decoded > MAX_DECODED) throw new Error("size");
    pdfOk_(bytes);
    const name = (clean_(f.fname) || ("מסמך - " + emp)).replace(/\.pdf$/i, "") + ".pdf";
    blobs.push(Utilities.newBlob(bytes, "application/pdf", name));
    shas.push(hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)));
  });
  if (st && st.sha && st.sha.join() !== shas.join()) return out_({ ok: false, err: "retry-differs" });

  if (!st) {
    st = { state: "received", linkId: linkId, sha: shas, mode: mode, files: [], at: new Date().toISOString(), complex: (d.complex101 || []).map(clean_).slice(0, 5) };
    props.setProperty(key, JSON.stringify(st));
    reg.activeDocId = docId; reg.submits = (reg.submits || 0) + 1;
    props.setProperty("L:" + linkId, JSON.stringify(reg));
  }
  // שלב 1: שמירה בדרייב – קובץ אחר קובץ
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const sub = folder_(root, clean_(company) + " – " + clean_(reg.tenantId));
  if (sub.getSharingAccess() !== DriveApp.Access.PRIVATE || root.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error("folder-shared");
  for (let i = st.files.length; i < blobs.length; i++) {
    const f = sub.createFile(blobs[i]);
    f.setDescription("מזהה מסמך " + docId + " | גרסה " + clean_(d.agrVer) + " | SHA-256 " + shas[i] + " | תנאים " + reg.sha + " | התקבל " + new Date().toISOString());
    st.files.push(f.getId()); st.state = "saving"; props.setProperty(key, JSON.stringify(st));
  }
  // שלב 2: מייל אחד למעסיק + העתק למשרד
  if (st.mail !== "sent") {
    const terms = JSON.parse(DriveApp.getFileById(reg.file).getBlob().getDataAsString());
    st.mail = "pending"; props.setProperty(key, JSON.stringify(st));
    try {
      MailApp.sendEmail({ to: owner, cc: OFFICE_EMAIL, subject: subject_(reg, emp, company), htmlBody: body_(d, reg, terms, emp, company, docId, shas, st), attachments: blobs, name: "משרד רו\"ח שניר טרמצ'י" });
    } catch (e) { st.mail = "failed"; props.setProperty(key, JSON.stringify(st)); throw e; } // נכשל בוודאות – מותר לנסות שוב
    st.mail = "sent"; st.mailedAt = new Date().toISOString(); props.setProperty(key, JSON.stringify(st));
  }
  // שלב 3: יומן (upsert לפי מזהה מסמך) ומשימות פתוחות למשרד
  log_(docId, [new Date(), docId, clean_(d.agrVer), mode, company, reg.tenantId, owner, emp, shas.join(" "), reg.sha, st.files.join(" "), linkId, tasks_(reg, mode, st).join(" · ")]);
  st.state = "done"; props.setProperty(key, JSON.stringify(st));
  reg.state = "used"; reg.usedAt = new Date().toISOString(); props.setProperty("L:" + linkId, JSON.stringify(reg));
  return out_({ ok: true });
}
function tasks_(reg, mode, st) { // מה עוד פתוח אחרי שהמסמכים נשלחו – קליטה לא הושלמה עד שהמשרד סוגר
  const t = [];
  if (mode === "print") t.push("101 ממתין לחתימה ידנית (שבוע)");
  if (mode === "paper") t.push("101 לא הופק – למלא טופס רשמי ידני");
  if ((st.complex || []).length) t.push("101 לבדיקת משרד: " + st.complex.join(", "));
  if (reg.mode !== "change") t.push("פנסיה: לבדוק סוג מוצר ובסיס בקליטה במיכפל");
  if (reg.sev833) t.push("מכתב לקופה 8.33%: לקבל אסמכתת מסירה");
  return t;
}
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
function body_(d, reg, t, emp, company, docId, shas, st) {
  const row = function (k, v) { return v ? "<tr><td style='color:#555;padding:2px 8px'>" + esc_(k) + "</td><td style='padding:2px 8px'><b>" + esc_(v) + "</b></td></tr>" : ""; };
  return "<div dir='rtl' style='font-family:Arial'><p>שלום,</p>" +
    "<p>מצורפים המסמכים החתומים של <b>" + esc_(emp) + "</b> ב" + esc_(company) + ".</p>" +
    (st.mode === "print" ? "<p><b>טופס 101:</b> להדפיס, להחתים את העובד בכתב יד בחלק י' בשבוע הראשון לעבודה, ולשמור בתיק. עד החתימה – זו טיוטה.</p>" : "") +
    (st.mode === "paper" ? "<p><b>טופס 101:</b> לא הופק – גרסת השנה עוד לא קיימת בכלי. יש למלא עם העובד טופס 101 רשמי.</p>" : "") +
    ((st.complex || []).length ? "<p style='color:#a00'><b>טופס 101 לבדיקת משרד לפני שימוש:</b> " + esc_(st.complex.join(", ")) + "</p>" : "") +
    (Number(t.sevPct) >= 8.33 && t.sec14 ? "<p><b>פיצויים 8.33%:</b> בקובץ ההסכם יש מכתב הודעה לקופה – יש למסור אותו לקופה ולשמור אישור מסירה.</p>" : "") +
    "<p><b>התנאים כפי שנרשמו על ידך בשרת</b> (להשוואה מול ה-PDF):</p><table style='border-collapse:collapse;font-size:13px'>" +
    row("תפקיד", t.role) + row(t.mode === "change" ? "בתוקף מ" : "תחילת עבודה", t.mode === "change" ? t.effDate : t.start) +
    row("שכר", (t.wage || "") + " ₪ " + (t.wageType === "monthly" ? "לחודש" : "לשעה")) + row("היקף", (t.weeklyHours || "") + " שעות בשבוע") +
    row("פנסיה", "עובד " + (t.empPct || 6) + "% · מעסיק " + (t.erPct || 6.5) + "% · פיצויים " + (t.sevPct || 6) + "%" + (t.sec14 ? " (סעיף 14)" : "")) +
    row("ממונה ישיר", t.manager) + row("ימים ושעות", (t.days || []).map(function (x, i) { return x ? ["א", "ב", "ג", "ד", "ה", "ו", "ש"][i] + " " + x : ""; }).filter(String).join(", ")) +
    row("יום מנוחה", t.restDay) + row("הפסקה", (t.breakMin || 0) + " דקות" + (t.breakPaid ? " (משולמת)" : "")) +
    row("גמול גלובלי", t.globalOT ? t.globalOT + " שעות · " + t.globalOTAmount + " ₪" : "") + row("עמלות", t.commission) + row("נסיעות", t.travel) +
    row("קרן השתלמות", t.hishEr ? "מעסיק " + t.hishEr + "% · עובד " + (t.hishEmp || "") + "%" : "") + row("תנאים נוספים", t.extras) +
    "</table><p style='font-size:12px;color:#555'>הטבלה מציגה את התנאים כפי שנשמרו בשרת. ה-PDF נוצר בטלפון של העובד; אם יש הבדל בין ה-PDF לטבלה – לא להשתמש במסמך ולפנות למשרד.</p>" +
    "<p><b>משימות פתוחות:</b> " + esc_(tasks_(reg, st.mode, st).join(" · ")) + "</p>" +
    "<p>הקבצים נשמרו בדרייב של המשרד: " + esc_(ROOT_FOLDER + " / " + company) + "</p>" +
    "<p style='color:#555;font-size:12px'>מזהה מסמך " + esc_(docId) + " · גרסה " + esc_(clean_(d.agrVer)) + "<br>טביעת התנאים (SHA-256): " + reg.sha + "<br>טביעות הקבצים: " + shas.join("<br>") + "</p>" +
    (reg.mode === "change" ? "" : "<p>תזכורת: בתחילת כל שנת מס יש לבקש מהעובד טופס 101 מעודכן.</p>") +
    "<p>משרד רו\"ח שניר טרמצ'י</p></div>";
}

/* ---------- כלים ---------- */
function log_(docId, row) {
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const it = root.getFilesByName(LOG_NAME);
  let ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else {
    ss = SpreadsheetApp.create(LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const sh0 = ss.getSheets()[0];
    sh0.appendRow(["התקבל", "מזהה מסמך", "גרסה", "מסלול", "מעסיק", "מזהה לקוח", "מייל מעסיק", "עובד", "SHA-256 קבצים", "SHA-256 תנאים", "קבצים בדרייב", "מזהה קישור", "משימות פתוחות"]);
    const p = sh0.protect().setDescription("יומן קליטות – נכתב רק על ידי הסקריפט");
    p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false);
  }
  const sh = ss.getSheets()[0], ids = sh.getDataRange().getValues().map(function (r) { return String(r[1]); });
  const at = ids.indexOf(docId);
  if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}
/* ניקוי: רק דוח – לא מוחק. מחיקה לפי מדיניות שמירה שהמשרד יקבע (ממתין להחלטת שניר). */
function reportStale(days) {
  const all = PropertiesService.getScriptProperties().getProperties(), cut = Date.now() - (days || 90) * 864e5, out = [];
  Object.keys(all).forEach(function (k) { if (/^[LD]:/.test(k)) { const o = JSON.parse(all[k]); if (new Date(o.usedAt || o.exp || o.at).getTime() < cut) out.push(k); } });
  Logger.log(out.length + " רשומות ישנות מ-" + (days || 90) + " יום (לא נמחקו): " + out.join(", "));
  return out;
}
function linksFolder_() { return folder_(folder_(DriveApp.getRootFolder(), ROOT_FOLDER), LINKS_FOLDER); }
function rate_(k, max) {
  const c = CacheService.getScriptCache(); const n = Number(c.get("r:" + k) || 0);
  if (n >= max) return false; c.put("r:" + k, String(n + 1), 3600); return true;
}
function canon_(o) { // JSON קנוני: מפתחות ממוינים
  if (Array.isArray(o)) return "[" + o.map(canon_).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ":" + canon_(o[k]); }).join(",") + "}";
  return JSON.stringify(o);
}
function hex_(bytes) { return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
function folder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function clean_(s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120); }
function esc_(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
