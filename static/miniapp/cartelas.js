// static/miniapp/cartelas.js

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }

let cartelas = [], stake = 0, balance = 0, myCount = 0;
let timerInterval = null;

// ⚠️ REPLACE THESE WITH YOUR SUPABASE URL AND ANON KEY
const SUPABASE_URL = 'https://pneyxzpsritncwybeptx.supabase.co';
const SUPABASE_ANON_KEY = 'pneyxzpsritncwybeptx';

// Initialize Supabase Client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ... (Keep your `api()` function exactly the same) ...

async function loadCartelas() {
    const r = await api('/api/cartelas/');
    if (!r.ok) return;

    cartelas = r.cartelas || [];
    stake = parseFloat(r.room.stake);
    balance = parseFloat(r.my_balance);
    myCount = cartelas.filter(c => c.mine).length;

    // ... (Keep your UI updates for balance, timer, etc.) ...

    // Render the grid
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

async function handleCartelaClick(id, element) {
    const c = cartelas.find(x => x.id === id);
    if (!c || (c.sold && !c.mine)) return;

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
        // Revert if server failed
        element.className = isBuying ? 'cg-item' : 'cg-item mine';
        c.mine = !isBuying;
        c.sold = !isBuying;
        tg?.showAlert(r.error || 'Failed');
    } else {
        balance = parseFloat(r.balance);
        document.getElementById('mainWallet').textContent = balance.toFixed(0);
        document.getElementById('playWallet').textContent = balance.toFixed(0);
    }
}

// ═══ SUPABASE REALTIME WEBSOCKET ═══
function listenToRealtime() {
    // Listen to ALL inserts and deletes on the PlayerCartela table
    const channel = supabase.channel('lobby-updates')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'bingo_playercartela' },
            (payload) => {
                // When someone buys or releases a cartela, update the UI instantly
                if (payload.eventType === 'INSERT') {
                    const cartelaId = payload.new.cartela_id;
                    const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);

                    if (el && !el.classList.contains('mine')) {
                        el.className = 'cg-item sold'; // Turn yellow
                    }
                }
                else if (payload.eventType === 'DELETE') {
                    const cartelaId = payload.old.cartela_id;
                    const el = document.querySelector(`.cg-item[data-id="${cartelaId}"]`);

                    if (el && !el.classList.contains('mine')) {
                        el.className = 'cg-item'; // Turn black
                    }
                }
            }
        )
        .subscribe();
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCartelas();
    listenToRealtime(); // ✅ Start WebSocket listener instead of polling!

    // Remove the setInterval polling entirely!
    // syncInterval = setInterval(() => loadCartelas(true), 2000);

    document.getElementById('playGameBtn')?.addEventListener('click', () => {
        window.location.href = '/app/game/';
    });
});
