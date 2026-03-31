const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const webpush = require('web-push');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// --- VAPID Keys ---
// Generate once: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BNq1WuEBMKBMnr4R2x9Gx6XPa6HCQQ3TqV9zMqfEoJv2SGyb4P8GxjAKeMV3hRXiJakqFiGMExyL9fxqDgFxGE';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'your-private-key-here';

try {
  webpush.setVapidDetails(
    'mailto:mamad@family.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('VAPID keys not configured properly. Push notifications will not work.');
  console.warn('Run: npx web-push generate-vapid-keys');
  console.warn('Then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.');
}

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Serve client files
app.use(express.static(path.join(__dirname, '..', 'client')));

// --- State ---
const MEMBERS = ['שי', 'רוי', 'אמנון', 'אורנה'];
const ALERT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const TARGET_CITY = 'קריית אונו';

let state = {
  alertActive: false,
  alertTitle: '',
  alertTime: null,
  expiresAt: null,
  members: {
    'שי': 'none',
    'רוי': 'none',
    'אמנון': 'none',
    'אורנה': 'none'
  }
};

let alertTimer = null;
let lastAlertId = null;
let pushSubscriptions = [];

// --- Helper: Reset state ---
function resetState() {
  state.alertActive = false;
  state.alertTitle = '';
  state.alertTime = null;
  state.expiresAt = null;
  for (const m of MEMBERS) {
    state.members[m] = 'none';
  }
  if (alertTimer) {
    clearTimeout(alertTimer);
    alertTimer = null;
  }
  broadcastState();
}

// --- Helper: Broadcast state to all WebSocket clients ---
function broadcastState() {
  const msg = JSON.stringify({ type: 'state', data: state });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  });
}

// --- Helper: Activate alert ---
function activateAlert(title) {
  const now = Date.now();
  state.alertActive = true;
  state.alertTitle = title;
  state.alertTime = now;
  state.expiresAt = now + ALERT_DURATION_MS;
  for (const m of MEMBERS) {
    state.members[m] = 'none';
  }

  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    console.log('Alert session expired, resetting.');
    resetState();
  }, ALERT_DURATION_MS);

  broadcastState();
  sendPushToAll();
}

// --- Helper: Send push notifications ---
async function sendPushToAll() {
  const payload = JSON.stringify({
    title: '🚨 התרעת פיקוד העורף',
    body: 'יש ירי רקטות! סמן אם אתה מגיע לממד',
    url: '/'
  });

  const validSubscriptions = [];
  for (const sub of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      validSubscriptions.push(sub);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log('Removing expired push subscription');
      } else {
        console.error('Push error:', err.message);
        validSubscriptions.push(sub); // keep on non-fatal errors
      }
    }
  }
  pushSubscriptions = validSubscriptions;
}

// --- Pikud HaOref Polling ---
let pollErrorCount = 0;

function pollOref() {
  const options = {
    hostname: 'www.oref.org.il',
    path: '/WarningMessages/alert/alerts.json',
    method: 'GET',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.oref.org.il/',
      'Accept': 'application/json'
    },
    timeout: 5000
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        pollErrorCount = 0;
        if (!data || data.trim() === '' || data.trim() === '[]') {
          return; // No active alert
        }
        const alert = JSON.parse(data);
        if (!alert || !alert.data || !Array.isArray(alert.data)) return;

        if (alert.data.includes(TARGET_CITY)) {
          if (alert.id !== lastAlertId) {
            console.log(`Alert detected for ${TARGET_CITY}: ${alert.title}`);
            lastAlertId = alert.id;
            activateAlert(alert.title || 'ירי רקטות וטילים');
          }
        }
      } catch (e) {
        // Response wasn't valid JSON — this is normal when there's no alert
      }
    });
  });

  req.on('error', (err) => {
    pollErrorCount++;
    console.error(`Oref poll error (${pollErrorCount}):`, err.message);
  });

  req.on('timeout', () => {
    req.destroy();
  });

  req.end();
}

// Start polling every 2 seconds, with 5s retry on repeated errors
setInterval(() => {
  try {
    pollOref();
  } catch (e) {
    console.error('Unexpected polling error:', e.message);
  }
}, pollErrorCount > 3 ? 5000 : 2000);

// --- WebSocket ---
wss.on('connection', (ws) => {
  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', data: state }));

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'status' && MEMBERS.includes(parsed.member)) {
        if (['coming', 'not-coming'].includes(parsed.status)) {
          state.members[parsed.member] = parsed.status;
          broadcastState();
        }
      }
      // Dev: simulate alert
      if (parsed.type === 'test-alert') {
        console.log('Test alert triggered');
        lastAlertId = 'test-' + Date.now();
        activateAlert('התרעת בדיקה — ירי רקטות וטילים');
      }
    } catch (e) {
      console.error('WebSocket message error:', e.message);
    }
  });
});

// --- REST Endpoints ---
app.get('/state', (req, res) => {
  res.json(state);
});

app.post('/status', (req, res) => {
  const { member, status } = req.body;
  if (!MEMBERS.includes(member)) return res.status(400).json({ error: 'Invalid member' });
  if (!['coming', 'not-coming'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  state.members[member] = status;
  broadcastState();
  res.json({ ok: true });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  // Remove duplicate endpoint if exists
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
  pushSubscriptions.push(sub);
  console.log(`Push subscription added. Total: ${pushSubscriptions.length}`);
  res.json({ ok: true });
});

app.get('/vapidPublicKey', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

// Test endpoint for dev mode
app.post('/test-alert', (req, res) => {
  lastAlertId = 'test-' + Date.now();
  activateAlert('התרעת בדיקה — ירי רקטות וטילים');
  res.json({ ok: true });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Mamad Family server running on port ${PORT}`);
  console.log(`Polling Pikud HaOref for alerts in: ${TARGET_CITY}`);
});
