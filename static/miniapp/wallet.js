const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d111a'); }
const INIT_DATA = tg?.initData || '';

async function api(path) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA };
    return (await fetch(path, { headers })).json();
}

async function loadWallet() {
    const r = await api('/api/wallet/');
    if (r.ok) {
        document.getElementById('walletBal').textContent = parseFloat(r.balance).toFixed(2);

        const list = document.getElementById('txList');
        if (r.transactions.length > 0) {
            list.innerHTML = r.transactions.map(t => {
                const isPositive = parseFloat(t.amount) >= 0;
                const color = isPositive ? '#27ae60' : '#e74c3c';
                const sign = isPositive ? '+' : '';
                return `
                    <div style="background: #1e2230; padding: 12px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="color: white; font-weight: bold; font-size: 14px;">${t.note}</div>
                            <div style="color: #a8a8b3; font-size: 11px; margin-top: 3px;">${t.date}</div>
                        </div>
                        <div style="color: ${color}; font-weight: bold; font-size: 16px;">${sign}${t.amount} ETB</div>
                    </div>
                `;
            }).join('');
        } else {
            list.innerHTML = '<p style="color: #a8a8b3; text-align: center;">No transactions yet.</p>';
        }
    }
}
document.addEventListener('DOMContentLoaded', loadWallet);