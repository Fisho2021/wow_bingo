// static/miniapp/cartelas.js

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }

let cartelas = [], stake = 0, balance = 0, myCount = 0;
let timerInterval = null;
let syncInterval = null;

// ⚠️ REPLACE THESE WITH YOUR ACTUAL SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

let supabase = null;

// ✅ Safe Initialization (Prevents crashes if script is missing)
try {
    if (window.supabase) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.warn("⚠️ Supabase script not found in HTML. Falling back to polling.");
    }
} catch (e) {
    console.error("⚠️ Supabase failed to initialize:", e);
}

async function api(path, opts = {}) {
    const initData = window.Telegram?.WebApp?.initData || '';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `TgWebApp ${initData}`,
        ...(opts.headers || {})
    };
    try {
        const res = await fetch(path, { ...opts, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error || data.message || 'Server Error' };
        return { ok: true, ...data };
    } catch (e) {
        return { ok: false, error: 'Network Error' };
    }
}

async function loadCartelas(isBackgroundSync = false) {
    const grid = document.getElementById('cartelaGrid');

    // Show loading state only on first load
    if (!isBackgroundSync && grid) {
        grid.innerHTML = '<div class="loader" style="grid-column: span 8; text-align: center; color: white; padding: 20px;">Loading Cartelas...</div>';
    }

    const r = await api('/api/cartelas/');

    if (!r.ok) {
        if (grid && !isBackgroundSync) {
            grid.innerHTML = `<div class="loader" style="color:#e74c3c; grid-column: span 8; text-align: center; padding: 20px;">Error: ${r.error}</div>`;
        }
        return;
    }

    if (r.status === 'active') {
        window.location.href = '/app/game/';
        return;
    }

    cartelas = r.cartelas || [];
    stake = parseFloat(r.room.stake);
    balance = parseFloat(r.my_balance);
    myCount = cartelas.filter(c => c.mine).length;

    // Update Wallets
    if(document.getElementById('mainWallet')) document.getElementById('mainWallet').textContent = balance.toFixed(0);
    if(document.getElementById('playWallet')) document.getElementById('playWallet').textContent = balance.toFixed(0);
    if(document.getElementById('stakeVal')) document.getElementById('stakeVal').textContent = stake.toFixed(0);

    // Show/Hide Play Button
    const playContainer = document.getElementById('playBtnContainer');
    if (playContainer) {
        if (myCount > 0) {
            playContainer.style.display = 'block';
            if(document.getElementById('myCartelaCount')) document.getElementById('myCartelaCount').textContent = myCount;
        } else {
            playContainer.style.display = 'none';
        }
    }

    // ⏱️ Handle Timer
    if (r.starts_at) {
        startCountdown(new Date(r.starts_at).getTime());
    } else {
        if (document.getElementById('timerVal')) document.getElementById('timerVal').textContent = 'Waiting...';
        if (timerInterval) clearInterval(timerInterval);
    }

    // 🎨 Render Grid
    if (grid && !isBackgroundSync) {
        grid.innerHTML = cartelas.map(c => {
            let cls = 'cg-item';
            if (c.mine) cls += ' mine';
            else if (c.sold) cls += ' sold';
            return `<div class="${cls}" data-id="${c.id}">${c.number}</div>`;
        }).join('');

        grid.querySelectorAll('.cg-item').forEach(el => {
            el.addEventListener('click', () => handleCartelaClick(parseInt(el.dataset.id), el));
        });
    } else if (grid && isBackgroundSync) {
        cartelas.forEach(c => {
            const el = document.querySelector(`.cg-item[data-id="${c.id}"]`);
            if (!el) return;
            const isMineNow = el.classList.contains('mine');
            const isSoldNow = el.classList.contains('sold');
            if (c.mine && !isMineNow) el.className = 'cg-item mine';
            else if (c.sold && !c.mine && !isSoldNow) el.className = 'cg-item sold';
            else if (!c.sold && !c.mine && (isMineNow || isSoldNow)) el.className = 'cg-item';
        });
    }
}

async function handleCartelaClick(id, element) {
    const c = cartelas.find(x => x.id === id);
    if (!c) return;

    if (c.sold && !c.mine) {
        tg?.showAlert("❌ This cartela is already sold.");
        return;
    }

    // ⚡ INSTANT OPTIMISTIC UI
    const isBuying = !c.mine;
    element.className = isBuying ? 'cg-item mine' : 'cg-item';
    c.mine = isBuying;
    c.sold = isBuying;
    tg?.HapticFeedback?.impactOccurred('light');

    const r = await api('/api/cartelas/toggle/', {
        method: 'POST',
        body: JSON.stringify({ cartela_id: id }),
    });

    if (!r.ok) {
        element.className = isBuying ? 'cg-item' : 'cg-item mine';
        c.mine = !isBuying;
        c.sold = !isBuying;
        tg?.showAlert("❌ Server Error: " + (r.error || 'Purchase failed.'));
    } else {
        balance = parseFloat(r.balance);
        if(document.getElementById('mainWallet')) document.getElementById('mainWallet').textContent = balance.toFixed(0);
        if(document.getElementById('playWallet')) document.getElementById('playWallet').textContent = balance.toFixed(0);
        myCount = cartelas.filter(x => x.mine).length;

        const playContainer = document.getElementById('playBtnContainer');
        if (playContainer) {
            if (myCount > 0) {
                playContainer.style.display = 'block';
                if(document.getElementById('myCartelaCount')) document.getElementById('myCartelaCount').textContent = myCount;
            } else {
                playContainer.style.display = 'none';
            }
        }
    }
}

function startCountdown(targetTime) {
    if (timerInterval) clearInterval(timerInterval);
    const timerEl = document.getElementById('timerVal');
    if (!timerEl) return;

    const updateTimer = () => {
        const remain = Math.max(0, Math.round((targetTime - Date.now()) / 1000));
        timerEl.textContent = remain + ' s';
        if (remain <= 0) {
            clearInterval(timerInterval);
            timerEl.textContent = 'Checking...';
            loadCartelas(true);
        }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

// ═══ SUPABASE REALTIME LISTENER (If Available) ═══
function listenToRealtime() {
    if (!supabase) {
        console.log("Using fallback polling for cartela updates.");
        return;
    }

    supabase.channel('lobby-updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_playercartela' }, (payload) => {
            if (payload.eventType === 'INSERT') {
                const cartelaId = payload.new.cartela_id;
                const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);
                if (el && !el.classList.contains('mine')) el.className = 'cg-item sold';
            } else if (payload.eventType === 'DELETE') {
                const cartelaId = payload.old.cartela_id;
                const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);
                if (el && !el.classList.contains('mine')) el.className = 'cg-item';
            }
        })
        .subscribe();
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCartelas(false);

    listenToRealtime();

    // ✅ Fallback Polling: Every 3 seconds check for updates anyway (just in case Realtime misses one)
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => loadCartelas(true), 3000);

    document.getElementById('refreshBtn')?.addEventListener('click', () => loadCartelas(false));
    document.getElementById('playGameBtn')?.addEventListener('click', () => {
        window.location.href = '/app/game/';
    });
});
