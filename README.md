# bcars-video

סרטוני מודעה לרכבים של בית הרכב (עפולה), נבנים אוטומטית מתמונות הרכב ומנתוני האתר bcars.co.il.

- `pipeline.mjs`: פעמיים ביום (GitHub Actions) בונה סרטון NOVEMBER SALE לכל רכב במלאי, רק למה שחדש או שהשתנה.
- `render.mjs`: בונה סרטון ממשימה, עם התבנית `template-sale/` (או `template/` לסרטון המלאי הרגיל).
- `videos-sale.json`: הסרטונים העדכניים (בגרסה "videos-sale"). מטא מושכת אותם מהקישור הציבורי.
- `carousel-plates.json`: רכבים שהמודעה שלהם קרוסלה, ולכן לא נבנה להם סרטון.

מוזיקה: Mixkit Stock Music Free License, מורדת בזמן הבנייה ולא נשמרת כאן. גופנים: Heebo, Karantina (SIL OFL).
