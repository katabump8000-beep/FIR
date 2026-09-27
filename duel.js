// ============================================================
// duel.js
// ALJESAT BOT
// أنظمة الكازينو: الروليت + الكريستال + اتبع حدسك
// نسخة محدّثة: إصلاح فتح الشات + دعم LID + تفاعل ✅
// ============================================================

"use strict";

// ⭐ دوال LID
const { cleanNumber, buildSafeMention } = require("./bot");

// ============================================================
// الحالة النشطة
// ============================================================

const activeCasinos = Object.create(null);
const activeGuessGames = Object.create(null);

// ============================================================
// إعدادات عامة
// ============================================================

const CRYSTAL_PLAYER_COOLDOWN = 5 * 60 * 1000;
const CRYSTAL_GROUP_COOLDOWN = 30 * 1000;
const MIN_BET = 1;
const MAX_BET = 500;
const MAX_ROULETTE_PLAYERS = 20;
const ROULETTE_COOLDOWN = 10 * 60 * 1000;
const MAX_GUESS_PLAYERS = 7;
const GUESS_COOLDOWN = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

function getBalance(db, jid) {
    const user = getUser(db, jid);
    const balance = Number(user?.balance);
    return Number.isFinite(balance) ? balance : 0;
}

function hasNickname(db, jid) {
    const user = getUser(db, jid);
    return Boolean(user && String(user.nickname || "").trim());
}

function getUserNickname(db, jid) {
    const user = getUser(db, jid);
    return (user && String(user.nickname || "").trim()) || "مجهول";
}

function ensureUser(db, jid) {
    db.users = db.users || {};
    if (!db.users[jid] || typeof db.users[jid] !== "object") {
        db.users[jid] = { nickname: "", balance: 0, rank: "", maxInteraction: 0 };
    }
    if (!Number.isFinite(Number(db.users[jid].balance))) db.users[jid].balance = 0;
    if (typeof db.users[jid].nickname !== "string") db.users[jid].nickname = "";
    return db.users[jid];
}

function parseBet(parts) {
    if (!Array.isArray(parts) || !parts.length) return 0;
    const raw = String(parts[0]).replace(/[,$]/g, "").trim();
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.floor(amount);
}

function isSarahaActive(jid) {
    try {
        const { activeSaraha } = require("./saraha");
        return Boolean(activeSaraha[jid] && activeSaraha[jid].isActive);
    } catch { return false; }
}

// ============================================================
// إيموجيات عشوائية
// ============================================================

const RANDOM_EMOJIS = ["🔴", "🔵", "🟠", "🟡", "🟤", "🟣", "🟢", "⚫"];

function getRandomEmoji() {
    return RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
}

// ============================================================
// الكريستال
// ============================================================

const CRYSTAL_PATTERNS = [
    { pattern: ["♦️","♦️","♦️","♦️"], result: "win", multiplier: 2, weight: 5 },
    { pattern: ["⭐","⭐","⭐","⭐"], result: "win", multiplier: 1.3, weight: 9 },
    { pattern: ["💎","💎","💎","♦️"], result: "win", multiplier: 2.3, weight: 3 },
    { pattern: ["♦️","⭐","⭐","⭐"], result: "win", multiplier: 1.5, weight: 8 },
    { pattern: ["💎","♦️","💎","⭐"], result: "win", multiplier: 2, weight: 4 },
    { pattern: ["💎","💎","💎","💎"], result: "win", multiplier: 3, weight: 5 },
    { pattern: ["💠","💠","💠","💠"], result: "win", multiplier: 5, weight: 0.8 },
    { pattern: ["💣","💣","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["⭐","💣","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","♦️","⭐","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","♦️","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","💣","💎","💣"], result: "lose", weight: 6.5 },
    { pattern: ["♦️","⭐","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["♦️","⭐","💎","💣"], result: "retry", weight: 5 },
    { pattern: ["💠","♦️","⭐","💣"], result: "retry", weight: 5 }
];

const TOTAL_WEIGHT = CRYSTAL_PATTERNS.reduce((sum, p) => sum + p.weight, 0);

function getWeightedCrystalPattern() {
    const rand = Math.random() * TOTAL_WEIGHT;
    let cumulative = 0;
    for (const pattern of CRYSTAL_PATTERNS) {
        cumulative += pattern.weight;
        if (rand <= cumulative) return pattern;
    }
    return CRYSTAL_PATTERNS[0];
}

function generateCrystalCombo() {
    const p = getWeightedCrystalPattern();
    return { combo: [...p.pattern], result: p.result, multiplier: p.multiplier || 0 };
}

function checkCrystalResult(combo) {
    if (!Array.isArray(combo) || combo.length !== 4) return { result: "retry" };
    for (const pattern of CRYSTAL_PATTERNS) {
        if (combo.every((val, idx) => val === pattern.pattern[idx])) {
            return { result: pattern.result, multiplier: pattern.multiplier || 0 };
        }
    }
    return { result: "retry" };
}

function crystalDisplay(combo, betAmount = null) {
    if (!Array.isArray(combo) || combo.length !== 4) {
        return `*❉▬▬▬▬🎰▬▬▬▬❉*\n  💎    💎    💎    💎\n*✥▬▬▬▬🎰▬▬▬▬✥*`;
    }
    let header = betAmount ? `*الرهان:* \`${betAmount}$\`\n` : "";
    header += `*❉▬▬▬▬🎰▬▬▬▬❉*`;
    return `${header}\n  ${combo[0]}    ${combo[1]}    ${combo[2]}    ${combo[3]}\n*✥▬▬▬▬🎰▬▬▬▬✥*`;
}

function crystalGameBlocked() {
    return `*❉▬▬▬▬▬⚠️▬▬▬▬▬❉*\n   *عذرا هناك العاب أخرى تجري*\n*✥▬▬▬▬▬⛔▬▬▬▬▬✥*`;
}

async function sendCrystalWinAd(sock, db, cleanSender, sender, amount) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;
    const date = new Date();
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    const startTimeFormatted = `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
    const winnerUser = db.users?.[cleanSender];
    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || cleanSender;

    const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{كريستال}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${amount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, { text: adMessage });
    }
}

async function sendCrystalLossAd(sock, db, cleanSender, sender, amount) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;
    const loserUser = db.users?.[cleanSender];
    const loserNickname = (loserUser && String(loserUser.nickname || "").trim()) || cleanSender;
    const lossMessage = `╗══════💔══════╔
اللاعب *${loserNickname}* خسر في
لعبة الكرستال بمبلغ يبلغ قيمته:
﴿ ${amount} ﴾
╝══════💔══════╚`;
    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, { text: lossMessage });
    }
}

async function spinCrystal(sock, jid, msgId, betAmount) {
    const rounds = 6;
    let finalCombo = null;
    let finalResult = null;
    for (let i = 0; i < rounds; i++) {
        await sleep(700);
        const p = getWeightedCrystalPattern();
        await safeSend(sock, jid, { text: crystalDisplay(p.pattern, betAmount), edit: msgId });
        if (i === rounds - 1) {
            finalCombo = p.pattern;
            finalResult = p;
        }
    }
    return {
        combo: finalCombo,
        result: finalResult ? {
            result: finalResult.result,
            multiplier: finalResult.multiplier || 0
        } : { result: "retry" }
    };
}

async function startCrystal(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner, parts) {
    try {
        if (isSarahaActive(jid)) {
            await safeSend(sock, jid, { text: "⚠️ لا يمكن بدء الكريستال أثناء وجود لعبة صراحة نشطة." }, { quoted: msg });
            return false;
        }

        const senderNumber = cleanNumber(cleanSender);
        if (!senderNumber) {
            await safeSend(sock, jid, { text: "❌ حدث خطأ في التعرف على رقمك." }, { quoted: msg });
            return false;
        }

        db.users = db.users || {};
        db.crystalCooldown = db.crystalCooldown || {};
        db.crystalPlayerCooldown = db.crystalPlayerCooldown || {};

        if (activeCasinos[jid] || activeGuessGames[jid]) {
            await safeSend(sock, jid, { text: crystalGameBlocked() }, { quoted: msg });
            return false;
        }

        if (!hasNickname(db, senderNumber)) {
            await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل." }, { quoted: msg });
            return false;
        }

        const betAmount = parseBet(parts);
        if (betAmount < MIN_BET) {
            await safeSend(sock, jid, { text: `⚠️ يرجى تحديد مبلغ صحيح، مثل: .الكرستال 50` }, { quoted: msg });
            return false;
        }
        if (betAmount > MAX_BET) {
            await safeSend(sock, jid, { text: `⚠️ الحد الأقصى للرهان هو ${MAX_BET}$.` }, { quoted: msg });
            return false;
        }

        const balance = getBalance(db, senderNumber);
        if (balance < betAmount) {
            await safeSend(sock, jid, { text: `⚠️ رصيدك غير كافي. رصيدك الحالي: ${balance}$` }, { quoted: msg });
            return false;
        }

        const now = Date.now();
        const lastPlayerGame = Number(db.crystalPlayerCooldown[senderNumber]) || 0;
        const playerElapsed = now - lastPlayerGame;
        if (lastPlayerGame > 0 && playerElapsed < CRYSTAL_PLAYER_COOLDOWN) {
            const remainingMin = Math.ceil((CRYSTAL_PLAYER_COOLDOWN - playerElapsed) / 60000);
            await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
            return false;
        }

        const lastGroupGame = Number(db.crystalCooldown[jid]) || 0;
        const groupElapsed = now - lastGroupGame;
        if (lastGroupGame > 0 && groupElapsed < CRYSTAL_GROUP_COOLDOWN) {
            const remainingSec = Math.ceil((CRYSTAL_GROUP_COOLDOWN - groupElapsed) / 1000);
            await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingSec} ثوانٍ.` }, { quoted: msg });
            return false;
        }

        const user = ensureUser(db, senderNumber);
        user.balance = Number(user.balance) || 0;
        if (user.balance < betAmount) {
            await safeSend(sock, jid, { text: `⚠️ رصيدك غير كافي. رصيدك الحالي: ${user.balance}$` }, { quoted: msg });
            return false;
        }

        user.balance -= betAmount;
        db.crystalPlayerCooldown[senderNumber] = now;
        db.crystalCooldown[jid] = now;
        saveDb();

        const firstPattern = getWeightedCrystalPattern();
        const startMessage = crystalDisplay(firstPattern.pattern, betAmount);
        const sent = await sock.sendMessage(jid, { text: startMessage });

        if (!sent || !sent.key) {
            user.balance += betAmount;
            saveDb();
            await safeSend(sock, jid, { text: "❌ حدث خطأ في بدء اللعبة." }, { quoted: msg });
            return false;
        }

        const msgId = sent.key;
        const round = await spinCrystal(sock, jid, msgId, betAmount);
        const finalCombo = round.combo;
        const finalResult = round.result;

        if (finalResult.result === "win") {
            const multiplier = Number(finalResult.multiplier) || 1;
            const winAmount = Math.max(0, Math.round(betAmount * multiplier));
            user.balance += winAmount;
            saveDb();

            const resultMessage = `${crystalDisplay(finalCombo, betAmount)}\n\n🎉 *ربحت!* 🎉\n💰 المبلغ: ${winAmount}$ (×${multiplier})`;
            await safeSend(sock, jid, { text: resultMessage, edit: msgId });
            await sendCrystalWinAd(sock, db, senderNumber, sender, winAmount);
            return true;
        }

        if (finalResult.result === "lose") {
            saveDb();
            const resultMessage = `${crystalDisplay(finalCombo, betAmount)}\n\n💔 *خسرت!* 💔\n💰 تم خصم: ${betAmount}$`;
            await safeSend(sock, jid, { text: resultMessage, edit: msgId });
            await sendCrystalLossAd(sock, db, senderNumber, sender, betAmount);
            return true;
        }

        user.balance += betAmount;
        saveDb();
        const retryResult = `${crystalDisplay(finalCombo, betAmount)}\n\n🔃 لا يوجد خسارة او ربح 🔃\n💰 تم إرجاع المبلغ: ${betAmount}$`;
        await safeSend(sock, jid, { text: retryResult, edit: msgId });
        return true;

    } catch (error) {
        console.error("❌ خطأ في startCrystal:", error?.message || error);
        return false;
    }
}

// ============================================================
// الروليت
// ============================================================

async function startRoulette(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner) {
    if (isSarahaActive(jid)) {
        await safeSend(sock, jid, { text: "⚠️ لا يمكن بدء الروليت أثناء وجود لعبة صراحة نشطة." }, { quoted: msg });
        return false;
    }

    const senderNumber = cleanNumber(cleanSender);
    if (!senderNumber) {
        await safeSend(sock, jid, { text: "❌ حدث خطأ في التعرف على رقمك." }, { quoted: msg });
        return false;
    }

    const now = Date.now();
    db.rouletteCooldown = db.rouletteCooldown || {};
    const lastRoulette = Number(db.rouletteCooldown[jid]) || 0;
    if (lastRoulette > 0 && (now - lastRoulette) < ROULETTE_COOLDOWN) {
        const remainingMin = Math.ceil((ROULETTE_COOLDOWN - (now - lastRoulette)) / 60000);
        await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
        return false;
    }

    if (activeCasinos[jid] || activeGuessGames[jid]) {
        await safeSend(sock, jid, { text: "⚠️ هناك فعالية قائمة بالفعل!" }, { quoted: msg });
        return false;
    }

    db.users = db.users || {};
    if (!hasNickname(db, senderNumber)) {
        await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل." }, { quoted: msg });
        return false;
    }

    const user = getUser(db, senderNumber);
    activeCasinos[jid] = {
        creator: senderNumber,
        creatorJid: sender,
        creatorNickname: user?.nickname || "",
        bets: {},
        started: false,
        playersMsgId: null,
        gameMsgId: null,
        resultMsgId: null,
        type: "roulette",
        startTime: Date.now(),
        allowOthersToStart: false,
        maxPlayers: MAX_ROULETTE_PLAYERS,
        stopGame: null
    };

    const casinoIntro = `╮─❖『 الرهانات 』❖─╭

شرح الفعالية:

فعالية تعتمد على الحظ، إما تربح أو تخسر 🎲

يجب أن يمتلك المشارك رصيدًا ويضع رهانًا.

بعد وضع أول رهان، ينتظر صاحب رهان آخر بنفس القيمة أو أعلى بشرط ألا يتجاوز رصيد صاحب الفعالية.

كل شخص يملك 🎈🎈🎈 بالونات بحيث إذا وقع الحظ عليه ستفقع البالونة 💥 وعندما تفقع كل بالوناته يخسر رهانه، لكن إذا صمدت بالوناته يربح.

مثال:
ناغي كتب .رهان 100

بعد اكتمال الرهانات، يختار منشئ الفعالية:

.بدأ الرهان ➜ تبدأ اللعبة.

.انسحاب ➜ تلغى الفعالية.

الفائز يحصل على مجموع كل الرهانات.

╰─❖『 بالتوفيق 🍀 』❖─╯`;

    await safeSend(sock, jid, { text: casinoIntro }, { quoted: msg });
    return true;
}

function buildRoulettePlayersList(casino) {
    const players = Object.keys(casino.bets || {});
    let text = "╗══════المشاركون══════╔\n";
    const activePlayers = [];
    const eliminatedPlayers = [];
    for (const number of players) {
        const player = casino.bets[number];
        const lives = Number(player.lives) || 0;
        if (lives <= 0) eliminatedPlayers.push({ number, player });
        else activePlayers.push({ number, player });
    }
    let index = 0;
    for (const { player } of activePlayers) {
        const lives = Number(player.lives) || 3;
        const display = lives >= 3 ? "🎈🎈🎈" : lives === 2 ? "🎈🎈💥" : lives === 1 ? "🎈💥💥" : "☠️☠️☠️";
        text += `${index + 1}. \`${player.nickname}\` ${display}\n`;
        index++;
    }
    for (const { player } of eliminatedPlayers) {
        text += `${index + 1}. \`${player.nickname}\` ☠️☠️☠️\n`;
        index++;
    }
    for (let i = index; i < 8; i++) text += `${i + 1}. [مقعد فارغ]\n`;
    text += "╝═════════════════╚";
    return text;
}

function getRouletteDropMessage(nickname, emoji) {
    return `╗═════════🔪═════════╔\nًسًــــيــــنزل الدبــ📍ــوس على بالــ🎈ـون:\n        ${emoji} \`${nickname}\` ${emoji}\n╝═════════🎰═════════╚`;
}

function getRouletteResultMessage(nickname, emoji) {
    return `╗═════════🔪═════════╔\n  نـــزل الدبــ📍ــوس على بالــ🎈ـون:\n        ${emoji} \`${nickname}\` ${emoji}\n╝═════════🎰═════════╚`;
}

function getRouletteDefaultMessage(emoji) {
    return `╗═════════🔪═════════╔\nًسًــــيــــنزل الدبــ📍ــوس على بالــ🎈ـون:\n        ${emoji} \`لم يحدد بعد\` ${emoji}\n╝═════════🎰═════════╚`;
}

function createRouletteRunner(sock, jid, casino, db) {
    const playersKeys = Object.keys(casino.bets || {});
    let activePlayers = [...playersKeys];
    let running = true;

    const stopRunner = () => { running = false; };

    const runRound = async () => {
        if (!running) return;

        if (activePlayers.length <= 1) {
            const winnerKey = activePlayers[0];
            if (!winnerKey) { delete activeCasinos[jid]; return; }

            const winner = casino.bets[winnerKey];
            let pool = 0;
            for (const key of playersKeys) pool += Number(casino.bets[key]?.amount) || 0;

            const winnerUser = ensureUser(db, winnerKey);
            winnerUser.balance = Number(winnerUser.balance || 0) + pool;
            db.users = db.users || {};
            db.users[winnerKey] = winnerUser;
            if (typeof db.saveDb === "function") db.saveDb();
            else {
                try {
                    const bot = require("./bot");
                    bot.saveDb();
                } catch (_) {}
            }

            try { await sock.groupSettingUpdate(jid, "not_announcement"); } catch (_) {}

            const winnerEmoji = getRandomEmoji();
            if (casino.resultMsgId) {
                await sock.sendMessage(jid, {
                    text: getRouletteResultMessage(winner.nickname, winnerEmoji),
                    edit: casino.resultMsgId
                }).catch(() => {});
            }

            await safeSend(sock, jid, {
                text: `╗═════════════════╔
تم اضافة مجموع الرهان الكامل:
               [\`${pool}$\`]
الى رصيد [${winner.nickname}] بنجاح ✅
╝═════════════════╝`
            });

            const date = new Date();
            const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
            const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            const dateText = `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
            const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerKey;

            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{كازينو - روليت}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${pool}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${dateText}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

            for (const adJid of Object.keys(db.adsGroups || {})) {
                if (!db.adsGroups[adJid]) continue;
                await sock.sendMessage(adJid, { text: adMessage }).catch(() => {});
            }

            try {
                const bot = require("./bot");
                bot.getDb().rouletteCooldown = bot.getDb().rouletteCooldown || {};
                bot.getDb().rouletteCooldown[jid] = Date.now();
                bot.saveDb();
            } catch (_) {}

            delete activeCasinos[jid];
            return;
        }

        const loserIndex = Math.floor(Math.random() * activePlayers.length);
        const loserKey = activePlayers[loserIndex];
        const loser = casino.bets[loserKey];

        if (!loser) {
            activePlayers = activePlayers.filter(key => key !== loserKey);
            setTimeout(runRound, 1000);
            return;
        }

        for (let i = 0; i < 8; i++) {
            if (!running) return;
            const randomKey = activePlayers[Math.floor(Math.random() * activePlayers.length)];
            const randomPlayer = casino.bets[randomKey];
            const randomEmoji = getRandomEmoji();
            if (casino.gameMsgId && randomPlayer) {
                await sock.sendMessage(jid, {
                    text: getRouletteDropMessage(randomPlayer.nickname, randomEmoji),
                    edit: casino.gameMsgId
                }).catch(() => {});
            }
            await sleep(900);
        }

        if (!running) return;
        const resultEmoji = getRandomEmoji();
        if (casino.resultMsgId) {
            await sock.sendMessage(jid, {
                text: getRouletteResultMessage(loser.nickname, resultEmoji),
                edit: casino.resultMsgId
            }).catch(() => {});
        }

        loser.lives = Math.max(0, Number(loser.lives || 0) - 1);

        await sock.sendMessage(jid, {
            text: buildRoulettePlayersList(casino),
            edit: casino.playersMsgId
        }).catch(() => {});

        if (loser.lives <= 0) {
            activePlayers = activePlayers.filter(key => key !== loserKey);
            await safeSend(sock, jid, {
                text: `تم استبعاد المدعو [${loser.nickname}] وسيتم خصم الرهان الذي وضعه من رصيده 🏳`
            });
        }

        const defaultEmoji = getRandomEmoji();
        if (casino.gameMsgId) {
            await sock.sendMessage(jid, {
                text: getRouletteDefaultMessage(defaultEmoji),
                edit: casino.gameMsgId
            }).catch(() => {});
        }

        if (!running) return;
        setTimeout(runRound, 4000);
    };

    return { runRound, stopRunner };
}

async function handleRouletteStart(sock, jid, msg, senderNumber, owner, db) {
    const casino = activeCasinos[jid];
    if (!casino || casino.started || casino.type !== "roulette") return true;

    const players = Object.keys(casino.bets || {});
    if (players.length < 3) {
        await safeSend(sock, jid, { text: "⚠️ يجب أن يكون هناك 3 مشاركين على الأقل." }, { quoted: msg });
        return true;
    }

    const canStart = casino.creator === senderNumber || owner ||
        (Date.now() - Number(casino.startTime || 0)) > 5 * 60 * 1000;

    if (!canStart) {
        await safeSend(sock, jid, { text: "⚠️ منشئ الروليت فقط يمكنه بدء الرهان." }, { quoted: msg });
        return true;
    }

    for (const number of players) {
        const player = casino.bets[number];
        const user = getUser(db, number);
        if (!user || Number(user.balance || 0) < Number(player.amount || 0)) {
            await safeSend(sock, jid, `⚠️ لا يمكن بدء الروليت لأن رصيد [${player.nickname}] غير كافٍ.`, msg);
            return true;
        }
    }

    casino.started = true;
    try { await sock.groupSettingUpdate(jid, "announcement"); } catch (_) {}

    for (const number of players) {
        const player = casino.bets[number];
        const user = ensureUser(db, number);
        user.balance -= Number(player.amount);
    }
    try { require("./bot").saveDb(); } catch (_) {}

    const playersMsg = await sock.sendMessage(jid, { text: buildRoulettePlayersList(casino) });
    casino.playersMsgId = playersMsg?.key || null;

    const defaultEmoji = getRandomEmoji();
    const gameMsg = await sock.sendMessage(jid, { text: getRouletteDefaultMessage(defaultEmoji) });
    casino.gameMsgId = gameMsg?.key || null;

    const resultEmoji = getRandomEmoji();
    const resultMsg = await sock.sendMessage(jid, { text: getRouletteDefaultMessage(resultEmoji) });
    casino.resultMsgId = resultMsg?.key || null;

    const runner = createRouletteRunner(sock, jid, casino, db);
    casino.stopGame = runner.stopRunner;
    setTimeout(runner.runRound, 3000);
    return true;
}

function removeCasino(jid) {
    if (!jid) return false;
    const casino = activeCasinos[jid];
    if (casino) {
        try { if (typeof casino.stopGame === "function") casino.stopGame(); } catch (_) {}
    }
    delete activeCasinos[jid];
    return true;
}

// ============================================================
// ⭐ لعبة اتبع حدسك — مع إصلاح فتح الشات وتفاعل ✅
// ============================================================

const GUESS_BALLS = ["🟢", "🟡", "🔵", "🟣", "🔴", "🟤", "🟠"];

function getGuessStartMessage() {
    return `╗🔵══════شرح═══════🟣╔
 بكل بساطة البوت يرسل كرات ملونة
ويجب على كل عضو ان يرسل لون كرة
يشك بأنها الكرة الفائزة... لو ارسل 
كرة ولم تكن هي الفائزة سيتم خصم
الرهان الذي يضعه من رصيده....  
\`للمشاركة اكتب:\` .مشاركة او .اشارك
مثلا:  .مشاركة 50
ملاحظة:  هناك كرة واحد رابحة من بين الكرات التي عددها على نفس
عدد المشاركين... 
╝🟡════════════════🟢╚`;
}

function getGuessJoinMessage(nickname, amount) {
    return `✅ تم تسجيل مشاركة [${nickname}] بمبلغ \`${amount}$\``;
}

function getGuessBallsDisplay(balls) {
    let line = "◆━─━─━─⊱⊰─━─━─━◆\n          ";
    line += balls.join(" ");
    line += "\n◆━─━─━─⊱⊰─━─━─━◆";
    return line;
}

function getGuessChooseMessage() {
    return "✧سيتم فتح الشات بعد 20ث... يرجى ارسال لون الكرة التي تعتقد انها الفائزة وعندما تصيب سيتم إضافة رهان الجميع الى رصيدك✧";
}

function getGuessOpenMessage() {
    return `◆━─━─━─⊱⚫⊰─━─━─━◆\n تفضلوا وارسلو كرات حدسكم: \n◆━─━─━─⊱⚪⊰─━─━─━◆`;
}

function getGuessChooseConfirm() {
    return "√ `تم تسجيل اختيارك` √";
}

function getGuessRemovedMessage(userNumber) {
    return `◆━─━─━─⊱⊰─━─━─━◆
تم استبعاد @${userNumber}
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getGuessResultMessage(ball) {
    return `⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫
 \`الكرة الصحيحة هي:\`
       
            *☜ ${ball} ☞*

⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫`;
}

function getGuessNoWinnerMessage() {
    return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
 الشخص الذي اصاب حدسه: 
  \`جدي\`...  ههه امزح ولا واحد 
  منكم = كلكم مخطئين 🙂😂
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
}

function getGuessSingleWinnerMessage(nickname, amount) {
    return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
 الشخص الذي اصاب حدسه: 
 \`${nickname}\`
تم إضافة الرصيد: \`${amount}\`
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
}

function getGuessMultiWinnerMessage(winners) {
    let text = `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙\n الشخص الذي اصاب حدسه: \n`;
    winners.forEach((w, i) => {
        text += `${i + 1} \`${w.nickname}\` او: @${w.number}\n`;
    });
    text += `تم إضافة الرصيد: \`${winners[0]?.total || 0}\`\n`;
    winners.forEach(w => { text += `\`${w.nickname}\`: *${w.amount}*\n`; });
    text += `🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
    return text;
}

function getGuessNeedThirdMessage(creatorNumber) {
    return `◆━─━─━─⊱⊰─━─━─━◆
ايها المنشئ @${creatorNumber}
 ارجوك قم بالغاء الفعالية 
لانه لم يتم العثور على مشارك
ثالث..  ارسل:  .وقف
لإيقاف هذه الفعالية او يجب 
على مشارك ثالث المشاركة وان
لم تغلقها او تكملوها سيتم ايقافها
بعد 75 ثانية وشكرا لكم 🔥
◆━─━─━─⊱⊰─━─━─━◆`;
}

async function handleGuessStart(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner) {
    try {
        if (isSarahaActive(jid)) {
            await safeSend(sock, jid, { text: "⚠️ لا يمكن بدء اللعبة أثناء وجود لعبة صراحة نشطة." }, { quoted: msg });
            return false;
        }

        const senderNumber = cleanNumber(cleanSender);
        if (!senderNumber) {
            await safeSend(sock, jid, { text: "❌ حدث خطأ في التعرف على رقمك." }, { quoted: msg });
            return false;
        }

        if (activeGuessGames[jid] || activeCasinos[jid]) {
            await safeSend(sock, jid, { text: "⚠️ هناك فعالية قائمة بالفعل!" }, { quoted: msg });
            return false;
        }

        if (!hasNickname(db, senderNumber)) {
            await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل." }, { quoted: msg });
            return false;
        }

        db.users = db.users || {};
        db.guessCooldown = db.guessCooldown || {};
        const now = Date.now();
        const lastGuess = Number(db.guessCooldown[jid]) || 0;
        if (lastGuess > 0 && (now - lastGuess) < GUESS_COOLDOWN) {
            const remainingMin = Math.ceil((GUESS_COOLDOWN - (now - lastGuess)) / 60000);
            await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقائق.` }, { quoted: msg });
            return false;
        }

        db.guessCooldown[jid] = now;
        saveDb();

        // عرض التحميل
        const { LOADING_STAGES } = require("./menu");
        if (LOADING_STAGES) {
            let loadingMsg = await safeSend(sock, jid, { text: LOADING_STAGES[0] }, { quoted: msg });
            if (loadingMsg) {
                for (let i = 1; i < LOADING_STAGES.length; i++) {
                    await sleep(1000);
                    await safeSend(sock, jid, { text: LOADING_STAGES[i], edit: loadingMsg.key });
                }
            }
        }

        const gameState = {
            creator: senderNumber,
            creatorJid: sender,
            players: {},
            started: false,
            finished: false,
            guessedBalls: {},
            winningBall: null,
            ballsDisplayed: [],
            startTime: Date.now(),
            lastActivity: Date.now(),
            isActive: true,
            phase: "joining",
            timers: { joinWait: null, chooseWait: null, reminder: null, autoStop: null },
            listener: null,
            stopGame: function() {
                this.isActive = false;
                for (const t of Object.values(this.timers)) {
                    if (t) clearTimeout(t);
                }
                if (this.listener) {
                    try { sock.ev.off("messages.upsert", this.listener); } catch (_) {}
                    this.listener = null;
                }
                delete activeGuessGames[jid];
            }
        };

        activeGuessGames[jid] = gameState;

        await safeSend(sock, jid, { text: getGuessStartMessage() }, { quoted: msg });

        // timer: 3 دقائق - إن لم يوجد 3 مشاركين
        gameState.timers.joinWait = setTimeout(async () => {
            if (!gameState.isActive || gameState.started) return;
            const playerCount = Object.keys(gameState.players).length;
            if (playerCount < 3) {
                await safeSend(sock, jid, {
                    text: getGuessNeedThirdMessage(senderNumber),
                    mentions: [buildSafeMention(sender) || `${senderNumber}@s.whatsapp.net`]
                });

                // إيقاف تلقائي بعد 75 ثانية
                gameState.timers.autoStop = setTimeout(async () => {
                    if (!gameState.isActive || gameState.started) return;
                    const pc = Object.keys(gameState.players).length;
                    if (pc < 3) {
                        for (const num of Object.keys(gameState.players)) {
                            const u = ensureUser(db, num);
                            u.balance = Number(u.balance || 0) + Number(gameState.players[num].amount || 0);
                        }
                        saveDb();
                        gameState.stopGame();
                        await safeSend(sock, jid, { text: "🚫 تم إيقاف الفعالية لعدم اكتمال المشاركين." });
                    }
                }, 75 * 1000);
            }
        }, 3 * 60 * 1000);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessStart:", error?.message || error);
        return false;
    }
}

async function handleGuessJoin(sock, jid, msg, cleanSender, parts, db, saveDb) {
    try {
        const game = activeGuessGames[jid];
        if (!game || !game.isActive || game.started) {
            await safeSend(sock, jid, { text: "⚠️ لا توجد لعبة اتبع حدسك مفتوحة للمشاركة." }, { quoted: msg });
            return true;
        }

        const senderNumber = cleanNumber(cleanSender);
        if (game.players[senderNumber]) {
            await safeSend(sock, jid, { text: "⚠️ انت مسجل بالفعل في اللعبة!" }, { quoted: msg });
            return true;
        }

        const playerCount = Object.keys(game.players).length;
        if (playerCount >= MAX_GUESS_PLAYERS) {
            await safeSend(sock, jid, { text: `⚠️ اكتمل العدد الأقصى (${MAX_GUESS_PLAYERS} لاعبين).` }, { quoted: msg });
            return true;
        }

        const user = getUser(db, senderNumber);
        if (!user || !String(user.nickname || "").trim()) {
            await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل." }, { quoted: msg });
            return true;
        }

        const amount = parseBet(parts);
        if (!amount) {
            await safeSend(sock, jid, { text: "⚠️ الاستخدام: .مشاركة (المبلغ)\nمثال: .مشاركة 50" }, { quoted: msg });
            return true;
        }

        const balance = Number(user.balance) || 0;
        if (balance < amount) {
            await safeSend(sock, jid, { text: `⚠️ رصيدك غير كافي. رصيدك: ${balance}$` }, { quoted: msg });
            return true;
        }

        const u = ensureUser(db, senderNumber);
        u.balance = balance - amount;

        game.players[senderNumber] = {
            nickname: user.nickname,
            amount: amount,
            jid: `${senderNumber}@s.whatsapp.net`
        };
        game.lastActivity = Date.now();
        saveDb();

        await safeSend(sock, jid, {
            text: getGuessJoinMessage(user.nickname, amount),
            mentions: [`${senderNumber}@s.whatsapp.net`]
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessJoin:", error?.message || error);
        return false;
    }
}

async function handleGuessRun(sock, jid, msg, senderNumber, owner, db, saveDb) {
    try {
        const game = activeGuessGames[jid];
        if (!game || !game.isActive) return true;
        if (game.started) {
            await safeSend(sock, jid, { text: "⚠️ اللعبة بدأت بالفعل!" }, { quoted: msg });
            return true;
        }

        const isCreator = game.creator === senderNumber;
        if (!isCreator && !owner) {
            await safeSend(sock, jid, { text: "⚠️ منشئ الفعالية فقط يمكنه البدء." }, { quoted: msg });
            return true;
        }

        const playerCount = Object.keys(game.players).length;
        if (playerCount < 3) {
            await safeSend(sock, jid, { text: "⚠️ يجب أن يكون هناك 3 مشاركين على الأقل." }, { quoted: msg });
            return true;
        }

        game.started = true;
        game.phase = "choosing";
        if (game.timers.joinWait) clearTimeout(game.timers.joinWait);
        if (game.timers.autoStop) clearTimeout(game.timers.autoStop);

        // ⭐ إغلاق الشات
        try { await sock.groupSettingUpdate(jid, "announcement"); } catch (_) {}

        // اختيار الكرات
        const shuffledBalls = [...GUESS_BALLS].sort(() => Math.random() - 0.5);
        const selectedBalls = shuffledBalls.slice(0, playerCount);
        game.ballsDisplayed = selectedBalls;
        game.winningBall = selectedBalls[Math.floor(Math.random() * selectedBalls.length)];

        await safeSend(sock, jid, { text: "`ايها المشاركين الحقو حدسكم:`" });
        await safeSend(sock, jid, { text: getGuessBallsDisplay(selectedBalls) });
        await safeSend(sock, jid, { text: getGuessChooseMessage() });

        // ⭐ بعد 20 ثانية: افتح الشات
        game.timers.chooseWait = setTimeout(async () => {
            if (!game.isActive) return;
            game.phase = "waiting";

            // ⭐ فتح الشات
            try { await sock.groupSettingUpdate(jid, "not_announcement"); } catch (_) {}

            await safeSend(sock, jid, { text: getGuessOpenMessage() });

            // مستمع للاختيارات
            const listener = async (mObj) => {
                try {
                    if (!game.isActive || game.finished) return;
                    if (!mObj?.messages?.length) return;
                    const incomingMsg = mObj.messages[0];
                    if (!incomingMsg?.message) return;
                    if (incomingMsg.key?.remoteJid !== jid) return;
                    if (incomingMsg.key?.fromMe) return;

                    // ⭐ دعم LID
                    const userSender =
                        incomingMsg.key?.participantPn ||
                        incomingMsg.key?.participant_pn ||
                        incomingMsg.key?.senderPn ||
                        incomingMsg.key?.participant ||
                        incomingMsg.key?.remoteJid;
                    if (!userSender) return;

                    const userNum = cleanNumber(String(userSender).split("@")[0]);
                    if (!game.players[userNum]) return;
                    if (game.guessedBalls[userNum]) return;

                    const txt = (incomingMsg.message?.conversation ||
                                 incomingMsg.message?.extendedTextMessage?.text || "").trim();
                    if (!txt) return;

                    // ⭐ فحص إذا كانت الكرة صحيحة
                    const cleanedTxt = txt.trim();
                    if (game.ballsDisplayed.includes(cleanedTxt)) {
                        game.guessedBalls[userNum] = cleanedTxt;
                        game.lastActivity = Date.now();

                        // ⭐ تفاعل ✅ على رسالته
                        try {
                            await sock.sendMessage(jid, {
                                react: { text: "✅", key: incomingMsg.key }
                            });
                        } catch (_) {}

                        // كل المشاركين اختاروا؟
                        const totalGuessed = Object.keys(game.guessedBalls).length;
                        const totalPlayers = Object.keys(game.players).length;

                        if (totalGuessed >= totalPlayers) {
                            if (game.timers.reminder) clearTimeout(game.timers.reminder);
                            if (game.timers.chooseWait) clearTimeout(game.timers.chooseWait);
                            try { sock.ev.off("messages.upsert", listener); } catch (_) {}
                            game.listener = null;
                            await finishGuessGame(sock, jid, db, saveDb, game);
                        }
                    }
                } catch (e) { console.error("guess listener:", e?.message); }
            };

            sock.ev.on("messages.upsert", listener);
            game.listener = listener;

            // تذكير للذين لم يختاروا
            game.timers.reminder = setTimeout(async () => {
                if (!game.isActive || game.finished) return;
                const pending = Object.keys(game.players).filter(n => !game.guessedBalls[n]);
                if (pending.length > 0) {
                    for (const num of pending) {
                        await safeSend(sock, jid, {
                            text: getGuessRemovedMessage(num),
                            mentions: [`${num}@s.whatsapp.net`]
                        });
                        delete game.players[num];
                    }
                }
                if (game.timers.chooseWait) clearTimeout(game.timers.chooseWait);
                if (game.listener) {
                    try { sock.ev.off("messages.upsert", game.listener); } catch (_) {}
                    game.listener = null;
                }
                if (!game.finished) await finishGuessGame(sock, jid, db, saveDb, game);
            }, 90 * 1000);
        }, 20 * 1000);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessRun:", error?.message || error);
        return false;
    }
}

async function finishGuessGame(sock, jid, db, saveDb, game) {
    if (game.finished) return;
    game.finished = true;
    game.phase = "ended";

    const winningBall = game.winningBall;

    // ⭐ إغلاق الشات
    try { await sock.groupSettingUpdate(jid, "announcement"); } catch (_) {}

    // أعلن الكرة الفائزة بعد 5 ثواني
    await sleep(5000);
    await safeSend(sock, jid, { text: getGuessResultMessage(winningBall) });

    // إيجاد الفائزين
    const winners = [];
    let totalPool = 0;
    for (const num of Object.keys(game.players)) {
        totalPool += Number(game.players[num].amount) || 0;
        if (game.guessedBalls[num] === winningBall) {
            winners.push({
                number: num,
                nickname: game.players[num].nickname,
                amount: 0
            });
        }
    }

    if (winners.length === 0) {
        await safeSend(sock, jid, { text: getGuessNoWinnerMessage() });
    } else {
        const share = Math.floor(totalPool / winners.length);
        for (const w of winners) {
            const u = ensureUser(db, w.number);
            u.balance = Number(u.balance || 0) + share;
            w.amount = share;
        }
        saveDb();

        if (winners.length === 1) {
            await safeSend(sock, jid, {
                text: getGuessSingleWinnerMessage(winners[0].nickname, share),
                mentions: [`${winners[0].number}@s.whatsapp.net`]
            });
        } else {
            const mentions = winners.map(w => `${w.number}@s.whatsapp.net`);
            await safeSend(sock, jid, {
                text: getGuessMultiWinnerMessage(winners),
                mentions
            });
        }

        // إعلان ADS
        if (db.adsGroups && typeof db.adsGroups === "object") {
            const date = new Date();
            const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
            const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            const dateText = `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
            const winnerNick = winners.map(w => w.nickname).join(" + ");

            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{اتبع حدسك}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${share}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNick}*

◇⏰ بّـــــــدأت:
*{${dateText}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

            for (const adJid of Object.keys(db.adsGroups)) {
                if (!db.adsGroups[adJid]) continue;
                await safeSend(sock, adJid, { text: adMessage });
            }
        }
    }

    // ⭐ فتح الشات مرة أخرى
    try { await sock.groupSettingUpdate(jid, "not_announcement"); } catch (_) {}

    game.stopGame();
}

function isGuessActive(jid) {
    return Boolean(activeGuessGames[jid] && activeGuessGames[jid].isActive);
}

function stopGuessGame(jid) {
    const game = activeGuessGames[jid];
    if (game) {
        try {
            // إعادة الرصيد
            const bot = require("./bot");
            const db = bot.getDb();
            if (db) {
                for (const num of Object.keys(game.players || {})) {
                    const u = db.users?.[num];
                    if (u) u.balance = Number(u.balance || 0) + Number(game.players[num].amount || 0);
                }
                bot.saveDb();
            }
        } catch (_) {}
        game.stopGame();
        try { require("./bot").getDb(); } catch (_) {}
        return true;
    }
    return false;
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeCasinos,
    activeGuessGames,
    startRoulette,
    startCrystal,
    handleRouletteStart,
    generateCrystalCombo,
    checkCrystalResult,
    removeCasino,
    crystalDisplay,
    crystalGameBlocked,
    buildRoulettePlayersList,
    getRouletteDropMessage,
    getRouletteResultMessage,
    getRouletteDefaultMessage,
    getRandomEmoji,
    RANDOM_EMOJIS,
    CRYSTAL_PATTERNS,
    isSarahaActive,
    // اتبع حدسك
    handleGuessStart,
    handleGuessJoin,
    handleGuessRun,
    isGuessActive,
    stopGuessGame,
    GUESS_BALLS
};