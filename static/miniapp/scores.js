const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }
const INIT_DATA = tg?.initData || '';

async function api(path) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA };
    return (await fetch(path, { headers })).json();
}

async function loadScores() {
    const r = await api('/api/scores/');
    const list = document.getElementById('scoresList');

    if (r.ok && r.scores.length > 0) {
        list.innerHTML = r.scores.map((s, i) => `
            <div style="background: #1e2230; padding: 15px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="color: #ffd166; font-weight: bold; font-size: 18px;">#${i+1}</div>
                    <div style="color: white; font-weight: bold;">${s.name}</div>
                </div>
                <div style="color: #27ae60; font-weight: bold;">+${s.amount} ETB</div>
            </div>
        `).join('');
    } else {
        list.innerHTML = '<p style="color: #a8a8b3; text-align: center;">No winners yet.</p>';
    }
}
document.addEventListener('DOMContentLoaded', loadScores);