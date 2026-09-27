// ============================================================
// results.js
// ALJESAT BOT
// نظام النتائج - يراقب قروبات ADS ويسجل الانتصارات والخسائر
// ============================================================

"use strict";

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

function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

function hasResultsPerm(db, cleanSender, isBotOwner) {
    if (isBotOwner) return true;
    // فقط من يملك سماح 5
    const permissions = db.permissions || {};
    return Array.isArray(permissions["5"]) && permissions["5"].includes(cleanSender);
}

// ============================================================
// استخراج البيانات من رسائل ADS
// ============================================================

/**
 * يفكك رسالة إعلان الفوز ويستخرج:
 * - اللقب
 * - المبلغ
 * - نوع الفعالية
 */
function parseWinAd(text) {
    try {
        if (!text) return null;

        // لابد أن تحتوي على "إنــتــهــت" أو "انتهت"
        if (!text.includes("إنــتــهــت") && !text.includes("انتهت")) return null;

        // استخراج اللقب
        const nicknameMatch =
            text.match(/آلَف[^\n]*?:\s*\n?\s*\*([^*\n]+)\*/) ||
            text.match(/الفائز[^\n]*?:\s*\n?\s*\*([^*\n]+)\*/) ||
            text.match(/\*\{?\s*([^}\n*]+?)\s*\}?\*/g);

        let nickname = null;
        // بحث أدق
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("آلَف") || lines[i].includes("الفائز")) {
                // السطر التالي
                if (lines[i + 1]) {
                    const m = lines[i + 1].match(/\*([^*]+)\*/);
                    if (m) { nickname = m[1].trim(); break; }
                }
            }
        }
        if (!nickname) return null;

        // استخراج المبلغ
        const amountMatch = text.match(/[آ]{1,2}[َ]*لَ[^\n]*?:\s*\n?\s*\*\{\s*([\d,]+)\$?\s*\}/) ||
                            text.match(/\{\s*([\d,]+)\$\s*\}/) ||
                            text.match(/\{\s*([\d,]+)\s*\}/);
        const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) || 0 : 0;

        // استخراج نوع الفعالية
        const gameMatch = text.match(/\*\{([^}]+)\}/);
        const gameType = gameMatch ? gameMatch[1].trim() : "";

        return { nickname, amount, gameType };
    } catch (e) {
        return null;
    }
}

/**
 * يفكك رسالة إعلان الخسارة ويستخرج:
 * - اللقب
 * - المبلغ
 */
function parseLossAd(text) {
    try {
        if (!text) return null;
        if (!text.includes("خسر في") && !text.includes("خسر")) return null;

        // "اللاعب *فلان* خسر في"
        const match = text.match(/اللاعب\s+\*?([^*\n]+?)\*?\s+خسر/);
        if (!match) return null;
        const nickname = match[1].trim();

        const amountMatch = text.match(/﴿\s*([\d,]+)\s*﴾/) ||
                            text.match(/([\d,]+)\s*\$/);
        const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) || 0 : 0;

        return { nickname, amount, gameType: "" };
    } catch (e) {
        return null;
    }
}

// ============================================================
// البحث عن اللقب في قاعدة البيانات
// ============================================================

function normalizeText(text) {
    return String(text || "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .trim();
}

function findUserByNickname(db, nickname) {
    const norm = normalizeText(nickname);
    if (!norm) return null;

    for (const number of Object.keys(db.users || {})) {
        const u = db.users[number];
        if (!u) continue;
        const uNick = normalizeText(u.nickname);
        if (uNick && uNick === norm) return { number, user: u };
    }
    return null;
}

// ============================================================
// تسجيل نتيجة
// ============================================================

/**
 * @param {Object} db
 * @param {Function} saveDb
 * @param {Object} entry
 *   entry = {
 *     nickname, playerNumber, gameType, prize, result ("win"|"lose")
 *   }
 */
function recordResult(db, saveDb, entry) {
    try {
        if (!db || !entry) return false;

        const nickname = String(entry.nickname || "").trim();
        if (!nickname) return false;

        // البحث عن رقم العضو (إن لم يكن معروف)
        let number = entry.playerNumber ? cleanNumber(entry.playerNumber) : "";
        if (!number) {
            const found = findUserByNickname(db, nickname);
            if (found) number = found.number;
        }

        db.resultsData = db.resultsData && typeof db.resultsData === "object" ? db.resultsData : {};

        // المفتاح = اللقب (حتى لو تغير الرقم)
        const key = "nick:" + normalizeText(nickname);

        if (!db.resultsData[key]) {
            db.resultsData[key] = {
                nickname,
                playerNumber: number || "",
                wins: 0,
                losses: 0,
                totalEarned: 0,
                totalLost: 0,
                lastGame: "",
                lastUpdated: Date.now(),
                games: []
            };
        }

        const data = db.resultsData[key];
        data.nickname = nickname; // تحديث لو تغير

        if (entry.result === "win") {
            data.wins = (data.wins || 0) + 1;
            data.totalEarned = (data.totalEarned || 0) + (Number(entry.prize) || 0);
        } else if (entry.result === "lose") {
            data.losses = (data.losses || 0) + 1;
            data.totalLost = (data.totalLost || 0) + (Number(entry.prize) || 0);
        }

        if (entry.gameType) data.lastGame = entry.gameType;
        data.lastUpdated = Date.now();

        // سجل آخر 30 لعبة
        if (!Array.isArray(data.games)) data.games = [];
        data.games.push({
            type: entry.gameType || "",
            result: entry.result,
            prize: Number(entry.prize) || 0,
            timestamp: Date.now()
        });
        if (data.games.length > 30) data.games = data.games.slice(-30);

        if (typeof saveDb === "function") saveDb();
        return true;

    } catch (error) {
        console.error("❌ خطأ في recordResult:", error?.message || error);
        return false;
    }
}

// ============================================================
// المعالجة التلقائية لرسائل ADS
// ============================================================

/**
 * يستدعى من index.js عندما تُرسل رسالة في قروب ADS
 */
async function handleAdsMessage(sock, jid, msg, db, saveDb) {
    try {
        if (!isAdsGroup(db, jid)) return false;

        const text =
            msg?.message?.conversation ||
            msg?.message?.extendedTextMessage?.text ||
            msg?.message?.imageMessage?.caption ||
            msg?.message?.videoMessage?.caption ||
            "";
        if (!text) return false;

        // محاولة تحليل الفوز
        const win = parseWinAd(text);
        if (win && win.nickname) {
            recordResult(db, saveDb, {
                nickname: win.nickname,
                gameType: win.gameType,
                prize: win.amount,
                result: "win"
            });
            return true;
        }

        // محاولة تحليل الخسارة
        const loss = parseLossAd(text);
        if (loss && loss.nickname) {
            recordResult(db, saveDb, {
                nickname: loss.nickname,
                gameType: loss.gameType,
                prize: loss.amount,
                result: "lose"
            });
            return true;
        }

        return false;

    } catch (error) {
        console.error("❌ خطأ في handleAdsMessage:", error?.message || error);
        return false;
    }
}

// ============================================================
// بناء قائمة النتائج (بالصيغة المطلوبة)
// ============================================================

function buildResultsList(db) {
    try {
        const data = db.resultsData || {};
        const entries = [];

        for (const key of Object.keys(data)) {
            const d = data[key];
            if (!d || !d.nickname) continue;
            entries.push({
                nickname: d.nickname,
                wins: Number(d.wins) || 0,
                losses: Number(d.losses) || 0,
                totalEarned: Number(d.totalEarned) || 0,
                totalLost: Number(d.totalLost) || 0
            });
        }

        if (entries.length === 0) {
            return "⚠️ لا توجد نتائج مسجلة حتى الآن.";
        }

        // ترتيب حسب مجموع المرابح
        entries.sort((a, b) => (b.totalEarned - b.totalLost) - (a.totalEarned - a.totalLost));

        let text = "";
        entries.forEach((e, i) => {
            text += `═══════ _*${i + 1}*_ ═══════\n`;
            text += ` \`•\` اللقب: \`${e.nickname}\`\n`;
            text += ` \`•\` عدد الانتصارات: \`${e.wins}\`\n`;
            text += ` \`•\` عدد الخسائر: \`${e.losses}\`\n`;
            text += ` \`•\` المرابح: \`${e.totalEarned}\`\n`;
            text += ` \`•\` الخسائر: \`${e.totalLost}\`\n`;
        });

        return text;

    } catch (error) {
        console.error("❌ خطأ في buildResultsList:", error?.message || error);
        return "❌ حدث خطأ أثناء بناء النتائج.";
    }
}

// ============================================================
// المعالجة الرئيسية لأمر .نتائج
// ============================================================

async function handleResults(sock, jid, msg, text, db, saveDb, cleanSender, isBotOwner) {
    try {
        // التحقق من الصلاحيات (سماح 5 فقط)
        if (!hasResultsPerm(db, cleanSender, isBotOwner)) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر يحتاج صلاحية .سماح 5."
            }, { quoted: msg });
            return true;
        }

        // يجب أن يكون في قروب ADS
        if (!isAdsGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *هذا الأمر يعمل فقط في*
  *قروب الإعلانات (ADS)*
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // .نتائج 0 → تصفير
        const parts = text.split(/\s+/);
        const subCommand = parts[1] || "";

        if (subCommand === "0") {
            db.resultsData = {};
            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆
  *تم تصفير جميع النتائج*
  *وسيتم بدء المراقبة من جديد*
❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // عرض النتائج
        const resultsText = buildResultsList(db);
        await safeSend(sock, jid, { text: resultsText }, { quoted: msg });
        return true;

    } catch (error) {
        console.error("❌ خطأ في handleResults:", error?.message || error);
        return false;
    }
}

// ============================================================
// إعادة تعيين كامل
// ============================================================

function clearResults(db, saveDb) {
    try {
        db.resultsData = {};
        if (typeof saveDb === "function") saveDb();
        return true;
    } catch { return false; }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handleResults,
    handleAdsMessage,
    recordResult,
    clearResults,
    buildResultsList,
    parseWinAd,
    parseLossAd,
    isAdsGroup,
    hasResultsPerm,
    findUserByNickname
};