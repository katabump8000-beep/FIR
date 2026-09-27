// ============================================================
// menu.js
// ALJESAT BOT
// Games: .تفكيك, .كتابة, .اعلام, .ايموجي, .الوان
// نسخة محدّثة: دعم LID + participantPn
// ============================================================

"use strict";

const { wordsList, writingList, flagsList, emojisList } = require("./data");

// ⭐ استيراد دوال LID
const { cleanNumber, buildSafeMention, getRealMentionedJids } = require("./bot");

// ============================================================
// Active Games
// ============================================================

const activeGames = Object.create(null);

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
// قائمة الألعاب — الأوامر بالنقطة (كما في الرد على القائمة)
// ============================================================

const GAMES_MENU_ITEMS = [
    "تفكيك",
    "كتابة",
    "الوان",
    "الحيوانات",
    "اعلام",
    "ايموجي",
    "تخمين",
    "روليت",
    "اتبع حدسك"
];

// ============================================================
// Text normalization
// ============================================================

function normalizeText(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ");
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
    );
}

// ============================================================
// قائمة الألوان
// ============================================================

const colorsList = [
    { emoji: "❤️", name: "أحمر" },
    { emoji: "💙", name: "أزرق" },
    { emoji: "💚", name: "أخضر" },
    { emoji: "💛", name: "أصفر" },
    { emoji: "🧡", name: "برتقالي" },
    { emoji: "💜", name: "بنفسجي" },
    { emoji: "🩶", name: "رمادي" },
    { emoji: "🩷", name: "زهري" },
    { emoji: "🩵", name: "أزرق فاتح" },
    { emoji: "🤎", name: "بني" },
    { emoji: "🤍", name: "أبيض" },
    { emoji: "🖤", name: "أسود" }
];

// ============================================================
// عرض التحميل
// ============================================================

async function showLoading(sock, jid, msg) {
    let loadingMsg = await sock.sendMessage(jid, { text: LOADING_STAGES[0] }, { quoted: msg });
    if (!loadingMsg) return null;

    for (let i = 1; i < LOADING_STAGES.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, {
            text: LOADING_STAGES[i],
            edit: loadingMsg.key
        }).catch(() => {});
    }

    return loadingMsg;
}

// ============================================================
// ⭐ لعبة الألوان المدمجة (بدعم LID)
// ============================================================

async function startColorsGame(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

    if (!hasPermission) {
        await sock.sendMessage(jid, { text: "⚠️ ليس لديك صلاحية لاستخدام أوامر الفعاليات." }, { quoted: msg });
        return false;
    }

    if (activeGames[jid] && !activeGames[jid].gameEnded) {
        await sock.sendMessage(jid, { text: "⚠️ هناك فعالية قائمة بالفعل." }, { quoted: msg });
        return false;
    }

    const now = Date.now();
    const cooldownTime = 5 * 60 * 1000;
    db.gameCooldown = db.gameCooldown || {};
    const previousTime = Number(db.gameCooldown[jid]) || 0;

    if (previousTime > 0 && (now - previousTime) < cooldownTime) {
        const remainingMin = Math.ceil((cooldownTime - (now - previousTime)) / 60000);
        await sock.sendMessage(jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
        return false;
    }

    db.gameCooldown[jid] = now;
    saveDb();

    await showLoading(sock, jid, msg);

    const userScores = Object.create(null);
    let gameEnded = false;
    let isWaitingNext = false;
    let currentColorObj = null;
    let lastActivityTime = Date.now();
    let noAnswerSeconds = 0;
    let inactiveInterval = null;
    let noAnswerInterval = null;
    let nextTimer = null;
    let gameMessageListener = null;
    const prizeAmount = 30;

    const startDate = new Date();
    const daysNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    const startTimeFormatted = `${daysNames[startDate.getDay()]} | ${startDate.getDate()} | ${monthsNames[startDate.getMonth()]}`;

    function stopGame() {
        if (gameEnded) return;
        gameEnded = true;
        if (inactiveInterval) clearInterval(inactiveInterval);
        if (noAnswerInterval) clearInterval(noAnswerInterval);
        if (nextTimer) clearTimeout(nextTimer);
        if (gameMessageListener) {
            try { sock.ev.off("messages.upsert", gameMessageListener); } catch (_) {}
            gameMessageListener = null;
        }
        delete activeGames[jid];
    }

    async function sendNewColor() {
        if (gameEnded) return;
        if (activeGames[jid]?.isPaused) return;

        noAnswerSeconds = 0;
        const randomIndex = Math.floor(Math.random() * colorsList.length);
        const color = colorsList[randomIndex];

        currentColorObj = { emoji: color.emoji, name: normalizeText(color.name) };

        const display = `╗──────فعالية الالوان ─────╔
 ارسل اسم اللون التالي: ☜  ${color.emoji} ☞
╝──────────────────╚`;

        await sock.sendMessage(jid, { text: display });
        isWaitingNext = false;
        lastActivityTime = Date.now();
    }

    await sock.sendMessage(jid, {
        text: `╗──────فعالية الالوان ─────╔ 
 بكل بساطة البوت يرسل قلب ملون
ويجب على المشاركين ارسال اسم
اللون الذي يرسله البوت وهذه الالوان: 
🤎🤍🩶💜💙🩵💚❤️🩷🧡
╝──────────────────╚`
    });

    activeGames[jid] = {
        gameEnded: false,
        isPaused: false,
        sendNewChallenge: sendNewColor,
        stopGame
    };

    gameMessageListener = async (mObj) => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused || isWaitingNext) return;
            if (!mObj?.messages?.length) return;

            const incomingMsg = mObj.messages[0];
            if (!incomingMsg?.message || incomingMsg.key?.remoteJid !== jid || incomingMsg.key?.fromMe) return;

            const txt = getMessageText(incomingMsg.message);
            if (!txt || txt.startsWith(".")) return;

            // ⭐ استخراج المرسل بدعم LID
            const userSender =
                incomingMsg.key?.participantPn ||
                incomingMsg.key?.participant_pn ||
                incomingMsg.key?.senderPn ||
                incomingMsg.key?.participant ||
                incomingMsg.key?.remoteJid;
            if (!userSender) return;

            const userNumber = cleanNumber(String(userSender).split("@")[0]);
            const safeJid = buildSafeMention(userSender) || `${userNumber}@s.whatsapp.net`;

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

            if (currentColorObj && normalizeText(txt) === currentColorObj.name) {
                isWaitingNext = true;
                userScores[userNumber] = (userScores[userNumber] || 0) + 1;
                const currentScore = userScores[userNumber];

                if (currentScore >= 10) {
                    stopGame();

                    await sock.sendMessage(jid, {
                        text: `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳 @${userNumber}
━━━━━━✦❘༻👑༺❘✦━━━━━━`,
                        mentions: [safeJid]
                    });

                    db.users = db.users || {};
                    if (db.users[userNumber]) {
                        db.users[userNumber].balance = (db.users[userNumber].balance || 0) + prizeAmount;
                        saveDb();
                    }

                    const depositMsg = `👑◈═══『 إيداع 』═══◈👑
@${userNumber}
السبب: فاز بفعالية الألوان
💰 المبلغ: [${prizeAmount}]
✅ تم الإيداع.
👑◈════════════◈👑`;
                    await sock.sendMessage(jid, { text: depositMsg, mentions: [safeJid] });

                    const winnerUser = db.users?.[userNumber];
                    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || userNumber;

                    const adMessage = `_*█ إنــتــهــت █*_

◇🎮 نـــــــوع الفعالية:
*{الألوان}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                    if (db.adsGroups) {
                        for (const adJid of Object.keys(db.adsGroups)) {
                            if (db.adsGroups[adJid]) {
                                await sock.sendMessage(adJid, { text: adMessage }).catch(() => {});
                            }
                        }
                    }
                    return;
                }

                await sock.sendMessage(jid, {
                    text: `✅ إجابة صحيحة ✅
إجاباتك: { \`${currentScore}\` }
الهدف: { _*10*_ }.`
                }, { quoted: incomingMsg });

                if (nextTimer) clearTimeout(nextTimer);
                nextTimer = setTimeout(async () => {
                    nextTimer = null;
                    if (!gameEnded && !activeGames[jid]?.isPaused) {
                        try { await sendNewColor(); } catch (_) { stopGame(); }
                    }
                }, 4000);
                return;
            }

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

        } catch (error) {
            console.error("❌ خطأ في Listener الألوان:", error);
        }
    };

    sock.ev.on("messages.upsert", gameMessageListener);

    noAnswerInterval = setInterval(async () => {
        if (gameEnded || activeGames[jid]?.isPaused) return;
        noAnswerSeconds += 5;
        if (noAnswerSeconds === 30) {
            await sock.sendMessage(jid, { text: "🕰 إنتهى الوقت 30ث ⌛" });
            await sendNewColor();
        } else if (noAnswerSeconds >= 52) {
            stopGame();
            await sock.sendMessage(jid, { text: "⛔ تم إيقاف الفعالية لعدم النشاط." });
        }
    }, 5000);

    inactiveInterval = setInterval(() => {
        if (gameEnded) { clearInterval(inactiveInterval); return; }
        if (Date.now() - lastActivityTime > 3 * 60 * 1000) {
            stopGame();
            sock.sendMessage(jid, { text: "⚠️ تم إيقاف الفعالية بسبب الخمول." }).catch(() => {});
        }
    }, 60000);

    try { await sendNewColor(); } catch (_) { stopGame(); return false; }
    return true;
}

// ============================================================
// Handle game command (الألعاب القديمة) — بدعم LID
// ============================================================

async function handleGameCommand(sock, jid, msg, command, cleanSender, sender, db, saveDb, isBotOwner) {
    if (!sock || !jid) return false;

    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasGamePermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

    if (!hasGamePermission) {
        await sock.sendMessage(jid, { text: "⚠️ ليس لديك صلاحية لاستخدام أوامر الفعاليات." }, { quoted: msg });
        return false;
    }

    const validGames = ["تفكيك", "كتابة", "اعلام", "ايموجي"];
    if (!validGames.includes(command)) return false;

    if (activeGames[jid] && !activeGames[jid].gameEnded) {
        await sock.sendMessage(jid, { text: "⚠️ هناك فعالية قائمة بالفعل في هذه المجموعة، انتظر حتى تنتهي أو اكتب .ايقاف" }, { quoted: msg });
        return false;
    }

    const now = Date.now();
    const cooldownTime = 5 * 60 * 1000;
    db.gameCooldown = db.gameCooldown && typeof db.gameCooldown === "object" ? db.gameCooldown : {};
    const previousTime = Number(db.gameCooldown[jid]) || 0;

    if (previousTime > 0) {
        const elapsed = now - previousTime;
        if (elapsed < cooldownTime) {
            const remainingMin = Math.ceil((cooldownTime - elapsed) / 60000);
            await sock.sendMessage(jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
            return false;
        }
    }

    db.gameCooldown[jid] = now;
    if (typeof saveDb === "function") saveDb();

    const startDate = new Date();
    const daysNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    const startTimeFormatted = `${daysNames[startDate.getDay()]} | ${startDate.getDate()} | ${monthsNames[startDate.getMonth()]}`;

    await showLoading(sock, jid, msg);

    const userScores = Object.create(null);
    let gameEnded = false;
    let isWaitingNextWord = false;
    let currentChallengeObj = null;
    let lastActivityTime = Date.now();
    let noAnswerSeconds = 0;
    let inactiveInterval = null;
    let noAnswerInterval = null;
    let nextChallengeTimer = null;
    let gameMessageListener = null;

    let prizeAmount = 30;
    if (command === "كتابة") prizeAmount = 20;
    if (command === "اعلام") prizeAmount = 35;

    function stopGame() {
        if (gameEnded) return;
        gameEnded = true;
        if (inactiveInterval) { clearInterval(inactiveInterval); inactiveInterval = null; }
        if (noAnswerInterval) { clearInterval(noAnswerInterval); noAnswerInterval = null; }
        if (nextChallengeTimer) { clearTimeout(nextChallengeTimer); nextChallengeTimer = null; }
        if (gameMessageListener) {
            try { sock.ev.off("messages.upsert", gameMessageListener); } catch (_) {}
            gameMessageListener = null;
        }
        delete activeGames[jid];
    }

    async function sendNewChallenge() {
        if (gameEnded) return;
        if (activeGames[jid]?.isPaused) return;
        noAnswerSeconds = 0;

        if (command === "تفكيك") {
            if (!Array.isArray(wordsList) || wordsList.length === 0) throw new Error("wordsList فارغة");
            const randomWord = wordsList[Math.floor(Math.random() * wordsList.length)];
            const target = String(randomWord).split("").join(" ");
            currentChallengeObj = {
                target: normalizeText(target),
                display: `╗════════✂️════════╔
  *قم بتفكيك الكلمة:*

   *(${randomWord})*

\`شرح: فقط ارسل تفكيك الكلمة\`
\`كهذا المثال: ناروتو = ن ا ر و ت و\`
╝═══════════════════╚`
            };
        } else if (command === "كتابة") {
            if (!Array.isArray(writingList) || writingList.length === 0) throw new Error("writingList فارغة");
            const randomWord = writingList[Math.floor(Math.random() * writingList.length)];
            currentChallengeObj = {
                target: normalizeText(randomWord),
                display: `*فعالية الكتابة*
_*الشرح:*_
\`يقوم البوت بإرسال كلمة ويجب على أي شخص أن يرسل نفسها بالضبط\`

╮──────────────╭
       *${randomWord}*
‏╯──────────────╰`
            };
        } else if (command === "اعلام") {
            if (!Array.isArray(flagsList) || flagsList.length === 0) throw new Error("flagsList فارغة");
            const randomFlag = flagsList[Math.floor(Math.random() * flagsList.length)];
            currentChallengeObj = {
                target: normalizeText(randomFlag.emoji),
                display: `🏳️*فعالية الاعلام*🏴
أرسل علم دولة: *${randomFlag.name}*`
            };
        } else if (command === "ايموجي") {
            if (!Array.isArray(emojisList) || emojisList.length === 0) throw new Error("emojisList فارغة");
            const randomEmoji = emojisList[Math.floor(Math.random() * emojisList.length)];
            currentChallengeObj = {
                target: normalizeText(randomEmoji.emoji),
                display: `🍎_*فعالية الإيموجي*_🙂
يرسل البوت اسم ايموجي ويجب على أي مشارك أن يرسل الإيموجي الذي يتناسق مع الاسم الذي يرسله البوت
╮──────────────╭
      ${randomEmoji.name}
‏╯──────────────╰`
            };
        }

        if (!currentChallengeObj) return;

        await sock.sendMessage(jid, { text: currentChallengeObj.display });
        isWaitingNextWord = false;
        lastActivityTime = Date.now();
    }

    // مقدمة
    if (command === "تفكيك") {
        await sock.sendMessage(jid, {
            text: `*┊ فعالية التفكيك ┊*

✂️═══════✂️
الشرح:
\`يقوم البوت بإرسال كلمة ويجب على أحد المشاركين أن يرسلها بشكل مفكك\`

\`مثال:\`
ناروتو = ن ا ر و ت و

آلَفــــــائـــز يــربــح: ┊*30 $*💰┊`
        });
    } else if (command === "كتابة") {
        await sock.sendMessage(jid, {
            text: `✍️*فعالية الكتابة*
_*الشرح:*_
\`يقوم البوت بإرسال كلمة ويجب على أي شخص ان يرسل نفسها بالضبط\`

آلَـــ💰ـــجَــآئــزة: 20$`
        });
    } else if (command === "اعلام") {
        await sock.sendMessage(jid, {
            text: `🏳️*فعالية الاعلام*🏴
\`يرسل البوت اسم علم دولة وأي شخص يرسل ايموجي علم لاسم الدولة المذكور\`

آلَـــ💰ـــجَــآئــزة: 35$`
        });
    } else if (command === "ايموجي") {
        await sock.sendMessage(jid, {
            text: `🍎_*فعالية الإيموجي*_🙂
يرسل البوت اسم ايموجي ويجب على أي مشارك أن يرسل الإيموجي الذي يتناسق مع الاسم الذي يرسله البوت

آلَـــ💰ـــجَــآئــزة: 30$`
        });
    }

    activeGames[jid] = { gameEnded: false, isPaused: false, sendNewChallenge, stopGame };

    gameMessageListener = async (mObj) => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused || isWaitingNextWord) return;
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

            const userNumber = cleanNumber(String(userSender).split("@")[0]);
            const safeJid = buildSafeMention(userSender) || `${userNumber}@s.whatsapp.net`;

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

            if (currentChallengeObj && normalizeText(txt) === currentChallengeObj.target) {
                isWaitingNextWord = true;
                userScores[userNumber] = (userScores[userNumber] || 0) + 1;
                const currentScore = userScores[userNumber];

                if (currentScore >= 10) {
                    stopGame();

                    await sock.sendMessage(jid, {
                        text: `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳 @${userNumber}
━━━━━━✦❘༻👑༺❘✦━━━━━━`,
                        mentions: [safeJid]
                    });

                    db.users = db.users && typeof db.users === "object" ? db.users : {};

                    if (db.users[userNumber]) {
                        const user = db.users[userNumber];
                        user.balance = Number(user.balance) || 0;
                        user.balance += prizeAmount;
                        if (typeof saveDb === "function") saveDb();
                    }

                    const depositMsg = `👑◈═══『 إيداع 』═══◈👑
@${userNumber}
السبب: فاز بالفعالية
💰 المبلغ: [${prizeAmount}]
تم إضافة رصيدك للبنك يمكنك الذهاب والتحقق✅

👑◈════════════◈👑`;

                    await sock.sendMessage(jid, { text: depositMsg, mentions: [safeJid] });

                    const winnerUser = db.users?.[userNumber];
                    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || userNumber;

                    const adMessage = `_*█ إنــتــهــت █*_

◇🎮 نـــــــوع الفعالية:
*{${command}}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                    if (db.adsGroups && typeof db.adsGroups === "object") {
                        for (const adJid of Object.keys(db.adsGroups)) {
                            if (!db.adsGroups[adJid]) continue;
                            try { await sock.sendMessage(adJid, { text: adMessage }); } catch (_) {}
                        }
                    }
                    return;
                }

                await sock.sendMessage(jid, {
                    text: `✅ إجابة صحيحة ✅
اجاباتك: { \`${currentScore}\` }
الهدف حتى الفوز: { _*10*_ }.`
                }, { quoted: incomingMsg });

                if (nextChallengeTimer) clearTimeout(nextChallengeTimer);

                nextChallengeTimer = setTimeout(async () => {
                    nextChallengeTimer = null;
                    if (gameEnded || activeGames[jid]?.isPaused) return;
                    try { await sendNewChallenge(); }
                    catch (error) { console.error("❌ فشل إرسال التحدي التالي:", error?.message); stopGame(); }
                }, 4000);
                return;
            }

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

        } catch (error) {
            console.error("❌ خطأ في Listener الفعالية:", error?.stack || error?.message);
        }
    };

    sock.ev.on("messages.upsert", gameMessageListener);

    noAnswerInterval = setInterval(async () => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused) return;
            noAnswerSeconds += 5;

            if (noAnswerSeconds === 30) {
                await sock.sendMessage(jid, { text: "🕰 إنتهى الوقت المحدد 30ث ⌛" });
                await sendNewChallenge();
                return;
            }

            if (noAnswerSeconds >= 52) {
                stopGame();
                await sock.sendMessage(jid, {
                    text: `╗═══════❌══════╔
  إن لم يكن هناك نشاط ومشاركة
   ستتم عملية إيقاف الفعالية
╝═══════❌══════╝`
                });
            }
        } catch (error) {
            console.error("❌ خطأ في مؤقت الفعالية:", error?.message);
        }
    }, 5000);

    inactiveInterval = setInterval(async () => {
        try {
            if (gameEnded) { clearInterval(inactiveInterval); inactiveInterval = null; return; }
            if (Date.now() - lastActivityTime > 3 * 60 * 1000) {
                stopGame();
                await sock.sendMessage(jid, { text: "⚠️ تم إيقاف الفعالية تلقائياً بسبب الخمول." });
            }
        } catch (error) {
            console.error("❌ خطأ في مؤقت الخمول:", error?.message);
        }
    }, 60000);

    try {
        await sendNewChallenge();
    } catch (error) {
        console.error("❌ فشل بدء الفعالية:", error?.message);
        stopGame();
        return false;
    }

    return true;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    activeGames,
    handleGameCommand,
    normalizeText,
    showLoading,
    startColorsGame,
    colorsList,
    LOADING_STAGES,
    GAMES_MENU_ITEMS
};