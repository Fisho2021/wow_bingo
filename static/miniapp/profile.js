const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#151924'); }
const INIT_DATA = tg?.initData || '';

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA, ...(opts.headers || {}) };
    return (await fetch(path, { ...opts, headers })).json();
}

// Load Data
async function loadProfile() {
    const r = await api('/api/me/');
    if (r.ok) {
        const u = r.user;
        document.getElementById('avatarLetter').textContent = (u.first_name || 'U').charAt(0).toUpperCase();
        document.getElementById('profileUsername').textContent = '@' + (u.username || u.first_name);
        document.getElementById('walletMain').innerHTML = `${parseFloat(u.balance).toFixed(0)} <span style="font-size: 12px; color: #27ae60;">ETB</span>`;
        document.getElementById('walletPlay').innerHTML = `${parseFloat(u.balance).toFixed(0)} <span style="font-size: 12px; color: #3498db;">ETB</span>`;
        document.getElementById('nicknameInput').value = u.nickname || '';

        document.getElementById('statWin').textContent = "0";
        document.getElementById('statInvite').textContent = u.total_invite || "0";
        document.getElementById('statEarned').textContent = parseFloat(u.total_earned || 0).toFixed(0);
    }
}

// Save Nickname
async function saveNickname() {
    const nick = document.getElementById('nicknameInput').value.trim();
    if (!nick) { tg?.showAlert("Please enter a nickname."); return; }

    const r = await api('/api/me/nickname/', {
        method: 'POST',
        body: JSON.stringify({ nickname: nick })
    });

    if (r.ok) {
        tg?.showAlert("✅ Nickname updated successfully!");
        loadProfile(); // Reload data to show the new name
    } else {
        tg?.showAlert(`❌ Error: ${r.error}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    updateSoundUI();
    // Make sure this listener is attached
    document.getElementById('saveNicknameBtn')?.addEventListener('click', saveNickname);
});

// Sound Toggle Logic
let soundOn = localStorage.getItem('soundOn') !== 'false'; // Default to true

function updateSoundUI() {
    const toggle = document.getElementById('soundToggle');
    const knob = document.getElementById('soundToggleKnob');
    const icon = document.getElementById('soundIcon');

    if (soundOn) {
        toggle.style.background = '#27ae60';
        knob.style.right = '3px';
        knob.style.left = 'auto';
        icon.textContent = '🔊';
    } else {
        toggle.style.background = '#666';
        knob.style.left = '3px';
        knob.style.right = 'auto';
        icon.textContent = '🔇';
    }
}

function toggleSoundSetting() {
    soundOn = !soundOn;
    localStorage.setItem('soundOn', soundOn);
    updateSoundUI();
}

document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    updateSoundUI();
    document.getElementById('saveNicknameBtn')?.addEventListener('click', saveNickname);
});