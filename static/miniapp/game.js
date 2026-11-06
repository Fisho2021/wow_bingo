const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#b8a8d9'); }
const INIT_DATA = tg?.initData || '';

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA, ...(opts.headers || {}) };
    return (await fetch(path, { ...opts, headers })).json();
}

function getBingoLetter(n) {
    if (n >= 1 && n <= 15) return 'B';
    if (n >= 16 && n <= 30) return 'I';
    if (n >= 31 && n <= 45) return 'N';
    if (n >= 46 && n <= 60) return 'G';
    if (n >= 61 && n <= 75) return 'O';
    return '';
}

// ═══ AMHARIC VOICE ENGINE ═══
let soundOn = true;
let audioUnlocked = false;
let currentAudio = null;

function toggleSound() {
    soundOn = !soundOn;
    document.getElementById('soundVal').textContent = soundOn ? '🔊' : '🔇';

    if (!soundOn && currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
}

document.addEventListener('click', () => {
    if (!audioUnlocked) {
        audioUnlocked = true;
        const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
        silentAudio.play().catch(e => console.log("Audio unlock failed"));
    }
}, { once: true });

const amharicNumbers = {
    1: "አንድ", 2: "ሁለት", 3: "ሶስት", 4: "አራት", 5: "አምስት", 6: "ስድስት", 7: "ሰባት", 8: "ስምንት", 9: "ዘጠኝ", 10: "አስር",
    11: "አስራ አንድ", 12: "አስራ ሁለት", 13: "አስራ ሶስት", 14: "አስራ አራት", 15: "አስራ አምስት", 16: "አስራ ስድስት", 17: "አስራ ሰባት", 18: "አስራ ስምንት", 19: "አስራ ዘጠኝ",
    20: "ሃያ", 21: "ሃያ አንድ", 22: "ሃያ ሁለት", 23: "ሃያ ሶስት", 24: "ሃያ አራት", 25: "ሃያ አምስት", 26: "ሃያ ስድስት", 27: "ሃያ ሰባት", 28: "ሃያ ስምንት", 29: "ሃያ ዘጠኝ",
    30: "ሰላሳ", 31: "ሰላሳ አንድ", 32: "ሰላሳ ሁለት", 33: "ሰላሳ ሶስት", 34: "ሰላሳ አራት", 35: "ሰላሳ አምስት", 36: "ሰላሳ ስድስት", 37: "ሰላሳ ሰባት", 38: "ሰላሳ ስምንት", 39: "ሰላሳ ዘጠኝ",
    40: "አርባ", 41: "አርባ አንድ", 42: "አርባ ሁለት", 43: "አርባ ሶስት", 44: "አርባ አራት", 45: "አርባ አምስት", 46: "አርባ ስድስት", 47: "አርባ ሰባት", 48: "አርባ ስምንት", 49: "አርባ ዘጠኝ",
    50: "ሃምሳ", 51: "ሃምሳ አንድ", 52: "ሃምሳ ሁለት", 53: "ሃምሳ ሶስት", 54: "ሃምሳ አራት", 55: "ሃምሳ አምስት", 56: "ሃምሳ ስድስት", 57: "ሃምሳ ሰባት", 58: "ሃምሳ ስምንት", 59: "ሃምሳ ዘጠኝ",
    60: "ስልሳ", 61: "ስልሳ አንድ", 62: "ስልሳ ሁለት", 63: "ስልሳ ሶስት", 64: "ስልሳ አራት", 65: "ስልሳ አምስት", 66: "ስልሳ ስድስት", 67: "ስልሳ ሰባት", 68: "ስልሳ ስምንት", 69: "ስልሳ ዘጠኝ",
    70: "ሰባ", 71: "ሰባ አንድ", 72: "ሰባ ሁለት", 73: "ሰባ ሶስት", 74: "ሰባ አራት", 75: "ሰባ አምስት"
};

const amharicLetters = { 'B': 'ቢ', 'I': 'አይ', 'N': 'ኤን', 'G': 'ጂ', 'O': 'ኦ' };

function playVoice(text) {
    if (!soundOn) return;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=am&client=tw-ob`;
    currentAudio = new Audio(url);
    currentAudio.playbackRate = 1.3;
    const playPromise = currentAudio.play();
    if (playPromise !== undefined) {
        playPromise.catch(e => console.log("Audio play blocked:", e));
    }
}

function speakNumber(letter, num) {
    if (!soundOn) return;
    const amLetter = amharicLetters[letter] || letter;
    const amNum = amharicNumbers[num] || num;
    playVoice(`${amLetter} ${amNum}`);
}

function speakBingo() {
    if (!soundOn) return;
    playVoice("ቢንጎ!");
}

// ═══ GAME LOGIC ═══
let pollTimer, lastCalledCount = 0, myCartelas = [], hasShownWinModal = false;
let pendingMarks = new Set();
let redirectInterval = null;

async function updateTopBalance() {
    const r = await api('/api/me/');
    if (r.ok) {
        const balEl = document.getElementById('balanceTop');
        if (balEl) balEl.textContent = `💰 ${parseFloat(r.user.balance).toFixed(2)}`;
    }
}

async function refreshGame() {
    try {
        updateTopBalance();
        const r = await api('/api/game/');
        if (!r.ok) return;

        const called = r.round.called_numbers || [];
        const last = called[called.length - 1];

        if (called.length > lastCalledCount && lastCalledCount > 0 && r.round.status === 'active') {
            const letter = getBingoLetter(last);
            speakNumber(letter, last);
            if (soundOn) tg?.HapticFeedback.impactOccurred('light');
        }
        lastCalledCount = called.length;

        document.getElementById('gameId').textContent = r.round.number ? `Y${r.round.number}` : 'Y0';
        document.getElementById('playersVal').textContent = r.round.players;
        document.getElementById('callVal').textContent = called.length;
        document.getElementById('prizeVal').textContent = parseFloat(r.round.prize_pool || 0).toFixed(0);

        if (r.round.players_list && r.round.players_list.length > 0) {
            document.getElementById('playersListText').textContent = "👥 In Game: " + r.round.players_list.join(", ");
        } else {
            document.getElementById('playersListText').textContent = "Players: None";
        }

        if (last) {
            document.getElementById('currentCall').textContent = `${getBingoLetter(last)}-${last}`;
        } else {
            document.getElementById('currentCall').textContent = '-';
        }

        const statusEl = document.getElementById('statusText');
        const cdEl = document.getElementById('countdown');

        if (r.round.status === 'waiting') {
            statusEl.textContent = '⏳ Buy Cartelas';
            if (r.round.start_at) {
                const remain = Math.max(0, Math.round((new Date(r.round.start_at).getTime() - Date.now()) / 1000));
                cdEl.textContent = remain > 0 ? remain + 's' : 'Starting...';
            } else {
                cdEl.textContent = 'Waiting...';
            }
        } else if (r.round.status === 'active') {
            statusEl.textContent = '🎯 Playing...';
            cdEl.textContent = called.length + '/75 called';
        } else if (r.round.status === 'finished') {
            statusEl.textContent = '🏁 Finished';
            cdEl.textContent = 'Wait';

            if (pollTimer) clearInterval(pollTimer);
            if (!hasShownWinModal && r.winners && r.winners.length > 0) {
                hasShownWinModal = true;
                showWinnerModal(r.winners);
            }
        }

        renderCalledGrid(called);
        myCartelas = r.my_cartelas || [];
        renderMyCartelas(called);

    } catch (e) {
        console.error("Refresh error:", e);
    }
}

function renderCalledGrid(called) {
    const calledSet = new Set(called || []);
    const grid = document.getElementById('calledGrid');
    if (!grid) return;
    let html = '';
    for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 5; c++) {
            const n = c * 15 + r + 1;
            html += `<div class="num ${calledSet.has(n) ? 'drawn' : ''}">${n}</div>`;
        }
    }
    grid.innerHTML = html;
}

function renderMyCartelas(called) {
    const calledSet = new Set(called || []);
    const container = document.getElementById('myCartelasContainer');
    if (!container) return;

    if (!myCartelas || myCartelas.length === 0) {
        container.innerHTML = `<div class="loader" style="color:#4a3a6a; font-weight:bold; text-align:center; margin-top:20px;">No cartelas in this round.<br>Go back and buy one!</div>`;
        return;
    }

    container.innerHTML = myCartelas.map(mc => {
        const marked = new Set(mc.marked || []);
        const lineNums = new Set(mc.line_numbers || []);
        const grid = mc.numbers;

        let cellsHtml = '';
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const n = grid[r][c];

                if (r === 2 && c === 2) {
                    const inLine = lineNums.has(n);
                    cellsHtml += `<div class="cell star ${inLine ? 'line-hit' : ''}">⭐</div>`;
                    continue;
                }

                const isCalled = calledSet.has(n);
                const isMarked = marked.has(n) || pendingMarks.has(n);
                const inLine = lineNums.has(n);

                let cls = 'cell';
                if (isCalled && !isMarked) cls += ' callable';
                if (isMarked) cls += ' marked';
                if (inLine && isMarked) cls += ' line-hit';

                cellsHtml += `<div class="${cls}" data-player="${mc.player_id}" data-num="${n}">${n}</div>`;
            }
        }

        return `
            <div class="cartela-block">
                <div class="header-letters">
                    <div class="hl b1">B</div><div class="hl b2">I</div><div class="hl b3">N</div><div class="hl b4">G</div><div class="hl b5">O</div>
                </div>
                <div class="cartela">${cellsHtml}</div>
                <div class="preview-cartela-title" style="margin-top:8px;">Cartela #${mc.cartela_number}</div>
            </div>
        `;
    }).join('');

    // 👇 INSTANT & PERMANENT MULTI-CARD MARK
    container.querySelectorAll('.cell.callable').forEach(cell => {
        cell.addEventListener('click', async () => {
            if (cell.dataset.clicked) return;

            const num = parseInt(cell.dataset.num);

            // Instantly mark ALL cartelas that have this number
            container.querySelectorAll(`.cell[data-num="${num}"]`).forEach(c => {
                c.dataset.clicked = "1";
                c.classList.remove('callable');
                c.classList.add('marked');
            });

            // Send to backend
            const resp = await api(`/api/player/0/mark/`, {
                method: 'POST', body: JSON.stringify({ number: num }),
            });

            if (resp.ok) {
                await refreshGame();
            } else {
                await refreshGame(); // Revert if error
            }
        });
    });
}

function showWinnerModal(winners) {
    speakBingo();

    const winner = winners[0];
    document.getElementById('winnerName').textContent = winner.name;
    document.getElementById('winnerCartelaNum').textContent = winner.cartela_number;

    const container = document.getElementById('winnerGridContainer');
    let html = '';

    const markedNums = winner.marked_numbers || [];
    const lineNums = winner.line_numbers || [];

    winner.numbers.flat().forEach((n, idx) => {
        const r = Math.floor(idx / 5);
        const c = idx % 5;

        let bgColor = '#ffffff';
        let textColor = '#000000';
        let displayText = n;

        if (r === 2 && c === 2) {
            bgColor = '#2ecc71'; textColor = '#ffffff'; displayText = '⭐';
        } else if (lineNums.includes(n)) {
            bgColor = '#2ecc71'; textColor = '#ffffff';
        } else if (markedNums.includes(n)) {
            bgColor = '#e67e22'; textColor = '#ffffff';
        }

        html += `<div style="background: ${bgColor}; color: ${textColor}; padding: 12px 0; text-align: center; font-weight: 900; font-size: 16px; border-radius: 6px;">${displayText}</div>`;
    });

    container.innerHTML = html;
    document.getElementById('winnerModal').style.display = 'flex';

    let count = 5;
    const countdownEl = document.getElementById('modalCountdown');
    const progressBar = document.getElementById('modalProgressBar');

    if (redirectInterval) clearInterval(redirectInterval);

    redirectInterval = setInterval(() => {
        count--;
        countdownEl.textContent = count + 'S';
        progressBar.style.width = (count / 5 * 100) + '%';

        if (count <= 0) {
            clearInterval(redirectInterval);
            window.location.href = '/app/cartelas/';
        }
    }, 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
    await refreshGame();
    pollTimer = setInterval(refreshGame, 2000);

    document.getElementById('bingoBtn')?.addEventListener('click', async () => {
        const r = await api('/api/bingo/', { method: 'POST' });

        if (r.ok) {
            speakBingo();
            await refreshGame();
        } else {
            if (r.error === 'FALSE_BINGO') {
                tg?.showAlert(`❌ ${r.message}`);
                window.location.href = '/app/'; // Kick them out
            } else {
                tg?.showAlert(`❌ ${r.error}`);
            }
        }
    });

    document.getElementById('refreshBtn')?.addEventListener('click', refreshGame);
    document.getElementById('leaveBtn')?.addEventListener('click', () => { if (tg) tg.close(); else window.location.href = '/app/'; });
});