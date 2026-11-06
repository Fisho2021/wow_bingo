const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#151924'); }
const INIT_DATA = tg?.initData || '';

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA, ...(opts.headers || {}) };
    return (await fetch(path, { ...opts, headers })).json();
}

async function loadStats() {
    const r = await api('/api/admin/stats/');
    if (r.ok) {
        document.getElementById('statProfit').textContent = `${r.stats.profit} ETB`;
        document.getElementById('statUsers').textContent = r.stats.users;
    }
}

async function loadRequests() {
    const r = await api('/api/admin/requests/');
    const container = document.getElementById('requestsList');

    if (r.ok) {
        if (r.requests.length === 0) {
            container.innerHTML = '<div style="color: #27ae60; text-align: center;">No pending requests.</div>';
            return;
        }

        container.innerHTML = r.requests.map(req => `
            <div style="background: #2a3143; padding: 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; color: white; font-weight: bold;">
                    <span>${req.type === 'deposit' ? '💸 Deposit' : '🤯 Withdraw'}</span>
                    <span style="color: ${req.type === 'deposit' ? '#27ae60' : '#e74c3c'};">${req.amount} ETB</span>
                </div>
                <div style="color: #a8a8b3; font-size: 12px;">
                    User: ${req.name} | Phone: ${req.phone}
                </div>
                <div style="display: flex; gap: 5px; margin-top: 5px;">
                    <button onclick="handleAction('${req.type}', ${req.id}, 'approve')" style="flex: 1; background: #27ae60; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: bold;">✅ Approve</button>
                    <button onclick="handleAction('${req.type}', ${req.id}, 'reject')" style="flex: 1; background: #e74c3c; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: bold;">❌ Reject</button>
                </div>
            </div>
        `).join('');
    }
}

async function handleAction(type, id, action) {
    if (!confirm(`Are you sure you want to ${action} this ${type}?`)) return;

    const r = await api('/api/admin/action/', {
        method: 'POST',
        body: JSON.stringify({ type, id, action })
    });

    if (r.ok) {
        tg?.showAlert(r.message);
        loadRequests();
        loadStats();
    } else {
        tg?.showAlert(`Error: ${r.error}`);
    }
}

async function forceStartGame() {
    if (!confirm('Force start the current game immediately?')) return;

    const r = await api('/api/admin/force-start/', { method: 'POST' });
    if (r.ok) {
        tg?.showAlert(r.message);
    } else {
        tg?.showAlert(`Error: ${r.error}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadRequests();
    // Refresh every 10 seconds
    setInterval(() => { loadStats(); loadRequests(); }, 10000);
});