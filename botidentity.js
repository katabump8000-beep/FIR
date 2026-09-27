// ============================================================
// botIdentity.js
// ALJESAT BOT
// نظام هوية البوتات المتعددة
// نسخة محدّثة: إصلاح .مؤبد + .اعفاء + استخراج المنشن من الرد
// ============================================================

"use strict";

// ⭐ دوال LID
const { cleanNumber, buildSafeMention, getRealMentionedJids } = require("./bot");

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
// أدوات مساعدة
// ============================================================

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

/**
 * ⭐ الحصول على الرسالة المقتبسة (quoted message)
 */
function getQuotedMessage(msg) {
    try {
        const ctx =
            msg?.message?.extendedTextMessage?.contextInfo ||
            msg?.message?.contextInfo ||
            null;
        if (!ctx) return null;
        if (!ctx.quotedMessage) return null;

        return {
            quotedMessage: ctx.quotedMessage,
            stanzaId: ctx.stanzaId,
            participant: ctx.participant,
            mentionedJid: ctx.mentionedJid || [],
            mentionedPn: ctx.mentionedPn || [],
            participants: ctx.participants || []
        };
    } catch {
        return null;
    }
}

/**
 * ⭐ استخراج المذكور (mentioned) من الرسالة المقتبسة
 * يدعم:
 *   1. mentionedPn (الأفضل)
 *   2. mentionedJid (إن كانت PN)
 *   3. participants[].pn (تحويل LID → PN)
 *   4. استخراج الرقم من النص @⁨...+...⁩
 */
function extractMentionFromQuoted(quoted) {
    if (!quoted) return null;

    // 1. الأولوية: mentionedPn
    if (Array.isArray(quoted.mentionedPn) && quoted.mentionedPn[0]) {
        return quoted.mentionedPn[0];
    }

    // 2. mentionedJid
    const mentionedJids = Array.isArray(quoted.mentionedJid) ? quoted.mentionedJid : [];
    for (const jid of mentionedJids) {
        const s = String(jid);
        if (s.endsWith("@s.whatsapp.net")) return s;
    }

    // 3. حاول إيجاد PN من participants
    if (mentionedJids.length > 0 && Array.isArray(quoted.participants)) {
        for (const jid of mentionedJids) {
            const s = String(jid);
            if (s.endsWith("@lid")) {
                for (const p of quoted.participants) {
                    if (p.lid === s && (p.pn || p.phoneNumber)) {
                        return p.pn || p.phoneNumber;
                    }
                }
            }
        }
    }

    // 4. استخراج الرقم من نص الرسالة المقتبسة
    // مثال: "_*المنشن*_: ┊ @⁨~rida @😎😎⁩ ┊"
    const quotedText = getMessageText(quoted.quotedMessage) || "";
    if (quotedText) {
        // ابحث عن "المنشن" ثم أول @رقم أو @
        const mentionSection = quotedText.split(/المنشن|الـمـنـشـن/)[1] || "";
        if (mentionSection) {
            // ابحث عن أرقام طويلة
            const numMatch = mentionSection.match(/(\d{10,15})/);
            if (numMatch) {
                return `${numMatch[1]}@s.whatsapp.net`;
            }
        }
    }

    // 5. إذا وجدنا mentionedJid كـ LID فقط، أرجعه
    if (mentionedJids.length > 0) {
        return mentionedJids[0];
    }

    return null;
}

/**
 * ⭐ استخراج لقب العضو من نص الاستمارة
 */
function extractNicknameFromQuoted(quoted) {
    if (!quoted) return "مجهول";
    const text = getMessageText(quoted.quotedMessage) || "";
    if (!text) return "مجهول";

    // ابحث عن "الـلــقـب" ثم القيمة بين ┊...┊
    const match = text.match(/الـلــقـب[^\n]*?┊\s*([^┊\n]+?)\s*┊/);
    if (match && match[1]) return match[1].trim();

    return "مجهول";
}

// ============================================================
// رسائل
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
◆━─━─━─⊱🟢⊰─━─━─━◆`;
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
// .انا بوت
// ============================================================

async function handleBotIdentity(sock, jid, msg, db, saveDb, cleanSender, text) {
    try {
        const match = text.match(/\.انا بوت\s+(.+)/);
        if (!match) return false;

        const emoji = match[1].trim();

        let botTitle = null;
        for (const [key, title] of Object.entries(BOT_TITLES)) {
            if (emoji.includes(key) || emoji === key) {
                botTitle = title;
                break;
            }
        }

        if (!botTitle) {
            botTitle = `بوت ${emoji}`;
        }

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
// .حذف نقابتك
// ============================================================

async function handleDeleteNakaba(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        const isEmperor = db.emperors && db.emperors[cleanSender] === true;
        if (!isBotOwner && !isEmperor) {
            await safeSend(sock, jid, { text: "⛔ هذا الأمر مخصص للإمبراطور فقط." }, { quoted: msg });
            return true;
        }

        const mentionedJids = getRealMentionedJids(msg);
        const mentioned = mentionedJids[0] || null;

        if (!mentioned) {
            await safeSend(sock, jid, { text: "⚠️ يرجى منشن البوت.\nمثال: .حذف نقابتك @bot" }, { quoted: msg });
            return true;
        }

        const targetNumber = cleanNumber(String(mentioned).split("@")[0]);
        const botData = db.botIdentities?.[targetNumber];

        if (!botData) {
            await safeSend(sock, jid, { text: "⚠️ هذا البوت ليس لديه هوية مسجلة." }, { quoted: msg });
            return true;
        }

        const deletedName = botData.title;
        delete db.botIdentities[targetNumber];
        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, { text: getNakabaDeleteMessage(deletedName) }, { quoted: msg });
        return true;

    } catch (error) {
        console.error("❌ خطأ في handleDeleteNakaba:", error?.message || error);
        return false;
    }
}

// ============================================================
// ⭐ .مؤبد — مع إصلاح استخراج المنشن من الرد
// ============================================================

async function handlePermanentMember(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        // استخراج الرسالة المقتبسة
        const quoted = getQuotedMessage(msg);

        if (!quoted) {
            await safeSend(sock, jid, {
                text: "⚠️ يجب أن ترد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        // ⭐ استخراج المنشن بشكل موثوق
        const targetJid = extractMentionFromQuoted(quoted);

        if (!targetJid) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const targetNumber = cleanNumber(String(targetJid).split("@")[0]);
        const memberNickname = extractNicknameFromQuoted(quoted);

        // حفظ العضو كمؤبد
        db.permanentMembers = db.permanentMembers || {};
        db.permanentMembers[targetNumber] = {
            nickname: memberNickname,
            savedAt: Date.now(),
            savedBy: cleanSender,
            sourceJid: targetJid
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, { text: getPermanentSaveMessage() }, { quoted: msg });
        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePermanentMember:", error?.message || error);
        return false;
    }
}

// ============================================================
// ⭐ .اعفاء — مع إصلاح استخراج المنشن
// ============================================================

async function handlePermanentRelease(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        const quoted = getQuotedMessage(msg);

        if (!quoted) {
            await safeSend(sock, jid, {
                text: "⚠️ يجب أن ترد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        const targetJid = extractMentionFromQuoted(quoted);

        if (!targetJid) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const targetNumber = cleanNumber(String(targetJid).split("@")[0]);

        if (!db.permanentMembers?.[targetNumber]) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا العضو ليس محفوظاً كمؤبد."
            }, { quoted: msg });
            return true;
        }

        delete db.permanentMembers[targetNumber];
        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, { text: getPermanentReleaseMessage() }, { quoted: msg });
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
// ⭐ كشف استمارة الوورك المرصودة + تنبيه الإدارة
// ============================================================

async function handleWorkFormDetection(sock, jid, msg, db, saveDb) {
    try {
        const text = getMessageText(msg.message);
        if (!text.includes("إستمارة الوورك") && !text.includes("استمارة الوورك") && !text.includes("الوورك")) {
            return false;
        }

        // حاول استخراج المنشن واللقب
        const quoted = {
            quotedMessage: msg.message,
            mentionedJid: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
            mentionedPn: msg.message?.extendedTextMessage?.contextInfo?.mentionedPn || [],
            participants: msg.message?.extendedTextMessage?.contextInfo?.participants || []
        };

        const targetJid = extractMentionFromQuoted(quoted);
        const memberNickname = extractNicknameFromQuoted(quoted);

        if (!targetJid) return false;

        const targetNumber = cleanNumber(String(targetJid).split("@")[0]);

        // حفظ معلومات الاستمارة
        db.workForms = db.workForms || {};
        db.workForms[targetNumber] = {
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
// .تعدد on/off
// ============================================================

async function handleTaadudCommand(sock, jid, msg, parts, cleanSender, owner, db, saveDb) {
    try {
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
            await safeSend(sock, jid, { text: "✅ تم تفعيل نظام تعدد البوتات." }, { quoted: msg });
        } else if (action === "off") {
            delete db.taadudEnabled[jid];
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, { text: "❌ تم إيقاف نظام تعدد البوتات." }, { quoted: msg });
        } else {
            await safeSend(sock, jid, { text: "⚠️ الاستخدام: .تعدد on/off" }, { quoted: msg });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleTaadudCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// فحص انضمام عضو مؤبد
// ============================================================

async function checkPermanentMemberJoin(sock, jid, memberNumber, db, saveDb) {
    try {
        const cleanNum = cleanNumber(memberNumber);

        if (!isPermanentMember(db, cleanNum)) {
            return false;
        }

        const safeJid = buildSafeMention(memberNumber) || `${cleanNum}@s.whatsapp.net`;

        await safeSend(sock, jid, {
            text: getPermanentBlockMessage(),
            mentions: [safeJid]
        });

        try {
            await sock.groupParticipantsUpdate(jid, [safeJid], "remove");
        } catch (_) {}

        return true;

    } catch (error) {
        console.error("❌ خطأ في checkPermanentMemberJoin:", error?.message || error);
        return false;
    }
}

// ============================================================
// ⭐ تنبيه الإدارة عن عضو من نقابة أخرى
// ============================================================

async function alertAdminsAboutMember(sock, jid, memberNumber, nakabaName, db) {
    try {
        const cleanNum = cleanNumber(String(memberNumber).split("@")[0]);
        if (!cleanNum) return false;

        const memberJid = buildSafeMention(memberNumber) || `${cleanNum}@s.whatsapp.net`;

        // الأدمن الذين لديهم صلاحية .سجل (2)
        const permissions = db.permissions || {};
        const adminNumbers = [];

        if (Array.isArray(permissions["2"])) {
            adminNumbers.push(...permissions["2"]);
        }

        if (adminNumbers.length === 0) return false;

        for (const adminNum of adminNumbers) {
            const adminJid = buildSafeMention(adminNum) || `${cleanNumber(adminNum)}@s.whatsapp.net`;
            const adminMention = `@${cleanNumber(adminNum)}`;
            const memberMention = `@${cleanNum}`;

            await safeSend(sock, jid, {
                text: getNakabaAlertMessage(adminMention, memberMention, nakabaName),
                mentions: [adminJid, memberJid]
            });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في alertAdminsAboutMember:", error?.message || error);
        return false;
    }
}

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
    getNakabaAlertMessage,
    extractMentionFromQuoted,
    extractNicknameFromQuoted,
    getQuotedMessage
};