const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite database file
const db = new Database(path.join('/tmp', 'analytics.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    details TEXT,
    url TEXT,
    user_agent TEXT,
    device TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logged_at TEXT DEFAULT (datetime('now')),
    event_type TEXT,
    payload TEXT,
    ip TEXT
  );
`);

console.log('Database ready.');

app.use(cors());
app.use(bodyParser.json());

const ACCEPTED_EVENTS = new Set(['page_view', 'click', 'email_click']);

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function validateLogPayload({ eventType, details, url, userAgent, device }) {
  const ev = normalizeString(eventType);
  if (!ev || !ACCEPTED_EVENTS.has(ev)) {
    return { valid: false, error: 'Invalid eventType' };
  }
  if (details && typeof details !== 'object') {
    return { valid: false, error: 'details must be JSON object' };
  }
  return {
    valid: true,
    data: {
      eventType: ev,
      details: details || {},
      url: normalizeString(url),
      userAgent: normalizeString(userAgent),
      device: ['mobile', 'tablet', 'desktop'].includes(device) ? device : 'unknown',
    },
  };
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Analytics backend running' });
});

app.post('/api/log', (req, res) => {
  const validation = validateLogPayload(req.body);
  if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });
  const { eventType, details, url, userAgent, device } = validation.data;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  try {
    const result = db.prepare(
      'INSERT INTO logs (event_type, details, url, user_agent, device, ip) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventType, JSON.stringify(details), url, userAgent, device, ip);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('DB log error:', err);
    res.status(500).json({ success: false, error: 'DB insert failed' });
  }
});

app.post('/api/send-email', (req, res) => {
  const validation = validateLogPayload(req.body);
  if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });
  const { eventType, details, url, userAgent, device } = validation.data;
  if (eventType !== 'email_click') return res.status(400).json({ success: false, error: 'send-email must be email_click event' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  try {
    const result = db.prepare('INSERT INTO email_logs (event_type, payload, ip) VALUES (?, ?, ?)').run(
      eventType, JSON.stringify({ details, url, userAgent, device }), ip
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Email log error:', err);
    res.status(500).json({ success: false, error: 'DB insert failed' });
  }
});

app.get('/api/logs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 200').all();
    res.json({ success: true, logs: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Query failed' });
  }
});

app.get('/api/email-logs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM email_logs ORDER BY id DESC LIMIT 200').all();
    res.json({ success: true, logs: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Query failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Analytics backend listening on port ${PORT}`);
});