const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'website_analytics',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

app.use(cors());
app.use(bodyParser.json());

async function ensureSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        details JSON,
        url TEXT,
        user_agent TEXT,
        device VARCHAR(20),
        ip VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        event_type VARCHAR(50),
        payload JSON,
        ip VARCHAR(45)
      ) ENGINE=InnoDB;
    `);
  } finally {
    conn.release();
  }
}

ensureSchema().catch(err => {
  console.error('Schema initialization failed:', err);
  process.exit(1);
});

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

  const normalized = {
    eventType: ev,
    details: details || {},
    url: normalizeString(url),
    userAgent: normalizeString(userAgent),
    device: ['mobile', 'tablet', 'desktop'].includes(device) ? device : 'unknown',
  };

  return { valid: true, data: normalized };
}

app.post('/api/log', async (req, res) => {
  try {
    const validation = validateLogPayload(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const { eventType, details, url, userAgent, device } = validation.data;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const [result] = await pool.query(
      'INSERT INTO logs (event_type, details, url, user_agent, device, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [eventType, JSON.stringify(details), url, userAgent, device, ip]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('DB log error:', err);
    res.status(500).json({ success: false, error: 'DB insert failed' });
  }
});

app.post('/api/send-email', async (req, res) => {
  try {
    const validation = validateLogPayload(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const { eventType, details, url, userAgent, device } = validation.data;
    if (eventType !== 'email_click') {
      return res.status(400).json({ success: false, error: 'send-email must be email_click event' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const [result] = await pool.query(
      'INSERT INTO email_logs (event_type, payload, ip) VALUES (?, ?, ?)',
      [eventType, JSON.stringify({ details, url, userAgent, device }), ip]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Email log error:', err);
    res.status(500).json({ success: false, error: 'DB insert failed' });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM logs ORDER BY id DESC LIMIT 200');
    res.json({ success: true, logs: rows });
  } catch (err) {
    console.error('Query logs error:', err);
    res.status(500).json({ success: false, error: 'Query failed' });
  }
});

app.get('/api/email-logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM email_logs ORDER BY id DESC LIMIT 200');
    res.json({ success: true, logs: rows });
  } catch (err) {
    console.error('Query email-logs error:', err);
    res.status(500).json({ success: false, error: 'Query failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Analytics backend listening at http://localhost:${PORT}`);
});
