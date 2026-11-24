/**
 * office-forms – קליטת מסמכי עובד חדש (הסכם עבודה + 101)
 * רץ בחשבון הגוגל של המשרד. מקבל PDF מהדף, שומר בדרייב ושולח במייל.
 * פריסה: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 */
const OFFICE_EMAIL = "cpa.snir@gmail.com";
const ROOT_FOLDER = "קליטת עובדים";
const MAX_BYTES = 25 * 1024 * 1024;
// מיילים של מעסיקים שמותר לשלוח אליהם ישירות. מייל שלא ברשימה – המסמך מגיע רק למשרד, עם הערה.
const ALLOWED_EMPLOYERS = [
  "nadavlevvy@gmail.com", "rachel@kaldaphone.co.il", "info@nes-defense.com", "huzi262@gmail.com",
  "oadir888@gmail.com", "redmeatk8@gmail.com", "idan.galilplast@gmail.com", "timor@trivision.co.il",
  "sitonnissim@gmail.com", "almognadlan@gmail.com", "cherpake@gmail.com", "roei.shalevwork@gmail.com"
];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.app !== "office-forms-v2") return out_({ ok: false, err: "bad-app" });

    // הגבלת קצב פשוטה נגד שימוש לרעה
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get("n") || 0);
    if (n > 80) return out_({ ok: false, err: "rate" });
    cache.put("n", String(n + 1), 3600);

    const bytes = Utilities.base64Decode(String(d.pdf || ""));
    if (!bytes.length || bytes.length > MAX_BYTES) return out_({ ok: false, err: "size" });
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF") return out_({ ok: false, err: "not-pdf" });

    const company = clean_(d.company) || "מעסיק";
    const emp = clean_(d.employee) || "עובד";
    const fname = (clean_(d.fname) || ("הסכם עבודה ו-101 - " + emp)).replace(/\.pdf$/i, "") + ".pdf";
    const blob = Utilities.newBlob(bytes, "application/pdf", fname);

    // שמירה בדרייב: קליטת עובדים / <מעסיק>
    const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
    const sub = folder_(root, company);
    const file = sub.createFile(blob);
    const sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
    file.setDescription("מזהה מסמך " + clean_(d.docId) + " | גרסת הסכם " + clean_(d.agrVer) + " | SHA-256 " + sha + " | התקבל " + new Date().toISOString());

    const owner = String(d.ownerEmail || "").trim().toLowerCase();
    const ownerOk = /^\S+@\S+\.\S+$/.test(owner) && ALLOWED_EMPLOYERS.indexOf(owner) >= 0;
    const subject = "הסכם עבודה וטופס 101 – " + emp + " – " + company;
    const body =
      "<div dir='rtl' style='font-family:Arial'>" +
      "<p>שלום,</p><p>מצורפים ההסכם החתום וטופס 101 של <b>" + esc_(emp) + "</b>" +
      (d.role ? " (" + esc_(clean_(d.role)) + ")" : "") + " ב" + esc_(company) + ".</p>" +
      (d.start ? "<p>תחילת עבודה: " + esc_(clean_(d.start)) + "</p>" : "") +
      (ownerOk ? "" : "<p style='color:#a00'>המייל של המעסיק (" + esc_(owner) + ") לא ברשימה המאושרת – המסמך נשלח רק למשרד.</p>") +
      "<p>הקובץ נשמר גם בדרייב: " + esc_(ROOT_FOLDER + " / " + company) + "</p>" +
      "<p style='color:#555;font-size:12px'>מזהה מסמך " + esc_(clean_(d.docId)) + " · גרסת הסכם " + esc_(clean_(d.agrVer)) + " · SHA-256: " + sha + "</p>" +
      "<p>תזכורת: בתחילת כל שנת מס (" + esc_(String(Number(d.taxYear || new Date().getFullYear()) + 1)) + " ואילך) יש לבקש מהעובד טופס 101 מעודכן.</p>" +
      "<p>משרד רו\"ח שניר טרמצ'י</p></div>";

    MailApp.sendEmail({
      to: ownerOk ? owner : OFFICE_EMAIL,
      cc: ownerOk ? OFFICE_EMAIL : "",
      subject: subject, htmlBody: body, attachments: [blob],
      name: "משרד רו\"ח שניר טרמצ'י"
    });

    // עותק לעובד (אם מסר מייל)
    const empMail = String(d.employeeEmail || "").trim();
    if (/^\S+@\S+\.\S+$/.test(empMail)) {
      MailApp.sendEmail({
        to: empMail, subject: "העותק שלך – הסכם עבודה וטופס 101 – " + company,
        htmlBody: "<div dir='rtl' style='font-family:Arial'><p>היי " + esc_(emp) + ",</p><p>ברוך/ה הבא/ה ל" + esc_(company) +
          "! מצורף עותק של ההסכם וטופס 101 שחתמת.</p><p>אם משהו בפרטים משתנה – עדכן/י את המעסיק בתוך שבוע.</p><p>בהצלחה!</p></div>",
        attachments: [blob], name: company
      });
    }
    return out_({ ok: true, file: file.getId(), toEmployer: ownerOk });
  } catch (err) {
    return out_({ ok: false, err: String(err) });
  }
}

function doGet() { return out_({ ok: true, service: "office-forms" }); }

function folder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function clean_(s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120); }
function esc_(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
