/**
 * office-forms 3.1 – קליטת מסמכי עובד (הסכם עבודה, טופס 101 להדפסה, הודעה על שינוי תנאים)
 * רץ בחשבון הגוגל של המשרד. מקבל PDF מהדף, שומר בדרייב, מתעד ביומן ושולח במייל.
 * פריסה: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 *
 * אבטחה:
 *  - רישום קישור (register) לפני שליחה; קבלת מסמכים (submit) רק עבור קישור רשום, ורק לאותו מעסיק שנרשם.
 *  - מייל ישיר למעסיק רק אם המייל ברשימה המאושרת; אחרת – למשרד בלבד.
 *  - מניעת שליחה כפולה לפי מזהה מסמך; הגבלת קצב; בדיקת PDF וגודל.
 *  - קבצים פרטיים (ללא שיתוף), בתיקייה נפרדת לכל מעסיק.
 *  - יומן קליטות בגיליון מוגן + טביעת SHA-256 בתיאור הקובץ ובמאגר המאפיינים של הסקריפט.
 */
const OFFICE_EMAIL = "cpa.snir@gmail.com";
const ROOT_FOLDER = "קליטת עובדים";
const LOG_NAME = "יומן קליטות עובדים (נוצר אוטומטית – לא לערוך)";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EMPLOYERS = [
  "nadavlevvy@gmail.com", "rachel@kaldaphone.co.il", "info@nes-defense.com", "huzi262@gmail.com",
  "oadir888@gmail.com", "redmeatk8@gmail.com", "idan.galilplast@gmail.com", "timor@trivision.co.il",
  "sitonnissim@gmail.com", "almognadlan@gmail.com", "cherpake@gmail.com", "roei.shalevwork@gmail.com"
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = JSON.parse(e.postData.contents);
    if (d.app !== "office-forms-v2") return out_({ ok: false, err: "bad-app" });
    if (!rate_()) return out_({ ok: false, err: "rate" });
    if (d.action === "register") return register_(d);
    return submit_(d);
  } catch (err) {
    return out_({ ok: false, err: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
function doGet() { return out_({ ok: true, service: "office-forms", ver: "3.1" }); }

function register_(d) {
  const linkId = String(d.linkId || "");
  if (!/^[0-9a-f]{16}$/.test(linkId)) return out_({ ok: false, err: "bad-link" });
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("L:" + linkId)) return out_({ ok: true, dup: true });
  const owner = String(d.ownerEmail || "").trim().toLowerCase();
  props.setProperty("L:" + linkId, JSON.stringify({
    owner: owner, company: clean_(d.company), employee: clean_(d.employee), mode: clean_(d.mode),
    allowed: ALLOWED_EMPLOYERS.indexOf(owner) >= 0, at: new Date().toISOString()
  }));
  return out_({ ok: true });
}

function submit_(d) {
  const props = PropertiesService.getScriptProperties();
  const linkId = String(d.linkId || "");
  const reg = linkId ? JSON.parse(props.getProperty("L:" + linkId) || "null") : null;
  if (!reg) return out_({ ok: false, err: "unregistered-link" });           // אין העלאה בלי קישור רשום
  const docId = clean_(d.docId);
  if (!/^[0-9A-F]{10}$/.test(docId)) return out_({ ok: false, err: "bad-doc" });
  if (props.getProperty("D:" + docId)) return out_({ ok: true, dup: true }); // שליחה כפולה – לא שולחים שוב

  // הנמען נקבע לפי הרישום בצד השרת, לא לפי מה שהדף שלח
  const owner = reg.owner, company = reg.company || clean_(d.company) || "מעסיק";
  const emp = clean_(d.employee) || reg.employee || "עובד";
  const files = Array.isArray(d.files) ? d.files : (d.pdf ? [{ fname: d.fname, pdf: d.pdf }] : []);
  if (!files.length || files.length > 3) return out_({ ok: false, err: "files" });

  const blobs = [], shas = [];
  files.forEach(function (f) {
    const bytes = Utilities.base64Decode(String(f.pdf || ""));
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("size");
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF") throw new Error("not-pdf");
    const name = (clean_(f.fname) || ("מסמך - " + emp)).replace(/\.pdf$/i, "") + ".pdf";
    blobs.push(Utilities.newBlob(bytes, "application/pdf", name));
    shas.push(sha_(bytes));
  });

  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const sub = folder_(root, company + " – " + owner);     // הפרדה בין מעסיקים
  const fileIds = blobs.map(function (b, i) {
    const f = sub.createFile(b);                            // פרטי כברירת מחדל – לא משותף
    f.setDescription("מזהה מסמך " + docId + " | גרסה " + clean_(d.agrVer) + " | SHA-256 " + shas[i] + " | התקבל " + new Date().toISOString());
    return f.getId();
  });

  const toEmployer = !!reg.allowed;
  const subject = (d.mode === "change" ? "הודעה על שינוי תנאי עבודה – " : "מסמכי עובד – ") + emp + " – " + company;
  const body = "<div dir='rtl' style='font-family:Arial'><p>שלום,</p>" +
    "<p>מצורפים המסמכים של <b>" + esc_(emp) + "</b>" + (d.role ? " (" + esc_(clean_(d.role)) + ")" : "") + " ב" + esc_(company) + ".</p>" +
    (d.mode === "print" ? "<p><b>טופס 101:</b> יש להדפיס ולהחתים את העובד בכתב יד בחלק י'.</p>" : "") +
    (toEmployer ? "" : "<p style='color:#a00'>המייל של המעסיק (" + esc_(owner) + ") לא ברשימה המאושרת – המסמכים נשלחו רק למשרד.</p>") +
    "<p>הקבצים נשמרו בדרייב: " + esc_(ROOT_FOLDER + " / " + company) + "</p>" +
    "<p style='color:#555;font-size:12px'>מזהה מסמך " + esc_(docId) + " · גרסה " + esc_(clean_(d.agrVer)) + "<br>SHA-256: " + shas.join("<br>") + "</p>" +
    (d.mode === "change" ? "" : "<p>תזכורת: בתחילת כל שנת מס יש לבקש מהעובד טופס 101 מעודכן.</p>") +
    "<p>משרד רו\"ח שניר טרמצ'י</p></div>";
  MailApp.sendEmail({ to: toEmployer ? owner : OFFICE_EMAIL, cc: toEmployer ? OFFICE_EMAIL : "", subject: subject, htmlBody: body, attachments: blobs, name: "משרד רו\"ח שניר טרמצ'י" });

  // עותק לעובד – רק ההסכם/ההודעה החתומים (לא ה-101 עם הצילומים)
  const empMail = String(d.employeeEmail || "").trim();
  let empSent = "";
  if (/^\S+@\S+\.\S+$/.test(empMail)) {
    MailApp.sendEmail({ to: empMail, subject: "העותק שלך – " + subject,
      htmlBody: "<div dir='rtl' style='font-family:Arial'><p>היי " + esc_(emp) + ",</p><p>מצורף עותק חתום של " + (d.mode === "change" ? "ההודעה על שינוי תנאי העבודה" : "הסכם העבודה") + " ב" + esc_(company) + ".</p><p>אם משהו בפרטים משתנה – עדכן/י את המעסיק בתוך שבוע.</p></div>",
      attachments: [blobs[0]], name: company });
    empSent = empMail;
  }

  props.setProperty("D:" + docId, JSON.stringify({ at: new Date().toISOString(), linkId: linkId, sha: shas, files: fileIds }));
  log_([new Date(), docId, clean_(d.agrVer), d.mode || "", company, owner, emp, toEmployer ? owner + " + " + OFFICE_EMAIL : OFFICE_EMAIL, empSent, shas.join(" "), fileIds.join(" "), linkId]);
  return out_({ ok: true, toEmployer: toEmployer, employeeCopy: !!empSent });
}

function log_(row) {
  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const it = root.getFilesByName(LOG_NAME);
  let ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else {
    ss = SpreadsheetApp.create(LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const sh0 = ss.getSheets()[0];
    sh0.appendRow(["התקבל", "מזהה מסמך", "גרסה", "סוג", "מעסיק", "מייל מעסיק", "עובד", "נשלח אל", "עותק לעובד", "SHA-256", "קבצים בדרייב", "מזהה קישור"]);
    const p = sh0.protect().setDescription("יומן קליטות – נכתב רק על ידי הסקריפט");
    p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false);
  }
  ss.getSheets()[0].appendRow(row);
}
function rate_() {
  const c = CacheService.getScriptCache(); const n = Number(c.get("n") || 0);
  if (n > 60) return false; c.put("n", String(n + 1), 3600); return true;
}
function sha_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
function folder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function clean_(s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120); }
function esc_(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
