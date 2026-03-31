// ============================
// Configuration
// ============================
// Change this to your deployed server URL (no trailing slash)
// For local development: '' (empty string = same origin)
// For deployed backend: 'https://your-app.up.railway.app'
const SERVER_URL = '';

// ============================
// State
// ============================
let currentUser = localStorage.getItem('mamad-user');
let ws = null;
let appState = null;
let countdownInterval = null;
let devTapCount = 0;
let devTapTimer = null;
let devMode = false;

// ============================
// DOM Elements
// ============================
const onboardingScreen = document.getElementById('onboarding');
const appScreen = document.getElementById('app');
const userName = document.getElementById('user-name');
const switchUserBtn = document.getElementById('switch-user');
const alertBanner = document.getElementById('alert-banner');
const alertTitle = document.getElementById('alert-title');
const alertTimer = document.getElementById('alert-timer');
const noAlert = document.getElementById('no-alert');
const actionButtons = document.getElementById('action-buttons');
const btnComing = document.getElementById('btn-coming');
const btnNotComing = document.getElementById('btn-not-coming');
const familyList = document.getElementById('family-list');
const connectionStatus = document.getElementById('connection-status');
const devIndicator = document.getElementById('dev-indicator');
const devTestBtn = document.getElementById('dev-test-btn');
const appTitleEl = document.getElementById('app-title');

// ============================
// Onboarding
// ============================
function showOnboarding() {
  onboardingScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

function showApp() {
  onboardingScreen.style.display = 'none';
  appScreen.style.display = 'flex';
  userName.textContent = currentUser;
  connectWebSocket();
  registerPush();
}

document.querySelectorAll('.member-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentUser = btn.dataset.member;
    localStorage.setItem('mamad-user', currentUser);
    showApp();
  });
});

switchUserBtn.addEventListener('click', () => {
  localStorage.removeItem('mamad-user');
  currentUser = null;
  if (ws) ws.close();
  showOnboarding();
});

// ============================
// WebSocket Connection
// ============================
function getWsUrl() {
  if (SERVER_URL) {
    const url = new URL(SERVER_URL);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}`;
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}`;
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  try {
    ws = new WebSocket(getWsUrl());
  } catch (e) {
    console.error('WebSocket creation failed:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('WebSocket connected');
    connectionStatus.textContent = 'מחובר';
    connectionStatus.classList.remove('disconnected');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'state') {
        handleStateUpdate(msg.data);
      }
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    connectionStatus.textContent = 'מנותק — מתחבר מחדש...';
    connectionStatus.classList.add('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

function scheduleReconnect() {
  setTimeout(() => {
    if (!currentUser) return;
    connectWebSocket();
  }, 3000);
}

// ============================
// State Update Handler
// ============================
let previousAlertActive = false;

function handleStateUpdate(newState) {
  const wasActive = appState?.alertActive;
  appState = newState;

  // Play sound on new alert
  if (newState.alertActive && !wasActive) {
    playAlertSound();
  }

  updateUI();
}

function updateUI() {
  if (!appState) return;

  // Alert banner
  if (appState.alertActive) {
    alertBanner.classList.add('active');
    alertTitle.textContent = `🚨 התרעה פעילה — ${appState.alertTitle}`;
    noAlert.classList.add('hidden');
    actionButtons.classList.add('active');
    startCountdown();
  } else {
    alertBanner.classList.remove('active');
    noAlert.classList.remove('hidden');
    actionButtons.classList.remove('active');
    stopCountdown();
  }

  // Action buttons — highlight current user's selection
  const myStatus = appState.members[currentUser];
  btnComing.classList.toggle('selected', myStatus === 'coming');
  btnNotComing.classList.toggle('selected', myStatus === 'not-coming');
  actionButtons.classList.toggle('has-selection', myStatus !== 'none');

  // Family status list
  updateFamilyList();
}

function updateFamilyList() {
  const members = ['שי', 'רוי', 'אמנון', 'אורנה'];
  familyList.innerHTML = '';

  for (const name of members) {
    const status = appState.members[name] || 'none';
    const div = document.createElement('div');
    div.className = `member-status status-${status}`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'member-name';
    nameSpan.textContent = name;
    if (name === currentUser) nameSpan.textContent += ' (אתה)';

    const badge = document.createElement('span');
    badge.className = 'member-badge';
    if (status === 'coming') badge.textContent = '✅ מגיע';
    else if (status === 'not-coming') badge.textContent = '❌ לא מגיע';
    else badge.textContent = '⏳ לא ענה';

    div.appendChild(nameSpan);
    div.appendChild(badge);
    familyList.appendChild(div);
  }
}

// ============================
// Countdown Timer
// ============================
function startCountdown() {
  stopCountdown();
  updateCountdownDisplay();
  countdownInterval = setInterval(updateCountdownDisplay, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  alertTimer.textContent = '';
}

function updateCountdownDisplay() {
  if (!appState || !appState.expiresAt) return;
  const remaining = appState.expiresAt - Date.now();
  if (remaining <= 0) {
    alertTimer.textContent = 'הזמן נגמר';
    stopCountdown();
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  alertTimer.textContent = `זמן שנותר: ${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================
// Action Buttons
// ============================
btnComing.addEventListener('click', () => sendStatus('coming'));
btnNotComing.addEventListener('click', () => sendStatus('not-coming'));

function sendStatus(status) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    // Fallback to HTTP
    fetch(`${SERVER_URL}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member: currentUser, status })
    }).catch(e => console.error('Status HTTP fallback failed:', e));
    return;
  }
  ws.send(JSON.stringify({ type: 'status', member: currentUser, status }));
}

// ============================
// Alert Sound (Web Audio API)
// ============================
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Android notification chime — played twice for emphasis
    const notes = [
      // First chime
      { freq: 783.99, start: 0, dur: 0.22 },       // G5
      { freq: 1046.50, start: 0.25, dur: 0.22 },   // C6
      { freq: 987.77, start: 0.50, dur: 0.30 },    // B5
      // Pause, then second chime
      { freq: 783.99, start: 1.0, dur: 0.22 },     // G5
      { freq: 1046.50, start: 1.25, dur: 0.22 },   // C6
      { freq: 987.77, start: 1.50, dur: 0.30 },    // B5
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + note.start);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + note.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + note.start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + note.start);
      osc.stop(ctx.currentTime + note.start + note.dur + 0.05);
    }
    // Vibrate pattern: buzz, pause, buzz (works on Android)
    if (navigator.vibrate) {
      navigator.vibrate([300, 200, 300, 200, 300]);
    }
  } catch (e) {
    console.warn('Could not play alert sound:', e);
  }
}

// ============================
// Push Notifications
// ============================
async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;

    // Get VAPID key from server
    const res = await fetch(`${SERVER_URL}/vapidPublicKey`);
    const { key } = await res.json();

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Subscribe
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });

    // Send subscription to server
    await fetch(`${SERVER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });

    console.log('Push subscription registered');
  } catch (e) {
    console.warn('Push registration failed:', e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ============================
// Dev Mode (tap title 5 times)
// ============================
appTitleEl.addEventListener('click', () => {
  devTapCount++;
  if (devTapTimer) clearTimeout(devTapTimer);
  devTapTimer = setTimeout(() => { devTapCount = 0; }, 3000);

  if (devTapCount >= 3) {
    devMode = !devMode;
    devIndicator.classList.toggle('active', devMode);
    devTapCount = 0;
  }
});

devTestBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'test-alert' }));
  } else {
    fetch(`${SERVER_URL}/test-alert`, { method: 'POST' })
      .catch(e => console.error('Test alert failed:', e));
  }
});

// ============================
// Service Worker Registration
// ============================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('SW registered'))
    .catch(err => console.warn('SW registration failed:', err));
}

// ============================
// Init
// ============================
if (currentUser) {
  showApp();
} else {
  showOnboarding();
}
