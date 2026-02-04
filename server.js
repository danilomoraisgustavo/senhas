/**
 * PyDen Senhas - server.js (PostgreSQL)
 * Filas: Estadual (E) e Municipal (M)
 * Tipos: Normal (N) e Prioridade (P)
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
 *   MAX_BATCH=500 (opcional)
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const http = require('http');
const socketIO = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// In-memory print jobs (token -> { userId, createdAt, items: [{id,fila,tipo,numero,created_at}] })
const printJobs = new Map();
const PRINT_JOB_TTL_MS = 5 * 60 * 1000; // 5 min

function createPrintJob(userId, items) {
  const token = crypto.randomUUID();
  printJobs.set(token, { userId, createdAt: Date.now(), items });
  return token;
}

function getPrintJob(token, userId) {
  const job = printJobs.get(token);
  if (!job) return null;
  if (job.userId !== userId) return null;
  if (Date.now() - job.createdAt > PRINT_JOB_TTL_MS) {
    printJobs.delete(token);
    return null;
  }
  return job;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of printJobs.entries()) {
    if (now - v.createdAt > PRINT_JOB_TTL_MS) printJobs.delete(k);
  }
}, 60 * 1000).unref();

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
    secure: IS_PROD,
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

function normalizeFila(fila) {
  const f = String(fila || '').toUpperCase().trim();
  return (f === 'E' || f === 'M') ? f : null;
}

function toPositiveInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Limites (por FILA, para separar as filas)
async function checkLimitesSenhasNormaisParaInserir(fila, qtyToInsert) {
  const dayCount = await pool.query(
    "SELECT COUNT(*)::int AS total FROM senhas WHERE fila=$1 AND tipo='N' AND DATE(created_at) = CURRENT_DATE",
    [fila]
  );
  if (dayCount.rows[0].total + qtyToInsert > 400) {
    return { ok: false, message: `Limite diário de senhas normais atingido (400) para a fila ${fila}.` };
  }

  const currentHour = new Date().getHours();
  const shiftCondition = currentHour < 12
    ? "EXTRACT(HOUR FROM created_at) < 12"
    : "EXTRACT(HOUR FROM created_at) >= 12";

  const shiftCount = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM senhas
     WHERE fila=$1 AND tipo='N' AND DATE(created_at) = CURRENT_DATE AND ${shiftCondition}`,
    [fila]
  );

  if (shiftCount.rows[0].total + qtyToInsert > 200) {
    return { ok: false, message: `Limite de senhas normais por turno atingido (200) para a fila ${fila}.` };
  }

  return { ok: true };
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function filaLabel(fila) {
  return fila === 'E' ? 'Estadual' : 'Municipal';
}

function tipoLabel(tipo) {
  return tipo === 'P' ? 'Prioridade' : 'Normal';
}

function renderThermalTickets(items, opts = {}) {
  const title = opts.title || 'SETRANE EXPRESS';
  const subtitle = opts.subtitle || 'Senha de Atendimento';
  const now = new Date();
  const tz = 'America/Sao_Paulo';
  const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: tz });
  const printedAt = fmt(now);

  const tickets = items.map(it => {
    const fila = escapeHtml(filaLabel(it.fila));
    const tipo = escapeHtml(tipoLabel(it.tipo));
    const numero = escapeHtml(it.numero);
    const senha = `${it.fila}${it.tipo}${numero}`;
    const created = it.created_at ? fmt(it.created_at) : printedAt;

    return `
      <div class="ticket">
        <p class="brand">${escapeHtml(title)}</p>
        <p class="sub">${escapeHtml(subtitle)}</p>
        <p class="meta">${fila} • ${tipo}</p>
        <p class="emitida">Emitida: ${escapeHtml(created)}</p>

        <div class="divider"></div>

        <p class="senha-label">Sua senha</p>
        <p class="senha">${escapeHtml(senha)}</p>

        <div class="divider"></div>

        <div class="footer">Por favor, aguarde ser chamado no painel.</div>
        <div class="feed"></div>
      </div>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Impressão • PyDen Senhas</title>
  <style>
    :root { --w: 80mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color:#000; background:#fff; }
    .page { width: var(--w); margin: 0 auto; }
    .ticket { padding: 5mm 6mm 9mm 4mm; page-break-after: always; }
    .brand { text-align:center; font-size: 15px; font-weight: 900; letter-spacing: .9px; text-transform: uppercase; margin: 0; }
    .sub { text-align:center; font-size: 11px; margin: 1.5mm 0 0; font-weight: 700; }
    .meta { text-align:center; font-size: 10px; margin: 1.5mm 0 0; font-weight: 700; }
    .emitida { text-align:center; font-size: 9.5px; margin: 1.5mm 0 0; line-height: 1.2; }
    .divider { border-top: 1px dashed #000; margin: 3.5mm 0; }
    .senha-label { text-align:center; font-size: 10px; text-transform: uppercase; margin: 0 0 1.5mm; font-weight: 700; }
    .senha { text-align:center; font-size: 42px; font-weight: 900; letter-spacing: 2px; margin: 0; line-height: 1; }
    .footer { text-align:center; font-size: 9.5px; margin-top: 3mm; line-height: 1.2; }
    .feed { height: 10mm; }
    @media print {
      @page { margin: 0; }
      body { margin: 0; }
      .page { width: var(--w); }
      .ticket { padding: 5mm 6mm 5mm 4mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${tickets}
  </div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
        setTimeout(() => window.close(), 1500);
      }, 150);
    });
  </script>
</body>
</html>`;
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

// Impressão (térmica)
app.get('/print/token/:token', checkAuth, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const job = getPrintJob(token, req.session.userId);
    if (!job) return res.status(404).send('Impressão expirada ou inválida.');

    printJobs.delete(token);

    const html = renderThermalTickets(job.items, {
      title: 'SETRANE EXPRESS',
      subtitle: 'Senha de Atendimento'
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('[PRINT] erro:', e);
    return res.status(500).send('Erro ao gerar impressão.');
  }
});

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

// Contagens pendentes (para o dashboard)
app.get('/contagens', checkAuth, async (req, res) => {
  try {
    const q = await pool.query(
      `
      SELECT fila, tipo, COUNT(*)::int AS total
      FROM senhas
      WHERE chamada = 0 AND DATE(created_at) = CURRENT_DATE
      GROUP BY fila, tipo
      `
    );

    const out = { EN: 0, EP: 0, MN: 0, MP: 0 };
    for (const r of q.rows) {
      const key = `${r.fila}${r.tipo}`;
      if (key === 'EN') out.EN = r.total;
      if (key === 'EP') out.EP = r.total;
      if (key === 'MN') out.MN = r.total;
      if (key === 'MP') out.MP = r.total;
    }

    res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[CONTAGENS] erro:', e);
    res.status(500).json({ ok: false, mensagem: 'Erro ao consultar contagens.' });
  }
});

// Geração rápida: cria a PRÓXIMA senha do dia (sequencial) por fila+tipo, com lock de concorrência
// Body: { fila: 'E'|'M', tipo: 'N'|'P' }
app.post('/gerar-proxima', checkAuth, async (req, res) => {
  const tipo = normalizeTipo(req.body.tipo);
  const fila = normalizeFila(req.body.fila);
  if (!fila) return res.json({ ok: false, mensagem: 'Fila inválida.' });
  if (!tipo) return res.json({ ok: false, mensagem: 'Tipo inválido.' });

  try {
    if (tipo === 'N') {
      const lim = await checkLimitesSenhasNormaisParaInserir(fila, 1);
      if (!lim.ok) return res.json({ ok: false, mensagem: lim.message });
    }

    await pool.query('BEGIN');
    await pool.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`senhas:${fila}:${tipo}:${new Date().toISOString().slice(0, 10)}`]
    );

    const nextQ = await pool.query(
      `SELECT COALESCE(MAX(numero), 0)::int + 1 AS next
       FROM senhas
       WHERE fila = $1 AND tipo = $2 AND DATE(created_at) = CURRENT_DATE`,
      [fila, tipo]
    );

    const nextNum = nextQ.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO senhas (fila, tipo, numero, created_at, chamada)
       VALUES ($1, $2, $3, NOW(), 0)
       RETURNING id, fila, tipo, numero, created_at`,
      [fila, tipo, nextNum]
    );

    await pool.query('COMMIT');

    const item = ins.rows[0];
    const token = createPrintJob(req.session.userId, [item]);
    const printUrl = `/print/token/${token}`;
    const senha = `${item.fila}${item.tipo}${item.numero}`;

    return res.json({
      ok: true,
      mensagem: `Senha gerada: ${senha} (${filaLabel(item.fila)} • ${tipoLabel(item.tipo)})`,
      senha,
      numero: item.numero,
      tipo: item.tipo,
      fila: item.fila,
      printUrl
    });
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch (_) { }
    console.error('[GERAR-PROXIMA] erro:', e);
    return res.json({ ok: false, mensagem: 'Erro ao gerar próxima senha.' });
  }
});

// Cadastro manual
// Body: { fila:'E'|'M', tipo:'N'|'P', numero:int }
app.post('/cadastrar-senha', checkAuth, async (req, res) => {
  try {
    const fila = normalizeFila(req.body.fila);
    const tipo = normalizeTipo(req.body.tipo);
    const numero = toPositiveInt(req.body.numero);

    if (!fila) return res.json({ ok: false, mensagem: 'Fila inválida.' });
    if (!tipo) return res.json({ ok: false, mensagem: 'Tipo inválido.' });
    if (!numero) return res.json({ ok: false, mensagem: 'Número inválido.' });

    if (tipo === 'N') {
      const lim = await checkLimitesSenhasNormaisParaInserir(fila, 1);
      if (!lim.ok) return res.json({ ok: false, mensagem: lim.message });
    }

    const insert = await pool.query(
      `INSERT INTO senhas (fila, tipo, numero, created_at, chamada)
       SELECT $1, $2, $3, NOW(), 0
       WHERE NOT EXISTS (
         SELECT 1 FROM senhas s
         WHERE s.fila = $1 AND s.tipo = $2 AND s.numero = $3 AND DATE(s.created_at) = CURRENT_DATE
       )
       RETURNING id, fila, tipo, numero, created_at`,
      [fila, tipo, numero]
    );

    if (insert.rowCount === 0) {
      return res.json({ ok: false, mensagem: `Já existe a senha ${fila}${tipo}${numero} hoje. (não inserida)` });
    }

    const item = insert.rows[0];
    const token = createPrintJob(req.session.userId, [item]);

    return res.json({
      ok: true,
      mensagem: `Senha cadastrada: ${fila}${tipo}${numero}`,
      printUrl: `/print/token/${token}`
    });
  } catch (e) {
    console.error('[CADASTRAR-SENHA] erro:', e);
    return res.json({ ok: false, mensagem: 'Erro ao cadastrar senha.' });
  }
});

// Gerar por intervalo (por fila+tipo)
// Body: { fila:'E'|'M', tipo:'N'|'P', inicio:int, fim:int }
app.post('/gerar-intervalo', checkAuth, async (req, res) => {
  try {
    const fila = normalizeFila(req.body.fila);
    const tipo = normalizeTipo(req.body.tipo);
    const inicio = toPositiveInt(req.body.inicio);
    const fim = toPositiveInt(req.body.fim);

    if (!fila) return res.json({ ok: false, mensagem: 'Fila inválida.' });
    if (!tipo) return res.json({ ok: false, mensagem: 'Tipo inválido.' });
    if (!inicio || !fim) return res.json({ ok: false, mensagem: 'Informe início e fim válidos.' });

    const start = Math.min(inicio, fim);
    const end = Math.max(inicio, fim);
    const rangeSize = (end - start) + 1;

    const maxBatch = Number(process.env.MAX_BATCH || 500);
    if (rangeSize > maxBatch) {
      return res.json({ ok: false, mensagem: `Intervalo grande demais. Máximo permitido: ${maxBatch} senhas por geração.` });
    }

    if (tipo === 'N') {
      const lim = await checkLimitesSenhasNormaisParaInserir(fila, rangeSize);
      if (!lim.ok) return res.json({ ok: false, mensagem: lim.message });
    }

    const q = await pool.query(
      `
      WITH serie AS (
        SELECT gs::int AS numero
        FROM generate_series($4::int, $5::int) gs
      ),
      inseridos AS (
        INSERT INTO senhas (fila, tipo, numero, created_at, chamada)
        SELECT $1, $2, s.numero, NOW(), 0
        FROM serie s
        WHERE NOT EXISTS (
          SELECT 1 FROM senhas x
          WHERE x.fila = $1 AND x.tipo = $2 AND x.numero = s.numero AND DATE(x.created_at) = CURRENT_DATE
        )
        RETURNING id, fila, tipo, numero, created_at
      )
      SELECT
        (SELECT COUNT(*)::int FROM inseridos) AS inseridos,
        (SELECT COUNT(*)::int FROM serie) AS solicitados,
        COALESCE((SELECT json_agg(inseridos ORDER BY numero ASC) FROM inseridos), '[]'::json) AS itens
      `,
      [fila, tipo, null, start, end]
    );

    const inserted = q.rows[0]?.inseridos ?? 0;
    const requested = q.rows[0]?.solicitados ?? rangeSize;
    const itens = q.rows[0]?.itens || [];
    const skipped = requested - inserted;

    let printUrl = null;
    if (inserted > 0) {
      const token = createPrintJob(req.session.userId, itens);
      printUrl = `/print/token/${token}`;
    }

    return res.json({
      ok: true,
      mensagem: `Geradas ${inserted} senha(s) (${fila}${tipo}${start} a ${fila}${tipo}${end}).` +
        (skipped > 0 ? ` ${skipped} já existiam hoje e foram ignoradas.` : ''),
      inseridos: inserted,
      ignorados: skipped,
      intervalo: { fila, tipo, inicio: start, fim: end },
      printUrl
    });
  } catch (e) {
    console.error('[GERAR-INTERVALO] erro:', e);
    return res.json({ ok: false, mensagem: 'Erro ao gerar intervalo.' });
  }
});

// Chamar próxima senha (por fila+tipo)
// Body: { fila:'E'|'M', tipo:'N'|'P' }
app.post('/chamar-senha', checkAuth, async (req, res) => {
  try {
    const fila = normalizeFila(req.body.fila);
    const tipo = normalizeTipo(req.body.tipo);
    if (!fila) return res.json({ sucesso: false, mensagem: 'Fila inválida.' });
    if (!tipo) return res.json({ sucesso: false, mensagem: 'Tipo inválido.' });

    const userId = req.session.userId;

    const next = await pool.query(
      `SELECT id, fila, tipo, numero
       FROM senhas
       WHERE fila = $1
         AND tipo = $2
         AND chamada = 0
         AND DATE(created_at) = CURRENT_DATE
       ORDER BY numero ASC, id ASC
       LIMIT 1`,
      [fila, tipo]
    );

    if (next.rows.length === 0) {
      return res.json({ sucesso: false, mensagem: 'Não há senhas nessa fila.' });
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

    const senha = `${row.fila}${row.tipo}${row.numero}`;
    const senhaChamada = {
      fila: row.fila,
      tipo: row.tipo,
      numero: row.numero,
      senha,
      sala: userRow.sala,
      mesa: userRow.mesa
    };

    io.emit('senhaChamada', senhaChamada);

    return res.json({ sucesso: true, senha, fila: row.fila, tipo: row.tipo, numero: row.numero });
  } catch (e) {
    console.error('[CHAMAR-SENHA] erro:', e);
    return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
  }
});

// Rechamar última senha (do usuário logado)
app.post('/rechamar-senha', checkAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const last = await pool.query(
      `SELECT s.id, s.fila, s.tipo, s.numero, u.sala, u.mesa
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

    const senha = `${row.fila}${row.tipo}${row.numero}`;
    const senhaChamada = { fila: row.fila, tipo: row.tipo, numero: row.numero, senha, sala: row.sala, mesa: row.mesa };
    io.emit('senhaChamada', senhaChamada);

    return res.json({ sucesso: true, senha });
  } catch (e) {
    console.error('[RECHAMAR-SENHA] erro:', e);
    return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
  }
});

// Limpar senhas (mantém)
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
