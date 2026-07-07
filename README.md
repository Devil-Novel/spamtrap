# بوت طرد القناة الممنوعة

بوت بسيط: أي حد يكتب في القناة اللي محددها، بيتمسح الرسالة بتاعته وبيتطرد من السيرفر.

- السيرفر: `1025348384900522004`
- القناة الممنوعة: `1520799402883809382`
- الأدمن مستثنى من الطرد (اختياري - تقدر تشيله من الكود لو عايز)

## 1) خطوات ضرورية في Discord Developer Portal

1. روح على https://discord.com/developers/applications واختار البوت بتاعك (أو اعمل واحد جديد).
2. من تبويب **Bot**:
   - فعّل **MESSAGE CONTENT INTENT**
   - فعّل **SERVER MEMBERS INTENT**
   - خد الـ Token (Reset Token لو مش متأكد) - هتحطه في متغير البيئة `BOT_TOKEN`
3. من تبويب **OAuth2 > URL Generator**:
   - اختار Scopes: `bot`
   - اختار Permissions: `Kick Members`, `Manage Messages`, `View Channel`, `Send Messages`
   - افتح اللينك اللي هيتولد وادخل بيه سيرفرك عشان تدعي البوت

⚠️ **مهم جدًا**: رتبة البوت في السيرفر (Role) لازم تكون **أعلى** من رتبة أي حد عايز تطرده، وإلا مش هيقدر يطرد حد.

## 2) رفع الكود على GitHub

```bash
git init
git add .
git commit -m "kick channel bot"
git branch -M main
git remote add origin <رابط الريبو بتاعك>
git push -u origin main
```

## 3) النشر على Railway

1. ادخل https://railway.app وسجل دخول بحساب GitHub.
2. اعمل **New Project > Deploy from GitHub repo** واختار الريبو بتاع البوت.
3. من تبويب **Variables** ضيف المتغيرات دي:
   - `BOT_TOKEN` = توكن البوت
   - `GUILD_ID` = `1025348384900522004`
   - `CHANNEL_ID` = `1520799402883809382`
4. Railway هيتعرف تلقائي على `Procfile` أو `npm start` ويشغل البوت كـ Worker.
5. تابع الـ Logs، لو شفت `✅ البوت شغال دلوقتي باسم: ...` يبقى كله تمام.

## 4) لو عايز تغيّر السيرفر أو القناة لاحقًا

من غير ما تعدل الكود، غيّر قيم `GUILD_ID` و `CHANNEL_ID` من Variables في Railway وريستارت البوت.

## ملاحظات

- لو عايز البوت يطرد الأدمن كمان، امسح الجزء ده من `index.js`:
```js
if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
  return;
}
```
- لو عايز بدل الطرد يكون **Timeout** (إسكات مؤقت) بدل طرد نهائي، قولي وأعدلها لك بسهولة.
