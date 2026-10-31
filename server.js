const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

function loadDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], tugasList: [], submissions: [], nextUserId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.tugasList)) db.tugasList = [];
  if (!Array.isArray(db.submissions)) db.submissions = [];
  if (!db.nextUserId) db.nextUserId = 1;
  return db;
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pass'
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) reject(new Error('too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function isAdmin(req) {
  return (req.headers['x-admin-pass'] || '') === ADMIN_PASS;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fallback = path.join(PUBLIC, 'login.html');
      fs.readFile(fallback, (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + req.headers.host);
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pass'
    });
    return res.end();
  }

  try {
    if (p === '/api/health') return sendJson(res, 200, { ok: true, db: 'server' });

    if (p === '/api/register' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const username = String(body.username || '').trim().toLowerCase();
      const kelas = String(body.kelas || '').trim();
      const pass = String(body.password || '');
      if (!name || !username || pass.length < 4) return sendJson(res, 400, { error: 'Data tidak lengkap' });
      if (!/^[a-z0-9._-]{3,20}$/.test(username)) return sendJson(res, 400, { error: 'Username tidak valid' });
      const db = loadDb();
      if (db.users.some(x => x.username === username)) return sendJson(res, 400, { error: 'Username sudah terdaftar' });
      const user = {
        id: db.nextUserId++,
        username, name, kelas,
        pass: hash(pass),
        created_at: new Date().toISOString()
      };
      db.users.push(user);
      saveDb(db);
      return sendJson(res, 201, { id: user.id, username: user.username, name: user.name, kelas: user.kelas });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const pass = String(body.password || '');
      const db = loadDb();
      const user = db.users.find(x => x.username === username && x.pass === hash(pass));
      if (!user) return sendJson(res, 401, { error: 'Username atau password salah' });
      return sendJson(res, 200, { id: user.id, username: user.username, name: user.name, kelas: user.kelas });
    }

    if (p === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (String(body.password || '') === ADMIN_PASS) return sendJson(res, 200, { ok: true });
      return sendJson(res, 401, { error: 'Password salah' });
    }

    // List tugas (siswa: hide answerKey)
    if (p === '/api/tugas' && req.method === 'GET') {
      const db = loadDb();
      const admin = isAdmin(req);
      let list = (db.tugasList || []).filter(t => admin || t.active !== false);
      if (!admin) {
        list = list.map(t => ({
          ...t,
          questions: (t.questions || []).map(q => {
            const c = { ...q };
            delete c.answerKey;
            return c;
          })
        }));
      }
      return sendJson(res, 200, list);
    }

    // Create tugas (admin)
    if (p === '/api/tugas' && req.method === 'POST') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Admin only' });
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      const mapel = String(body.mapel || '').trim();
      const description = String(body.description || '').trim();
      let questions = Array.isArray(body.questions) ? body.questions : [];
      if (!title || !mapel) return sendJson(res, 400, { error: 'Judul dan mapel wajib' });
      if (!questions.length) return sendJson(res, 400, { error: 'Minimal 1 soal' });
      if (questions.length > 20) return sendJson(res, 400, { error: 'Maksimal 20 soal' });
      questions = questions.map((q, i) => ({
        id: q.id || ('qq_' + Date.now() + '_' + i),
        body: String(q.body || '').trim(),
        options: {
          A: String((q.options && q.options.A) || '').trim(),
          B: String((q.options && q.options.B) || '').trim(),
          C: String((q.options && q.options.C) || '').trim(),
          D: String((q.options && q.options.D) || '').trim()
        },
        answerKey: q.answerKey || null,
        points: parseInt(q.points, 10) || 5
      }));
      const tugas = {
        id: 'tugas_' + Date.now(),
        title, mapel, description,
        active: true,
        questions,
        created_at: new Date().toISOString()
      };
      const db = loadDb();
      db.tugasList.push(tugas);
      saveDb(db);
      return sendJson(res, 201, tugas);
    }

    const delT = p.match(/^\/api\/tugas\/([^/]+)$/);
    if (delT && req.method === 'DELETE') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Admin only' });
      const db = loadDb();
      db.tugasList = db.tugasList.filter(x => x.id !== delT[1]);
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // Get my submission for a tugas
    if (p === '/api/submissions/me' && req.method === 'GET') {
      const userId = u.searchParams.get('userId');
      const tugasId = u.searchParams.get('tugasId');
      if (!userId || !tugasId) return sendJson(res, 400, { error: 'userId & tugasId required' });
      const db = loadDb();
      const sub = (db.submissions || []).find(
        s => String(s.userId) === String(userId) && s.tugasId === tugasId
      );
      return sendJson(res, 200, sub || null);
    }

    // Save / lock answer
    if (p === '/api/submissions/answer' && req.method === 'POST') {
      const body = await readBody(req);
      const userId = body.userId;
      const tugasId = body.tugasId;
      const questionId = body.questionId;
      const answer = String(body.answer || '').trim();
      const lock = !!body.lock;
      if (!userId || !tugasId || !questionId || !answer) {
        return sendJson(res, 400, { error: 'Data tidak lengkap' });
      }
      const db = loadDb();
      const user = db.users.find(x => String(x.id) === String(userId));
      if (!user) return sendJson(res, 400, { error: 'User tidak ditemukan' });
      const tugas = db.tugasList.find(x => x.id === tugasId);
      if (!tugas) return sendJson(res, 400, { error: 'Tugas tidak ditemukan' });
      const q = (tugas.questions || []).find(x => x.id === questionId);
      if (!q) return sendJson(res, 400, { error: 'Soal tidak ditemukan' });

      let idx = db.submissions.findIndex(
        s => String(s.userId) === String(userId) && s.tugasId === tugasId
      );
      let sub = idx >= 0 ? db.submissions[idx] : null;
      if (!sub) {
        sub = {
          userId: user.id,
          username: user.username,
          name: user.name,
          kelas: user.kelas,
          tugasId: tugas.id,
          tugasTitle: tugas.title,
          answers: {},
          updated_at: new Date().toISOString()
        };
        db.submissions.push(sub);
        idx = db.submissions.length - 1;
      }
      if (!sub.answers) sub.answers = {};
      if (sub.answers[questionId] && sub.answers[questionId].locked) {
        return sendJson(res, 400, { error: 'Jawaban sudah terkunci' });
      }
      let autoScore = null;
      if (q.answerKey) autoScore = answer === q.answerKey ? (q.points || 5) : 0;
      sub.answers[questionId] = {
        answer,
        locked: lock,
        autoScore,
        locked_at: lock ? new Date().toISOString() : null
      };
      sub.updated_at = new Date().toISOString();
      db.submissions[idx] = sub;
      saveDb(db);
      return sendJson(res, 200, sub);
    }

    // Admin: all submissions
    if (p === '/api/submissions' && req.method === 'GET') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Admin only' });
      const db = loadDb();
      return sendJson(res, 200, (db.submissions || []).slice().reverse());
    }

    serveStatic(req, res, p);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Server error' });
  }
});

loadDb();
server.listen(PORT, () => {
  console.log('Portal Tugas (server DB) on http://localhost:' + PORT);
  console.log('Database:', DB_PATH);
});
