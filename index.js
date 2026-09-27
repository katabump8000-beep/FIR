// ============================================================
// index.js
// ALJESAT BOT — Main Entry Point (FINAL)
// نسخة نهائية متوافقة مع جميع الملفات
// دعم LID + list-response + reply-to-list + ads monitoring
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

const _originalLog = console.log.bind(console);
const _originalError = console.error.bind(console);
const _originalWarn = console.warn.bind(console);

const logGuard = {
    count: 0, windowStart: Date.now(),
    WINDOW_MS: 1000, MAX_PER_WINDOW: 30,
    dropped: 0, silenced: false,
    canLog() {
        const now = Date.now();
        if (now - this.windowStart >= this.WINDOW_MS) {
            this.windowStart = now; this.count = 0;
            if (this.silenced) {
                this.silenced = false;
                _originalWarn("⚠️ [LogGuard] تم استئناف السجلات.");
                this.dropped = 0;
            }
        }
        this.count++;
        if (this.count > this.MAX_PER_WINDOW) {
            this.silenced = true; this.dropped++;
            return false;
        }
        return true;
    }
};

console.log = (...args) => { if (logGuard.canLog()) _originalLog(...args); };
console.error = (...args) => { if (logGuard.canLog()) _originalError(...args); };
console.warn = (...args) => { if (logGuard.canLog()) _originalWarn(...args); };

// ============================================================
// Core
// ============================================================

const {
    startBot, configureHandlers, getDb, saveDb,
    jidToNumber, isGroupJid, isOwner, cleanNumber,
    getSenderNumber, getSenderJid,
    getRealMentionedJid, getRealMentionedJids,
    buildSafeMention, isValidPnJid
} = require("./bot");

const { handleCommand, isUserBanned, formatBanDuration } = require("./commands");
const { handleGroupJoin, startAdminMonitoring, stopAdminMonitoring } = require("./admin");
const { activeGames } = require("./menu");
const { activeCasinos, isSarahaActive, activeGuessGames, stopGuessGame } = require("./duel");
const { activeSaraha, handleSarahaCommand } = require("./saraha");
const {
    activeMazads, handleMazadCommand, handleMazadBid,
    handleMazadInventory, handleMazadSend, handleMazadCancelSend
} = require("./mzad");
const { activeColors, handleColorsCommand } = require("./colors");
const { activeAnimals, handleAnimalsCommand } = require("./animals");

let photosModule = null;
let welcomeModule = null;
let tahminModule = null;
let resultsModule = null;
let commandsListModule = null;
let typoModule = null;
let shopModule = null;
let botIdentityModule = null;

try { photosModule = require("./photos"); } catch (e) { _originalWarn("⚠️ photos.js غير محمّل"); }
try { welcomeModule = require("./welcome"); } catch (e) { _originalWarn("⚠️ welcome.js غير محمّل"); }
try { tahminModule = require("./tahmin"); } catch (e) { _originalWarn("⚠️ tahmin.js غير محمّل"); }
try { resultsModule = require("./results"); } catch (e) { _originalWarn("⚠️ results.js غير محمّل"); }
try { commandsListModule = require("./commands_list"); } catch (e) { _originalWarn("⚠️ commands_list.js غير محمّل"); }
try { typoModule = require("./typo"); } catch (e) { _originalWarn("⚠️ typo.js غير محمّل"); }
try { shopModule = require("./shop"); } catch (e) { _originalWarn("⚠️ shop.js غير محمّل"); }
try { botIdentityModule = require("./botIdentity"); } catch (e) { _originalWarn("⚠️ botIdentity.js غير محمّل"); }

// ============================================================
// Runtime
// ============================================================

let autoSaveInterval = null;
let autoSaveEnabled = false;
let autoSaveGroupJid = null;
let watchdogInterval = null;
let lastMessageAt = Date.now();
let lastGroupUpdateAt = Date.now();
let lastSocketRef = null;
let consecutiveIdleChecks = 0;

const WATCHDOG_CHECK_MS = 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const GAME_STUCK_THRESHOLD_MS = 25 * 60 * 1000;
const MAX_IDLE_CHECKS = 15;
const MAX_GAME_COUNT = 8;

const pendingGamesMenu = Object.create(null);
global.pendingGamesMenu = pendingGamesMenu;

if (!global.messageCounters) global.messageCounters = {};
if (!global.reactCounters) global.reactCounters = {};

const REACT_EMOJIS = [
    "🥀", "🫟", "🔥", "🎀", "🍁", "🥲", "🙂", "⭐", "🐦‍⬛",
    "🍀", "🐱", "🕯", "🎉", "🍿", "🫠", "🍭", "🍒", "🍫",
    "🍯", "🐥", "👻", "🍅"
];

const VALID_GAME_COMMANDS = [
    "تفكيك", "كتابة", "الوان", "الحيوانات",
    "اعلام", "ايموجي", "تخمين", "روليت", "اتبع حدسك"
];

// ============================================================
// شبكة أمان
// ============================================================

let lastExceptionAt = 0;
const EXCEPTION_COOLDOWN_MS = 5000;

process.on('uncaughtException', (error) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Uncaught Exception:', error?.message || error);
});

process.on('unhandledRejection', (reason) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Unhandled Rejection:', reason?.message || reason);
});

// ============================================================
// Helpers
// ============================================================

function getMessageTextFromMsg(msg) {
    if (!msg || !msg.message) return "";
    const message = msg.message;
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.buttonsResponseMessage?.selectedDisplayText ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

/**
 * ⭐ getSender يدعم LID
 */
function getSender(msg, sock) {
    try {
        if (msg?.key?.fromMe) return sock?.user?.id || "";
        return (
            msg?.key?.participantPn ||
            msg?.key?.participant_pn ||
            msg?.key?.senderPn ||
            msg?.key?.participant ||
            msg?.key?.remoteJid ||
            ""
        );
    } catch { return ""; }
}

function getBotNumber(sock) {
    try { return jidToNumber(sock?.user?.id || ""); }
    catch { return ""; }
}

function shouldIgnoreMessage(msg) {
    try {
        if (!msg?.message) return true;
        const jid = msg?.key?.remoteJid;
        if (!jid) return true;
        if (jid === "status@broadcast") return true;
        if (msg?.key?.fromMe) {
            const text = getMessageTextFromMsg(msg);
            return !text || !text.startsWith(".");
        }
        return false;
    } catch { return true; }
}

function setupAdminMonitoring(sock) {
    try {
        const db = getDb();
        if (!db) return;
        stopAdminMonitoring();
        startAdminMonitoring(sock, db, saveDb);
    } catch (e) { _originalError("Admin monitoring error:", e?.message); }
}

// ============================================================
// الحفظ التلقائي
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");

function getDatabaseContent() {
    try {
        if (fs.existsSync(DB_FILE)) return fs.readFileSync(DB_FILE, "utf8");
        return null;
    } catch { return null; }
}

async function sendDatabaseBackup(sock) {
    if (!autoSaveEnabled || !autoSaveGroupJid || !sock) return;
    try {
        const dbContent = getDatabaseContent();
        if (!dbContent) return;
        const maxLength = 65536;
        const parts = [];
        if (dbContent.length > maxLength) {
            for (let i = 0; i < dbContent.length; i += maxLength) {
                parts.push(dbContent.substring(i, i + maxLength));
            }
        } else parts.push(dbContent);

        const timestamp = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false });
        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const header = "📦 *نسخة احتياطية*\n🕐 " + timestamp + "\n📊 جزء " + (i + 1) + "/" + parts.length + "\n\n";
            const footer = isLast ? "\n\n✅ تم الحفظ ✅" : '';
            await sock.sendMessage(autoSaveGroupJid, { text: header + parts[i] + footer });
        }
    } catch (e) { _originalError("Backup error:", e?.message); }
}

function startAutoSave(sock, jid) {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveEnabled = true;
    autoSaveGroupJid = jid;
    setTimeout(() => sendDatabaseBackup(sock), 3000);
    autoSaveInterval = setInterval(() => sendDatabaseBackup(sock), 4 * 60 * 60 * 1000);
}

function stopAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = null;
    autoSaveEnabled = false;
    autoSaveGroupJid = null;
}

// ============================================================
// الردود التلقائية + مراقبة المخالفات (دعم LID)
// ============================================================

async function handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb) {
    try {
        if (isSarahaActive && isSarahaActive(jid)) return;

        if (db.hisbaEnabled && db.hisbaEnabled[jid]) {
            if (!global.messageCounters[jid]) global.messageCounters[jid] = {};
            if (!global.messageCounters[jid][cleanSender]) global.messageCounters[jid][cleanSender] = 0;
            global.messageCounters[jid][cleanSender]++;
        }

        if (db.reactEnabled && db.reactEnabled[jid]) {
            if (!global.reactCounters[jid]) global.reactCounters[jid] = 0;
            global.reactCounters[jid]++;
            if (global.reactCounters[jid] >= 13) {
                global.reactCounters[jid] = 0;
                const emoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
                try { await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }); } catch (_) {}
            }
        }

        const msgContent = msg.message || {};
        if (db.protectCards && db.protectCards[jid]) {
            if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}
                try {
                    const senderJid = getSenderJid(msg, sock);
                    if (senderJid) await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                } catch (_) {}
                return;
            }
        }

        // مراقبة المخالفات
        if (db.monitors && db.monitors[cleanSender]) {
            if (text.includes("مخالفة") || text.includes("مــخــالــفــة")) {
                const mentionedJids = getRealMentionedJids(msg);
                let violatedNumber = "";

                if (mentionedJids[0]) {
                    violatedNumber = cleanNumber(String(mentionedJids[0]).split("@")[0]);
                } else {
                    const m = text.match(/العضو:\s*@(\d+)/) || text.match(/@(\d+)/);
                    if (m) violatedNumber = cleanNumber(m[1]);
                }

                if (violatedNumber) {
                    const violatedUser = db.users?.[violatedNumber];
                    if (violatedUser) {
                        const TAX = 100;
                        const balance = Number(violatedUser.balance) || 0;
                        let newBalance = balance - TAX;
                        violatedUser.balance = newBalance;
                        saveDb();

                        const nick = violatedUser.nickname || violatedNumber;
                        const violatedJid = `${violatedNumber}@s.whatsapp.net`;

                        await sock.sendMessage(jid, {
                            text: `•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•
تم خصم رصيد من العضو: 
[ \`${nick}\` ]  قيمة الضريبة:  ${TAX}
السبب:  ارتكاب مخالفة
•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•`,
                            mentions: [violatedJid]
                        }).catch(() => {});

                        if (newBalance < 0) {
                            const deficit = Math.abs(newBalance);
                            if (deficit > 0 && !db.bankruptcy?.[violatedNumber]) {
                                db.bankruptcy = db.bankruptcy || {};
                                db.bankruptcy[violatedNumber] = { amount: deficit, at: Date.now() };
                                saveDb();
                                await sock.sendMessage(jid, {
                                    text: `━━━━━═⏣⊰📛⊱⏣═━━━━━
العضو @${violatedNumber} 
نود اعلامك بأن عليك دفع سلفة في رصيدك  لانه قد اصبح عليك كسر
بقيمة: \`-${deficit}\`
═════════════════`,
                                    mentions: [violatedJid]
                                }).catch(() => {});
                            }
                        }
                    }
                }
            }
        }

        if (db.repliesEnabled && db.repliesEnabled[jid]) {
            const badWords = ["كول خرا", "كول خراا", "يلعون", "يلعن امك", "يلعن ابوك"];
            const isBadWord = badWords.some(w => text.includes(w));
            if (isBadWord) {
                let isAdminUser = false;
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const p = metadata.participants.find(p => p.id === sender);
                    if (p && (p.admin === "admin" || p.admin === "superadmin")) isAdminUser = true;
                } catch {}
                await sock.sendMessage(jid, {
                    text: isAdminUser
                        ? "═════════════════════\nلولا رتبتك لكنت اعطيتك درسا عن الردود\n═════════════════════"
                        : "═════════════════\nالخرا لسانه خرا مع الكل\n═════════════════"
                });
                return;
            }
        }

        if (db.ahaEnabled && db.ahaEnabled[jid]) {
            if (/احا{1,}/.test(text)) {
                db.ahaCooldown = db.ahaCooldown || {};
                const now = Date.now();
                if (now - (db.ahaCooldown[jid] || 0) > 5 * 60 * 1000) {
                    db.ahaCooldown[jid] = now;
                    saveDb();
                    await sock.sendMessage(jid, {
                        text: "═════ احا وأخواتها ═════\nاحا. احيه. احوه. احات. احاوات.اح\n══════════════════"
                    });
                }
                return;
            }
        }

        if (db.quietEnabled && db.quietEnabled[jid]) {
            db.quietTimer = db.quietTimer || {};
            if (db.quietTimer[jid]) {
                db.quietTimer[jid].lastMessageTime = Date.now();
                db.quietTimer[jid].sent = false;
                saveDb();
            }
        }
    } catch (e) { _originalError("AutoReplies error:", e?.message); }
}

// ============================================================
// دوال الفعاليات
// ============================================================

function getGamesDetailed() {
    const now = Date.now();
    const details = { total: 0, stuck: 0, healthy: 0, list: [] };
    const checkGame = (jid, game, name, ownTimeout) => {
        details.total++;
        const lastActivity = game?.lastActivity || game?.startTime || 0;
        const idle = now - lastActivity;
        const isStuck = idle > ownTimeout + 60 * 1000;
        if (isStuck) { details.stuck++; details.list.push({ jid, name, idle, status: "STUCK" }); }
        else { details.healthy++; details.list.push({ jid, name, idle, status: "HEALTHY" }); }
    };
    try {
        for (const jid of Object.keys(activeGames || {})) checkGame(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        for (const jid of Object.keys(activeCasinos || {})) checkGame(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        for (const jid of Object.keys(activeGuessGames || {})) checkGame(jid, activeGuessGames[jid], "حدسك", 5 * 60 * 1000);
        for (const jid of Object.keys(activeSaraha || {})) checkGame(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        for (const jid of Object.keys(activeColors || {})) checkGame(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        for (const jid of Object.keys(activeAnimals || {})) checkGame(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        for (const jid of Object.keys(activeMazads || {})) checkGame(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) checkGame(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
        }
    } catch {}
    return details;
}

function getStuckGamesInGroup() {
    const now = Date.now();
    const stuck = [];
    const check = (jid, game, name, ownTimeout) => {
        const last = game?.lastActivity || game?.startTime || 0;
        if ((now - last) > ownTimeout + 60 * 1000) stuck.push({ jid, name, game });
    };
    try {
        for (const jid of Object.keys(activeGames || {})) check(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        for (const jid of Object.keys(activeColors || {})) check(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        for (const jid of Object.keys(activeAnimals || {})) check(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        for (const jid of Object.keys(activeSaraha || {})) check(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        for (const jid of Object.keys(activeCasinos || {})) check(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        for (const jid of Object.keys(activeMazads || {})) check(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) check(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
        }
    } catch {}
    return stuck;
}

function stopSingleGame(entry) {
    try {
        const { jid, name, game } = entry;
        if (name === "مزاد") { try { game?.stopMazad?.(); } catch {} delete activeMazads[jid]; }
        else if (name === "روليت") { try { game?.stopGame?.(); } catch {} delete activeCasinos[jid]; }
        else if (name === "حدسك") { try { stopGuessGame(jid); } catch {} }
        else if (name === "تخمين") {
            if (tahminModule && tahminModule.stopTahminGame) {
                try { tahminModule.stopTahminGame(jid); } catch {}
            }
        } else {
            try { game?.stopGame?.(); } catch {}
            delete activeGames[jid]; delete activeColors[jid];
            delete activeAnimals[jid]; delete activeSaraha[jid];
        }
        return true;
    } catch { return false; }
}

// ============================================================
// الاستراحة
// ============================================================

const restRequests = Object.create(null);

async function requestRestInGroup(sock, jid, reason = "ضغط هائل") {
    if (restRequests[jid]) return false;
    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱☢️⊰─━─━─━◆
ملاحظة هناك ${reason} على
 البوت يرجى ارسال امر: 
*.استراحة*
للحفاظ على عدم تعليق البوت
◆━─━─━─⊱🛑⊰─━─━─━◆`
        });
        const timeoutId = setTimeout(async () => {
            const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
            for (const entry of stuck) stopSingleGame(entry);
            if (stuck.length > 0) {
                await sock.sendMessage(jid, {
                    text: `⏰ انتهت المهلة دون استجابة.\n🛑 تم إيقاف ${stuck.length} فعالية عالقة تلقائياً.`
                }).catch(() => {});
            }
            delete restRequests[jid];
        }, 60 * 1000);
        restRequests[jid] = { timeout: timeoutId, sentAt: Date.now() };
        return true;
    } catch (e) { _originalError("requestRestInGroup error:", e?.message); return false; }
}

async function handleRestCommand(sock, jid, msg, db) {
    if (restRequests[jid]) { clearTimeout(restRequests[jid].timeout); delete restRequests[jid]; }
    const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
    let stoppedCount = 0;
    if (stuck.length === 0) {
        try {
            if (activeGames[jid]) { activeGames[jid]?.stopGame?.(); delete activeGames[jid]; stoppedCount++; }
            if (activeColors[jid]) { activeColors[jid]?.stopGame?.(); delete activeColors[jid]; stoppedCount++; }
            if (activeAnimals[jid]) { activeAnimals[jid]?.stopGame?.(); delete activeAnimals[jid]; stoppedCount++; }
            if (activeSaraha[jid]) { activeSaraha[jid]?.stopGame?.(); delete activeSaraha[jid]; stoppedCount++; }
            if (activeCasinos[jid]) { activeCasinos[jid]?.stopGame?.(); delete activeCasinos[jid]; stoppedCount++; }
            if (activeGuessGames[jid]) { stopGuessGame(jid); stoppedCount++; }
            if (activeMazads[jid]) { activeMazads[jid]?.stopMazad?.(); delete activeMazads[jid]; stoppedCount++; }
            if (tahminModule && tahminModule.stopTahminGame) {
                if (tahminModule.activeTahmin && tahminModule.activeTahmin[jid]) {
                    tahminModule.stopTahminGame(jid); stoppedCount++;
                }
            }
        } catch {}
    } else {
        for (const entry of stuck) if (stopSingleGame(entry)) stoppedCount++;
    }
    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱✅⊰─━─━─━◆
تم الاستجابة لطلب الاستراحة
🛑 عدد الفعاليات المتوقفة: \`${stoppedCount}\`
شكراً لتعاونكم ❤️
◆━─━─━─⊱🛑⊰─━─━─━◆`
        }, { quoted: msg });
    } catch {}
    lastMessageAt = Date.now();
    return true;
}

// ============================================================
// Watchdog
// ============================================================

function startWatchdog(sock) {
    lastSocketRef = sock;
    lastMessageAt = Date.now();
    lastGroupUpdateAt = Date.now();
    consecutiveIdleChecks = 0;
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const idleMs = now - lastMessageAt;
            const games = getGamesDetailed();
            if (games.stuck > 0 && idleMs > GAME_STUCK_THRESHOLD_MS) {
                const stuckList = getStuckGamesInGroup();
                const affectedGroups = [...new Set(stuckList.map(g => g.jid))];
                for (const grpJid of affectedGroups) {
                    if (!restRequests[grpJid]) await requestRestInGroup(sock, grpJid, "ضغط هائل");
                }
                consecutiveIdleChecks = 0;
                return;
            }
            if (games.healthy > 0) {
                if (games.total > MAX_GAME_COUNT) _originalWarn(`⚠️ Watchdog: عدد فعاليات مرتفع (${games.total})`);
                return;
            }
            if (idleMs > IDLE_THRESHOLD_MS) {
                consecutiveIdleChecks++;
                _originalWarn(`⚠️ Watchdog: خمول ${Math.round(idleMs/60000)}د (${consecutiveIdleChecks}/${MAX_IDLE_CHECKS})`);
                if (consecutiveIdleChecks >= MAX_IDLE_CHECKS) {
                    _originalWarn("🔄 Watchdog: إعادة تشغيل الاتصال قسرياً...");
                    consecutiveIdleChecks = 0;
                    try { if (lastSocketRef && lastSocketRef.ws) lastSocketRef.ws.close(); } catch {}
                }
            } else consecutiveIdleChecks = 0;
        } catch (e) { _originalError("Watchdog error:", e?.message); }
    }, WATCHDOG_CHECK_MS);
}

function stopWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = null;
}

// ============================================================
// ⭐ انضمام العضو للقروب الأساسي (دعم LID)
// ============================================================

async function handleMainGroupJoin(sock, groupJid, participant, db, saveDb) {
    try {
        if (!db.mainGroup || db.mainGroup[groupJid] !== true) return;

        const userNumber = cleanNumber(String(participant).split("@")[0]);
        if (!userNumber) return;

        const safeJid = buildSafeMention(participant) || `${userNumber}@s.whatsapp.net`;

        // فحص المؤبد
        if (botIdentityModule && botIdentityModule.isPermanentMember(db, userNumber)) {
            await sock.sendMessage(groupJid, {
                text: `*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*
  انت محفوظ لدي مملكة النار
  بأنك مؤبد..  لهذا بص تحت: 
*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*`,
                mentions: [safeJid]
            }).catch(() => {});
            try {
                await sock.groupParticipantsUpdate(groupJid, [safeJid], "remove");
            } catch (_) {}
            return;
        }

        // ترحيب بالصورة
        if (!db.userPhotos) db.userPhotos = {};
        const photoEntry = db.userPhotos[userNumber];

        if (photoEntry && welcomeModule && typeof welcomeModule.sendWelcome === "function") {
            try {
                await welcomeModule.sendWelcome(sock, groupJid, userNumber, photoEntry, db);
            } catch (e) { _originalError("sendWelcome error:", e?.message); }
        }

        // ⭐ 100 رصيد ترحيبي
        const user = db.users?.[userNumber];
        if (user) {
            user.balance = (Number(user.balance) || 0) + 100;
            if (typeof saveDb === "function") saveDb();

            // رسالة الهدية بعد دقيقة
            setTimeout(async () => {
                await sock.sendMessage(groupJid, {
                    text: `♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢
👤 العضو: @${userNumber}
لقد حصلت على 100 رصيد كهدية
ترحيب خاصة بك يمكنك ان تكتب: 
*.تفاصيلي*
لرؤية ملفك التعريفي ورصيدك... 
♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢`,
                    mentions: [safeJid]
                }).catch(() => {});
            }, 60 * 1000);

            // تفاصيله بعد 5 دقائق
            setTimeout(async () => {
                const u = db.users?.[userNumber];
                if (!u) return;
                const dn = String(u.nickname || "").trim() || "غير مسجل";
                const fn = String(u.friend || "").trim() || "لا يوجد";
                const detailsText = "╗═════『   بياناتك  』═════╔\n\n💰 رصـــيـــــــدك:     `{" + (u.balance || 0) + "}`\n\n🏷️ لقبك:    `{" + dn + "}`\n\n🎖️ رتبتك:   `{" + (u.rank || "عضو") + "}`\n\n📈 أعلى تفاعل لك: `{" + (u.maxInteraction || 0) + "}`\n\n🫂 صـــديق:  `{" + fn + "}`\n╝════════════════════╚";
                await sock.sendMessage(groupJid, {
                    text: detailsText,
                    mentions: [safeJid]
                }).catch(() => {});
            }, 5 * 60 * 1000);
        }

        // إشعار قروبات الاستقبال
        if (db.receiveGroups) {
            for (const recJid of Object.keys(db.receiveGroups)) {
                if (!db.receiveGroups[recJid]) continue;
                try {
                    const recMeta = await sock.groupMetadata(recJid).catch(() => null);
                    if (!recMeta) continue;
                    const found = recMeta.participants.find(p => {
                        const pNum = cleanNumber(String(p.id).split("@")[0]);
                        return pNum === userNumber;
                    });
                    if (found) {
                        await sock.sendMessage(recJid, {
                            text: `❆━━━━━═⏣⊰👤⊱⏣═━━━━━❆
عزيزي/تي @${userNumber}
شكرا لك لقد إنتهى عملك هنا وقد تم
دخولك القروب الاساسي..  بينما هذا 
القروب انتهى عملك فيه هنا..  وداعا❤
❆━━━━━═⏣⊰🪪⊱⏣═━━━━━❆`,
                            mentions: [safeJid]
                        }).catch(() => {});
                        try { await sock.groupParticipantsUpdate(recJid, [safeJid], "remove"); } catch (_) {}
                    }
                } catch (_) {}
            }
        }

        // فحص النقابات
        if (botIdentityModule && db.workForms && db.workForms[userNumber]) {
            const workData = db.workForms[userNumber];
            const nakabaName = workData.nakaba || "غير محدد";
            try {
                await botIdentityModule.alertAdminsAboutMember(sock, groupJid, userNumber, nakabaName, db);
            } catch (_) {}
        }

    } catch (e) { _originalError("handleMainGroupJoin error:", e?.message); }
}

// ============================================================
// ⭐ معالجة اختيار الألعاب من List/Buttons Response
// ============================================================

async function handleGamesListSelection(sock, msg, jid, cleanSender, sender, isGroup, owner, botNumber, db) {
    const message = msg.message;
    if (!message) return false;

    let selectedId = "";

    // 1. Interactive List Response
    if (message.listResponseMessage) {
        selectedId = String(message.listResponseMessage.singleSelectReply?.selectedRowId || "").trim();
    }
    // 2. Buttons Response
    else if (message.buttonsResponseMessage) {
        selectedId = String(message.buttonsResponseMessage.selectedButtonId ||
                          message.buttonsResponseMessage.selectedDisplayText || "").trim();
    }
    // 3. Template Button Reply
    else if (message.templateButtonReplyMessage) {
        selectedId = String(message.templateButtonReplyMessage.selectedId || "").trim();
    }

    if (!selectedId) return false;

    // ⭐ تحويل أي اختيار لأمر صحيح
    let matchedCmd = null;

    // هل هو أمر جاهز؟
    for (const cmd of VALID_GAME_COMMANDS) {
        if (selectedId === cmd ||
            selectedId === "." + cmd ||
            selectedId.includes(cmd)) {
            matchedCmd = cmd;
            break;
        }
    }

    if (!matchedCmd) return false;

    // فحص وجود قائمة معلقة
    const pending = global.pendingGamesMenu && global.pendingGamesMenu[jid];
    if (!pending) {
        // لا قائمة معلقة - تجاهل
        return false;
    }

    if (pending.sender !== cleanSender) {
        await sock.sendMessage(jid, {
            text: "⚠️ هذه القائمة خاصة بصاحب الأمر `.العاب` فقط."
        }, { quoted: msg }).catch(() => {});
        return true;
    }

    if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
        delete global.pendingGamesMenu[jid];
        await sock.sendMessage(jid, {
            text: "⚠️ انتهت صلاحية القائمة، أعد كتابة `.العاب`."
        }, { quoted: msg }).catch(() => {});
        return true;
    }

    delete global.pendingGamesMenu[jid];

    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}

    const fakeText = "." + matchedCmd;
    try {
        const fakeMsg = { ...msg, message: { conversation: fakeText } };
        await handleCommand(sock, jid, fakeMsg, {
            db, sender, cleanSender, isGroup,
            isBotOwner: Boolean(owner), botNumber, text: fakeText
        });
    } catch (e) { _originalError("List response exec error:", e?.message); }

    return true;
}

// ============================================================
// ⭐ مراقبة ردود على قائمة الألعاب (الرد بالمنشن/الريبلاي)
// ============================================================

async function handleGamesListReply(sock, msg, jid, cleanSender, sender, isGroup, owner, botNumber, db) {
    try {
        const ctx =
            msg?.message?.extendedTextMessage?.contextInfo ||
            msg?.message?.contextInfo ||
            null;
        if (!ctx) return false;

        const quotedStanzaId = ctx.stanzaId;
        if (!quotedStanzaId) return false;

        const pending = global.pendingGamesMenu && global.pendingGamesMenu[jid];
        if (!pending) return false;

        // هل الرد على رسالة القائمة؟
        const isReplyToList =
            (pending.listMsgId && quotedStanzaId === pending.listMsgId) ||
            (pending.headerMsgId && quotedStanzaId === pending.headerMsgId);

        if (!isReplyToList) return false;

        // النص
        const text = (msg?.message?.conversation ||
                      msg?.message?.extendedTextMessage?.text || "").trim();
        if (!text) return false;

        // نظف النص
        let cleaned = text.replace(/^\./, "").trim();
        if (!VALID_GAME_COMMANDS.includes(cleaned)) return false;

        if (pending.sender !== cleanSender) {
            await sock.sendMessage(jid, {
                text: "⚠️ هذه القائمة خاصة بصاحب الأمر `.العاب` فقط."
            }, { quoted: msg }).catch(() => {});
            return true;
        }

        if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
            delete global.pendingGamesMenu[jid];
            return false;
        }

        delete global.pendingGamesMenu[jid];

        const fakeText = "." + cleaned;
        try {
            const fakeMsg = { ...msg, message: { conversation: fakeText } };
            await handleCommand(sock, jid, fakeMsg, {
                db, sender, cleanSender, isGroup,
                isBotOwner: Boolean(owner), botNumber, text: fakeText
            });
        } catch (e) { _originalError("Reply-to-list error:", e?.message); }

        return true;

    } catch (e) {
        _originalError("handleGamesListReply error:", e?.message);
        return false;
    }
}

// ============================================================
// ⭐ مراقبة رسائل ADS (لتسجيل النتائج)
// ============================================================

async function handleAdsMonitoring(sock, jid, msg, db, saveDb) {
    try {
        if (!resultsModule || typeof resultsModule.handleAdsMessage !== "function") return false;
        return await resultsModule.handleAdsMessage(sock, jid, msg, db, saveDb);
    } catch (e) {
        _originalError("Ads monitoring error:", e?.message);
        return false;
    }
}

// ============================================================
// Handlers
// ============================================================

function createHandlers() {
    return {
        onConnectionOpen: async (sock) => {
            setupAdminMonitoring(sock);
            const db = getDb();
            if (db && db.autoSaveEnabled && db.autoSaveGroupJid) startAutoSave(sock, db.autoSaveGroupJid);
            startWatchdog(sock);
            _originalLog("✅ البوت جاهز.");
        },

        onConnectionClose: async () => {
            stopAdminMonitoring();
            stopWatchdog();
        },

        onMessage: async (sock, event, context) => {
            try {
                lastMessageAt = Date.now();
                const { messages, type } = event || {};
                if (type !== "notify") return;
                if (!Array.isArray(messages) || !messages.length) return;

                const db = context.db || getDb();

                for (const msg of messages) {
                    try {
                        if (shouldIgnoreMessage(msg)) continue;
                        const jid = msg?.key?.remoteJid;
                        if (!jid) continue;

                        // ⭐ استخراج المرسل (LID support)
                        const sender = getSender(msg, sock);
                        const cleanSender = cleanNumber(String(sender).split("@")[0]);
                        const isGroup = isGroupJid(jid);
                        const botNumber = getBotNumber(sock);
                        const owner = isOwner(cleanSender, sock, msg);

                        const text = getMessageTextFromMsg(msg);

                        // ⭐ مراقبة ADS أولاً
                        if (isGroup && text) {
                            try { await handleAdsMonitoring(sock, jid, msg, db, saveDb); } catch (_) {}
                        }

                        // ⭐ List/Buttons Response
                        if (await handleGamesListSelection(sock, msg, jid, cleanSender, sender, isGroup, owner, botNumber, db)) continue;

                        // ⭐ Reply على رسالة القائمة
                        if (await handleGamesListReply(sock, msg, jid, cleanSender, sender, isGroup, owner, botNumber, db)) continue;

                        if (!text) continue;

                        // رسالة غير أمر
                        if (!text.startsWith(".")) {
                            if (typoModule && typeof typoModule.handleTypo === "function") {
                                try {
                                    const handled = await typoModule.handleTypo(sock, jid, msg, text, db, cleanSender, owner);
                                    if (handled) continue;
                                } catch (_) {}
                            }
                            await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
                            continue;
                        }

                        // ============================================
                        // الأوامر
                        // ============================================

                        // .صورة
                        if (text === ".صورة" || text.startsWith(".صورة ")) {
                            if (photosModule && typeof photosModule.handlePhotoCommand === "function") {
                                try {
                                    const handled = await photosModule.handlePhotoCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) { _originalError("photos error:", e?.message); }
                            }
                        }

                        // .اساسي on/off
                        if (text === ".اساسي on" || text === ".اساسي off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.mainGroup = db.mainGroup || {};
                            db.organizedGroups = db.organizedGroups || {};
                            if (text === ".اساسي on") {
                                db.mainGroup[jid] = true;
                                db.organizedGroups[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, {
                                    text: "✅ تم تعيين هذا القروب كقروب أساسي.\n📌 وتم تفعيل مراقبة المغادرين تلقائياً."
                                }, { quoted: msg });
                            } else {
                                delete db.mainGroup[jid];
                                delete db.organizedGroups[jid];
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إلغاء تعيين هذا القروب كقروب أساسي." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .رابط الاعلانات
                        if (text.startsWith(".رابط الاعلانات ")) {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            const url = text.slice(".رابط الاعلانات ".length).trim();
                            if (!url) {
                                await sock.sendMessage(jid, { text: "⚠️ يرجى كتابة الرابط." }, { quoted: msg });
                                continue;
                            }
                            db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
                            db.welcomeLinks.link1 = url;
                            saveDb();
                            await sock.sendMessage(jid, { text: "✅ تم حفظ رابط الإعلانات." }, { quoted: msg });
                            continue;
                        }

                        // .رابط المتجر
                        if (text.startsWith(".رابط المتجر ")) {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            const url = text.slice(".رابط المتجر ".length).trim();
                            if (!url) {
                                await sock.sendMessage(jid, { text: "⚠️ يرجى كتابة الرابط." }, { quoted: msg });
                                continue;
                            }
                            db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
                            db.welcomeLinks.link2 = url;
                            saveDb();
                            await sock.sendMessage(jid, { text: "✅ تم حفظ رابط المتجر." }, { quoted: msg });
                            continue;
                        }

                        // .حماية on/off
                        if (text === ".حماية on" || text === ".حماية off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.protectCards = db.protectCards || {};
                            if (text === ".حماية on") {
                                db.protectCards[jid] = true; saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل حماية البطاقات." }, { quoted: msg });
                            } else {
                                delete db.protectCards[jid]; saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف حماية البطاقات." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .تنظيف — حذف آخر 30 رسالة
                        if (text === ".تنظيف") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            try {
                                const history = await sock.fetchMessageHistory(30, msg.key, Math.floor(Date.now() / 1000) - 3600);
                                let deleted = 0;
                                for (const m of history) {
                                    try {
                                        if (m.key && !m.key.fromMe) continue;
                                        await sock.sendMessage(jid, { delete: m.key });
                                        deleted++;
                                    } catch (_) {}
                                }
                                await sock.sendMessage(jid, { text: `🧹 تم مسح ${deleted} رسالة.` }, { quoted: msg });
                            } catch (_) {
                                await sock.sendMessage(jid, { text: "⚠️ فشل تنظيف الرسائل." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .تفاعل on/off
                        if (text === ".تفاعل on" || text === ".تفاعل off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.reactEnabled = db.reactEnabled || {};
                            if (text === ".تفاعل on") {
                                db.reactEnabled[jid] = true; saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل التفاعل التلقائي." }, { quoted: msg });
                            } else {
                                delete db.reactEnabled[jid]; saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف التفاعل التلقائي." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .حسبة on/off
                        if (text === ".حسبة on" || text === ".حسبة off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.hisbaEnabled = db.hisbaEnabled || {};
                            if (text === ".حسبة on") {
                                db.hisbaEnabled[jid] = true; saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل عدّاد التفاعل." }, { quoted: msg });
                            } else {
                                delete db.hisbaEnabled[jid]; saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف عدّاد التفاعل." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .حسبة
                        if (text === ".حسبة") {
                            const isPermission1 = owner || (db.permissions && db.permissions["1"] && db.permissions["1"].includes(cleanSender));
                            if (!isPermission1) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر يحتاج صلاحية .سماح 1." }, { quoted: msg });
                                continue;
                            }
                            for (const grpJid of Object.keys(global.messageCounters || {})) {
                                const counters = global.messageCounters[grpJid];
                                for (const userNum of Object.keys(counters)) {
                                    const count = counters[userNum];
                                    db.users = db.users || {};
                                    if (!db.users[userNum]) {
                                        db.users[userNum] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
                                    }
                                    if (count > (db.users[userNum].maxInteraction || 0)) {
                                        db.users[userNum].maxInteraction = count;
                                    }
                                }
                            }
                            saveDb();
                            await sock.sendMessage(jid, { text: "◆━─━─━─⊱✅⊰─━─━─━◆\n  تم تعديل واضافة تفاعل الجميع\n◆━─━─━─⊱✅⊰─━─━─━◆" }, { quoted: msg });
                            continue;
                        }

                        // .امبراطور
                        if (text.startsWith(".امبراطور ")) {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            const mentionedJids = getRealMentionedJids(msg);
                            if (!mentionedJids.length) {
                                await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص." }, { quoted: msg });
                                continue;
                            }
                            const targetJid = mentionedJids[0];
                            const target = cleanNumber(String(targetJid).split("@")[0]);
                            const safeJid = buildSafeMention(targetJid) || `${target}@s.whatsapp.net`;
                            db.emperors = db.emperors || {};
                            db.emperors[target] = true;
                            saveDb();
                            await sock.sendMessage(jid, {
                                text: `👑 تم تعيين @${target} كامبراطور.`,
                                mentions: [safeJid]
                            }, { quoted: msg });
                            continue;
                        }

                        // .نتائج
                        if (text === ".نتائج" || text.startsWith(".نتائج ")) {
                            if (resultsModule && typeof resultsModule.handleResults === "function") {
                                try {
                                    const handled = await resultsModule.handleResults(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) { _originalError("results error:", e?.message); }
                            }
                        }

                        // .اوامر
                        if (text === ".اوامر") {
                            if (commandsListModule && typeof commandsListModule.handleCommandsList === "function") {
                                try {
                                    const handled = await commandsListModule.handleCommandsList(sock, jid, msg, db, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) { _originalError("commandsList error:", e?.message); }
                            }
                        }

                        // .عادي on/off
                        if (text === ".عادي on" || text === ".عادي off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.typoEnabled = db.typoEnabled || {};
                            if (text === ".عادي on") {
                                db.typoEnabled[jid] = true; saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل تصحيح الأخطاء." }, { quoted: msg });
                            } else {
                                delete db.typoEnabled[jid]; saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف تصحيح الأخطاء." }, { quoted: msg });
                            }
                            continue;
                        }

                        // .استراحة
                        if (text === ".استراحة") {
                            await handleRestCommand(sock, jid, msg, db);
                            continue;
                        }

                        // .حفظ
                        if (text === ".حفظ" || text.startsWith(".حفظ ")) {
                            const parts = text.split(/\s+/);
                            const action = parts.length > 1 ? parts[1].toLowerCase() : "";
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            if (action === "on") {
                                db.autoSaveEnabled = true;
                                db.autoSaveGroupJid = jid;
                                saveDb();
                                startAutoSave(sock, jid);
                                await sock.sendMessage(jid, { text: "✅ *تم تفعيل الحفظ التلقائي*\n🕐 كل 4 ساعات" }, { quoted: msg });
                            } else if (action === "off") {
                                db.autoSaveEnabled = false;
                                db.autoSaveGroupJid = null;
                                saveDb();
                                stopAutoSave();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف الحفظ التلقائي" }, { quoted: msg });
                            } else {
                                const status = db.autoSaveEnabled ? "🟢 مفعّل" : "🔴 غير مفعّل";
                                await sock.sendMessage(jid, { text: "📊 الحالة: " + status + "\n.حفظ on / off" }, { quoted: msg });
                            }
                            continue;
                        }

                        // .548484
                        if (text === ".548484") {
                            try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            if (db.mazadRevoked === true) {
                                await sock.sendMessage(jid, {
                                    text: `◆━─━─━─⊱⚠️⊰─━─━─━◆\n*عذرا الإمبراطور قام بمنع هذا!*\n◆━─━─━─⊱⛔⊰─━─━─━◆`
                                }, { quoted: msg });
                                continue;
                            }
                            db.mazadCreator = cleanSender;
                            saveDb();
                            await sock.sendMessage(jid, { text: "✅ تم تفعيل وضع منشئ المزاد." }, { quoted: msg });
                            continue;
                        }

                        // .مزاد
                        if (text === ".مزاد") {
                            if (db.mazadRevoked === true) {
                                const isEmperor = db.emperors && db.emperors[cleanSender] === true;
                                if (!isEmperor) {
                                    await sock.sendMessage(jid, {
                                        text: `◆━─━─━─⊱⚠️⊰─━─━─━◆\n*عذرا الإمبراطور قام بمنع هذا!*\n◆━─━─━─⊱⛔⊰─━─━─━◆`
                                    }, { quoted: msg });
                                    continue;
                                }
                            }
                            if (await handleMazadCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text.startsWith(".ادفع")) {
                            const parts = text.split(/\s+/);
                            const amount = parseInt(parts[1]);
                            if (!isNaN(amount) && amount > 0) {
                                if (await handleMazadBid(sock, jid, msg, db, saveDb, cleanSender, amount)) continue;
                            }
                        }

                        if (text === ".مخزوني") {
                            if (await handleMazadInventory(sock, jid, msg, db, cleanSender)) continue;
                        }

                        if (text.startsWith(".ارسال")) {
                            if (await handleMazadSend(sock, jid, msg, text, db, saveDb, cleanSender)) continue;
                        }

                        if (text === ".الغاء") {
                            if (await handleMazadCancelSend(sock, jid, msg, db, saveDb, cleanSender)) continue;
                        }

                        // .صراحة
                        if (text === ".صراحة") {
                            if (await handleSarahaCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        // .الوان
                        if (text === ".الوان") {
                            if (await handleColorsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        // .الحيوانات
                        if (text === ".الحيوانات") {
                            if (await handleAnimalsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        // .تخمين
                        if (text === ".تخمين") {
                            if (tahminModule && typeof tahminModule.handleTahminCommand === "function") {
                                try {
                                    const handled = await tahminModule.handleTahminCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) { _originalError("tahmin error:", e?.message); }
                            }
                        }

                        // المعالج الرئيسي
                        await handleCommand(sock, jid, msg, {
                            db, sender, cleanSender, isGroup,
                            isBotOwner: Boolean(owner), botNumber, text
                        });

                    } catch (e) {
                        _originalError("Message error:", e?.message);
                    }
                }
            } catch (e) {
                _originalError("onMessage error:", e?.message);
            }
        },

        onGroupUpdate: async (sock, update, context) => {
            try {
                lastGroupUpdateAt = Date.now();
                const db = context.db || getDb();

                await handleGroupJoin(sock, update, db, saveDb);

                if (update && update.action === "add" && Array.isArray(update.participants)) {
                    for (const participant of update.participants) {
                        await handleMainGroupJoin(sock, update.id, participant, db, saveDb);

                        const userNum = cleanNumber(String(participant).split("@")[0]);
                        const safeJid = buildSafeMention(participant) || `${userNum}@s.whatsapp.net`;

                        if (botIdentityModule && botIdentityModule.isPermanentMember(db, userNum)) {
                            if (db.receiveGroups && db.receiveGroups[update.id]) {
                                await sock.sendMessage(update.id, {
                                    text: `*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*
  انت محفوظ لدي مملكة النار
  بأنك مؤبد..  لهذا بص تحت: 
*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*`,
                                    mentions: [safeJid]
                                }).catch(() => {});
                                try {
                                    await sock.groupParticipantsUpdate(update.id, [safeJid], "remove");
                                } catch (_) {}
                            }
                        }
                    }
                }
            } catch (e) {
                _originalError("GroupUpdate error:", e?.message);
            }
        }
    };
}

// ============================================================
// Start
// ============================================================

async function main() {
    try {
        _originalLog("╔════════════════════════════════════╗");
        _originalLog("║        🤖 ALJESAT BOT START       ║");
        _originalLog("╚════════════════════════════════════╝");

        configureHandlers(createHandlers());
        const sock = await startBot();
        if (!sock) throw new Error("فشل بدء البوت");
        return sock;
    } catch (e) {
        _originalError("فشل تشغيل البوت:", e?.message);
        return null;
    }
}

main().catch(e => _originalError("Fatal:", e?.message));

process.once("SIGINT", () => { stopWatchdog(); stopAutoSave(); process.exit(0); });
process.once("SIGTERM", () => { stopWatchdog(); stopAutoSave(); process.exit(0); });

module.exports = { main };