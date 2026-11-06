const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#2d2a3a');
}

const INIT_DATA = tg?.initData || '';
// ═══ SOUND ═══
let soundOn = true;
let audioCtx = null;

function toggleSound() {
    soundOn = !soundOn;
    document.getElementById('soundVal').textContent = soundOn ? '🔊' : '🔇';
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

function playCallSound() { beep(880, 0.15, 'sine'); setTimeout(() => beep(1100, 0.12, 'sine'), 100); }
function playBingoSound() {
    beep(660, 0.15); setTimeout(() => beep(880, 0.15), 150);
    setTimeout(() => beep(1100, 0.3), 300);
}
async function api(path, opts = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': INIT_DATA,
        ...(opts.headers || {}),
    };
    const res = await fetch(path, { ...opts, headers });
    return res.json();
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

// ---------- LOBBY ----------
async function loadLobby() {
    const list = document.getElementById('roomsList');
    if (!list) return;

    const r = await api('/api/lobby/');
    if (!r.ok) { list.innerHTML = '<div class="loader">Failed to load</div>'; return; }

    list.innerHTML = r.rooms.map(room => `
        <div class="room-card">
            <div>
                <div class="room-stake">${room.stake}<small>ETB</small></div>
            </div>
            <div class="room-win">${room.prize_pool}<small>${room.players} players</small></div>
            <div class="room-status">
                <div class="badge ${room.status === 'waiting' ? 'ready' : ''}">${room.status.toUpperCase()}</div>
                <button class="join-btn" onclick="joinRoom(${room.room_id})">JOIN</button>
            </div>
        </div>
    `).join('');
}

function joinRoom(roomId) {
    window.location.href = `/app/cartelas/${roomId}/`;
}

// ---------- GAME ----------
let currentRoomId = null;
let pollTimer = null;

async function loadGame() {
    currentRoomId = window.ROOM_ID;
    if (!currentRoomId) return;

    // Load cartela + state
    await refreshGame();
    pollTimer = setInterval(refreshGame, 3000);
}
let _lastCalledCount = 0;

async function refreshGame() {
    const r = await api(`/api/room/${currentRoomId}/`);
    if (!r.ok) return;

    const called = r.round.called_numbers || [];
    const last = called[called.length - 1];

    // Play sound when a NEW number is drawn
    if (called.length > _lastCalledCount && _lastCalledCount > 0) {
        playCallSound();
        if (tg) tg.HapticFeedback.impactOccurred('light');
    }
    _lastCalledCount = called.length;

    // Big "current call" panel on the left
    const bigCalled = document.getElementById('bigCalled');
    if (bigCalled) bigCalled.textContent = last || '—';

    // Current call circle
    document.getElementById('currentCall').textContent = last || '-';

    // Top info bar
    document.getElementById('gameId').textContent = r.round.number ? `Y${r.round.number}` : '—';
    document.getElementById('playersVal').textContent = r.round.players;
    document.getElementById('stakeVal').textContent = r.room.stake;
    document.getElementById('callVal').textContent = called.length;
    document.getElementById('countdown').textContent = r.round.status;

    // Left column: numbers 1-75
    const grid = document.getElementById('calledGrid');
    if (grid) {
        grid.innerHTML = Array.from({ length: 75 }, (_, i) => i + 1)
            .map(n => `<div class="num ${called.includes(n) ? 'drawn' : ''}">${n}</div>`)
            .join('');
    }

    // Cartela
    if (r.my_cartela) {
        const grid = r.my_cartela.numbers;
        const cartelaEl = document.getElementById('cartelaGrid');
        cartelaEl.innerHTML = grid.flat().map(n =>
            `<div class="cell ${called.includes(n) ? 'marked' : ''}">${n}</div>`
        ).join('');
        document.getElementById('boardNumber').textContent = r.my_cartela.cartela_number;
    }
}

async function claimBingo() {
    const r = await api(`/api/room/${currentRoomId}/bingo/`, { method: 'POST' });
    if (r.ok) {
        playBingoSound();
        if (tg) tg.showAlert(`🎉 BINGO! Payout: ${JSON.stringify(r.payouts)}`);
        clearInterval(pollTimer);
    } else {
        beep(220, 0.3, 'square');
        if (tg) tg.showAlert(`❌ ${r.error}`);
    }
}

// ---------- WALLET ----------
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

    const r = await api('/api/redeem/', {
        method: 'POST',
        body: JSON.stringify({ code }),
    });

    if (r.ok) {
        if (tg) tg.showAlert(`✅ Redeemed! New balance: ${r.new_balance} birr`);
        document.getElementById('couponInput').value = '';
        loadWallet();
    } else {
        if (tg) tg.showAlert(`❌ ${r.error}`);
    }
}

// ---------- HISTORY ----------
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

    const r = await api('/api/me/nickname/', {
        method: 'POST',
        body: JSON.stringify({ nickname: nick })
    });

    if (r.ok) {
        if (tg) tg.showAlert(`✅ Nickname updated to: ${r.nickname}`);
        await loadProfile(); // Reload to show updated name
    } else {
        if (tg) tg.showAlert(`❌ Error: ${r.error}`);
    }
}

    document.getElementById('saveNicknameBtn')?.addEventListener('click', saveNickname);

// DEPOSIT
async function requestDeposit() {
    const amt = document.getElementById('depositAmount').value;
    if (!amt) return;
    const r = await api('/api/deposit/', { method: 'POST', body: JSON.stringify({ amount: amt }) });
    if (r.ok) { tg?.showAlert(r.message); document.getElementById('depositAmount').value = ''; }
    else tg?.showAlert(`❌ ${r.error}`);
}

// WITHDRAW
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

// REFERRALS
async function loadReferrals() {
    const r = await api('/api/referrals/');
    if (!r.ok) return;
    document.getElementById('refLink').value = r.link;
    document.getElementById('refCount').textContent = r.count;
    document.getElementById('refList').innerHTML = r.list.map(x => `<div>👤 ${x.name} (${x.date})</div>`).join('') || '<div>No referrals yet.</div>';
}

document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Add these listeners at the very bottom of the file
    document.getElementById('depositBtn')?.addEventListener('click', requestDeposit);
    document.getElementById('withdrawBtn')?.addEventListener('click', requestWithdrawal);
    document.getElementById('saveNicknameBtn')?.addEventListener('click', saveNickname);

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