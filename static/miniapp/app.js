// static/miniapp/app.js

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#2d2a3a');
}

// ═══ SOUND & VOICE ═══
let soundOn = true;
let audioCtx = null;

function toggleSound() {
    soundOn = !soundOn;
    const el = document.getElementById('soundVal');
    if (el) el.textContent = soundOn ? '🔊' : '🔇';
}

function beep(freq = 660, duration = 0.12, type = 'sine') {
    if (!soundOn) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain); gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* ignore */ }
}

function playCallSound() {
    beep(880, 0.15, 'sine');
    setTimeout(() => beep(1100, 0.12, 'sine'), 100);
}

function playBingoSound() {
    beep(660, 0.15);
    setTimeout(() => beep(880, 0.15), 150);
    setTimeout(() => beep(1100, 0.3), 300);
}

// ✅ Speak both Letter and Number (e.g., "B-12")
function speakAmharic(number) {
    if (!soundOn) return;

    const amharicNumbers = {
        1:"አንድ",2:"ሁለት",3:"ሶስት",4:"አራት",5:"አምስት",6:"ስድስት",7:"ሰባት",8:"ስምንት",9:"ዘጠኝ",10:"አስር",
        11:"አስራ አንድ",12:"አስራ ሁለት",13:"አስራ ሶስት",14:"አስራ አራት",15:"አስራ አምስት",16:"አስራ ስድስት",17:"አስራ ሰባት",18:"አስራ ስምንት",19:"አስራ ዘጠኝ",20:"ሃያ",
        21:"ሃያ አንድ",22:"ሃያ ሁለት",23:"ሃያ ሶስት",24:"ሃያ አራት",25:"ሃያ አምስት",26:"ሃያ ስድስት",27:"ሃያ ሰባት",28:"ሃያ ስምንት",29:"ሃያ ዘጠኝ",30:"ሰላሳ",
        31:"ሰላሳ አንድ",32:"ሰላሳ ሁለት",33:"ሰላሳ ሶስት",34:"ሰላሳ አራት",35:"ሰላሳ አምስት",36:"ሰላሳ ስድስት",37:"ሰላሳ ሰባት",38:"ሰላሳ ስምንት",39:"ሰላሳ ዘጠኝ",40:"አርባ",
        41:"አርባ አንድ",42:"አርባ ሁለት",43:"አርባ ሶስት",44:"አርባ አራት",45:"አርባ አምስት",46:"አርባ ስድስት",47:"አርባ ሰባት",48:"አርባ ስምንት",49:"አርባ ዘጠኝ",50:"ሃምሳ",
        51:"ሃምሳ አንድ",52:"ሃምሳ ሁለት",53:"ሃምሳ ሶስት",54:"ሃምሳ አራት",55:"ሃምሳ አምስት",56:"ሃምሳ ስድስት",57:"ሃምሳ ሰባት",58:"ሃምሳ ስምንት",59:"ሃምሳ ዘጠኝ",60:"ስድሳ",
        61:"ስድሳ አንድ",62:"ስድሳ ሁለት",63:"ስድሳ ሶስት",64:"ስድሳ አራት",65:"ስድሳ አምስት",66:"ስድሳ ስድስት",67:"ስድሳ ሰባት",68:"ስድሳ ስምንት",69:"ስድሳ ዘጠኝ",70:"ሰባ",
        71:"ሰባ አንድ",72:"ሰባ ሁለት",73:"ሰባ ሶስት",74:"ሰባ አራት",75:"ሰባ አምስት"
    };

    let amharicLetter = '';
    if (number <= 15) amharicLetter = 'ቢ';       // B
    else if (number <= 30) amharicLetter = 'አይ';  // I
    else if (number <= 45) amharicLetter = 'ኤን';  // N
    else if (number <= 60) amharicLetter = 'ጂ';   // G
    else amharicLetter = 'ኦ';                     // O

    const numText = amharicNumbers[number];
    if (!numText) return;

    const textToSpeak = `${amharicLetter} ${numText}`;
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(textToSpeak)}&tl=am&client=tw-ob`;
    const audio = new Audio(audioUrl);
    audio.play().catch(e => console.log("Audio play failed:", e));
}

// ═══ API WRAPPER ═══
async function api(path, opts = {}) {
    const initData = window.Telegram?.WebApp?.initData || '';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `TgWebApp ${initData}`,
        ...(opts.headers || {}),
    };
    try {
        const res = await fetch(path, { ...opts, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error || data.message || `Server Error` };
        return { ok: true, ...data };
    } catch (e) {
        return { ok: false, error: 'Network Error' };
    }
}

function updateTopBalance(value) {
    const el = document.getElementById('balanceTop');
    if (el) el.textContent = `💰 ${value}`;
}

async function loadMe() {
    const r = await api('/api/me/');
    if (r.ok) {
        updateTopBalance(r.user.balance);
        return r.user;
    }
    return null;
}

// ═══ GAME PLAY ═══
let pollTimer = null;
let _lastCalledCount = 0;

async function loadGame() {
    await refreshGame();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshGame, 2000);
}

async function refreshGame() {
    const r = await api('/api/game/');
    if (!r.ok) {
        console.error("Game API Error:", r.error);
        return;
    }

    const roundData = r.round || {};
    const called = roundData.called_numbers || [];
    const last = called.length > 0 ? called[called.length - 1] : null;

    // 🏆 1. CHECK FOR WINNER MODAL
    if (roundData.status === 'finished' && r.winners && r.winners.length > 0) {
        if (pollTimer) clearInterval(pollTimer);
        const winner = r.winners[0];

        document.getElementById('winnerName').textContent = winner.name;
        document.getElementById('winnerCartelaNum').textContent = winner.cartela_number;

        const gridContainer = document.getElementById('winnerGridContainer');
        const flatNums = winner.numbers.flat();
        const markedNums = winner.marked_numbers || [];

        gridContainer.innerHTML = flatNums.map(n => {
            const isMarked = markedNums.includes(n) ? 'background: #2ecc71; color: white;' : 'background: #fff; color: #333;';
            return `<div style="padding: 5px 0; border-radius: 5px; font-size: 12px; font-weight: bold; ${isMarked}">${n}</div>`;
        }).join('');

        document.getElementById('winnerModal').style.display = 'flex';
        playBingoSound();

        // ✅ Auto-start next game in 5 seconds
        let timeLeft = 5;
        const countdownEl = document.getElementById('modalCountdown');
        const progressBar = document.getElementById('modalProgressBar');

        if (countdownEl && progressBar) {
            countdownEl.textContent = timeLeft + 'S';
            progressBar.style.width = '100%';

            const timer = setInterval(() => {
                timeLeft--;
                countdownEl.textContent = timeLeft + 'S';
                progressBar.style.width = (timeLeft / 5 * 100) + '%';

                if (timeLeft <= 0) {
                    clearInterval(timer);
                    window.location.href = '/app/cartelas/'; // Redirect to lobby
                }
            }, 1000);
        }
        return;
    }

    // 🔊 Voice and Sound
    if (called.length > _lastCalledCount && _lastCalledCount > 0 && last) {
        playCallSound();
        speakAmharic(last);
        if (tg) tg.HapticFeedback.impactOccurred('light');
    }
    _lastCalledCount = called.length;

    // ── Update Top UI Bar ──
    if (document.getElementById('gameId')) document.getElementById('gameId').textContent = roundData.number ? `R${roundData.number}` : 'R0';
    if (document.getElementById('playersVal')) document.getElementById('playersVal').textContent = roundData.players || 0;
    if (document.getElementById('callVal')) document.getElementById('callVal').textContent = called.length;
    if (document.getElementById('prizeVal')) document.getElementById('prizeVal').textContent = roundData.prize_pool || '0';

    if (document.getElementById('currentCall')) {
        let lastDisplay = '-';
        if (last) {
            let l = last <= 15 ? 'B' : last <= 30 ? 'I' : last <= 45 ? 'N' : last <= 60 ? 'G' : 'O';
            lastDisplay = `${l}-${last}`;
        }
        document.getElementById('currentCall').textContent = lastDisplay;
    }

    if (document.getElementById('statusText')) document.getElementById('statusText').textContent = roundData.status === 'active' ? 'Game Active!' : 'Waiting for players...';
    if (document.getElementById('countdown')) document.getElementById('countdown').textContent = roundData.status === 'active' ? 'LIVE' : 'WAITING';

    // ✅ REPLACE PLAYERS LIST WITH 4 LATEST CALLS
    if (document.getElementById('playersListText')) {
        const last4 = called.slice(-4);
        function getBingoLetter(num) {
            if (num <= 15) return 'B';
            if (num <= 30) return 'I';
            if (num <= 45) return 'N';
            if (num <= 60) return 'G';
            return 'O';
        }
        const last4Text = last4.map(n => `${getBingoLetter(n)}-${n}`).join('  ');
        document.getElementById('playersListText').textContent = last4.length > 0 ? `Last Calls: ${last4Text}` : 'Last Calls: None';
    }

    // ── 3. RENDER 1-75 BOARD ──
    const grid = document.getElementById('calledGrid');
    if (grid) {
        grid.innerHTML = Array.from({ length: 75 }, (_, i) => i + 1)
            .map(n => `<div class="num ${called.includes(n) ? 'drawn' : ''}">${n}</div>`)
            .join('');
    }

    // ── 4. RENDER MULTIPLE CARTELAS OR SPECTATOR MODE ──
    const cartelasContainer = document.getElementById('myCartelasContainer');

    if (r.my_cartelas && r.my_cartelas.length > 0) {
        // ✅ USER IS A PLAYER
        cartelasContainer.innerHTML = r.my_cartelas.map(cartela => {
            const markedNums = cartela.marked || [];
            const flatNums = cartela.numbers.flat();

            const cellsHtml = flatNums.map((n, index) => {
                if (index === 12) {
                    return `<div class="cell marked star">⭐</div>`;
                }

                const isMarked = markedNums.includes(n);
                const isCalled = called.includes(n);

                let cellClass = 'cell';
                if (isMarked) cellClass += ' marked';
                else if (isCalled) cellClass += ' called';

                return `<div class="${cellClass}" onclick="toggleMark(${cartela.player_id}, ${n})">${n}</div>`;
            }).join('');

            return `
            <div class="my-cartela-wrapper">
                <div class="my-cartela-header">Cartela #${cartela.cartela_number}</div>
                <div class="my-cartela-grid">${cellsHtml}</div>
                <button class="bingo-btn-card" onclick="claimBingo()">🎉 BINGO!</button>
            </div>
            `;
        }).join('');
    } else if (cartelasContainer) {
        // 👀 USER IS A SPECTATOR (Didn't buy, or got punished)
        cartelasContainer.innerHTML = `
            <div style="background: #232e3c; border-radius: 12px; padding: 20px; text-align: center; border: 2px solid #3a475a; margin-top: 15px;">
                <div style="font-size: 40px; margin-bottom: 10px;">👀</div>
                <h3 style="color: #ffd166; margin-bottom: 5px;">Spectator Mode</h3>
                <p style="color: #aaa; font-size: 14px;">You are watching this game. Wait for the next round to play!</p>
            </div>
        `;
    }
}

// ═══ MARKING NUMBERS ═══
async function toggleMark(playerId, number) {
    // ✅ FIX: Ensure the number is sent as an integer
    const cleanNumber = parseInt(number);

    const r = await api(`/api/player/${playerId}/mark/`, {
        method: 'POST',
        body: JSON.stringify({ number: cleanNumber })
    });

    if (r.ok) {
        if (tg) tg.HapticFeedback.impactOccurred('medium');
        refreshGame();
    } else {
        if (r.error === 'not_called_yet') {
            if (tg) tg.showAlert('Wait for this number to be called!');
        } else {
            if (tg) tg.showAlert(r.error);
        }
    }
}

// ═══ CLAIM BINGO & PUNISHMENT ═══
async function claimBingo() {
    const r = await api('/api/bingo/', { method: 'POST' });

    if (r.ok) {
        playBingoSound();
        if (tg) tg.showAlert(`🎉 BINGO! Payout: ${JSON.stringify(r.payouts)}`);
    } else {
        beep(220, 0.3, 'square');
        if (tg) tg.showAlert(`❌ ${r.error === 'FALSE_BINGO' ? r.message : r.error}`);

        // ✅ PUNISHMENT: If False Bingo, refresh immediately to show Spectator Mode
        if (r.error === 'FALSE_BINGO') {
            setTimeout(() => refreshGame(), 1500);
        }
    }
}

// ═══ WALLET & PROFILE ═══
async function loadWallet() {
    const r = await api('/api/wallet/');
    if (!r.ok) return;

    document.getElementById('walletBalance').textContent = `${r.balance} birr`;
    updateTopBalance(r.balance);

    const list = document.getElementById('txList');
    list.innerHTML = r.transactions.map(t => {
        const sign = parseFloat(t.amount) >= 0 ? '+' : '';
        const cls = parseFloat(t.amount) >= 0 ? 'positive' : 'negative';
        return `<div class="tx-item">
            <div>${t.note || t.type}<br><small>${t.date}</small></div>
            <div class="tx-amount ${cls}">${sign}${t.amount}</div>
        </div>`;
    }).join('') || '<div class="loader">No transactions yet</div>';
}

async function redeemCoupon() {
    const code = document.getElementById('couponInput').value.trim();
    if (!code) return;
    const r = await api('/api/redeem/', { method: 'POST', body: JSON.stringify({ code }) });
    if (r.ok) {
        if (tg) tg.showAlert(`✅ Redeemed! New balance: ${r.new_balance} birr`);
        document.getElementById('couponInput').value = '';
        loadWallet();
    } else {
        if (tg) tg.showAlert(`❌ ${r.error}`);
    }
}

async function loadHistory() {
    const r = await api('/api/history/');
    if (!r.ok) return;
    const list = document.getElementById('historyList');
    list.innerHTML = r.history.map(h => `
        <div class="history-item" style="flex-direction: column; align-items: flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%;">
                <strong>Round #${h.round_number} (Cartela #${h.cartela_number})</strong>
                <span style="color: #7a68ab;">${h.date}</span>
            </div>
            <div style="margin-top: 4px; font-size: 12px; color: #555;">
                Prize Pool: ${h.prize_pool} birr
            </div>
            <div style="margin-top: 8px; background: #fff; padding: 6px; border-radius: 6px; width: 100%;">
                ${h.winners.map(w => `<div style="font-size: 13px; color: #d35400; font-weight: bold;">${w}</div>`).join('')}
            </div>
        </div>
    `).join('') || '<div class="loader">No games yet</div>';
}

async function loadProfile() {
    const u = await loadMe();
    if (!u) return;
    document.getElementById('profileName').textContent = u.nickname || u.first_name || 'Player';
    document.getElementById('profileUsername').textContent = u.username ? `@${u.username}` : '';
    document.getElementById('profileBalance').textContent = `${u.balance} birr`;

    const nickInput = document.getElementById('nicknameInput');
    if (nickInput) nickInput.value = u.nickname || '';
}

async function saveNickname() {
    const nick = document.getElementById('nicknameInput').value.trim();
    if (!nick) return;
    const r = await api('/api/me/nickname/', { method: 'POST', body: JSON.stringify({ nickname: nick }) });
    if (r.ok) {
        if (tg) tg.showAlert(`✅ Nickname updated to: ${r.nickname}`);
        await loadProfile();
    } else {
        if (tg) tg.showAlert(`❌ Error: ${r.error}`);
    }
}

async function requestDeposit() {
    const amt = document.getElementById('depositAmount').value;
    if (!amt) return;
    const r = await api('/api/deposit/', { method: 'POST', body: JSON.stringify({ amount: amt }) });
    if (r.ok) { tg?.showAlert(r.message || "Deposit requested!"); document.getElementById('depositAmount').value = ''; }
    else tg?.showAlert(`❌ ${r.error}`);
}

async function requestWithdrawal() {
    const phone = document.getElementById('withdrawPhone').value;
    const amt = document.getElementById('withdrawAmount').value;
    if (!phone || !amt) return;
    const r = await api('/api/withdraw/', { method: 'POST', body: JSON.stringify({ phone, amount: amt }) });
    if (r.ok) {
        tg?.showAlert(`✅ Withdrawal requested!\nNew balance: ${r.new_balance} birr`);
        document.getElementById('withdrawPhone').value = '';
        document.getElementById('withdrawAmount').value = '';
        loadProfile();
    } else tg?.showAlert(`❌ ${r.error}`);
}

async function loadReferrals() {
    const r = await api('/api/referrals/');
    if (!r.ok) return;
    document.getElementById('refLink').value = r.link;
    document.getElementById('refCount').textContent = r.count;
    document.getElementById('refList').innerHTML = r.list.map(x => `<div>👤 ${x.name} (${x.date})</div>`).join('') || '<div>No referrals yet.</div>';
}

// ═══ INITIALIZATION ═══
document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;

    if (path.includes('/app/game/')) {
        await loadGame();
    } else if (path.includes('/app/wallet/')) {
        await loadWallet();
    } else if (path.includes('/app/history/')) {
        await loadHistory();
    } else if (path.includes('/app/profile/')) {
        await loadProfile();
    }

    document.getElementById('depositBtn')?.addEventListener('click', requestDeposit);
    document.getElementById('withdrawBtn')?.addEventListener('click', requestWithdrawal);
    document.getElementById('saveNicknameBtn')?.addEventListener('click', saveNickname);

    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        if (path.includes('/app/game/')) refreshGame();
        if (path.includes('/app/wallet/')) loadWallet();
    });

    if (document.getElementById('refLink')) {
        await loadReferrals();
        document.getElementById('copyRefBtn')?.addEventListener('click', () => {
            const txt = document.getElementById('refLink').value;
            navigator.clipboard.writeText(txt).then(() => tg?.showAlert("Link copied!"));
        });
        document.getElementById('shareRefBtn')?.addEventListener('click', () => {
            const txt = document.getElementById('refLink').value;
            tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(txt)}&text=Join%20me%20on%20JoFish%20Bingo!`);
        });
    }
});
