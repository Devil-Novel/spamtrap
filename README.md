# Spam Trap Bot

بوت Discord بيمسك بوتات السبام والأكونتات المخترقة (hacked) تلقائي، عن طريق قناة "فخ" (trap channel). أي حد مش أدمن ومش بوت يكتب فيها بيتعاقب في أقل من 3 ثواني بدون أي تدخل يدوي.

**Application ID:** `1523811499766976723`
**اسم البوت:** Spam Trap

---

## 1) خطوات ضرورية في Discord Developer Portal

1. https://discord.com/developers/applications → اختار الأبلكيشن اللي الـ ID بتاعه `1523811499766976723`.
2. من تبويب **Bot**:
   - فعّل **MESSAGE CONTENT INTENT**
   - فعّل **SERVER MEMBERS INTENT**
   - فعّل **SERVER MODERATION INTENT** (لو ظاهر)
   - خد التوكن وحطه في `BOT_TOKEN`
3. من تبويب **General Information** خد الـ **Application ID** وحطه في `CLIENT_ID` (هو نفسه `1523811499766976723`).
4. ارفع الإيموجي المخصص للبوت من تبويب **Emojis** باسم `Done` (لازم يبقى نفس الاسم عشان `<:Done:1523817641653829774>` يشتغل، أو غيّر الـ ID في `index.js` لو رفعته برقم تاني).
5. من **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Ban Members`, `Manage Messages`, `Manage Channels`, `Moderate Members`, `Create Instant Invite`, `View Channel`, `Send Messages`, `Manage Roles` (لو محتاج)
   - افتح اللينك وادعي البوت لسيرفرك

⚠️ رتبة البوت لازم تكون **أعلى** من رتبة أي حد عايز تطرده/تبانه.

---

## 2) تسجيل الـ Slash Commands

قبل أول تشغيل، أو بعد أي تعديل في `commands.js`:

```bash
npm install
npm run deploy-commands
```

- لو حطيت `GUILD_ID` في `.env`، الأوامر هتظهر فورًا على السيرفر ده بس (مفيد للتجربة).
- لو سبته فاضي، الأوامر بتتسجل Global وممكن تاخد لحد ساعة تظهر على كل السيرفرات.

---

## 3) رفع الكود على GitHub

```bash
git init
git add .
git commit -m "spam trap bot"
git branch -M main
git remote add origin <رابط الريبو بتاعك>
git push -u origin main
```

---

## 4) النشر على Railway

1. https://railway.app → **New Project > Deploy from GitHub repo** → اختار الريبو.
2. من **Variables** ضيف:
   - `BOT_TOKEN`
   - `CLIENT_ID` = `1523811499766976723`
   - `GUILD_ID` (اختياري، سيبه فاضي لو عايزه يشتغل على كذا سيرفر)
3. Railway هيشغل `node index.js` (من `Procfile`/`npm start`).
4. **مهم للاستمرارية**: البوت بيحفظ الإعدادات في `data/db.json` على القرص. من غير **Volume** في Railway، البيانات دي هتتمسح لو البوت عمل Redeploy. من تبويب **Settings > Volumes** في Railway، اعمل Volume واربطه بمسار `/app/data` عشان الإعدادات متتمسحش.

---

## 5) الأوامر المتاحة (لازم Ban Members + Manage Server)

| الأمر | الوظيفة |
| --- | --- |
| `/spamtrap channel` | تحديد قناة الفخ + بوستنج رسالة تحذير بـ 7 لغات ومعمولها Pin |
| `/spamtrap log` | تحديد قناة اللوج |
| `/spamtrap action` | softban (افتراضي) / ban / disabled |
| `/spamtrap channels` | لغاية 5 قنوات فخ (محتاج تفعيل Many Traps الأول) |
| `/spamtrap toggle` | قايمة منسدلة لتشغيل/تقفيل أي تجربة من الـ 11 |
| `/spamtrap experiments` | عرض كل التجارب وحالتها |
| `/spamtrap-messages` | فورم لتعديل رسالة التحذير/الـ DM/اللوج (بتدعم المتغيرات زي `{{server:name}}`) |
| `/spamtrap status` | عرض الإعدادات الحالية بالكامل |
| `/spamtrap stats` | إحصائيات الإمساك (السيرفر ده + كل السيرفرات) |
| `/spamtrap disable` | يوقف الفخ بس يسيب باقي الإعدادات |

## التجارب الـ 11 (Experiments)

Forward Message, Reinvite, No DM, No Warning, Channel Warmer, Random Channel Name, Random Name Chaos, Timeout First, Only Recent Delete, Many Traps, Ensure Deletion — كل التفاصيل موجودة في `/spamtrap experiments` جوه البوت نفسه.

ملاحظة: Random Channel Name و Random Name Chaos بيلغوا بعض — تفعيل واحد بيقفل التاني أوتوماتيك.

## متغيرات الرسايل (Template Variables)

`{{action:text}}`, `{{server:name}}`, `{{server:name:linked}}`, `{{trap:channel:link}}`, `{{trap:channel:mention}}` — تقدر تستخدمهم في `/spamtrap-messages`.
