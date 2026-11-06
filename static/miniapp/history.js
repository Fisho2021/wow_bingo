const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }
const INIT_DATA = tg?.initData || '';

async function api(path) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA };
    return (await fetch(path, { headers })).json();
}

async function loadHistory() {
    const r = await api('/api/history/');
    const list = document.getElementById('historyList');

    if (r.ok && r.history.length > 0) {
        list.innerHTML = r.history.map(h => `
            <div style="background: #1e2230; padding: 15px; border-radius: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="color: white; font-weight: bold;">Round #${h.round_number} (Cartela #${h.cartela_number})</span>
                    <span style="color: #27ae60;">${h.date}</span>
                </div>
                <div style="color: #ffd166; font-size: 14px;">Prize Pool: ${h.prize_pool} ETB</div>
                <div style="color: #a8a8b3; font-size: 12px; margin-top: 5px;">
                    ${h.winners.map(w => `<div>🏆 ${w}</div>`).join('')}
                </div>
            </div>
        `).join('');
    } else {
        list.innerHTML = '<p style="color: #a8a8b3; text-align: center;">No game history yet.</p>';
    }
}
document.addEventListener('DOMContentLoaded', loadHistory);