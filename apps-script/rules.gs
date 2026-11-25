/* rules.js – כללי העסקה משותפים לדף (index.html) ולשרת (apps-script/rules.gs – עותק זהה, נבדק בבדיקות).
   אין כאן DOM. */
const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
function fmtDate(d){ if(!d) return ""; const [y,m,dd] = d.split("-"); return dd && m && y ? `${dd}/${m}/${y}` : d; }
function validDate(s){ const m = String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return false; const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2]-1 && d.getUTCDate() === +m[3]; }
/* שכר מינימום לבגיר לפי תאריך תחולה – טבלת ביטוח לאומי, בסיס 182 שעות. [מ-, חודשי, שעתי] */
const MINW = [["2023-04-01",5571.75,30.61],["2024-04-01",5880.02,32.30],["2025-04-01",6247.67,34.32],["2026-04-01",6443.85,35.40]];
const MINW_SRC = "ביטוח לאומי – שכר מינימום (btl.gov.il)";
const MINW_KNOWN_UNTIL = "2027-03-31"; // אחרי התאריך הזה – חסימה עד עדכון הטבלה
function minWageAt(date){ let r = null; MINW.forEach(x => { if(date >= x[0]) r = x; }); return r ? {from:r[0], m:r[1], h:r[2]} : null; }
const FULL_WEEK = 42, MAX_WEEK_OT = 16, F101_YEAR = 2026;
const INDUSTRIES = [["general","כללי – אין צו הרחבה ענפי ידוע"],["construction","בנייה ותשתיות"],["cleaning","ניקיון"],["security","שמירה ואבטחה"],["transport","הובלה ומשאיות"],["food","מסעדנות וקייטרינג"],["hotels","מלונאות"],["events","אולמות וגני אירועים"],["staffing","קבלן כוח אדם / השמה"],["care","סיעוד ומטפלים"],["garage","מוסכים ורכב"],["retail","מסחר קמעונאי"],["agri","חקלאות"],["industry","תעשייה"],["other","אחר"]];
/* משמרת: "09:00-17:00" ואפשר הפסקה ליום: "09:00-17:00/30". הכול בדקות שלמות.
   מחזיר null (ריק), {bad}, {over} (חוצה חצות) או {st,en,g,brk} */
function parseShift(v){
  const s = String(v||"").trim(); if(!s) return null;
  const mm = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*-\s*(\d{1,2})(?::?(\d{2}))?(?:\s*\/\s*(\d{1,3}))?$/); if(!mm) return {bad:true};
  const m1 = +(mm[2]||0), m2 = +(mm[4]||0);
  if(+mm[1] > 23 || m1 > 59 || m2 > 59 || +mm[3] > 24 || (+mm[3] === 24 && m2 !== 0)) return {bad:true}; // 24:00 רק כסוף יום
  const st = +mm[1]*60 + m1, en = +mm[3]*60 + m2;
  if(en <= st) return {over:true, st, en};
  return {st, en, g:en-st, brk: mm[5] === undefined ? null : +mm[5]};
}
function parseDay(v){ const s = parseShift(v); return s && s.g ? s.g/60 : 0; }
function nightMin(s){ return s && s.g ? Math.max(0, Math.min(s.en,1440) - Math.max(s.st,1320)) + Math.max(0, Math.min(s.en,360) - s.st) : 0; }
/* ניתוח שבוע העבודה לפי חוק שעות עבודה ומנוחה וצו ההרחבה לקיצור שבוע העבודה (2018):
   5 ימים – 4 ימים עד 8:36 ויום מקוצר אחד עד 7:36; 6 ימים – עד 8:00; ערב המנוחה (בכל מתכונת) עד 7:00; יום שיש בו שעתיים בלילה – עד 7:00.
   נוספות יומיות קודם, ואחר כך שבועיות על יתרת השעות הרגילות מעל 42 – בלי כפל. */
function hoursPlan(t){
  const sh = DAYS.map((d,i) => parseShift((t.days||[])[i]));
  const workIdx = sh.map((s,i) => s && s.g ? i : -1).filter(i => i >= 0);
  const pattern = t.pattern || (workIdx.length >= 6 ? "6" : "5");
  const restIdx = {"ראשון":0,"שישי":5,"שבת":6}[t.restDay||"שבת"];
  const eve = (restIdx + 6) % 7;
  const shortDay = pattern === "5" ? (t.shortDay !== undefined && t.shortDay !== "" ? Number(t.shortDay) : workIdx[workIdx.length-1]) : -1;
  const brkDef = t.breakMin === undefined || t.breakMin === "" ? 0 : Number(t.breakMin);
  const rows = sh.map((s,i) => {
    if(!s || !s.g) return null;
    const night = nightMin(s) >= 120;
    const brk = s.brk !== null ? s.brk : (s.g >= 360 ? brkDef : 0);
    const net = t.breakPaid ? s.g : s.g - brk;
    const norm = (night || i === eve) ? 420 : pattern === "6" ? 480 : (i === shortDay ? 456 : 516); // ערב המנוחה – 7 שעות בכל מתכונת (סעיף 2(ב))
    const dOT = Math.max(0, net - norm);
    return {i, g:s.g, brk, net, norm, dOT, reg:net - dOT, night, st:s.st, en:s.en};
  });
  const real = rows.filter(Boolean);
  const net = real.reduce((a,r) => a + r.net, 0), reg0 = real.reduce((a,r) => a + r.reg, 0), dOT = real.reduce((a,r) => a + r.dOT, 0);
  const wOT = Math.max(0, reg0 - FULL_WEEK*60);
  const h = x => Math.round(x)/60;
  return {sh, rows, pattern, restIdx, shortDay, brkDef, workDays:real.length, night:real.some(r => r.night),
    net:h(net), regular:h(reg0 - wOT), dailyOT:h(dOT), weeklyOT:h(wOT), ot:h(dOT + wOT), otMin:dOT + wOT};
}
function restGap(plan){ // מנוחה רצופה סביב יום המנוחה, בשעות (36 לפחות – סעיף 7)
  const p = plan.sh[(plan.restIdx+6)%7], n = plan.sh[(plan.restIdx+1)%7];
  const end = p && p.g ? p.en : 0, start = n && n.g ? n.st : 1440;
  return ((1440 - end) + 1440 + start)/60;
}
function dayGaps(plan){ // הפסקה בין יום עבודה למשנהו (8 שעות לפחות – סעיף 21), כולל מעבר שבוע
  const out = [];
  plan.sh.forEach((s,i) => { const n = plan.sh[(i+1)%7]; if(s && s.g && n && n.g) out.push({i, j:(i+1)%7, gap:((1440 - s.en) + n.st)/60}); });
  return out;
}
const fmtH = h => (Math.round(h*100)/100).toString();
/* אישור משרד = תבנית חתומה (okTpl + okSig) שהשרת מאמת. בדף – רק בדיקה מקדימה לנוחות; האימות האמיתי ב-register_. */
const TPL_KEYS = ["role","wageType","minWage","empPct","erPct","sevPct","collective","breakPermit","night"];
/* מה בתנאים חורג מהתבנית שאושרה. לילה והפסקה קצרה מחושבים מהסידור עצמו – לא מדגלים שהדף שלח. */
function tplMiss(t){ const p = t.okTpl || {}, out = [], plan = hoursPlan(t);
  if(p.role && p.role !== t.role) out.push("תפקיד"); if(p.wageType && p.wageType !== t.wageType) out.push("סוג שכר");
  if(p.minWage && Number(t.wage) < Number(p.minWage)) out.push("שכר נמוך מהמאושר");
  ["empPct","erPct","sevPct"].forEach(k => { if(p[k] && Number(p[k]) !== Number(t[k] || {empPct:6,erPct:6.5,sevPct:6}[k])) out.push("שיעורי פנסיה"); });
  if((p.collective||"") !== (t.collective||"")) out.push("הסכם קיבוצי");
  const shortBreak = plan.rows.some(r => r && r.g >= 360 && r.brk < 45);
  if((t.breakPermit || shortBreak) && !p.breakPermit) out.push("היתר הפסקות");
  if(plan.night && !p.night) out.push("עבודת לילה");
  return out.filter((x,i) => out.indexOf(x) === i); }
const numOk = v => v !== "" && v !== undefined && isFinite(Number(v)) && Number(v) > 0;
/* שכבת קלט סגורה – לפני כל חישוב. בלי truthiness ובלי NaN: כל ערך נבדק לסוג ולטווח. */
/* שכבת קלט סגורה – לפני כל חישוב. כל שדה נבדק לסוג (לא String() על מערכים/אובייקטים) ולטווח,
   ואחר כך הכול מנורמל פעם אחת לאובייקט קנוני (מחרוזות), ורק הוא משמש לחישוב ולטביעה. */
const BOOL_KEYS = ["breakPaid","sec14","breakPermit","cash","cameras","youth","camPolicy","night"];
const ENUMS = {mode:["new","change"], pattern:["5","6"], restDay:["שבת","שישי","ראשון"], wageType:["hourly","monthly"], f101:["print","michpal","paper"],
  industry:INDUSTRIES.map(x => x[0]), shortDay:["0","1","2","3","4","5","6"]};
const NUM_KEYS = ["wage","weeklyHours","globalOT","globalOTAmount","empPct","erPct","sevPct","hishEr","hishEmp","breakMin"];
const TEXT_KEYS = ["company","companyId","address","role","manager","signer","harassContact","empName","collective","unionInfo","commission","travel","extras","pensionFund","workplace","otherAfter","chgReason","ownerEmail","empEmail","deductions","ephone","hishFrom","probation"];
const scalar = v => typeof v === "string" || (typeof v === "number" && isFinite(v));
const fin = v => scalar(v) && String(v).trim() !== "" && /^-?\d+(\.\d+)?$/.test(String(v).trim()) && isFinite(Number(v));
function validateInput(t){
  const e = [], has = k => t[k] !== undefined && t[k] !== "";
  if(!t || typeof t !== "object" || Array.isArray(t)) return ["מבנה תנאים לא תקין."];
  Object.keys(ENUMS).forEach(k => { if(has(k) && !(scalar(t[k]) && ENUMS[k].indexOf(String(t[k])) >= 0)) e.push({mode:"סוג מסמך לא מוכר.", pattern:"מתכונת שבוע חייבת להיות 5 או 6 ימים.", restDay:"יום מנוחה לא מוכר.", wageType:"סוג שכר לא מוכר.", f101:"מסלול טופס 101 לא מוכר.", industry:"ענף לא מוכר.", shortDay:"היום המקוצר לא תקין."}[k]); });
  if(has("breakMin") && !(fin(t.breakMin) && /^\d{1,3}$/.test(String(t.breakMin).trim()) && Number(t.breakMin) <= 180)) e.push("משך ההפסקה חייב להיות מספר שלם של דקות בין 0 ל-180.");
  if(t.days !== undefined && (!Array.isArray(t.days) || t.days.length !== 7 || t.days.some(d => typeof d !== "string"))) e.push("ימי העבודה במבנה לא תקין.");
  BOOL_KEYS.forEach(k => { if(t[k] !== undefined && typeof t[k] !== "boolean") e.push(`השדה ${k} חייב להיות כן/לא.`); });
  TEXT_KEYS.forEach(k => { if(t[k] !== undefined && typeof t[k] !== "string") e.push(`השדה ${k} חייב להיות טקסט.`); });
  ["start","effDate","origStart"].forEach(k => { if(has(k) && !(typeof t[k] === "string" && validDate(t[k]))) e.push(`התאריך ${k} לא תקין.`); });
  NUM_KEYS.forEach(k => { if(has(k) && !fin(t[k])) e.push(`הערך ${k} חייב להיות מספר.`); });
  [["wage","השכר"],["weeklyHours","היקף השעות"]].forEach(([k,n]) => { if(has(k) && !(fin(t[k]) && Number(t[k]) > 0)) e.push(`${n} לא תקין.`); });
  // גמול גלובלי: צמד אטומי – שניהם ריקים, או שניהם חיוביים
  if(has("globalOT") || has("globalOTAmount")) { if(!(fin(t.globalOT) && Number(t.globalOT) > 0 && fin(t.globalOTAmount) && Number(t.globalOTAmount) > 0)) e.push("גמול שעות נוספות גלובלי: יש למלא גם מכסת שעות וגם סכום חודשי, שניהם חיוביים – או להשאיר את שניהם ריקים."); }
  // פנסיה: לא פחות מהשיעורים בצו ההרחבה (עובד 6%, מעסיק 6.5%, פיצויים 6% או 8.33%), ועד תקרה סבירה
  const pct = (k, def) => has(k) ? Number(t[k]) : def;
  if(!["empPct","erPct","sevPct"].some(k => has(k) && !fin(t[k]))){
    if(pct("empPct",6) < 6 || pct("empPct",6) > 20) e.push("הפרשת עובד לפנסיה – לפחות 6% (צו ההרחבה). שיעור אחר מחייב בדיקת משרד.");
    if(pct("erPct",6.5) < 6.5 || pct("erPct",6.5) > 20) e.push("הפרשת מעסיק לתגמולים – לפחות 6.5% (צו ההרחבה). שיעור אחר מחייב בדיקת משרד.");
    if([6, 8.33].indexOf(pct("sevPct",6)) < 0) e.push("הפרשה לפיצויים – 6% או 8.33% בלבד בכלי.");
  }
  ["hishEr","hishEmp"].forEach(k => { if(has(k) && fin(t[k]) && !(Number(t[k]) >= 0 && Number(t[k]) <= 20)) e.push("שיעורי קרן השתלמות לא תקינים."); });
  // הודעת שינוי: changed = מערך ייחודי מתוך CHG; prev = אובייקט פשוט עם ערכים סקלריים
  if(t.changed !== undefined){
    const keys = CHG.map(c => c[0]);
    if(!Array.isArray(t.changed) || t.changed.some(k => typeof k !== "string" || keys.indexOf(k) < 0) || new Set(t.changed).size !== t.changed.length) e.push("רשימת השינויים לא תקינה.");
  }
  if(t.prev !== undefined){
    if(!t.prev || typeof t.prev !== "object" || Array.isArray(t.prev) || Object.keys(t.prev).some(k => !scalar(t.prev[k]))) e.push("הערכים הקודמים במבנה לא תקין.");
    else if(t.prev.wageType !== undefined && ENUMS.wageType.indexOf(t.prev.wageType) < 0) e.push("סוג השכר הקודם לא מוכר.");
  }
  return e;
}
/* נרמול חד-פעמי: אחרי validateInput בלבד. ערכים מספריים ו-enum הופכים למחרוזת קנונית – אותו אובייקט לחישוב ולטביעה. */
function normalizeTerms(t){
  const o = JSON.parse(JSON.stringify(t));
  Object.keys(ENUMS).concat(NUM_KEYS).forEach(k => { if(o[k] !== undefined && o[k] !== "" && scalar(o[k])) o[k] = String(o[k]).trim(); });
  if(o.prev) Object.keys(o.prev).forEach(k => { o.prev[k] = String(o.prev[k]); });
  return o;
}
function checkTerms(t, ctx){
  const err = [], warn = [], ok = !!(ctx && ctx.approved);
  const bad = validateInput(t);
  if(bad.length) return {err: bad, warn, plan: null};      // קלט לא תקין – לא מחשבים כלום
  t = normalizeTerms(t);                                   // מכאן – רק האובייקט הקנוני
  const plan = hoursPlan(t);
  if(["net","regular","ot","dailyOT","weeklyOT"].some(k => !isFinite(plan[k]) || plan[k] < 0)) return {err: ["חישוב השעות לא תקין – בדוק/י את הימים, השעות וההפסקות."], warn, plan};
  plan.sh.forEach((s,i) => {
    if(s && s.bad) err.push(`ביום ${DAYS[i]} השעות לא בפורמט "09:00-17:00" (אפשר להוסיף הפסקה ליום: "09:00-17:00/30").`);
    if(s && s.over) err.push(`ביום ${DAYS[i]} המשמרת חוצה את חצות. משמרות שחוצות יום לא נתמכות בכלי – יש לפנות למשרד.`);
    if(s && s.g && s.brk !== null && s.brk >= s.g) err.push(`ביום ${DAYS[i]} ההפסקה ארוכה מהמשמרת.`);
  });
  if(plan.pattern === "5" && plan.workDays > 5) err.push(`נבחר שבוע של 5 ימים, אבל רשומים ${plan.workDays} ימי עבודה.`);
  if(plan.pattern === "6" && plan.workDays && plan.workDays < 6) warn.push(`נבחר שבוע של 6 ימים, ורשומים ${plan.workDays} ימי עבודה – ודא/י שזו המתכונת הנכונה.`);
  if(plan.pattern === "5" && plan.workDays && !plan.sh[plan.shortDay]?.g) err.push("היום המקוצר שנבחר אינו יום עבודה.");
  if(plan.sh[plan.restIdx] && plan.sh[plan.restIdx].g) err.push(`ביום המנוחה השבועי (${t.restDay||"שבת"}) רשומות שעות עבודה. עבודה במנוחה מחייבת היתר – יש לפנות למשרד.`);
  else if(plan.workDays && restGap(plan) < 36) err.push(`המנוחה הרצופה סביב יום ה${t.restDay||"שבת"} קצרה מ-36 שעות (${fmtH(restGap(plan))} שעות) – סעיף 7 לחוק.`);
  dayGaps(plan).forEach(g => { if(g.gap < 8) err.push(`בין יום ${DAYS[g.i]} ליום ${DAYS[g.j]} יש רק ${fmtH(g.gap)} שעות מנוחה – לפי סעיף 21 לחוק נדרשות 8 שעות לפחות.`); });
  plan.rows.forEach(r => { if(r && r.net > 720) err.push(`ביום ${DAYS[r.i]} יוצאות ${fmtH(r.net/60)} שעות עבודה – יותר מ-12 שעות ביום, כולל שעות נוספות.`); });
  if(plan.otMin > MAX_WEEK_OT*60) err.push(`לפי המשמרות יש ${fmtH(plan.ot)} שעות נוספות בשבוע – מעל ${MAX_WEEK_OT}. זה חורג מההיתר הכללי ומחייב בדיקת משרד.`);
  // הפסקות – סעיף 20. גם כשהעובד נשאר במקום (ההפסקה משולמת) – ההפסקה עצמה נדרשת.
  plan.rows.forEach(r => { if(r && r.g >= 360 && t.breakPermit && r.brk < 30) err.push(`ביום ${DAYS[r.i]} מוגדרת הפסקה של ${r.brk} דקות. גם כשחל היתר – הכלי דורש לפחות 30 דקות רצופות ביום של 6 שעות ומעלה; מקרה אחר – בדיקת משרד.`); });
  plan.rows.forEach(r => { if(r && r.g >= 360 && r.brk < 45 && !t.breakPermit) err.push(`ביום ${DAYS[r.i]} (${fmtH(r.g/60)} שעות) מוגדרת הפסקה של ${r.brk} דקות. לפי סעיף 20 לחוק נדרשת הפסקה של 45 דקות לפחות, מהן 30 רצופות${t.breakPaid ? " – גם כשהעובד נדרש להישאר במקום (אז היא משולמת)" : ""}. אם חל היתר – סמן/י אותו; זה מחייב אישור משרד.`); });
  if(t.breakPermit && !ok) err.push("סומן היתר להפסקות (עבודה שאינה עבודת כפיים). חריגה מחייבת אישור משרד חתום בקישור המעסיק.");
  if(plan.night && !ok) err.push("יש משמרת עם שעתיים לפחות בין 22:00 ל-06:00. יום כזה הוא עד 7 שעות רגילות, וחלות מגבלות עבודת לילה (סעיף 22) – מחייב אישור משרד חתום.");
  else if(plan.night) warn.push("עבודת לילה: יום של עד 7 שעות רגילות. המשרד אישר את התבנית.");
  if(plan.ot > 0) warn.push(`לפי המשמרות: ${fmtH(plan.regular)} שעות רגילות ו-${fmtH(plan.ot)} שעות נוספות בשבוע (${fmtH(plan.dailyOT)} יומיות, ${fmtH(plan.weeklyOT)} שבועיות). השעות הנוספות ישולמו בגמול לפי החוק${t.wageType === "monthly" && !t.globalOT ? " – בנוסף לשכר החודשי" : ""}.`);
  // היקף: השדה = שעות העבודה הנטו לפי הסידור. סתירה מהותית חוסמת.
  const w = Number(t.weeklyHours||0);
  if(t.weeklyHours !== undefined && t.weeklyHours !== "" && !numOk(t.weeklyHours)) err.push("היקף השעות השבועי לא תקין.");
  if(plan.workDays && w && Math.abs(plan.net - w) > 0.5) err.push(`לפי הימים, השעות וההפסקות יוצאות ${fmtH(plan.net)} שעות עבודה בשבוע, ובהיקף המשרה כתוב ${w}. יש להתאים (כפתור "עדכן היקף").`);
  else if(plan.workDays && w && Math.abs(plan.net - w) > 0.01) warn.push(`הפרש קטן בין ההיקף (${w}) לבין הסידור (${fmtH(plan.net)}).`);
  // שכר מינימום – חוסם. נבדק לפי מועד התחולה, על השכר הרגיל בלבד, ולפי השעות הרגילות שבסידור (או ההיקף אם אין סידור).
  const on = (t.mode === "change" ? t.effDate : t.start) || "", mw = on ? minWageAt(on) : null;
  if(t.wage !== undefined && t.wage !== "" && !numOk(t.wage)) err.push("סכום השכר לא תקין.");
  const wage = Number(t.wage||0);
  if(on && !mw) err.push(`מועד התחולה (${fmtDate(on)}) לפני 1.4.2023 – אין בכלי טבלת שכר מינימום לתקופה זו. יש לפנות למשרד.`);
  if(on > MINW_KNOWN_UNTIL) err.push(`מועד התחולה (${fmtDate(on)}) אחרי ${fmtDate(MINW_KNOWN_UNTIL)} – טבלת שכר המינימום בכלי עוד לא עודכנה לתקופה זו. יש לפנות למשרד.`);
  if(mw && numOk(t.wage)){
    const regH = plan.workDays ? Math.min(plan.regular, FULL_WEEK) : Math.min(w || FULL_WEEK, FULL_WEEK);
    if(t.wageType === "monthly"){ const min = Math.round(mw.m * regH / FULL_WEEK * 100)/100; if(wage < min) err.push(`השכר החודשי (${wage} ₪) נמוך משכר המינימום היחסי להיקף (${min} ₪ ל-${fmtH(regH)} שעות רגילות, לפי ${mw.m} ₪ למשרה מלאה מ-${fmtDate(mw.from)}; מקור: ${MINW_SRC}).`); }
    else if(wage < mw.h) err.push(`השכר השעתי (${wage} ₪) נמוך משכר המינימום לשעה (${mw.h} ₪ מ-${fmtDate(mw.from)}; מקור: ${MINW_SRC}).`);
  }
  // גמול שעות נוספות גלובלי – חייב סכום, והסכום לא נמוך מהגמול המינימלי על השעות
  if(t.globalOT){
    if(!numOk(t.globalOT)) err.push("מספר השעות הנוספות הגלובליות לא תקין.");
    else if(!numOk(t.globalOTAmount)) err.push("לגמול שעות נוספות גלובלי יש לרשום סכום חודשי.");
    else { // ערך שעה לפי השעות הרגילות המוסכמות (לא 182 קבוע), ובדיקה שמרנית לפי 150% – כי חלק מהשעות עשוי להיות ב-150%
      const regH = plan.workDays ? Math.min(plan.regular, FULL_WEEK) : Math.min(w || FULL_WEEK, FULL_WEEK);
      const hr = t.wageType === "monthly" ? wage / (regH * 52 / 12) : wage, need = Math.round(Number(t.globalOT) * hr * 1.5 * 100)/100;
      if(Number(t.globalOTAmount) < need) err.push(`הגמול הגלובלי (${t.globalOTAmount} ₪) נמוך מ-150% עבור ${t.globalOT} שעות לפי ערך שעה ${fmtH(hr)} ₪ (${need} ₪). הבדיקה שמרנית; סכום נמוך יותר – רק אחרי בדיקה פרטנית של המשרד.`); }
  }
  if(t.youth) err.push("עובד/ת מתחת לגיל 18: חלים חוק עבודת הנוער, שכר מינימום לנוער ומגבלות שעות ולילה. מסלול נוער לא נתמך בכלי – יש לפנות למשרד.");
  // ענף / הסכם קיבוצי – חוסם. אישור משרד תקף רק במצב שרת, חתום בשרת (ראה register_ ב-Code.gs) – דגל בדף אינו אישור.
  const branch = (t.industry && t.industry !== "general") || t.collective;
  if(branch && !ok) err.push("נבחר ענף שעשוי לחול עליו צו הרחבה ענפי, או הוזן הסכם קיבוצי. השכר, הפנסיה, השעות והתוספות תלויים בצו – המסמך לא יופק בלי אישור משרד חתום, שקיים רק בקישור מעסיק שהמשרד הפיק.");
  if(ok){ const miss = tplMiss(t); if(miss.length) err.push(`התנאים חורגים מהתבנית שהמשרד אישר: ${miss.join(", ")}.`); else warn.push("התנאים בתוך התבנית שהמשרד אישר. השרת יאמת את האישור ביצירת הקישור."); }
  if(t.collective && !t.unionInfo) err.push("הוזן הסכם קיבוצי – יש לרשום את שם ארגון העובדים ומענו (חוק הודעה לעובד).");
  if(t.sevPct && Number(t.sevPct) < 8.33 && !t.sec14) err.push("ב-6% לפיצויים סעיף 14 חל מכוח צו ההרחבה לביטוח פנסיוני. ביטול הסימון מחייב בדיקת משרד.");
  if(t.sec14 && Number(t.sevPct) >= 8.33) warn.push("פיצויים 8.33%: יופק מכתב הודעה לקופה (העתק לעובד). ההחלה על ההשלמה מותנית במסירה בפועל לקופה – לא בהדפסת המכתב. יש למסור ולשמור אישור; המשרד יעקוב.");
  if(t.cameras && !t.camPolicy) err.push("סומנו מצלמות – יש לאשר שמדיניות המצלמות (מיקום ומטרה) נמסרה לעובד בכתב.");
  if(t.mode !== "change" && t.f101 === "print" && t.start && Number(t.start.slice(0,4)) > F101_YEAR) err.push(`תחילת העבודה ב-${t.start.slice(0,4)}: טופס 101 בכלי הוא גרסת ${F101_YEAR}. עד לעדכון הטופס – בחר/י 101 דרך מיכפל, או פנה/י למשרד.`);
  // חוק הודעה לעובד – פרטים חובה (סעיף 2)
  const need = [["company","זהות המעסיק"],["address","כתובת המעסיק"],["role","התפקיד"],["manager","שם או תפקיד הממונה הישיר"],["weeklyHours","היקף המשרה"],["restDay","יום המנוחה"],["wage","השכר"],["harassContact","האחראי לטיפול בתלונות על הטרדה מינית ודרך הפנייה"]];
  if(t.mode !== "change") need.push(["start","מועד תחילת העבודה"]);
  need.forEach(([k,n]) => { if(!t[k]) err.push(`חסר פרט חובה: ${n}.`); });
  [["start","תאריך תחילת העבודה"],["effDate","מועד השינוי"]].forEach(([k,n]) => { if(t[k] && !validDate(t[k])) err.push(`${n} (${t[k]}) אינו תאריך קיים.`); });
  if(numOk(t.weeklyHours) && Number(t.weeklyHours) > FULL_WEEK + MAX_WEEK_OT) err.push(`היקף של ${t.weeklyHours} שעות בשבוע – מעל ${FULL_WEEK + MAX_WEEK_OT} (42 רגילות + 16 נוספות).`);
  if(!plan.workDays && t.mode !== "change") err.push("יש למלא את ימי ושעות העבודה – בלעדיהם אי אפשר לבדוק שעות, הפסקות ומנוחה.");
  if(!plan.workDays && t.mode === "change" && (t.changed||[]).some(k => k === "sched" || k === "hours")) err.push("שינוי בשעות או בסידור – יש למלא את ימי ושעות העבודה החדשים. שעות משתנות בלי סידור – רק בבדיקת משרד.");
  if(t.harassContact && !/\d{6,}|@/.test(t.harassContact.replace(/[\s-]/g,""))) err.push("באחראי לתלונות על הטרדה מינית יש לרשום גם דרך פנייה – טלפון או מייל.");
  if(t.mode === "change") changeCheck(t).forEach(x => err.push(x));
  return {err, warn, plan};
}
/* הודעה על שינוי: כל פרט שמשתנה – ערך קודם מובנה; ה"אחרי" מאותו אובייקט שמזין את התנאים. אין הערות חופשיות. */
const CHG = [["wage","השכר"],["hours","היקף המשרה"],["role","התפקיד"],["sched","ימי ושעות העבודה"],["pension","הפרשות לפנסיה"],["other","תנאי אחר"]];
const CHG_REASONS = ["","העלאת שכר","קידום או שינוי תפקיד","לבקשת העובד","שינוי בצורכי העסק","עדכון לפי דין או צו","אחר"];
const pensLine = t => `עובד ${t.empPct||"6"}% · מעסיק ${t.erPct||"6.5"}% · פיצויים ${t.sevPct||"6"}%`;
function chgBefore(t, k){ const p = t.prev||{}; return k === "wage" ? (p.wage ? `${p.wage} ₪ ${p.wageType === "monthly" ? "לחודש" : "לשעה"}` : "") : k === "hours" ? (p.hours ? `${p.hours} שעות בשבוע` : "") : String(p[k]||""); }
function chgAfter(t, k){ return k === "wage" ? `${t.wage} ₪ ${t.wageType === "monthly" ? "לחודש" : "לשעה"}` : k === "hours" ? `${t.weeklyHours} שעות בשבוע` : k === "role" ? t.role : k === "sched" ? (t.days||[]).map((d,i) => d ? `${DAYS[i]} ${d}` : "").filter(Boolean).join(", ") : k === "pension" ? pensLine(t) : (t.otherAfter || ""); }
function changeCheck(t){
  const e = [], ch = t.changed || [], p = t.prev || {};
  if(!ch.length) e.push("בהודעה על שינוי יש לסמן מה משתנה, ולמלא את הערך הקודם.");
  ch.forEach(k => { const n = (CHG.find(c => c[0] === k)||[,k])[1];
    if(k === "wage"){ if(!numOk(p.wage)) e.push("חסר השכר הקודם (סכום)."); else if(Number(p.wage) === Number(t.wage) && (p.wageType||"hourly") === (t.wageType||"hourly")) e.push(`השכר הקודם והחדש זהים (${t.wage}). בדוק/י שעדכנת את השכר בטופס לערך החדש.`); return; }
    if(k === "hours"){ if(!numOk(p.hours)) e.push("חסר ההיקף הקודם (שעות)."); else if(Number(p.hours) === Number(t.weeklyHours)) e.push(`ההיקף הקודם והחדש זהים (${t.weeklyHours}).`); return; }
    const before = String(p[k]||"").trim();
    if(!before) e.push(`חסר הערך הקודם של ${n}.`);
    if(k === "other" && !String(t.otherAfter||"").trim()) e.push("חסר הערך החדש של התנאי האחר.");
    if(k === "other" && /₪|שכר|שעות|שעה|היקף|פנסי|%|\d/.test(before + " " + (t.otherAfter||""))) e.push("ב'תנאי אחר' אסור לכתוב שכר, שעות, פנסיה או מספרים – לאלה יש שדות מובנים.");
    if(before && before === chgAfter(t,k).trim()) e.push(`הערך הקודם והחדש של ${n} זהים.`);
  });
  return e;
}
