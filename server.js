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
const crypto = require('crypto');

// In-memory print jobs (token -> { userId, createdAt, items: [{id,tipo,numero,created_at}] })
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
  // Tipos aceitos:
  //   EN = Normal Estadual
  //   EP = Preferencial Estadual
  //   MN = Normal Municipal
  //   MP = Preferencial Municipal
  // Compat: N/P (antigo) -> MN/MP
  const t = String(tipo || '').toUpperCase().trim();
  if (t === 'N') return 'MN';
  if (t === 'P') return 'MP';
  return (t === 'EN' || t === 'EP' || t === 'MN' || t === 'MP') ? t : null;
}

function parseTipo(tipo) {
  const t = normalizeTipo(tipo);
  if (!t) return null;
  const origem = t.startsWith('M') ? 'MUNICIPAL' : (t.startsWith('E') ? 'ESTADUAL' : '');
  const prioridade = t.endsWith('P') ? 'PREFERENCIAL' : 'NORMAL';
  const letra = t.endsWith('P') ? 'P' : 'N';
  return { t, origem, prioridade, letra };
}

function formatSenha(tipo, numero) {
  const info = parseTipo(tipo);
  if (!info) return String(tipo || '') + String(numero || '');
  return `${info.origem} ${info.letra}${numero}`;
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
    "SELECT COUNT(*)::int AS total FROM senhas WHERE tipo IN ('EN','MN') AND DATE(created_at) = CURRENT_DATE"
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
     WHERE tipo IN ('EN','MN') AND DATE(created_at) = CURRENT_DATE AND ${shiftCondition}`
  );

  if (shiftCount.rows[0].total + qtyToInsert > 200) {
    return { ok: false, message: 'Limite de senhas normais por turno atingido (200).' };
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

function renderThermalTickets(items, opts = {}) {
  const title = opts.title || 'SETRANE EXPRESS';
  const subtitle = opts.subtitle || 'Senha de Atendimento';
  const now = new Date();
  const tz = 'America/Sao_Paulo';
  const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: tz });
  const printedAt = fmt(now);
  const tickets = items.map(it => {
    const tipoRaw = String(it.tipo || '');
    const numero = escapeHtml(it.numero);
    const info = parseTipo(tipoRaw) || { origem: '', letra: escapeHtml(tipoRaw) };
    const origem = escapeHtml(info.origem || '');
    const letra = escapeHtml(info.letra || String(tipoRaw));
    const senha = `${letra}${numero}`;
    const created = it.created_at ? fmt(it.created_at) : printedAt;

    return `
      <div class="ticket">
        <p class="brand">${title}</p>
        <p class="sub">${subtitle}</p>
        <p class="emitida">Emitida: ${escapeHtml(created)}</p>
        ${origem ? `<p class="origem">${origem}</p>` : ''}

        <div class="divider"></div>

        <p class="senha-label">Sua senha</p>
        <p class="senha">${senha}</p>

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

    /* Compact padding + leve deslocamento para esquerda (menos padding à esquerda) */
    .ticket { padding: 5mm 6mm 9mm 4mm; page-break-after: always; }

    .brand { text-align:center; font-size: 15px; font-weight: 900; letter-spacing: .9px; text-transform: uppercase; margin: 0; }
    .sub { text-align:center; font-size: 11px; margin: 1.5mm 0 0; font-weight: 700; }
    .emitida { text-align:center; font-size: 9.5px; margin: 2mm 0 0; line-height: 1.2; }
    .origem { text-align:center; font-size: 12px; margin: 2mm 0 0; font-weight: 900; letter-spacing: .8px; text-transform: uppercase; }

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
    // Auto-print
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


// Impressão (térmica) - gera HTML pronto para imprimir a(s) senha(s)
app.get('/print/token/:token', checkAuth, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const job = getPrintJob(token, req.session.userId);
    if (!job) return res.status(404).send('Impressão expirada ou inválida.');

    // uma vez impresso, remove para evitar reuso infinito
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


// Geração rápida (1 clique): cria a PRÓXIMA senha do dia (sequencial) e já prepara impressão térmica
// Body: { tipo: 'N'|'P' }
app.post('/gerar-proxima', checkAuth, async (req, res) => {
  const tipo = normalizeTipo(req.body.tipo);
  if (!tipo) return res.json({ ok: false, mensagem: 'Tipo inválido.' });

  try {
    // limites para Normal
    if (tipo === 'N') {
      const lim = await checkLimitesSenhasNormaisParaInserir(1);
      if (!lim.ok) return res.json({ ok: false, mensagem: lim.message });
    }

    // Evita "pulos" por concorrência: trava por tipo+dia até o commit
    await pool.query('BEGIN');
    await pool.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`senhas:${tipo}:${new Date().toISOString().slice(0, 10)}`]
    );

    const nextQ = await pool.query(
      `SELECT COALESCE(MAX(numero), 0)::int + 1 AS next
       FROM senhas
       WHERE tipo = $1 AND DATE(created_at) = CURRENT_DATE`,
      [tipo]
    );

    const nextNum = nextQ.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO senhas (tipo, numero, created_at, chamada)
       VALUES ($1, $2, NOW(), 0)
       RETURNING id, tipo, numero, created_at`,
      [tipo, nextNum]
    );

    await pool.query('COMMIT');

    const item = ins.rows[0];
    const token = createPrintJob(req.session.userId, [item]);
    const printUrl = `/print/token/${token}`;

    return res.json({
      ok: true,
      mensagem: `Senha gerada: ${formatSenha(item.tipo, item.numero)}`,
      senha: formatSenha(item.tipo, item.numero),
      numero: item.numero,
      tipo: item.tipo,
      printUrl
    });
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch (_) { }
    console.error('[GERAR-PROXIMA] erro:', e);
    return res.json({ ok: false, mensagem: 'Erro ao gerar próxima senha.' });
  }
});


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
       RETURNING id, tipo, numero, created_at`,
      [tipo, numero]
    );

    if (insert.rowCount === 0) {
      return res.json({ mensagem: `Já existe a senha ${formatSenha(tipo, numero)} hoje. (não inserida)` });
    }

    const item = insert.rows[0];
    const token = createPrintJob(req.session.userId, [item]);
    return res.json({
      mensagem: `Senha cadastrada: ${formatSenha(tipo, numero)}`,
      printUrl: `/print/token/${token}`
    });
  } catch (e) {
    console.error('[CADASTRAR-SENHA] erro:', e);
    return res.json({ mensagem: 'Erro ao cadastrar senha.' });
  }
});

// NOVO: gerar por intervalo (inteligente)
// NOVO: gerar por intervalo (inteligente) + impressão térmica
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

    // regras de limite para Normal (mantém sua regra atual)
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
        RETURNING id, tipo, numero, created_at
      )
      SELECT
        (SELECT COUNT(*)::int FROM inseridos) AS inseridos,
        (SELECT COUNT(*)::int FROM serie) AS solicitados,
        COALESCE((SELECT json_agg(inseridos ORDER BY numero ASC) FROM inseridos), '[]'::json) AS itens
      `,
      [tipo, start, end]
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
      mensagem: `Geradas ${inserted} senha(s) (${formatSenha(tipo, start)} a ${formatSenha(tipo, end)}).` +
        (skipped > 0 ? ` ${skipped} já existiam hoje e foram ignoradas.` : ''),
      inseridos: inserted,
      ignorados: skipped,
      intervalo: { tipo, inicio: start, fim: end },
      printUrl
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
       WHERE tipo = $1
         AND chamada = 0
         AND DATE(created_at) = CURRENT_DATE
       ORDER BY numero ASC, id ASC
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

    return res.json({ sucesso: true, senha: formatSenha(row.tipo, row.numero) });
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

    return res.json({ sucesso: true, senha: formatSenha(row.tipo, row.numero) });
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
