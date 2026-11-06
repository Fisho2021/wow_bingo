const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }
const INIT_DATA = tg?.initData || '';

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA, ...(opts.headers || {}) };
    return (await fetch(path, { ...opts, headers })).json();
}

let cartelas = [], stake = 0, balance = 0, myCount = 0;
let timerInterval = null;

async function loadCartelas() {
    const r = await api('/api/cartelas/');
    if (!r.ok) {
        document.getElementById('cartelaGrid').innerHTML = `<div class="loader" style="color:red;">Error loading cartelas</div>`;
        return;
    }

    cartelas = r.cartelas;
    stake = parseFloat(r.room.stake);
    balance = parseFloat(r.my_balance);

    myCount = cartelas.filter(c => c.mine).length;

    // Update UI Text
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

    if (r.starts_at) {
        startCountdown(new Date(r.starts_at).getTime());
    }

    // Render the 8-column grid
    const grid = document.getElementById('cartelaGrid');
    grid.innerHTML = cartelas.map(c => {
        let cls = 'cg-item';

        if (c.mine) {
            cls += ' mine'; // Green
        } else if (c.sold) {
            cls += ' sold'; // Yellow
        } // else it stays Black

        return `<div class="${cls}" data-id="${c.id}">${c.number}</div>`;
    }).join('');

    // Handle Clicks
    grid.querySelectorAll('.cg-item').forEach(el => {
        el.addEventListener('click', () => handleCartelaClick(parseInt(el.dataset.id), el));
    });
}

async function handleCartelaClick(id, element) {
    const c = cartelas.find(x => x.id === id);
    if (!c) return;

    // 👇 1. IF SOLD TO SOMEONE ELSE (YELLOW), SHOW ALERT
    if (c.sold && !c.mine) {
        tg?.showAlert("❌ This cartela is already sold. Please choose another one.");
        return;
    }

    // Instant Visual Feedback
    if (c.mine) {
        // Release (Green -> Black)
        element.classList.remove('mine');
        c.mine = false;
        c.sold = false;
    } else {
        // Buy (Black -> Green)
        element.classList.remove('cg-item');
        element.classList.add('cg-item', 'mine');
        c.mine = true;
        c.sold = true;
    }

    tg?.HapticFeedback.impactOccurred('light');

    // Send to backend
    const r = await api('/api/cartelas/toggle/', {
        method: 'POST', body: JSON.stringify({ cartela_id: id }),
    });

    if (!r.ok) {
        // If server fails (e.g., someone else bought it a millisecond before you)
        tg?.showAlert(r.error);
    }

    // Reload everything to sync exact state from database
    await loadCartelas();
}


function startCountdown(targetTime) {
    if (timerInterval) clearInterval(timerInterval);
    const timerEl = document.getElementById('timerVal');

    const updateTimer = () => {
        const remain = Math.max(0, Math.round((targetTime - Date.now()) / 1000));
        timerEl.textContent = remain + ' s';

        if (remain <= 0) {
            clearInterval(timerInterval);
            timerEl.textContent = '0 s';

            // 👇 INSTANT REDIRECT if they own a cartela
            if (myCount > 0) {
                window.location.href = '/app/game/';
            }
        }
    };

    updateTimer(); // Check immediately
    timerInterval = setInterval(updateTimer, 1000);
}



document.addEventListener('DOMContentLoaded', async () => {
    await loadCartelas();
    document.getElementById('refreshBtn')?.addEventListener('click', loadCartelas);

    document.getElementById('playGameBtn')?.addEventListener('click', () => {
        window.location.href = '/app/game/';
    });
});
