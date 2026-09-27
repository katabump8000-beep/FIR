// ============================================================
// bot.js
// ALJESAT BOT
// Core / Database / WhatsApp Connection
// نسخة محدّثة: دعم LID + participantPn
// ============================================================

"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const settings = require("./settings");

// ============================================================
// Paths
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");
const SESSION_FOLDER = path.join(__dirname, settings.sessionFolder || "session");

// ============================================================
// Runtime
// ============================================================

let db = null;
let currentSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let shuttingDown = false;
let startPromise = null;
let isReconnecting = false;

let handlers = {
    onMessage: null,
    onGroupUpdate: null,
    onConnectionOpen: null,
    onConnectionClose: null
};

const MAX_RECONNECT_DELAY = 30000;

// ============================================================
// ⭐ دوال LID / PN — جديدة لمعالجة المنشن الصحيح
// ============================================================

/**
 * التحقق أن JID صالح كرقم هاتف حقيقي (PN)
 */
function isValidPnJid(jid) {
    if (!jid || typeof jid !== "string") return false;
    if (!jid.endsWith("@s.whatsapp.net")) return false;
    const num = jid.split("@")[0];
    return /^\d{10,15}$/.test(num);
}

/**
 * استخراج JID الحقيقي من أي مصدر (يدعم LID و PN)
 * الأولوية: participantPn > participant > remoteJid
 */
function getRealJid(source) {
    if (!source) return "";

    // إذا كان نصاً مباشراً
    if (typeof source === "string") {
        return source;
    }

    // إذا كان كائناً (msg أو participant أو key)
    if (typeof source === "object") {
        return (
            source.participantPn ||
            source.participant_pn ||
            source.senderPn ||
            source.pn ||
            source.participant ||
            source.remoteJid ||
            source.id ||
            source.jid ||
            ""
        );
    }

    return "";
}

/**
 * بناء منشن آمن من أي مصدر
 * - إذا كان JID صحيح: نعيده كما هو
 * - إذا كان LID: نحاول استخراج رقم (أفضل جهد)
 */
function buildSafeMention(source) {
    if (!source) return "";

    let jid = "";
    if (typeof source === "string") jid = source;
    else if (typeof source === "object") {
        jid = source.participantPn ||
              source.participant_pn ||
              source.senderPn ||
              source.pn ||
              source.participant ||
              source.remoteJid ||
              source.id ||
              "";
    }

    if (!jid) return "";

    // إذا كان PN صحيح، نعيده كما هو
    if (isValidPnJid(jid)) return jid;

    // استخراج الأرقام فقط
    const num = String(jid).split("@")[0].replace(/\D/g, "");
    if (num && num.length >= 10 && num.length <= 15) {
        return `${num}@s.whatsapp.net`;
    }

    return "";
}

/**
 * استخراج رقم من JID (بدون @s.whatsapp.net)
 */
function getNumberFromJid(source) {
    const jid = buildSafeMention(source);
    if (!jid) return "";
    return jid.split("@")[0];
}

/**
 * استخراج الرقم الحقيقي من msg (مع LID support)
 */
function getSenderNumber(msg, sock = null) {
    if (!msg) return "";

    // من خود msg
    if (msg?.key?.fromMe && sock) {
        return jidToNumber(sock?.user?.id);
    }

    // الأولوية لـ participantPn
    const jid =
        msg?.key?.participantPn ||
        msg?.key?.participant_pn ||
        msg?.key?.senderPn ||
        msg?.key?.participant ||
        msg?.key?.remoteJid ||
        "";

    return cleanNumber(String(jid).split("@")[0]);
}

/**
 * استخراج JID الحقيقي للمرسل من msg
 */
function getSenderJid(msg, sock = null) {
    if (!msg) return "";

    if (msg?.key?.fromMe && sock) {
        return sock?.user?.id || "";
    }

    const jid =
        msg?.key?.participantPn ||
        msg?.key?.participant_pn ||
        msg?.key?.senderPn ||
        msg?.key?.participant ||
        msg?.key?.remoteJid ||
        "";

    return jid;
}

/**
 * استخراج JID المذكور من contextInfo (مع LID support)
 * يعطي الأولوية لـ mentionedPn إذا وُجد
 */
function getRealMentionedJid(msg) {
    try {
        const ctx =
            msg?.message?.extendedTextMessage?.contextInfo ||
            msg?.message?.contextInfo ||
            null;
        if (!ctx) return null;

        // الأولوية: mentionedPn
        if (Array.isArray(ctx.mentionedPn) && ctx.mentionedPn[0]) {
            return ctx.mentionedPn[0];
        }

        const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid[0] : null;
        if (!mentioned) return null;

        // إذا كان LID، حاول إيجاد PN
        if (String(mentioned).endsWith("@lid")) {
            const participants = Array.isArray(ctx.participants) ? ctx.participants : [];
            for (const p of participants) {
                if (p.lid === mentioned && (p.pn || p.phoneNumber)) {
                    return p.pn || p.phoneNumber;
                }
            }
            // إذا لم نجد PN، نُعيد LID كما هو (احتياط)
            return mentioned;
        }

        return mentioned;
    } catch {
        return null;
    }
}

/**
 * استخراج كل المنشنين الحقيقيين من contextInfo
 */
function getRealMentionedJids(msg) {
    try {
        const ctx =
            msg?.message?.extendedTextMessage?.contextInfo ||
            msg?.message?.contextInfo ||
            null;
        if (!ctx) return [];

        // الأولوية: mentionedPn
        if (Array.isArray(ctx.mentionedPn) && ctx.mentionedPn.length) {
            return ctx.mentionedPn.filter(Boolean);
        }

        const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
        return mentioned.map(jid => {
            if (String(jid).endsWith("@lid")) {
                const participants = Array.isArray(ctx.participants) ? ctx.participants : [];
                for (const p of participants) {
                    if (p.lid === jid && (p.pn || p.phoneNumber)) {
                        return p.pn || p.phoneNumber;
                    }
                }
            }
            return jid;
        }).filter(Boolean);
    } catch {
        return [];
    }
}

// ============================================================
// Database
// ============================================================

function createDefaultDatabase() {
    return {
        groupSettings: {},
        adsGroups: {},
        bankGroups: {},
        workGroups: {},
        receiveGroups: {},
        purchaseOrderGroups: {},

        mainGroup: {},
        organizedGroups: {},

        cooldowns: {},
        users: {},
        admins: {},

        permissions: { "1": [], "2": [], "3": [], "4": [] },
        gamePermissions: [],
        gameCooldown: {},

        monitoredUsers: {},
        monitors: {},

        dailyData: {},
        dailyCooldown: {},
        chainPermissions: [],

        rouletteCooldown: {},
        crystalCooldown: {},
        crystalPlayerCooldown: {},
        guessCooldown: {},

        pendingSend: {},
        mazadCreator: null,
        mazadRevoked: false,
        mazadPermitted: {},
        inventory: {},

        userPhotos: {},
        emperors: {},
        botIdentities: {},
        permanentMembers: {},
        workForms: {},

        welcomeLinks: { link1: "", link2: "" },

        protectCards: {},
        reactEnabled: {},
        hisbaEnabled: {},
        typoEnabled: {},
        resultsData: {},

        repliesEnabled: {},
        ahaEnabled: {},
        quietEnabled: {},

        autoSaveEnabled: false,
        autoSaveGroupJid: null,

        bans: {},
        bankruptcy: {},
        shopMessages: []
    };
}

function ensureDatabaseShape() {
    if (!db || typeof db !== "object" || Array.isArray(db)) {
        db = createDefaultDatabase();
    }

    const objectFields = [
        "groupSettings", "adsGroups", "bankGroups", "workGroups", "receiveGroups",
        "purchaseOrderGroups", "cooldowns", "users", "admins", "gameCooldown",
        "monitoredUsers", "monitors", "dailyData", "dailyCooldown",
        "rouletteCooldown", "crystalCooldown", "crystalPlayerCooldown", "guessCooldown",
        "pendingSend", "mazadPermitted", "inventory", "userPhotos", "emperors",
        "botIdentities", "permanentMembers", "workForms", "protectCards",
        "reactEnabled", "hisbaEnabled", "typoEnabled", "resultsData",
        "repliesEnabled", "ahaEnabled", "quietEnabled", "mainGroup",
        "organizedGroups", "bans", "bankruptcy"
    ];

    for (const field of objectFields) {
        if (!db[field] || typeof db[field] !== "object" || Array.isArray(db[field])) {
            db[field] = {};
        }
    }

    if (!db.welcomeLinks || typeof db.welcomeLinks !== "object" || Array.isArray(db.welcomeLinks)) {
        db.welcomeLinks = { link1: "", link2: "" };
    } else {
        if (typeof db.welcomeLinks.link1 !== "string") db.welcomeLinks.link1 = "";
        if (typeof db.welcomeLinks.link2 !== "string") db.welcomeLinks.link2 = "";
    }

    if (!db.permissions || typeof db.permissions !== "object" || Array.isArray(db.permissions)) {
        db.permissions = {};
    }
    for (const level of ["1", "2", "3", "4"]) {
        if (!Array.isArray(db.permissions[level])) db.permissions[level] = [];
    }

    if (!Array.isArray(db.gamePermissions)) db.gamePermissions = [];
    if (!Array.isArray(db.chainPermissions)) db.chainPermissions = [];
    if (!Array.isArray(db.shopMessages)) db.shopMessages = [];
    if (typeof db.mazadCreator !== "string" && db.mazadCreator !== null) db.mazadCreator = null;
    if (typeof db.mazadRevoked !== "boolean") db.mazadRevoked = false;

    return db;
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        db = createDefaultDatabase();
        ensureDatabaseShape();
        return db;
    }

    try {
        const raw = fs.readFileSync(DB_FILE, "utf8").trim();

        if (!raw) {
            db = createDefaultDatabase();
        } else {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("database.json لا يحتوي على بيانات صحيحة.");
            }
            db = { ...createDefaultDatabase(), ...parsed };
        }

        ensureDatabaseShape();
        return db;

    } catch (error) {
        console.error("❌ تعذر تحميل database.json:", error?.message || error);
        db = createDefaultDatabase();
        ensureDatabaseShape();
        return db;
    }
}

function saveDb() {
    try {
        ensureDatabaseShape();
        const tempFile = `${DB_FILE}.tmp`;
        const json = JSON.stringify(db, null, 2);
        fs.writeFileSync(tempFile, json, "utf8");
        fs.renameSync(tempFile, DB_FILE);
        return true;
    } catch (error) {
        console.error("❌ خطأ أثناء حفظ database.json:", error?.message || error);
        try {
            const tempFile = `${DB_FILE}.tmp`;
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (_) {}
        return false;
    }
}

loadDatabase();
global.db = db;
global.saveDb = saveDb;

// ============================================================
// Utilities
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

function cleanJid(value) {
    if (!value) return "";
    return String(value).split(":")[0];
}

function jidToNumber(value) {
    return cleanNumber(cleanJid(value));
}

function isGroupJid(jid) {
    return typeof jid === "string" && jid.endsWith("@g.us");
}

/**
 * ⭐ نسخة محدّثة: تبني منشن آمن من رقم أو JID
 */
function formatMention(source) {
    return buildSafeMention(source);
}

function getOwnerNumbers() {
    const configuredOwners = Array.isArray(settings.owners)
        ? settings.owners
        : settings.owners ? [settings.owners] : [];

    const owners = configuredOwners.map(cleanNumber).filter(Boolean);

    if (owners.length === 0 && settings.botNumber) {
        const botNumber = cleanNumber(settings.botNumber);
        if (botNumber) owners.push(botNumber);
    }

    return [...new Set(owners)];
}

function getBotNumber(sock = currentSocket) {
    return jidToNumber(sock?.user?.id);
}

function isOwner(senderNumber, sock = currentSocket, msg = null) {
    const sender = cleanNumber(senderNumber);
    if (!sender) return false;
    if (msg?.key?.fromMe) return true;

    const owners = getOwnerNumbers();
    if (owners.includes(sender)) return true;

    const botNumber = getBotNumber(sock);
    if (botNumber && sender === botNumber) return true;

    try {
        if (db && db.emperors && db.emperors[sender] === true) return true;
    } catch (_) {}

    return false;
}

function ensureUser(userNumber) {
    const number = cleanNumber(userNumber);
    if (!number) return null;

    ensureDatabaseShape();

    if (!db.users[number] || typeof db.users[number] !== "object" || Array.isArray(db.users[number])) {
        db.users[number] = {
            balance: 0,
            nickname: "",
            rank: "",
            maxInteraction: 0,
            friend: ""
        };
    }

    const user = db.users[number];
    if (typeof user.balance !== "number" || !Number.isFinite(user.balance)) user.balance = 0;
    if (typeof user.nickname !== "string") user.nickname = "";
    if (typeof user.rank !== "string") user.rank = "";
    if (typeof user.maxInteraction !== "number" || !Number.isFinite(user.maxInteraction)) user.maxInteraction = 0;
    if (typeof user.friend !== "string") user.friend = "";

    return user;
}

function hasPermission(userNumber, level, owner = false) {
    if (owner) return true;
    ensureDatabaseShape();
    const number = cleanNumber(userNumber);
    const permissionLevel = String(level);
    return Array.isArray(db.permissions[permissionLevel]) &&
        db.permissions[permissionLevel].includes(number);
}

function getMessageText(message) {
    if (!message) return "";
    const text =
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId;

    if (!text && message.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = message.extendedTextMessage.contextInfo.quotedMessage;
        return quoted.conversation || quoted.extendedTextMessage?.text || "";
    }

    return typeof text === "string" ? text.trim() : "";
}

/**
 * ⭐ نسخة محدّثة: تستخدم getRealMentionedJid
 */
function getMentionedJid(msg) {
    return getRealMentionedJid(msg);
}

async function sendText(sock, jid, text, msg = null, extra = {}) {
    if (!sock || !jid) return null;
    try {
        const messageText = String(text ?? "").trim();
        if (!messageText) return null;
        const options = { text: messageText, ...extra };
        const sendOptions = msg ? { quoted: msg } : undefined;
        return await sock.sendMessage(jid, options, sendOptions);
    } catch (error) {
        console.error(`❌ فشل إرسال الرسالة إلى ${jid}:`, error?.message || error);
        return null;
    }
}

// ============================================================
// Daily Rewards
// ============================================================

function getDailyReward(day) {
    const rewards = {
        1: 10, 2: 20, 3: 30, 4: 40, 5: 50,
        6: 60, 7: 70, 8: 80, 9: 90, 10: 100,
        11: 110, 12: 120, 13: 130, 14: 140, 15: 150,
        16: 160, 17: 170, 18: 180, 19: 190, 20: 200,
        21: 210, 22: 220, 23: 230, 24: 240, 25: 250,
        26: 260, 27: 270, 28: 280, 29: 290, 30: 1000
    };
    return rewards[day] || 10;
}

function getNextReward(day) {
    const nextDay = day + 1;
    if (nextDay > 30) return 10;
    return getDailyReward(nextDay);
}

function getDailyMessage(day, reward, nextReward) {
    if (day >= 30) {
        return `🔥▬▬▬▬🎀▬▬▬▬🔥
الهدية الاخيرة: ${reward}$
انت اصبحت عضو من الدرجة:
{الأسطورية}
لقد اكملت سلسلة 30 يوم
وقد حصلت على انجاز وسيسجل
في وصف المملكة بالكامل 🔥
🎁▬▬▬▬🎊▬▬▬▬🎁`;
    }
    return `🎁▬▬▬▬🎀▬▬▬▬🎁
هديتك اليوم: ${reward}$
سلسلة تسجيل دخولك: ${day} أيام
الجائزة القادمة: {${nextReward}$}
🎁▬▬▬▬🎊▬▬▬▬🎁`;
}

function getCooldownMessage(timeLeft, nextReward) {
    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    const timeStr = hours > 0 ? `${hours} ساعة و ${minutes} دقيقة` : `${minutes} دقيقة`;
    return `⚠️▬▬▬▬🎁▬▬▬▬⚠️
عذرا يرجى الانتظار {${timeStr}}
حتى تستطيع الحصول على الجائزة
التالية.. والتي ستكون: {${nextReward}$}
🎁▬▬▬▬⚠️▬▬▬▬🎁`;
}

function getNoNicknameMessage() {
    return `⚠️▬▬▬▬🎁▬▬▬▬⚠️
عذرا انت لم تسجل في قائمة
الالقاب 📜 يرجى من أحد الرتب
ان يقوم بتسجيل لقبك لتتمكن من
الحصول على هدايا بشكل متتالي
⛔▬▬▬▬⚠️▬▬▬▬⛔`;
}

// ============================================================
// Socket Management
// ============================================================

function configureHandlers(newHandlers = {}) {
    if (newHandlers && typeof newHandlers === "object") {
        handlers = { ...handlers, ...newHandlers };
    }
    return handlers;
}

function clearReconnectTimer() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function getReconnectDelay() {
    const exponential = Math.min(
        1000 * Math.pow(2, Math.max(0, reconnectAttempts - 1)),
        MAX_RECONNECT_DELAY
    );
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, MAX_RECONNECT_DELAY);
}

function registerEvents(sock, saveCreds) {
    if (!sock || !sock.ev) {
        console.error("❌ لا يمكن تسجيل الأحداث: Socket غير صالح");
        return;
    }

    if (typeof saveCreds === "function") {
        sock.ev.on("creds.update", async (...args) => {
            try { await saveCreds(...args); }
            catch (error) { console.error("❌ خطأ أثناء حفظ بيانات الجلسة:", error?.message || error); }
        });
    }

    sock.ev.on("connection.update", async update => {
        try {
            const { connection, lastDisconnect } = update || {};

            if (connection === "open") {
                reconnectAttempts = 0;
                clearReconnectTimer();
                isReconnecting = false;
                console.log("✅ تم اتصال البوت بنجاح!");
                if (typeof handlers.onConnectionOpen === "function") {
                    await handlers.onConnectionOpen(sock, { db, saveDb });
                }
                return;
            }

            if (connection === "close") {
                if (typeof handlers.onConnectionClose === "function") {
                    try { await handlers.onConnectionClose(sock, update); }
                    catch (error) { console.error("❌ خطأ في onConnectionClose:", error?.message || error); }
                }

                if (shuttingDown) return;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;

                if (loggedOut) {
                    console.error("🚫 تم تسجيل خروج الجلسة.");
                    currentSocket = null;
                    return;
                }

                reconnectAttempts++;
                const delay = getReconnectDelay();
                console.warn(`⚠️ انقطع الاتصال. إعادة المحاولة بعد ${Math.ceil(delay / 1000)} ثانية...`);
                clearReconnectTimer();
                reconnectTimer = setTimeout(async () => {
                    reconnectTimer = null;
                    if (!shuttingDown) await reconnect();
                }, delay);
            }
        } catch (error) {
            console.error("❌ خطأ في connection.update:", error?.message || error);
        }
    });

    sock.ev.on("messages.upsert", async event => {
        if (typeof handlers.onMessage !== "function") return;
        try { await handlers.onMessage(sock, event, { db, saveDb }); }
        catch (error) { console.error("❌ خطأ في messages.upsert:", error?.message || error); }
    });

    sock.ev.on("group-participants.update", async update => {
        if (typeof handlers.onGroupUpdate !== "function") return;
        try { await handlers.onGroupUpdate(sock, update, { db, saveDb }); }
        catch (error) { console.error("❌ خطأ في group-participants.update:", error?.message || error); }
    });

    console.log("✅ تم تسجيل جميع Events على الـSocket الجديد");
}

function cleanupSocket(sock) {
    if (!sock || !sock.ev) return;
    try {
        sock.ev.removeAllListeners();
        console.log("🧹 تم تنظيف الـListeners من الـSocket القديم");
    } catch (error) {
        console.error("❌ خطأ في تنظيف الـSocket:", error?.message || error);
    }
}

async function reconnect() {
    if (isReconnecting || shuttingDown) return;
    isReconnecting = true;

    try {
        console.log("🔄 جارٍ إعادة الاتصال...");
        if (currentSocket) {
            cleanupSocket(currentSocket);
            currentSocket = null;
        }
        const sock = await createSocket();
        if (sock) {
            currentSocket = sock;
            console.log("✅ تم إعادة الاتصال بنجاح");
            isReconnecting = false;
        } else {
            console.error("❌ فشل إعادة الاتصال");
            isReconnecting = false;
        }
    } catch (error) {
        console.error("❌ خطأ في إعادة الاتصال:", error?.message || error);
        isReconnecting = false;
        if (!shuttingDown) {
            clearReconnectTimer();
            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null;
                await reconnect();
            }, 5000);
        }
    }
}

async function createSocket() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

        let version;
        try {
            const latest = await fetchLatestBaileysVersion();
            version = latest?.version;
        } catch (error) {
            console.warn("⚠️ تعذر جلب إصدار Baileys الأخير.");
            version = undefined;
        }

        const socketOptions = {
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            markOnlineOnConnect: true,
            syncFullHistory: true
        };

        if (version) socketOptions.version = version;

        const sock = makeWASocket(socketOptions);

        const owners = getOwnerNumbers();
        const pairingNumber = owners[0] || cleanNumber(settings.botNumber);

        if (!state.creds.registered && pairingNumber) {
            console.log(`\n🤖 جار تجهيز رمز الاقتران للرقم: ${pairingNumber}`);
            setTimeout(async () => {
                try {
                    if (!currentSocket || currentSocket !== sock) return;
                    let code = await sock.requestPairingCode(pairingNumber);
                    if (code) code = String(code).match(/.{1,4}/g)?.join("-") || code;
                    console.log(`🔑 رمز الاقتران الخاص بك هو: [ ${code} ]\n`);
                } catch (error) {
                    console.error("❌ خطأ في رمز الاقتران:", error?.message || error);
                }
            }, 4000);
        }

        registerEvents(sock, saveCreds);
        return sock;

    } catch (error) {
        console.error("❌ فشل إنشاء Socket:", error?.message || error);
        throw error;
    }
}

async function startBot(customHandlers = null) {
    if (customHandlers && typeof customHandlers === "object") {
        configureHandlers(customHandlers);
    }

    if (shuttingDown) throw new Error("البوت في وضع الإيقاف.");
    if (startPromise) return startPromise;

    startPromise = (async () => {
        try {
            ensureDatabaseShape();
            if (currentSocket) {
                cleanupSocket(currentSocket);
                currentSocket = null;
            }
            const sock = await createSocket();
            currentSocket = sock;
            return sock;
        } finally {
            startPromise = null;
        }
    })();

    return startPromise;
}

async function shutdown() {
    shuttingDown = true;
    clearReconnectTimer();
    if (currentSocket) {
        cleanupSocket(currentSocket);
        currentSocket = null;
    }
    saveDb();
    console.log("🛑 تم إيقاف البوت.");
}

process.once("SIGINT", async () => { await shutdown(); process.exit(0); });
process.once("SIGTERM", async () => { await shutdown(); process.exit(0); });

// ============================================================
// تصدير
// ============================================================

module.exports = {
    startBot,
    shutdown,
    reconnect,
    configureHandlers,

    getDb: () => db,
    saveDb,

    ensureDatabaseShape,
    ensureUser,

    cleanNumber,
    cleanJid,
    jidToNumber,
    isGroupJid,
    formatMention,

    // ⭐ دوال LID الجديدة
    isValidPnJid,
    getRealJid,
    buildSafeMention,
    getNumberFromJid,
    getSenderNumber,
    getSenderJid,
    getRealMentionedJid,
    getRealMentionedJids,

    getOwnerNumbers,
    getBotNumber,
    isOwner,

    hasPermission,

    getMessageText,
    getMentionedJid,

    sendText,

    getDailyReward,
    getNextReward,
    getDailyMessage,
    getCooldownMessage,
    getNoNicknameMessage
};