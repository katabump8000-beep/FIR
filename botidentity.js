// ============================================================
// botIdentity.js
// ALJESAT BOT
// نظام هوية البوتات المتعددة
// ============================================================

"use strict";

// ============================================================
// الحالة النشطة
// ============================================================

const botIdentities = Object.create(null);
const monitoredWorks = Object.create(null);
const permanentMembers = Object.create(null);

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function getMessageText(message) {
    if (!message) return "";
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        ""
    ).trim();
}

// ============================================================
// الألقاب المتاحة للبوتات
// ============================================================

const BOT_TITLES = {
    "🩸": "بوت نوفا",
    "❄": "بوت فورتكس",
    "☘️": "بوت سولار",
    "🔥": "بوت النار",
    "⭐": "بوت النجم",
    "🌙": "بوت القمر"
};

// ============================================================
// رسائل الهوية
// ============================================================

function getIdentityConfirmMessage(botTitle) {
    return `تم مراقبة استماراتك يا ${botTitle}`;
}

function getPermanentSaveMessage() {
    return `◆━─━─━─⊱⊰─━─━─━◆
 📍تم حفظ العضو مؤبد 🛑
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getPermanentReleaseMessage() {
    return `◆━─━─━─⊱✅⊰─━─━─━◆
 تم فك حكم المؤبد عن هذا العضو
◆━─━─━─⊱🟢⊰─━━─━─━◆`;
}

function getPermanentBlockMessage() {
    return `*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*
  انت محفوظ لدي مملكة النار
  بأنك مؤبد..  لهذا بص تحت: 
*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*`;
}

function getNakabaDeleteMessage(nakabaName) {
    return `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆
 تم حذف اسم:  \`${nakabaName}\`
❆━━━━━═⏣⊰🛑⊱⏣═━━━━━❆`;
}

function getNakabaAlertMessage(adminMention, memberMention, nakabaName) {
    return `❆━━━━━═⏣⊰📡⊱⏣═━━━━━❆
${adminMention}
ايها الرتب هذا العضو : 
${memberMention}
كان موجود في نقابة { \`${nakabaName}\`} يرجى التحقق بشأنه
❆━━━━━═⏣⊰📍⊱⏣═━━━━━❆`;
}

// ============================================================
// معالجة أمر .انا بوت
// ============================================================

async function handleBotIdentity(sock, jid, msg, db, saveDb, cleanSender, text) {
    try {
        // استخراج الإيموجي من النص
        const match = text.match(/\.انا بوت\s+(.+)/);
        if (!match) return false;

        const emoji = match[1].trim();
        
        // البحث عن اللقب المناسب
        let botTitle = null;
        for (const [key, title] of Object.entries(BOT_TITLES)) {
            if (emoji.includes(key) || emoji === key) {
                botTitle = title;
                break;
            }
        }

        if (!botTitle) {
            // إذا لم يكن معروفاً، استخدم الإيموجي نفسه
            botTitle = `بوت ${emoji}`;
        }

        // حفظ هوية البوت
        db.botIdentities = db.botIdentities || {};
        db.botIdentities[cleanSender] = {
            emoji: emoji,
            title: botTitle,
            setAt: Date.now()
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getIdentityConfirmMessage(botTitle)
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleBotIdentity:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة أمر .حذف نقابتك
// ============================================================

async function handleDeleteNakaba(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        // التحقق من الصلاحيات (إمبراطور أو مالك)
        const isEmperor = db.emperors && db.emperors[cleanSender] === true;
        if (!isBotOwner && !isEmperor) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر مخصص للإمبراطور فقط."
            }, { quoted: msg });
            return true;
        }

        // الحصول على المنشن
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                         msg.message?.contextInfo?.mentionedJid?.[0];

        if (!mentioned) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى منشن البوت.\nمثال: .حذف نقابتك @bot"
            }, { quoted: msg });
            return true;
        }

        const targetNumber = cleanNumber(mentioned);
        const botData = db.botIdentities?.[targetNumber];

        if (!botData) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا البوت ليس لديه هوية مسجلة."
            }, { quoted: msg });
            return true;
        }

        const deletedName = botData.title;

        // حذف الهوية
        delete db.botIdentities[targetNumber];
        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getNakabaDeleteMessage(deletedName)
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleDeleteNakaba:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة أمر .مؤبد (مع رد على استمارة الورك)
// ============================================================

async function handlePermanentMember(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        // الحصول على الرسالة المقتبسة
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) {
            await safeSend(sock, jid, {
                text: "⚠️ يجب أن ترد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        const quotedText = getMessageText(quotedMsg);
        
        // البحث عن المنشن في الاستمارة
        const mentionMatch = quotedText.match(/@(\d+)/);
        if (!mentionMatch) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const memberNumber = mentionMatch[1];
        const memberNickname = quotedText.match(/الـلــقـب.*?┊\s*(.+?)\s*┊/)?.[1] || "مجهول";

        // حفظ العضو كمؤبد
        db.permanentMembers = db.permanentMembers || {};
        db.permanentMembers[memberNumber] = {
            nickname: memberNickname,
            savedAt: Date.now(),
            savedBy: cleanSender
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getPermanentSaveMessage()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePermanentMember:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة أمر .اعفاء
// ============================================================

async function handlePermanentRelease(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        // الحصول على الرسالة المقتبسة
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) {
            await safeSend(sock, jid, {
                text: "⚠️ يجب أن ترد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        const quotedText = getMessageText(quotedMsg);
        
        // البحث عن المنشن في الاستمارة
        const mentionMatch = quotedText.match(/@(\d+)/);
        if (!mentionMatch) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const memberNumber = mentionMatch[1];

        // التحقق من وجوده
        if (!db.permanentMembers?.[memberNumber]) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا العضو ليس محفوظاً كمؤبد."
            }, { quoted: msg });
            return true;
        }

        // حذف الحكم المؤبد
        delete db.permanentMembers[memberNumber];
        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getPermanentReleaseMessage()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePermanentRelease:", error?.message || error);
        return false;
    }
}

// ============================================================
// فحص هل العضو مؤبد
// ============================================================

function isPermanentMember(db, userNumber) {
    const cleanNum = cleanNumber(userNumber);
    return Boolean(db.permanentMembers && db.permanentMembers[cleanNum]);
}

// ============================================================
// معالجة استمارة الورك المرصودة
// ============================================================

async function handleWorkFormDetection(sock, jid, msg, db, saveDb) {
    try {
        const text = getMessageText(msg.message);
        
        // التحقق من أنها استمارة وورك
        if (!text.includes("إستمارة الوورك") && !text.includes("استمارة الوورك")) {
            return false;
        }

        // البحث عن المنشن واللقب
        const mentionMatch = text.match(/@(\d+)/);
        const nicknameMatch = text.match(/الـلــقـب.*?┊\s*(.+?)\s*┊/);

        if (!mentionMatch) return false;

        const memberNumber = mentionMatch[1];
        const memberNickname = nicknameMatch?.[1] || "مجهول";

        // حفظ معلومات الاستمارة
        db.workForms = db.workForms || {};
        db.workForms[memberNumber] = {
            nickname: memberNickname,
            detectedAt: Date.now(),
            detectedIn: jid
        };

        if (typeof saveDb === "function") saveDb();

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleWorkFormDetection:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة أمر .تعدد
// ============================================================

async function handleTaadudCommand(sock, jid, msg, parts, cleanSender, owner, db, saveDb) {
    try {
        // التحقق من أن القروب هو قروب العمل
        const workGroups = db.workGroups || {};
        if (!workGroups[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا الأمر يعمل فقط في قروب العمل (.ورك)."
            }, { quoted: msg });
            return true;
        }

        const action = String(parts[0] || "").toLowerCase();

        db.taadudEnabled = db.taadudEnabled || {};

        if (action === "on") {
            db.taadudEnabled[jid] = true;
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: "✅ تم تفعيل نظام تعدد البوتات."
            }, { quoted: msg });
        } else if (action === "off") {
            delete db.taadudEnabled[jid];
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: "❌ تم إيقاف نظام تعدد البوتات."
            }, { quoted: msg });
        } else {
            await safeSend(sock, jid, {
                text: "⚠️ الاستخدام: .تعدد on/off"
            }, { quoted: msg });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleTaadudCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال تنبيه للأدمن عند دخول عضو مؤبد
// ============================================================

async function checkPermanentMemberJoin(sock, jid, memberNumber, db, saveDb) {
    try {
        const cleanNum = cleanNumber(memberNumber);

        // التحقق من كونه مؤبد
        if (!isPermanentMember(db, cleanNum)) {
            return false;
        }

        // إرسال رسالة الطرد
        await safeSend(sock, jid, {
            text: getPermanentBlockMessage(),
            mentions: [`${cleanNum}@s.whatsapp.net`]
        });

        // طرد العضو
        try {
            await sock.groupParticipantsUpdate(jid, [`${cleanNum}@s.whatsapp.net`], "remove");
        } catch (_) {}

        return true;

    } catch (error) {
        console.error("❌ خطأ في checkPermanentMemberJoin:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال تنبيه للأدمن عن عضو من نقابة أخرى
// ============================================================

async function alertAdminsAboutMember(sock, jid, memberNumber, nakabaName, db) {
    try {
        const cleanNum = cleanNumber(memberNumber);
        const memberMention = `@${cleanNum}`;

        // البحث عن الأدمن الذين لديهم صلاحية .سجل
        const permissions = db.permissions || {};
        const adminNumbers = [];

        if (Array.isArray(permissions["2"])) {
            adminNumbers.push(...permissions["2"]);
        }

        if (adminNumbers.length === 0) return;

        // إرسال التنبيه لكل أدمن
        for (const adminNum of adminNumbers) {
            const adminMention = `@${cleanNumber(adminNum)}`;
            
            await safeSend(sock, jid, {
                text: getNakabaAlertMessage(adminMention, memberMention, nakabaName),
                mentions: [
                    `${cleanNumber(adminNum)}@s.whatsapp.net`,
                    `${cleanNum}@s.whatsapp.net`
                ]
            });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في alertAdminsAboutMember:", error?.message || error);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    BOT_TITLES,
    handleBotIdentity,
    handleDeleteNakaba,
    handlePermanentMember,
    handlePermanentRelease,
    handleWorkFormDetection,
    handleTaadudCommand,
    isPermanentMember,
    checkPermanentMemberJoin,
    alertAdminsAboutMember,
    getIdentityConfirmMessage,
    getPermanentSaveMessage,
    getPermanentReleaseMessage,
    getPermanentBlockMessage,
    getNakabaDeleteMessage,
    getNakabaAlertMessage
};