# ⚔ Chess Arena Pro — نسخة احترافية جاهزة للإنتاج

منصة ألعاب متعددة اللاعبين بجودة تجارية: شطرنج، لودو، جاكارو، Warhex، Connect 4.

## ✨ المميزات

### 🎮 أوضاع اللعب
- **لعب محلي** — لاعبان على نفس الجهاز، قلب الرقعة تلقائي
- **لعب أونلاين** — غرف بكود، دردشة، دعوات أصحاب
- **مباراة عشوائية** — matchmaking تلقائي مع عد تنازلي
- **ضد الذكاء الاصطناعي** — 4 مستويات (easy/medium/hard/expert) بمحرك minimax + alpha-beta pruning

### 🎤 Voice Chat
- WebRTC كامل مع STUN + TURN (Metered.ca Open Relay)
- كتم المايك + كتم السماعة
- كشف من يتحدث (audio level analysis)
- إعادة اتصال تلقائي عند انقطاع ICE

### 🎨 التصميم
- Loading screen احترافي بقطع شطرنج متحركة + شريط تحميل
- Auth screen بـ glassmorphism + خلفية متحركة + animations
- Full-screen game view مستقل عن اللوبي
- Timer لكل لاعب + مؤشر الدور + سجل النقلات + دردشة
- Dark theme + responsive لكل الأجهزة

### 🔊 المؤثرات
- أصوات إجرائية (Web Audio API): نقل، أسر، كش، فوز، خسارة، نرد
- اهتزاز على الهاتف (Vibration API)

### 👥 النظام الاجتماعي
- قائمة أصدقاء + إضافة
- Elo Rating (معادلة قياسية)
- لوحة متصدرين
- سجل مباريات
- إنجازات (7 أوسمة)

### 🔒 الأمان
- bcrypt (12 rounds) + JWT + refresh tokens
- Helmet, CORS, rate limiting, compression
- Input validation + error handling + logging

### 🗄️ قاعدة البيانات
- PostgreSQL مع migrations + JSON fallback تلقائي
- Schema: users, matches, match_players, friends, game_invites, user_achievements, leaderboard view

## 🚀 التشغيل

```bash
npm install
npm start
# افتح http://localhost:3000
```

## 🌐 النشر

### Railway
```bash
railway init && railway add postgresql && railway up
```

### Render
استخدم `render.yaml` — ينشئ PostgreSQL تلقائيًا

### Docker
```bash
docker build -t chess-arena . && docker run -p 3000:3000 chess-arena
```

## 🔧 متغيرات البيئة

انظر `.env.example` — أهمها:
- `DATABASE_URL` — رابط PostgreSQL (فارغ = JSON)
- `JWT_SECRET` — مفتاح عشوائي قوي
- `TURN_SECRET` — `openrelayprojectsecret` (مجاني من Metered.ca)

## 📁 الهيكل

```
warhex_pro/
├── server.js              # الخادم الرئيسي
├── src/
│   ├── logger.js          # نظام تسجيل
│   ├── db.js              # طبقة PostgreSQL + JSON
│   ├── auth.js            # JWT + bcrypt + Elo
│   ├── turn.js            # TURN credentials (Metered)
│   ├── ai-chess.js        # محرك الذكاء الاصطناعي
│   ├── rooms.js           # غرف + matchmaking
│   └── migrate.js         # migrations
├── database/migrations/   # SQL migrations
├── public/
│   ├── index.html         # الواجهة الكاملة
│   ├── styles.css         # تصميم احترافي
│   ├── app.js             # منطق العميل
│   ├── sound.js           # مؤثرات صوتية
│   ├── voice.js           # WebRTC voice chat
│   └── games/             # 5 محركات ألعاب
├── Dockerfile, railway.json, render.yaml
└── .env.example
```
