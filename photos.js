// ============================================================
// photos.js
// ALJESAT BOT
// نظام حفظ الصور والألقاب لقروب الاستقبال
// نسخة محدّثة: دعم LID
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

// ⭐ دوال LID
const { cleanNumber, buildSafeMention, getRealMentionedJids } = require("./bot");

// ============================================================
// مجلد الصور
// ============================================================

const PHOTOS_FOLDER = path.join(__dirname, "user_photos");
if (!fs.existsSync(PHOTOS_FOLDER)) {
    fs.mkdirSync(PHOTOS_FOLDER, { recursive: true });
}

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanJid(value) {
    if (!value) return "";
    return String(value).split(":")[0];
}

function normalizeText(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function getQuotedImage(msg) {
    try {
        const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo) return null;

        const quoted = contextInfo.quotedMessage;
        if (!quoted) return null;

        if (quoted.imageMessage) {
            return {
                imageMessage: quoted.imageMessage,
                quotedKey: {
                    remoteJid: msg.key.remoteJid,
                    fromMe: false,
                    id: contextInfo.stanzaId,
                    participant: contextInfo.participant || msg.key.participant || msg.key.remoteJid
                }
            };
        }
        return null;
    } catch { return null; }
}

function getMessageText(msg) {
    if (!msg || !msg.message) return "";
    const m = msg.message;
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ""
    ).trim();
}

function isReceiveGroup(db, jid) {
    return Boolean(db.receiveGroups && db.receiveGroups[jid]);
}

function getMainGroups(db) {
    if (!db.mainGroup) return [];
    return Object.keys(db.mainGroup).filter(jid => db.mainGroup[jid] === true);
}

async function isUserInMainGroup(sock, db, userNumber) {
    try {
        const mainGroups = getMainGroups(db);
        if (mainGroups.length === 0) return false;

        for (const mainJid of mainGroups) {
            try {
                const metadata = await sock.groupMetadata(mainJid).catch(() => null);
                if (!metadata) continue;

                const found = metadata.participants.find(p => {
                    const pid = cleanNumber(String(p.id).split("@")[0]);
                    return pid === userNumber;
                });

                if (found) return true;
            } catch (_) {}
        }
        return false;
    } catch { return false; }
}

function findUserByNickname(db, nickname) {
    const norm = normalizeText(nickname);
    if (!norm) return null;

    for (const number of Object.keys(db.users || {})) {
        const user = db.users[number];
        if (!user) continue;
        const userNick = normalizeText(user.nickname);
        if (userNick && userNick === norm) {
            return { number, user };
        }
    }
    return null;
}

function isImageAlreadySaved(db, imageMessage) {
    if (!imageMessage) return false;

    const newFileLength = Number(imageMessage.fileLength) || 0;
    const newSha256 = imageMessage.fileSha256 ? String(imageMessage.fileSha256) : "";

    if (!db.userPhotos) return false;

    for (const userNumber of Object.keys(db.userPhotos)) {
        const entry = db.userPhotos[userNumber];
        if (!entry) continue;

        if (newSha256 && entry.fileSha256) {
            if (entry.fileSha256 === newSha256) {
                return { userNumber, entry };
            }
        } else if (newFileLength > 0 && entry.fileLength === newFileLength) {
            return { userNumber, entry };
        }
    }
    return false;
}

async function downloadAndSaveImage(sock, imageMessage, userNumber) {
    try {
        const { downloadMediaMessage } = require("@whiskeysockets/baileys");

        const fakeMsg = {
            key: { remoteJid: "x@s.whatsapp.net", fromMe: false, id: "x" },
            message: { imageMessage: imageMessage }
        };

        const buffer = await downloadMediaMessage(
            fakeMsg, "buffer", {},
            { logger: console, reuploadRequest: sock.updateMediaMessage }
        );

        if (!buffer || buffer.length === 0) {
            throw new Error("الصورة فارغة أو فشل التحميل");
        }

        const ext = imageMessage.mimetype?.includes("png") ? "png" : "jpg";
        const filename = `${userNumber}_${Date.now()}.${ext}`;
        const filePath = path.join(PHOTOS_FOLDER, filename);

        fs.writeFileSync(filePath, buffer);
        return { filePath, filename, size: buffer.length };

    } catch (error) {
        console.error("❌ فشل تحميل وحفظ الصورة:", error?.message || error);
        return null;
    }
}

// ============================================================
// .صورة
// ============================================================

async function handlePhotoCommand(sock, jid, msg, text, db, saveDb, cleanSender, isBotOwner) {
    try {
        // 1) قروب استقبال
        if (!isReceiveGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *هذا الأمر يعمل فقط داخل*
  *قروب الاستقبال*
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 2) الصلاحيات
        const permissions = db.permissions || {};
        const hasRegisterPerm = 
            isBotOwner || 
            (Array.isArray(permissions["2"]) && permissions["2"].includes(cleanSender)) ||
            (Array.isArray(permissions["5"]) && permissions["5"].includes(cleanSender));

        if (!hasRegisterPerm) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆
  *ليس لديك صلاحية لاستخدام*
  *هذا الأمر*
❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 3) اللقب
        const parts = text.split(/\s+/);
        const nickname = parts.slice(1).join(" ").trim();

        if (!nickname) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *يرجى كتابة اللقب بعد الأمر*
  مثال: .صورة ساسكي
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 4) الصورة المقتبسة
        const quoted = getQuotedImage(msg);
        if (!quoted || !quoted.imageMessage) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
      رجاءا أعمل منشن للصورة 
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const imageMessage = quoted.imageMessage;

        // 5) البحث عن العضو
        const foundUser = findUserByNickname(db, nickname);
        if (!foundUser) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *لا يوجد عضو مسجل بهذا اللقب*
  *عبر أمر .سجل*
  
  اللقب: _*${nickname}*_
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const targetNumber = foundUser.number;

        // 6) محفوظة سابقاً؟
        const alreadySaved = isImageAlreadySaved(db, imageMessage);
        if (alreadySaved) {
            const savedUser = db.users?.[alreadySaved.userNumber];
            const savedNickname = savedUser?.nickname || alreadySaved.userNumber;

            await safeSend(sock, jid, {
                text: `♢━━━━━═⏣⊰⚠️⊱⏣═━━━━━♤
  \`عذرا الصورة هذه محفوظة بالفعل\`
  
  لصاحب اللقب: _*${savedNickname}*_
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 7) في الأساسي؟
        const isInMain = await isUserInMainGroup(sock, db, targetNumber);
        if (isInMain) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  \`خطأ\` *هذا العضو موجود في قروب*
  _*الاساسي...*_ *تأكد بأنك تسجل لقب*
  *ليس مأخود او تأكد بأن العضو المحدد*
  *جديد*
❆━━━━━═⏣⊰❌⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 8) التحميل
        const saveResult = await downloadAndSaveImage(sock, imageMessage, targetNumber);
        if (!saveResult) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *فشل تحميل الصورة*
  يرجى المحاولة مرة أخرى
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // 9) حفظ البيانات
        db.userPhotos = db.userPhotos || {};
        db.userPhotos[targetNumber] = {
            nickname: foundUser.user.nickname,
            filePath: saveResult.filePath,
            filename: saveResult.filename,
            fileLength: Number(imageMessage.fileLength) || saveResult.size,
            fileSha256: imageMessage.fileSha256 ? String(imageMessage.fileSha256) : "",
            mimetype: imageMessage.mimetype || "image/jpeg",
            savedAt: Date.now(),
            savedBy: cleanSender,
            chatId: jid
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, { text: `◆━─⊱✅نجح✅⊰─━◆` }, { quoted: msg });

        console.log(`✅ تم حفظ صورة للعضو ${targetNumber} (${foundUser.user.nickname})`);
        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePhotoCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// دوال مساعدة مُصدَّرة
// ============================================================

function getPhoto(db, userNumber) {
    if (!db || !db.userPhotos) return null;
    return db.userPhotos[userNumber] || null;
}

function hasPhoto(db, userNumber) {
    if (!db || !db.userPhotos) return false;
    return Boolean(db.userPhotos[userNumber]);
}

function removePhoto(db, userNumber, saveDb) {
    if (!db || !db.userPhotos || !db.userPhotos[userNumber]) return false;

    const entry = db.userPhotos[userNumber];

    try {
        if (entry.filePath && fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
        }
    } catch (err) {
        console.warn("⚠️ فشل حذف ملف الصورة:", err?.message);
    }

    delete db.userPhotos[userNumber];
    if (typeof saveDb === "function") saveDb();
    return true;
}

function getPhotosFolder() {
    return PHOTOS_FOLDER;
}

module.exports = {
    handlePhotoCommand,
    getPhoto,
    hasPhoto,
    removePhoto,
    getPhotosFolder,
    isReceiveGroup,
    isUserInMainGroup,
    findUserByNickname,
    isImageAlreadySaved,
    PHOTOS_FOLDER
};