// static/miniapp/cartelas.js

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }

let cartelas = [], stake = 0, balance = 0, myCount = 0;
let timerInterval = null;


const SUPABASE_URL = 'https://pneyxzpsritncwybeptx.supabase.co';
const SUPABASE_ANON_KEY = 'pneyxzpsritncwybeptx';
// Initialize Supabase Client for Realtime
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Correct Authorization header for Django API
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
    const r = await api('/api/cartelas/');
    if (!r.ok) {
        if (!isBackgroundSync) {
            document.getElementById('cartelaGrid').innerHTML = `<div class="loader" style="color:red; grid-column: span 8;">Error: ${r.error}</div>`;
        }
        return;
    }

    // ✅ Redirect immediately if the game is active
    if (r.status === 'active') {
        window.location.href = '/app/game/';
        return;
    }

    cartelas = r.cartelas || [];
    stake = parseFloat(r.room.stake);
    balance = parseFloat(r.my_balance);
    myCount = cartelas.filter(c => c.mine).length;

    // Update Wallets
    document.getElementById('mainWallet').textContent = balance.toFixed(0);
    document.getElementById('playWallet').textContent = balance.toFixed(0);
    document.getElementById('stakeVal').textContent = stake.toFixed(0);

    // Show/Hide Play Button
    const playContainer = document.getElementById('playBtnContainer');
    if (myCount > 0) {
        playContainer.style.display = 'block';
        document.getElementById('myCartelaCount').textContent = myCount;
    } else {
        playContainer.style.display = 'none';
    }

    // ⏱️ Handle Timer
    if (r.starts_at) {
        startCountdown(new Date(r.starts_at).getTime());
    } else {
        if (document.getElementById('timerVal')) document.getElementById('timerVal').textContent = 'Waiting...';
        if (timerInterval) clearInterval(timerInterval);
    }

    // 🎨 Render Grid (First Load Only)
    if (!isBackgroundSync) {
        const grid = document.getElementById('cartelaGrid');
        grid.innerHTML = cartelas.map(c => {
            let cls = 'cg-item';
            if (c.mine) cls += ' mine';
            else if (c.sold) cls += ' sold';
            return `<div class="${cls}" data-id="${c.id}">${c.number}</div>`;
        }).join('');

        grid.querySelectorAll('.cg-item').forEach(el => {
            el.addEventListener('click', () => handleCartelaClick(parseInt(el.dataset.id), el));
        });
    }
}

async function handleCartelaClick(id, element) {
    const c = cartelas.find(x => x.id === id);
    if (!c) return;

    // 1. IF SOLD TO SOMEONE ELSE, BLOCK
    if (c.sold && !c.mine) {
        tg?.showAlert("❌ This cartela is already sold. Please choose another one.");
        return;
    }

    // 2. ⚡ INSTANT OPTIMISTIC UI (No lag)
    const isBuying = !c.mine;
    if (isBuying) {
        element.className = 'cg-item mine';
    } else {
        element.className = 'cg-item';
    }
    c.mine = isBuying;
    c.sold = isBuying;

    tg?.HapticFeedback?.impactOccurred('light');

    // 3. Send to backend
    const r = await api('/api/cartelas/toggle/', {
        method: 'POST',
        body: JSON.stringify({ cartela_id: id }),
    });

    if (!r.ok) {
        // Revert on failure
        if (isBuying) element.className = 'cg-item';
        else element.className = 'cg-item mine';
        c.mine = !isBuying;
        c.sold = !isBuying;
        tg?.showAlert("❌ Server Error: " + (r.error || 'Cartela purchase failed.'));
    } else {
        // Update balance instantly
        balance = parseFloat(r.balance);
        document.getElementById('mainWallet').textContent = balance.toFixed(0);
        document.getElementById('playWallet').textContent = balance.toFixed(0);

        myCount = cartelas.filter(x => x.mine).length;
        const playContainer = document.getElementById('playBtnContainer');
        if (myCount > 0) {
            playContainer.style.display = 'block';
            document.getElementById('myCartelaCount').textContent = myCount;
        } else {
            playContainer.style.display = 'none';
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
            // Check API immediately when timer hits 0
            loadCartelas(true);
        }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

// ═══ SUPABASE REALTIME WEBSOCKET LISTENER ═══
function listenToRealtime() {
    console.log("Connecting to Supabase Realtime...");

    const channel = supabase.channel('lobby-updates')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'bingo_playercartela' },
            (payload) => {
                // When another player buys a cartela
                if (payload.eventType === 'INSERT') {
                    const cartelaId = payload.new.cartela_id;
                    const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);

                    // If we haven't already marked it as ours, turn it yellow
                    if (el && !el.classList.contains('mine')) {
                        el.className = 'cg-item sold';
                    }
                }
                // When a player releases a cartela
                else if (payload.eventType === 'DELETE') {
                    const cartelaId = payload.old.cartela_id;
                    const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);

                    if (el && !el.classList.contains('mine')) {
                        el.className = 'cg-item'; // Back to black
                    }
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("✅ Realtime connected!");
            }
        });
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCartelas(false);

    // ⚡ Start the WebSocket listener instead of polling!
    listenToRealtime();

    // We still need a slow background sync to check the timer / game status
    // every 5 seconds, but we removed the fast 2-second sync for cartelas!
    setInterval(() => loadCartelas(true), 5000);

    document.getElementById('refreshBtn')?.addEventListener('click', () => loadCartelas(false));

    document.getElementById('playGameBtn')?.addEventListener('click', () => {
        window.location.href = '/app/game/';
    });
});
