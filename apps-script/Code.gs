/**
 * office-forms 3.2 – קליטת מסמכי עובד (הסכם עבודה, טופס 101 להדפסה, הודעה על שינוי תנאים)
 * רץ בחשבון הגוגל של המשרד. שומר את תנאי ההעסקה בצד השרת, מקבל PDF חתום, שומר בדרייב, מתעד ושולח במייל.
 *
 * פריסה (שניר, פעם אחת):
 *   1. להריץ את setup() מהעורך – יוצר סוד חתימה (SECRET) במאפייני הסקריפט.
 *   2. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 *   3. לכל מעסיק: להריץ mintToken("employer@mail") ולהכניס את הטוקן לקישור המעסיק (#s=…,"tok":"…").
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
const LINK_DAYS = 30, MAX_SUBMITS_PER_LINK = 5;

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
function doGet() { return out_({ ok: true, service: "office-forms", ver: "3.2" }); }

/* ---------- הרשאות מעסיק ---------- */
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty("SECRET")) p.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  Logger.log("SECRET קיים. להפקת טוקן למעסיק: mintToken('mail@example.com')");
}
function mintToken(email) { const t = tok_(email); Logger.log(email + " → " + t); return t; }
function tok_(email) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret) throw new Error("no-secret");
  return hex_(Utilities.computeHmacSha256Signature(String(email || "").trim().toLowerCase(), secret)).slice(0, 32);
}
function tokOk_(email, tok) { try { return !!tok && safeEq_(tok_(email), String(tok)); } catch (e) { return false; } }
function safeEq_(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/* ---------- קישורים ---------- */
function register_(d) {
  const linkId = String(d.linkId || "");
  if (!/^[0-9a-f]{32}$/.test(linkId)) return out_({ ok: false, err: "bad-link" });
  const owner = String(d.ownerEmail || "").trim().toLowerCase();
  if (!tokOk_(owner, d.tok)) return out_({ ok: false, err: "not-authorized" });
  if (!rate_("reg:" + owner, 30)) return out_({ ok: false, err: "rate" });
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("L:" + linkId)) return out_({ ok: false, err: "exists" });
  const terms = d.terms && typeof d.terms === "object" ? d.terms : null;
  if (!terms) return out_({ ok: false, err: "no-terms" });
  delete terms.tok;
  if (String(terms.ownerEmail || "").trim().toLowerCase() !== owner || terms.linkId !== linkId) return out_({ ok: false, err: "mismatch" });
  const json = canon_(terms);
  if (json.length > MAX_TERMS) return out_({ ok: false, err: "terms-size" });
  const sha = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8));
  const f = linksFolder_().createFile(Utilities.newBlob(json, "application/json", linkId + ".json"));
  props.setProperty("L:" + linkId, JSON.stringify({
    owner: owner, company: clean_(terms.company), employee: clean_(terms.empName), mode: clean_(terms.mode),
    sha: sha, file: f.getId(), state: "active", submits: 0,
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
  if (!reg || !tokOk_(reg.owner, d.tok)) return out_({ ok: false, err: "not-authorized" });
  reg.state = "revoked"; reg.revokedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty("L:" + d.linkId, JSON.stringify(reg));
  return out_({ ok: true });
}

/* ---------- קבלת מסמכים ---------- */
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
  if (!st) {                                                     // מסמך חדש – הקישור חייב להיות פעיל
    const s0 = regState_(reg);
    if (s0 !== "active") return out_({ ok: false, err: s0 });
    if ((reg.submits || 0) >= MAX_SUBMITS_PER_LINK) return out_({ ok: false, err: "too-many" });
    if (String(d.termsHash || "") !== reg.sha) return out_({ ok: false, err: "terms-mismatch" });
  }
  const files = Array.isArray(d.files) ? d.files : [];
  if (!files.length || files.length > 3) return out_({ ok: false, err: "files" });
  const total = files.reduce(function (a, f) { return a + String(f.pdf || "").length; }, 0);
  if (total > MAX_TOTAL_B64) return out_({ ok: false, err: "size" });   // לפני פענוח

  const emp = reg.employee || "עובד", company = reg.company || "מעסיק", owner = reg.owner;
  const blobs = [], shas = [];
  files.forEach(function (f) {
    const bytes = Utilities.base64Decode(String(f.pdf || ""));
    pdfOk_(bytes);
    const name = (clean_(f.fname) || ("מסמך - " + emp)).replace(/\.pdf$/i, "") + ".pdf";
    blobs.push(Utilities.newBlob(bytes, "application/pdf", name));
    shas.push(hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)));
  });
  if (st && st.sha && st.sha.join() !== shas.join()) return out_({ ok: false, err: "retry-differs" });

  if (!st) {
    st = { state: "received", linkId: linkId, sha: shas, at: new Date().toISOString() };
    reg.submits = (reg.submits || 0) + 1;
    props.setProperty("L:" + linkId, JSON.stringify(reg));
    props.setProperty(key, JSON.stringify(st));
  }
  if (!st.files) {                                              // שלב 1: שמירה בדרייב
    const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
    const sub = folder_(root, company + " – " + owner);
    st.files = blobs.map(function (b, i) {
      const f = sub.createFile(b);                                // פרטי כברירת מחדל – לא משותף
      f.setDescription("מזהה מסמך " + docId + " | גרסה " + clean_(d.agrVer) + " | SHA-256 " + shas[i] + " | תנאים " + reg.sha + " | התקבל " + new Date().toISOString());
      return f.getId();
    });
    st.state = "saved"; props.setProperty(key, JSON.stringify(st));
  }
  if (!st.mailed) {                                             // שלב 2: מייל אחד למעסיק + העתק למשרד
    const terms = JSON.parse(DriveApp.getFileById(reg.file).getBlob().getDataAsString());
    MailApp.sendEmail({ to: owner, cc: OFFICE_EMAIL, subject: subject_(reg, emp, company), htmlBody: body_(d, reg, terms, emp, company, docId, shas), attachments: blobs, name: "משרד רו\"ח שניר טרמצ'י" });
    st.mailed = new Date().toISOString(); st.state = "mailed"; props.setProperty(key, JSON.stringify(st));
  }
  if (!st.logged) {                                             // שלב 3: יומן
    log_([new Date(), docId, clean_(d.agrVer), reg.mode || "", company, owner, emp, owner + " + " + OFFICE_EMAIL, shas.join(" "), reg.sha, st.files.join(" "), linkId]);
    st.logged = true;
  }
  st.state = "done"; props.setProperty(key, JSON.stringify(st));
  reg.state = "used"; reg.usedAt = new Date().toISOString(); props.setProperty("L:" + linkId, JSON.stringify(reg));
  return out_({ ok: true });
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
function body_(d, reg, t, emp, company, docId, shas) {
  const row = function (k, v) { return v ? "<tr><td style='color:#555;padding:2px 8px'>" + esc_(k) + "</td><td style='padding:2px 8px'><b>" + esc_(v) + "</b></td></tr>" : ""; };
  return "<div dir='rtl' style='font-family:Arial'><p>שלום,</p>" +
    "<p>מצורפים המסמכים החתומים של <b>" + esc_(emp) + "</b> ב" + esc_(company) + ".</p>" +
    (reg.mode === "print" || t.f101 === "print" ? "<p><b>טופס 101:</b> להדפיס, להחתים את העובד בכתב יד בחלק י' בשבוע הראשון לעבודה, ולשמור בתיק.</p>" : "") +
    (Number(t.sevPct) >= 8.33 && t.sec14 ? "<p><b>פיצויים 8.33%:</b> בקובץ ההסכם יש מכתב הודעה לקופה – יש למסור אותו לקופה ולשמור אישור מסירה.</p>" : "") +
    "<p><b>התנאים כפי שנרשמו על ידך בשרת</b> (להשוואה מול ה-PDF):</p><table style='border-collapse:collapse;font-size:13px'>" +
    row("תפקיד", t.role) + row(t.mode === "change" ? "בתוקף מ" : "תחילת עבודה", t.mode === "change" ? t.effDate : t.start) +
    row("שכר", (t.wage || "") + " ₪ " + (t.wageType === "monthly" ? "לחודש" : "לשעה")) + row("היקף", (t.weeklyHours || "") + " שעות בשבוע") +
    row("פנסיה", "עובד " + (t.empPct || 6) + "% · מעסיק " + (t.erPct || 6.5) + "% · פיצויים " + (t.sevPct || 6) + "%" + (t.sec14 ? " (סעיף 14)" : "")) +
    "</table>" +
    "<p>הקבצים נשמרו בדרייב של המשרד: " + esc_(ROOT_FOLDER + " / " + company) + "</p>" +
    "<p style='color:#555;font-size:12px'>מזהה מסמך " + esc_(docId) + " · גרסה " + esc_(clean_(d.agrVer)) + "<br>טביעת התנאים (SHA-256): " + reg.sha + "<br>טביעות הקבצים: " + shas.join("<br>") + "</p>" +
    (reg.mode === "change" ? "" : "<p>תזכורת: בתחילת כל שנת מס יש לבקש מהעובד טופס 101 מעודכן.</p>") +
    "<p>משרד רו\"ח שניר טרמצ'י</p></div>";
}

/* ---------- כלים ---------- */
function log_(row) {
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const it = root.getFilesByName(LOG_NAME);
  let ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else {
    ss = SpreadsheetApp.create(LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const sh0 = ss.getSheets()[0];
    sh0.appendRow(["התקבל", "מזהה מסמך", "גרסה", "סוג", "מעסיק", "מייל מעסיק", "עובד", "נשלח אל", "SHA-256 קבצים", "SHA-256 תנאים", "קבצים בדרייב", "מזהה קישור"]);
    const p = sh0.protect().setDescription("יומן קליטות – נכתב רק על ידי הסקריפט");
    p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false);
  }
  ss.getSheets()[0].appendRow(row);
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
