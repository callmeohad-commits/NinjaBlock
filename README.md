# NinjaAdBlocker 🥷

תוסף Chrome (Manifest V3) לזיהוי פרסומות בעזרת **מודל הערכה היוריסטי** (Heuristic Scoring Model).

## איך זה עובד
1. **חילוץ מאפיינים** – `content.js` סורק `div`, `iframe`, `aside`, `section`, `ins` ועוד, ובודק:
   - מילות מפתח ב‑id / class / data‑* (`sponsored`, `taboola`, `outbrain`, `ad-container`…)
   - דומיינים של רשתות פרסום ב‑iframe ובקישורים
   - תוויות גלויות כמו "Sponsored" / "ממומן" / "פרסומת"
   - פרופורציות סטנדרטיות של IAB (300×250, 728×90, 160×600…)
   - אלמנטים צפים (fixed/sticky)
   - מאפיינים שליליים (אזורים גדולים מדי, `main`/`nav`, טפסים) כדי למנוע זיהוי שגוי
2. **ציון** – כל מאפיין מוסיף/מוריד נקודות. מעל `THRESHOLD` (ברירת מחדל 6) האלמנט מסומן.
3. **הסוואה דיסקרטית** – במקום למחוק, `style.css` מטשטש, מעלים כמעט לגמרי ומבטל לחיצות. האלמנט נשאר ב‑DOM בגודלו המקורי.
4. **MutationObserver** – עוקב אחרי פרסומות שנטענות בגלילה.

## התקנה
1. פתחו `chrome://extensions`
2. הפעילו **Developer mode**
3. לחצו **Load unpacked** ובחרו את התיקייה `NinjaAdBlocker`

## כיוונון
ב‑`content.js`:
- `THRESHOLD` – הורדה = יותר אגרסיבי, העלאה = פחות זיהויים שגויים
- `DEBUG = true` – מדפיס לקונסול את הציון והסיבות לכל אלמנט

## בדיקות אוטומטיות
`npm install && npx playwright install chromium && npm test` – טוען את התוסף ב‑Chromium אמיתי ובודק זיהוי, אי‑זיהוי שגוי ו‑MutationObserver.
ב‑GitHub הבדיקה רצה אוטומטית בכל push (לשונית **Actions**).
