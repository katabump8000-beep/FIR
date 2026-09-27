// ============================================================
// animals.js
// ALJESAT BOT
// لعبة الحيوانات - نسخة محدّثة بدعم LID
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

// ⭐ دوال LID
const { cleanNumber, buildSafeMention } = require("./bot");

// ============================================================
// مراحل التحميل
// ============================================================

const LOADING_STAGES = [
    "█░░░░░░░░░░░░░░  1%",
    "██░░░░░░░░░░░░░  3%",
    "███░░░░░░░░░░░░  7%",
    "█████░░░░░░░░░░ 16%",
    "█████████░░░░░░ 35%",
    "████████████░░░ 65%",
    "███████████████ 88%",
    "████████████████ 100%"
];

// ============================================================
// قائمة الحيوانات
// ============================================================

const ANIMALS_LIST = [
    { id: "aa", name: "سلطعون", aliases: ["سلطان", "سرطان"] },
    { id: "ar", name: "ارنب", aliases: ["أرنب", "ارانب"] },
    { id: "bb", name: "دبور", aliases: ["دبور", "زنقط"] },
    { id: "bat", name: "بطريق", aliases: ["بطريق", "بطاريق"] },
    { id: "cc", name: "اوزة", aliases: ["إوزة", "وزة", "اوز"] },
    { id: "dd", name: "دولفين", aliases: ["دولفين", "دلافين"] },
    { id: "de", name: "ديك", aliases: ["ديك", "ديوك"] },
    { id: "ee", name: "آكل النمل", aliases: ["آكل النمل", "اكل النمل"] },
    { id: "far", name: "فار", aliases: ["فأر", "فئران"] },
    { id: "ff", name: "حمار", aliases: ["حمار", "حمير"] },
    { id: "fuk", name: "فقمة", aliases: ["فقمة", "فقمات"] },
    { id: "gg", name: "الباكا", aliases: ["ألباكا", "يرعة", "الباكا"] },
    { id: "gf", name: "دودة", aliases: ["دودة", "ديدان", "دودة ارض"] },
    { id: "ha", name: "حمامة", aliases: ["حمامة", "حمام"] },
    { id: "hh", name: "فيل", aliases: ["فيل", "افيال"] },
    { id: "hs", name: "ثعبان", aliases: ["ثعبان", "افعى"] },
    { id: "ii", name: "فراشة", aliases: ["فراشة", "فراشات"] },
    { id: "jj", name: "سمكة", aliases: ["سمكة", "اسماك"] },
    { id: "kk", name: "غزال", aliases: ["غزال", "غزالة"] },
    { id: "kl", name: "عقرب", aliases: ["عقرب", "عقارب"] },
    { id: "la", name: "لاما", aliases: ["لاما"] },
    { id: "ll", name: "فرس النهر", aliases: ["فرس النهر", "فرس نهر"] },
    { id: "M44", name: "ام اربع واربعين", aliases: ["أم أربع وأربعين", "ام اربع واربعين"] },
    { id: "mm", name: "ماموث", aliases: ["ماموث"] },
    { id: "nn", name: "غوريلا", aliases: ["غوريلا", "غوريلات"] },
    { id: "oo", name: "قطة", aliases: ["قطة", "قطط"] },
    { id: "pa", name: "باندا", aliases: ["باندا"] },
    { id: "pp", name: "بقرة", aliases: ["بقرة", "بقر"] },
    { id: "qq", name: "تمساح", aliases: ["تمساح", "تماسيح"] },
    { id: "re", name: "طاووس", aliases: ["طاووس", "طواويس"] },
    { id: "rr", name: "خفاش", aliases: ["خفاش", "خفافيش"] },
    { id: "she", name: "خروف", aliases: ["خروف", "غنمة", "غنم", "ماعز"] },
    { id: "sn", name: "سنجاب", aliases: ["سنجاب", "سناجب"] },
    { id: "sp", name: "عنكبوت", aliases: ["عنكبوت", "عناكب"] },
    { id: "ss", name: "غراب", aliases: ["غراب", "غربان"] },
    { id: "ssa", name: "كنغر", aliases: ["كنغر", "كنغرات"] },
    { id: "su", name: "كتكوت", aliases: ["كتكوت", "صوص", "فرخ"] },
    { id: "tt", name: "دب", aliases: ["دب", "دببة"] },
    { id: "tur", name: "ديك رومي", aliases: ["ديك رومي", "ديك روم"] },
    { id: "uu", name: "عصفور", aliases: ["عصفور", "عصافير"] },
    { id: "vv", name: "ضفدع", aliases: ["ضفدع", "ضفادع"] },
    { id: "ww", name: "نملة", aliases: ["نملة", "نمل"] },
    { id: "xx", name: "زرافة", aliases: ["زرافة", "زرافات"] },
    { id: "yy", name: "خنفساء", aliases: ["خنفساء", "خنافس"] },
    { id: "zb", name: "ذبابة", aliases: ["ذبابة", "ذباب"] },
    { id: "zon", name: "حلزون", aliases: ["حلزون", "حلازين"] },
    { id: "zz", name: "هدهد", aliases: ["هدهد"] },
    { id: "zzx", name: "نعامة", aliases: ["نعامة", "نعام"] }
];

// ============================================================
// مسار مجلد الصور
// ============================================================

const ANIMALS_FOLDER = path.join(__dirname, "animal_images");

if (!fs.existsSync(ANIMALS_FOLDER)) {
    fs.mkdirSync(ANIMALS_FOLDER, { recursive: true });
}

const activeAnimals = Object.create(null);

// ============================================================
// أدوات مساعدة
// ============================================================

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

function hasNickname(db, jid) {
    const user = getUser(db, jid);
    return Boolean(user && String(user.nickname || "").trim());
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
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

// ============================================================
// عرض التحميل
// ============================================================

async function showLoading(sock, jid, msg) {
    let loadingMsg = await safeSend(sock, jid, { text: LOADING_STAGES[0] }, { quoted: msg });
    if (!loadingMsg) return null;

    for (let i = 1; i < LOADING_STAGES.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await safeSend(sock, jid, { text: LOADING_STAGES[i], edit: loadingMsg.key });
    }

    return loadingMsg;
}

// ============================================================
// رسائل اللعبة
// ============================================================

function getAnimalsStartMessage() {
    return `~*‏«───────🦊───────»*~
  فعالية الحيوانات جدا بسيطة 
  \`فقط ارسل أسم الحيوان\` الذي 
  أرسله الان في الصورة 🖼️
  \`اولا سأبدأ بهذا الحيوان:\`
~*‏«───────🐞───────»*~`;
}

function getAnimalsQuestion(animalName) {
    return `~*‏«───────🦊───────»*~
  \`ما اسم هذا الحيوان؟\`
~*‏«───────🐞───────»*~`;
}

function getAnimalsCorrect(score) {
    return `✅ إجابة صحيحة ✅
إجاباتك: { \`${score}\` }
الهدف حتى الفوز: { _*10*_ }.`;
}

function getAnimalsWinner(user) {
    return `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳  @${user}
━━━━━━✦❘༻👑༺❘✦━━━━━━`;
}

function getAnimalsDeposit(user, prize) {
    return `👑◈═══『 إيداع 』═══◈👑
@${user}
السبب: فاز بفعالية الحيوانات
💰 المبلغ: [${prize}]
تم إضافة رصيدك للبنك يمكنك الذهاب والتحقق✅

👑◈════════════◈👑`;
}

function getAnimalsInactiveStop() {
    return "⚠️ تم إيقاف فعالية الحيوانات تلقائياً بسبب الخمول وعدم التفاعل.";
}

function getAnimalsTimeout() {
    return "🕰 إنتهى الوقت المحدد 30ث ⌛";
}

function formatDate(date) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
}

// ============================================================
// مسارات الصور
// ============================================================

function getAnimalImagePath(animalId) {
    return path.join(ANIMALS_FOLDER, `${animalId}.jpg`);
}

function animalImageExists(animalId) {
    return fs.existsSync(getAnimalImagePath(animalId));
}

// ============================================================
// بدء اللعبة
// ============================================================

async function handleAnimalsCommand(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (activeAnimals[jid]) {
            await safeSend(sock, jid, { text: "⚠️ هناك فعالية حيوانات قائمة بالفعل في هذه المجموعة!" }, { quoted: msg });
            return true;
        }

        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

        if (!hasPermission) {
            await safeSend(sock, jid, { text: "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر." }, { quoted: msg });
            return true;
        }

        if (!hasNickname(db, cleanSender)) {
            await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل." }, { quoted: msg });
            return true;
        }

        const availableAnimals = ANIMALS_LIST.filter(animal => animalImageExists(animal.id));
        if (availableAnimals.length === 0) {
            await safeSend(sock, jid, { text: "❌ لا توجد صور حيوانات متوفرة." }, { quoted: msg });
            return true;
        }

        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000;
        db.gameCooldown = db.gameCooldown && typeof db.gameCooldown === "object" ? db.gameCooldown : {};
        const previousTime = Number(db.gameCooldown[jid]) || 0;

        if (previousTime > 0) {
            const elapsed = now - previousTime;
            if (elapsed < cooldownTime) {
                const remainingMin = Math.ceil((cooldownTime - elapsed) / 60000);
                await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
                return true;
            }
        }

        db.gameCooldown[jid] = now;
        if (typeof saveDb === "function") saveDb();

        await showLoading(sock, jid, msg);

        const animals = shuffleArray([...availableAnimals]);
        const gameState = {
            animals: animals,
            currentIndex: 0,
            scores: {},
            isActive: true,
            isPaused: false,
            isWaitingNext: false,
            currentAnimal: null,
            lastActivity: Date.now(),
            totalQuestions: animals.length,
            prizeAmount: 30,
            startTime: new Date(),
            timers: { inactivity: null, question: null, next: null },
            listeners: [],
            stopGame: function() {
                this.isActive = false;
                if (this.timers.inactivity) { clearTimeout(this.timers.inactivity); this.timers.inactivity = null; }
                if (this.timers.question) { clearTimeout(this.timers.question); this.timers.question = null; }
                if (this.timers.next) { clearTimeout(this.timers.next); this.timers.next = null; }
                delete activeAnimals[jid];
            }
        };

        activeAnimals[jid] = gameState;

        await safeSend(sock, jid, { text: getAnimalsStartMessage() }, { quoted: msg });

        setTimeout(async () => {
            if (!gameState.isActive) return;
            await sendNextAnimalQuestion(sock, jid, db, gameState);
        }, 2000);

        startAnimalsInactivityTimer(sock, jid, gameState);

        const listener = async (mObj) => {
            try {
                if (!gameState.isActive || gameState.isPaused || gameState.isWaitingNext) return;
                if (!mObj || !Array.isArray(mObj.messages) || !mObj.messages.length) return;

                const incomingMsg = mObj.messages[0];
                if (!incomingMsg?.message) return;
                if (incomingMsg.key?.remoteJid !== jid) return;
                if (incomingMsg.key?.fromMe) return;

                const txt = getMessageText(incomingMsg.message);
                if (!txt) return;
                if (txt.startsWith(".")) return;

                // ⭐ استخراج المرسل بدعم LID
                const userSender =
                    incomingMsg.key?.participantPn ||
                    incomingMsg.key?.participant_pn ||
                    incomingMsg.key?.senderPn ||
                    incomingMsg.key?.participant ||
                    incomingMsg.key?.remoteJid;
                if (!userSender) return;

                const senderNumber = cleanNumber(String(userSender).split("@")[0]);
                const safeJid = buildSafeMention(userSender) || `${senderNumber}@s.whatsapp.net`;

                gameState.lastActivity = Date.now();

                if (gameState.currentAnimal) {
                    const normalizedAnswer = normalizeText(txt);
                    const animal = gameState.currentAnimal;

                    const isCorrect = 
                        normalizedAnswer === normalizeText(animal.name) ||
                        animal.aliases.some(alias => normalizedAnswer === normalizeText(alias));

                    if (isCorrect) {
                        gameState.isWaitingNext = true;
                        gameState.scores[senderNumber] = (gameState.scores[senderNumber] || 0) + 1;
                        const currentScore = gameState.scores[senderNumber];

                        if (currentScore >= 10) {
                            gameState.stopGame();

                            await safeSend(sock, jid, {
                                text: getAnimalsWinner(senderNumber),
                                mentions: [safeJid]
                            });

                            db.users = db.users && typeof db.users === "object" ? db.users : {};
                            if (db.users[senderNumber]) {
                                const user = db.users[senderNumber];
                                user.balance = Number(user.balance) || 0;
                                user.balance += gameState.prizeAmount;
                                if (typeof saveDb === "function") saveDb();
                            }

                            await safeSend(sock, jid, {
                                text: getAnimalsDeposit(senderNumber, gameState.prizeAmount),
                                mentions: [safeJid]
                            });

                            const winnerUser = db.users?.[senderNumber];
                            const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || senderNumber;

                            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{الحيوانات}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${gameState.prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${formatDate(gameState.startTime)}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                            if (db.adsGroups && typeof db.adsGroups === "object") {
                                for (const adJid of Object.keys(db.adsGroups)) {
                                    if (!db.adsGroups[adJid]) continue;
                                    await safeSend(sock, adJid, { text: adMessage });
                                }
                            }
                            return;
                        }

                        await safeSend(sock, jid, { text: getAnimalsCorrect(currentScore) }, { quoted: incomingMsg });

                        if (gameState.timers.next) clearTimeout(gameState.timers.next);

                        gameState.timers.next = setTimeout(async () => {
                            gameState.timers.next = null;
                            if (!gameState.isActive || gameState.isPaused) return;
                            gameState.isWaitingNext = false;
                            await sendNextAnimalQuestion(sock, jid, db, gameState);
                        }, 4000);

                        return;
                    }
                }

            } catch (error) {
                console.error("❌ خطأ في مستمع الحيوانات:", error?.message || error);
            }
        };

        sock.ev.on("messages.upsert", listener);
        gameState.listeners.push(listener);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleAnimalsCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال السؤال التالي
// ============================================================

async function sendNextAnimalQuestion(sock, jid, db, gameState) {
    if (!gameState.isActive || gameState.isPaused) return;
    if (gameState.currentIndex >= gameState.totalQuestions) {
        gameState.animals = shuffleArray([...gameState.animals]);
        gameState.currentIndex = 0;
    }

    const animal = gameState.animals[gameState.currentIndex];
    gameState.currentAnimal = animal;
    gameState.currentIndex++;
    gameState.lastActivity = Date.now();

    const imagePath = getAnimalImagePath(animal.id);
    
    if (fs.existsSync(imagePath)) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            await safeSend(sock, jid, {
                image: imageBuffer,
                caption: getAnimalsQuestion(animal.name)
            });
        } catch (error) {
            console.error("❌ خطأ في إرسال صورة الحيوان:", error?.message);
            await safeSend(sock, jid, {
                text: `${getAnimalsQuestion(animal.name)}\n\n⚠️ لم يتم تحميل الصورة. اكتب اسم الحيوان: ${animal.name}`
            });
        }
    } else {
        await safeSend(sock, jid, {
            text: `${getAnimalsQuestion(animal.name)}\n\n⚠️ الصورة غير متوفرة. اكتب اسم الحيوان: ${animal.name}`
        });
    }

    if (gameState.timers.question) clearTimeout(gameState.timers.question);

    gameState.timers.question = setTimeout(async () => {
        if (!gameState.isActive || gameState.isPaused) return;
        gameState.isWaitingNext = false;
        await safeSend(sock, jid, { text: getAnimalsTimeout() });
        await sendNextAnimalQuestion(sock, jid, db, gameState);
    }, 30000);
}

// ============================================================
// مؤقت النشاط
// ============================================================

function startAnimalsInactivityTimer(sock, jid, gameState) {
    if (gameState.timers.inactivity) clearTimeout(gameState.timers.inactivity);

    gameState.timers.inactivity = setTimeout(async () => {
        if (!gameState.isActive) return;
        const timeSinceLastActivity = Date.now() - gameState.lastActivity;

        if (timeSinceLastActivity > 3 * 60 * 1000) {
            gameState.stopGame();
            await safeSend(sock, jid, { text: getAnimalsInactiveStop() });
            return;
        }

        startAnimalsInactivityTimer(sock, jid, gameState);
    }, 60000);
}

// ============================================================
// إيقاف اللعبة
// ============================================================

function stopAnimalsGame(jid) {
    const game = activeAnimals[jid];
    if (game) { game.stopGame(); return true; }
    return false;
}

function checkAnimalsActive(jid) {
    return Boolean(activeAnimals[jid] && activeAnimals[jid].isActive);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeAnimals,
    handleAnimalsCommand,
    stopAnimalsGame,
    checkAnimalsActive,
    ANIMALS_LIST,
    getAnimalImagePath,
    animalImageExists,
    LOADING_STAGES,
    showLoading
};