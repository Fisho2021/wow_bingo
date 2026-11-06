// static/miniapp/cartelas.js

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }

let cartelas = [], stake = 0, balance = 0, myCount = 0;
let timerInterval = null;
let syncInterval = null;

// ✅ FIXED: Corrected the Authorization header
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

    // 🎨 Render or Sync Grid
    const grid = document.getElementById('cartelaGrid');
    
    if (!isBackgroundSync) {
        // Initial full render
        grid.innerHTML = cartelas.map(c => {
            let cls = 'cg-item';
            if (c.mine) cls += ' mine';
            else if (c.sold) cls += ' sold';
            return `<div class="${cls}" data-id="${c.id}">${c.number}</div>`;
        }).join('');

        grid.querySelectorAll('.cg-item').forEach(el => {
            el.addEventListener('click', () => handleCartelaClick(parseInt(el.dataset.id), el));
        });
    } else {
        // ⚡ Background Sync: Update ONLY the changed cards (prevents lag)
        cartelas.forEach(c => {
            const el = document.querySelector(`.cg-item[data-id="${c.id}"]`);
            if (!el) return;
            
            const isMineNow = el.classList.contains('mine');
            const isSoldNow = el.classList.contains('sold');

            if (c.mine && !isMineNow) {
                el.className = 'cg-item mine';
            } else if (c.sold && !c.mine && !isSoldNow) {
                el.className = 'cg-item sold';
            } else if (!c.sold && !c.mine && (isMineNow || isSoldNow)) {
                el.className = 'cg-item';
            }
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
        tg?.showAlert(r.error || 'Cartela purchase failed.');
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
            timerEl.textContent = '0 s';
            
            // ⚡ When timer hits 0, check if the game started. 
            // If not (only 1 player), the backend resets to 60s and the background sync will catch it.
            if (myCount > 0) {
                window.location.href = '/app/game/';
            }
        }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCartelas(false);
    
    // ⚡ Background Sync: Check for other players' purchases every 3 seconds
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => loadCartelas(true), 3000);

    document.getElementById('refreshBtn')?.addEventListener('click', () => loadCartelas(false));

    document.getElementById('playGameBtn')?.addEventListener('click', () => {
        window.location.href = '/app/game/';
    });
});
