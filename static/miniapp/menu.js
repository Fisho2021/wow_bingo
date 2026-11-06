const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#151924'); }
const INIT_DATA = tg?.initData || '';

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA, ...(opts.headers || {}) };
    return (await fetch(path, { ...opts, headers })).json();
}

async function loadDashboard() {
    try {
        const r = await api('/api/dashboard/');
        console.log("Dashboard Data:", r);

        if (r.ok) {
            document.getElementById('dashBalance').textContent = parseFloat(r.balance).toFixed(0);

            // 👇 ADMIN REVEAL LOGIC
            if (r.is_admin) {
                const adminPanel = document.getElementById('adminPanel');
                if (adminPanel) adminPanel.style.display = 'block';

                const adminBtn = document.getElementById('adminControlBtn');
                if (adminBtn) adminBtn.style.display = 'block';

                document.getElementById('dashPlatformBalance').textContent = parseFloat(r.platform_balance).toFixed(0);
            }
            // (Removed the else statement so normal users don't see any popup)
        }
    } catch (e) {
        console.error("Dashboard error:", e);
    }
}

// Check Balance
async function checkBalance() {
    const r = await api('/api/me/');
    if (r.ok) {
        tg?.showAlert(`💰 Your current balance is ${parseFloat(r.user.balance).toFixed(2)} birr.`);
    }
}

// Modal Controls
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    if (id === 'referralModal') loadReferrals();
}
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Referrals
async function loadReferrals() {
    const r = await api('/api/referrals/');
    if (r.ok) {
        document.getElementById('refLink').value = r.link;
        document.getElementById('refList').innerHTML = r.list.map(x => `<div style="padding: 5px 0; border-bottom: 1px solid #ccc;">👤 ${x.name} (${x.date})</div>`).join('') || '<div style="color: #666;">No referrals yet.</div>';
    }
}

function copyRefLink() {
    const txt = document.getElementById('refLink').value;
    navigator.clipboard.writeText(txt).then(() => {
        if (tg) tg.showAlert("✅ Referral link copied! Share it with friends.");
        else alert("Copied!");
    });
}

function showInstructions() {
    tg?.showAlert("📖 How to play:\n1. Buy cartelas.\n2. Wait for countdown.\n3. Tap called numbers.\n4. Make a line and press BINGO!");
}

// Initialize on load
document.addEventListener('DOMContentLoaded', loadDashboard);
