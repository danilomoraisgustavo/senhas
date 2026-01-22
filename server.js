/**
 * PyDen Senhas - server.js (PostgreSQL RDS) - Premium Update
 * - Express + Session + Socket.IO
 * - Auth (register/login) com bcrypt
 * - Reverse proxy friendly (Nginx): trust proxy + cookie secure em produção
 * - Geração de senhas: unitária e por intervalo (inteligente) com dedupe por dia
 *
 * Requisitos:
 *   npm i express express-session socket.io pg bcryptjs dotenv
 *
 * ENV (.env):
 *   NODE_ENV=production
 *   PORT=7000
 *   DATABASE_URL=postgres://user:pass@host:5432/senhas
 *   SESSION_SECRET=...
 *   PG_SSL=true|false (opcional; default true)
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const http = require('http');
const socketIO = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: true, credentials: true } });

// -------------------- ENV --------------------
const PORT = Number(process.env.PORT || 7000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

if (!process.env.DATABASE_URL) console.error('[ENV] DATABASE_URL não definido (.env).');
if (!process.env.SESSION_SECRET) console.error('[ENV] SESSION_SECRET não definido (.env).');

// -------------------- DB (Postgres) --------------------
// Para AWS RDS: SELF_SIGNED_CERT_IN_CHAIN é comum. rejectUnauthorized:false destrava.
// Se quiser validação estrita, use CA bundle e rejectUnauthorized:true.
const useSsl = String(process.env.PG_SSL || 'true').toLowerCase() !== 'false';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000)
});

(async () => {
  try {
    const r = await pool.query(
      'SELECT current_database() db, inet_server_addr() ip, inet_server_port() port, current_user u'
    );
    console.log('[DB] OK:', r.rows[0]);
  } catch (e) {
    console.error('[DB] Falha:', e);
  }
})();

// -------------------- Middlewares --------------------
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  name: 'senhas.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,          // precisa de HTTPS em produção
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// -------------------- Helpers --------------------
function checkAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ success: false, message: 'Não autenticado' });
}

function normalizeTipo(tipo) {
  const t = String(tipo || '').toUpperCase().trim();
  return (t === 'N' || t === 'P') ? t : null;
}

function toPositiveInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// Limites (mantém sua regra atual)
async function checkLimitesSenhasNormaisParaInserir(qtyToInsert) {
  // dia
  const dayCount = await pool.query(
    "SELECT COUNT(*)::int AS total FROM senhas WHERE tipo='N' AND DATE(created_at) = CURRENT_DATE"
  );
  if (dayCount.rows[0].total + qtyToInsert > 400) {
    return { ok: false, message: 'Limite diário de senhas normais atingido (400).' };
  }

  // turno
  const currentHour = new Date().getHours();
  const shiftCondition = currentHour < 12
    ? "EXTRACT(HOUR FROM created_at) < 12"
    : "EXTRACT(HOUR FROM created_at) >= 12";

  const shiftCount = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM senhas
     WHERE tipo='N' AND DATE(created_at) = CURRENT_DATE AND ${shiftCondition}`
  );

  if (shiftCount.rows[0].total + qtyToInsert > 200) {
    return { ok: false, message: 'Limite de senhas normais por turno atingido (200).' };
  }

  return { ok: true };
}

// -------------------- Routes --------------------
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 ok, current_database() db');
    res.json({ ok: true, db: r.rows[0].db, env: NODE_ENV });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/dashboard', (req, res) => {
  if (!req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

// -------------------- Auth --------------------
app.post('/register', async (req, res) => {
  try {
    const { nomeCompleto, email, senha, sala, mesa } = req.body;

    const nome = String(nomeCompleto || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    const pass = String(senha || '');

    if (!nome || !mail || !pass || !sala || !mesa) {
      return res.json({ success: false, message: 'Preencha todos os campos.' });
    }

    const exists = await pool.query('SELECT id FROM users_senhas WHERE email = $1 LIMIT 1', [mail]);
    if (exists.rows.length > 0) {
      return res.json({ success: false, message: 'E-mail já cadastrado!' });
    }

    const hash = await bcrypt.hash(pass, 10);

    await pool.query(
      `INSERT INTO users_senhas (nomecompleto, email, senha, sala, mesa)
       VALUES ($1, $2, $3, $4, $5)`,
      [nome, mail, hash, String(sala), String(mesa)]
    );

    return res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
  } catch (e) {
    console.error('[REGISTER] erro:', e);
    return res.json({ success: false, message: 'Erro ao cadastrar usuário.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const mail = String(email || '').trim().toLowerCase();
    const pass = String(senha || '');

    if (!mail || !pass) return res.json({ success: false, message: 'Informe e-mail e senha.' });

    const result = await pool.query(
      'SELECT id, nomecompleto, senha FROM users_senhas WHERE email = $1 LIMIT 1',
      [mail]
    );

    if (result.rows.length === 0) return res.json({ success: false, message: 'Usuário não encontrado.' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(pass, user.senha);
    if (!ok) return res.json({ success: false, message: 'Senha incorreta.' });

    req.session.userId = user.id;

    return res.json({ success: true, message: `Bem-vindo, ${user.nomecompleto}!`, redirect: '/dashboard' });
  } catch (e) {
    console.error('[LOGIN] erro:', e);
    return res.json({ success: false, message: 'Erro ao acessar o banco de dados.' });
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// -------------------- Senhas --------------------

// Cadastro unitário (mantém endpoint)
app.post('/cadastrar-senha', checkAuth, async (req, res) => {
  try {
    const tipo = normalizeTipo(req.body.tipo);
    const numero = toPositiveInt(req.body.numero);

    if (!tipo) return res.json({ mensagem: 'Tipo inválido.' });
    if (!numero) return res.json({ mensagem: 'Número inválido.' });

    if (tipo === 'N') {
      const lim = await checkLimitesSenhasNormaisParaInserir(1);
      if (!lim.ok) return res.json({ mensagem: lim.message });
    }

    // Dedupe por dia (evita repetir número do mesmo tipo no mesmo dia)
    const insert = await pool.query(
      `INSERT INTO senhas (tipo, numero, created_at, chamada)
       SELECT $1, $2, NOW(), 0
       WHERE NOT EXISTS (
         SELECT 1 FROM senhas s
         WHERE s.tipo = $1 AND s.numero = $2 AND DATE(s.created_at) = CURRENT_DATE
       )
       RETURNING id`,
      [tipo, numero]
    );

    if (insert.rowCount === 0) {
      return res.json({ mensagem: `Já existe a senha ${tipo}${numero} hoje. (não inserida)` });
    }

    return res.json({ mensagem: `Senha cadastrada: ${tipo}${numero}` });
  } catch (e) {
    console.error('[CADASTRAR-SENHA] erro:', e);
    return res.json({ mensagem: 'Erro ao cadastrar senha.' });
  }
});

// NOVO: gerar por intervalo (inteligente)
app.post('/gerar-intervalo', checkAuth, async (req, res) => {
  try {
    const tipo = normalizeTipo(req.body.tipo);
    const inicio = toPositiveInt(req.body.inicio);
    const fim = toPositiveInt(req.body.fim);

    if (!tipo) return res.json({ ok: false, mensagem: 'Tipo inválido.' });
    if (!inicio || !fim) return res.json({ ok: false, mensagem: 'Informe início e fim válidos.' });

    const start = Math.min(inicio, fim);
    const end = Math.max(inicio, fim);
    const rangeSize = (end - start) + 1;

    // proteção básica (evitar geração absurda)
    const maxBatch = Number(process.env.MAX_BATCH || 500);
    if (rangeSize > maxBatch) {
      return res.json({ ok: false, mensagem: `Intervalo grande demais. Máximo permitido: ${maxBatch} senhas por geração.` });
    }

    if (tipo === 'N') {
      // limite considera o pior caso (todas novas). Depois o SQL pode pular duplicadas.
      const lim = await checkLimitesSenhasNormaisParaInserir(rangeSize);
      if (!lim.ok) return res.json({ ok: false, mensagem: lim.message });
    }

    // Insere usando generate_series, pulando números já existentes HOJE
    const q = await pool.query(
      `
      WITH serie AS (
        SELECT gs::int AS numero
        FROM generate_series($2::int, $3::int) gs
      ),
      inseridos AS (
        INSERT INTO senhas (tipo, numero, created_at, chamada)
        SELECT $1, s.numero, NOW(), 0
        FROM serie s
        WHERE NOT EXISTS (
          SELECT 1 FROM senhas x
          WHERE x.tipo = $1 AND x.numero = s.numero AND DATE(x.created_at) = CURRENT_DATE
        )
        RETURNING numero
      )
      SELECT
        (SELECT COUNT(*)::int FROM inseridos) AS inseridos,
        (SELECT COUNT(*)::int FROM serie) AS solicitados
      `,
      [tipo, start, end]
    );

    const inserted = q.rows[0]?.inseridos ?? 0;
    const requested = q.rows[0]?.solicitados ?? rangeSize;
    const skipped = requested - inserted;

    return res.json({
      ok: true,
      mensagem: `Geradas ${inserted} senha(s) (${tipo}${start} a ${tipo}${end}).` + (skipped > 0 ? ` ${skipped} já existiam hoje e foram ignoradas.` : ''),
      inseridos: inserted,
      ignorados: skipped,
      intervalo: { tipo, inicio: start, fim: end }
    });
  } catch (e) {
    console.error('[GERAR-INTERVALO] erro:', e);
    return res.json({ ok: false, mensagem: 'Erro ao gerar intervalo.' });
  }
});

// Chamar próxima senha
app.post('/chamar-senha', checkAuth, async (req, res) => {
  try {
    const tipo = normalizeTipo(req.body.tipo);
    if (!tipo) return res.json({ sucesso: false, mensagem: 'Tipo inválido.' });

    const userId = req.session.userId;

    const next = await pool.query(
      `SELECT id, tipo, numero
       FROM senhas
       WHERE tipo = $1 AND chamada = 0
       ORDER BY id ASC
       LIMIT 1`,
      [tipo]
    );

    if (next.rows.length === 0) {
      return res.json({ sucesso: false, mensagem: 'Não há senhas desse tipo na fila.' });
    }

    const row = next.rows[0];

    const userRes = await pool.query(
      'SELECT sala, mesa FROM users_senhas WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.json({ sucesso: false, mensagem: 'Erro ao obter dados do usuário.' });
    }

    const userRow = userRes.rows[0];

    await pool.query(
      'UPDATE senhas SET chamada = 1, chamadopor = $1, updated_at = NOW() WHERE id = $2',
      [userId, row.id]
    );

    const senhaChamada = { tipo: row.tipo, numero: row.numero, sala: userRow.sala, mesa: userRow.mesa };
    io.emit('senhaChamada', senhaChamada);

    return res.json({ sucesso: true, senha: `${row.tipo}${row.numero}` });
  } catch (e) {
    console.error('[CHAMAR-SENHA] erro:', e);
    return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
  }
});

// Rechamar última senha
app.post('/rechamar-senha', checkAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const last = await pool.query(
      `SELECT s.id, s.tipo, s.numero, u.sala, u.mesa
       FROM senhas s
       JOIN users_senhas u ON u.id = s.chamadopor
       WHERE s.chamadopor = $1
       ORDER BY s.id DESC
       LIMIT 1`,
      [userId]
    );

    if (last.rows.length === 0) {
      return res.json({ sucesso: false, mensagem: 'Você ainda não chamou nenhuma senha.' });
    }

    const row = last.rows[0];

    await pool.query('UPDATE senhas SET updated_at = NOW() WHERE id = $1', [row.id]);

    const senhaChamada = { tipo: row.tipo, numero: row.numero, sala: row.sala, mesa: row.mesa };
    io.emit('senhaChamada', senhaChamada);

    return res.json({ sucesso: true, senha: `${row.tipo}${row.numero}` });
  } catch (e) {
    console.error('[RECHAMAR-SENHA] erro:', e);
    return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
  }
});

// Limpar senhas
app.post('/limpar-senhas', checkAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM senhas');
    await pool.query('ALTER SEQUENCE senhas_id_seq RESTART WITH 1');
    return res.json({ mensagem: 'Tabela de senhas limpa com sucesso!' });
  } catch (e) {
    console.error('[LIMPAR-SENHAS] erro:', e);
    return res.json({ mensagem: 'Erro ao limpar tabela de senhas.' });
  }
});

// Socket.IO
io.on('connection', () => console.log('Cliente conectado ao Socket.io'));

// Start
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
