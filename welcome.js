// ============================================================
// welcome.js
// ALJESAT BOT
// نظام رسالة الترحيب مع الصورة والروابط
// نسخة محدّثة: إصلاح المنشن (LID support)
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

// ⭐ استيراد دوال LID
const { cleanNumber, buildSafeMention } = require("./bot");

// ============================================================
// أدوات مساعدة
// ============================================================

/**
 * ⭐ بناء منشن آمن (يدعم LID و PN)
 */
function safeNumber(num) {
    const clean = cleanNumber(num);
    if (!clean) return "";

    // إذا كان JID صحيح، استخدمه كما هو
    if (typeof num === "string" && num.includes("@")) {
        return buildSafeMention(num) || `${clean}@s.whatsapp.net`;
    }

    return `${clean}@s.whatsapp.net`;
}

/**
 * استخراج الرقم الصافي من أي مصدر
 */
function extractNumber(source) {
    if (!source) return "";
    return cleanNumber(String(source).split("@")[0]);
}

function getWelcomeMessage(nickname, userNumber, db) {
    // جلب الروابط
    let link1 = "الرابط 1";
    let link2 = "الرابط 2";

    try {
        if (db && db.welcomeLinks) {
            if (db.welcomeLinks.link1 && String(db.welcomeLinks.link1).trim()) {
                link1 = String(db.welcomeLinks.link1).trim();
            }
            if (db.welcomeLinks.link2 && String(db.welcomeLinks.link2).trim()) {
                link2 = String(db.welcomeLinks.link2).trim();
            }
        }
    } catch (_) {}

    const safeNickname = nickname && String(nickname).trim() ? nickname : "غير مسجل";
    const cleanNum = extractNumber(userNumber);

    return `╮─❖『 👑 ترحيب 』❖─╭

 أضــاءت مملكة *آلنـ🔥ــآر* بانضمامك إلينا! 
أهلًا وسهلًا بك في المكان الذي لا يعرف الملل، ولا يتوقف فيه الحماس. 🌟
لقد أنرت المملكة بحضورك، ويسعدنا جدًا انضمامك إلى عائلتنا. 🤍

_*آلَــلـقــــــب:*_    ┊ ${safeNickname} ┊

_*آلَمِــــنـــــشــــن:*_
  ┊ @${cleanNum} ┊

\`الدخول اجباري لهنا:\`
╮──────────────╭
📢 \`الإعــلانــات:\` ${link1}】

🛒 \`الــمــتــجــر:\` ${link2} 】
╯──────────────╰
🌸 نتمنى لك قضاء أجمل الأوقات معنا، وندعوك للمشاركة والتفاعل باستمرار.

╮──────────────╭
                     ꧁ تــوقــيــع ꧂ 
                𝑭. 𝑰. 𝑹
╯──────────────╰`;
}

// ============================================================
// ⭐ إرسال رسالة الترحيب (مع إصلاح المنشن)
// ============================================================

async function sendWelcome(sock, jid, userNumber, photoEntry, db) {
    try {
        if (!sock || !jid || !userNumber) {
            console.warn("⚠️ sendWelcome: بيانات ناقصة");
            return false;
        }

        const cleanNum = extractNumber(userNumber);
        if (!cleanNum) {
            console.warn("⚠️ sendWelcome: رقم غير صالح:", userNumber);
            return false;
        }

        // ⭐ منشن صحيح
        const mentionJid = buildSafeMention(userNumber) || `${cleanNum}@s.whatsapp.net`;

        // جلب اللقب
        let nickname = photoEntry?.nickname || "";
        if (!nickname || !String(nickname).trim()) {
            const user = db && db.users ? db.users[cleanNum] : null;
            nickname = user?.nickname || "";
        }

        const welcomeText = getWelcomeMessage(nickname, cleanNum, db);

        // فحص ملف الصورة
        const filePath = photoEntry?.filePath;
        const fileExists = filePath && fs.existsSync(filePath);

        if (fileExists) {
            try {
                const imageBuffer = fs.readFileSync(filePath);
                await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption: welcomeText,
                    mentions: [mentionJid]
                });
                console.log(`✅ تم إرسال ترحيب بالصورة للعضو ${cleanNum}`);
                return true;
            } catch (err) {
                console.error("❌ فشل إرسال الصورة:", err?.message);
                // fallback: نص فقط
                await sock.sendMessage(jid, {
                    text: welcomeText,
                    mentions: [mentionJid]
                }).catch(() => {});
                return true;
            }
        }

        // بدون صورة
        await sock.sendMessage(jid, {
            text: welcomeText,
            mentions: [mentionJid]
        }).catch(() => {});

        console.log(`✅ تم إرسال ترحيب نصي للعضو ${cleanNum}`);
        return true;

    } catch (error) {
        console.error("❌ خطأ في sendWelcome:", error?.message || error);
        return false;
    }
}

async function sendWelcomeTextOnly(sock, jid, userNumber, nickname, db) {
    try {
        const cleanNum = extractNumber(userNumber);
        const mentionJid = buildSafeMention(userNumber) || `${cleanNum}@s.whatsapp.net`;
        const welcomeText = getWelcomeMessage(nickname, cleanNum, db);

        await sock.sendMessage(jid, {
            text: welcomeText,
            mentions: [mentionJid]
        }).catch(() => {});

        return true;

    } catch (error) {
        console.error("❌ خطأ في sendWelcomeTextOnly:", error?.message || error);
        return false;
    }
}

function getWelcomeText(nickname, userNumber, db) {
    return getWelcomeMessage(nickname, userNumber, db);
}

module.exports = {
    sendWelcome,
    sendWelcomeTextOnly,
    getWelcomeText,
    getWelcomeMessage,
    safeNumber,
    extractNumber
};