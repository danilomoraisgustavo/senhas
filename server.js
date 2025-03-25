// server.js
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const http = require('http');
const socketIO = require('socket.io');
const { Pool } = require('pg'); // Adicionado para Postgres

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Mantido para não omitir nenhuma linha, porém não será usado
const db = new sqlite3.Database('usuarios.db');

// Cria pool para Postgres
const pool = new Pool({
    connectionString: 'postgres://postgres:DeD-140619@pyden-express-2-0.cjucwyoced9l.sa-east-1.rds.amazonaws.com:5432/pyden_express',
    ssl: {
        rejectUnauthorized: false
    }
});

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'pyden-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Função de verificação de autenticação
function checkAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    } else {
        return res.redirect('/');
    }
}

// -------------------- ROTAS DE USUÁRIO -------------------- //

// Rota de cadastro de usuário (retorna JSON)
app.post('/register', (req, res) => {
    const { nomeCompleto, email, senha, sala, mesa } = req.body;
    pool.query('SELECT * FROM users_senhas WHERE email = $1', [email], (err, result) => {
        if (err) {
            return res.json({ success: false, message: 'Erro ao verificar e-mail.' });
        }
        if (result.rows.length > 0) {
            return res.json({ success: false, message: 'E-mail já cadastrado!' });
        }
        pool.query(
            `INSERT INTO users_senhas (nomeCompleto, email, senha, sala, mesa)
             VALUES ($1, $2, $3, $4, $5)`,
            [nomeCompleto, email, senha, sala, mesa],
            (err2) => {
                if (err2) {
                    return res.json({ success: false, message: 'Erro ao cadastrar usuário.' });
                }
                return res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
            }
        );
    });
});

// Rota de login (retorna JSON)
app.post('/login', (req, res) => {
    const { email, senha } = req.body;
    pool.query('SELECT * FROM users_senhas WHERE email = $1', [email], (err, result) => {
        if (err) {
            return res.json({ success: false, message: 'Erro ao acessar o banco de dados.' });
        }
        if (result.rows.length === 0) {
            return res.json({ success: false, message: 'Usuário não encontrado.' });
        }
        const row = result.rows[0];
        if (row.senha !== senha) {
            return res.json({ success: false, message: 'Senha incorreta.' });
        }
        req.session.userId = row.id;
        return res.json({
            success: true,
            message: `Bem-vindo, ${row.nomecompleto}!`,
            redirect: '/dashboard'
        });
    });
});

// Rota de logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// -------------------- ROTAS DE SENHAS -------------------- //

// Rota para acessar o dashboard (somente logado)
app.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota para página de exibição de senhas (display)
app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Rota para cadastrar senha MANUAL (tipo e número)
app.post('/cadastrar-senha', checkAuth, (req, res) => {
    const { tipo, numero } = req.body;
    if (!tipo || !['N', 'P'].includes(tipo)) {
        return res.json({ mensagem: 'Tipo inválido.' });
    }
    const num = parseInt(numero, 10);
    if (isNaN(num) || num <= 0) {
        return res.json({ mensagem: 'Número inválido.' });
    }
    pool.query(
        'INSERT INTO senhas (tipo, numero) VALUES ($1, $2)',
        [tipo, num],
        (err) => {
            if (err) {
                return res.json({ mensagem: 'Erro ao cadastrar senha.' });
            }
            return res.json({ mensagem: `Senha cadastrada: ${tipo}${num}` });
        }
    );
});

// Rota para chamar a próxima senha
app.post('/chamar-senha', checkAuth, (req, res) => {
    const { tipo } = req.body;
    if (!tipo || !['N', 'P'].includes(tipo)) {
        return res.json({ sucesso: false, mensagem: 'Tipo inválido.' });
    }
    const userId = req.session.userId;
    pool.query(`
        SELECT * FROM senhas
        WHERE tipo = $1 AND chamada = 0
        ORDER BY id ASC
        LIMIT 1
    `, [tipo], (err, result) => {
        if (err) {
            return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
        }
        if (result.rows.length === 0) {
            return res.json({ sucesso: false, mensagem: 'Não há senhas desse tipo na fila.' });
        }
        const row = result.rows[0];
        pool.query('SELECT sala, mesa FROM users_senhas WHERE id = $1', [userId], (errUser, userResult) => {
            if (errUser || userResult.rows.length === 0) {
                return res.json({ sucesso: false, mensagem: 'Erro ao obter dados do usuário.' });
            }
            const userRow = userResult.rows[0];
            pool.query('UPDATE senhas SET chamada = 1, chamadoPor = $1 WHERE id = $2',
                [userId, row.id],
                (err2) => {
                    if (err2) {
                        return res.json({ sucesso: false, mensagem: 'Erro ao atualizar senha.' });
                    }
                    const senhaChamada = {
                        tipo: row.tipo,
                        numero: row.numero,
                        sala: userRow.sala,
                        mesa: userRow.mesa
                    };
                    io.emit('senhaChamada', senhaChamada);
                    return res.json({ sucesso: true, senha: `${row.tipo}${row.numero}` });
                }
            );
        });
    });
});

// Rota para rechamar a última senha que o usuário chamou
app.post('/rechamar-senha', checkAuth, (req, res) => {
    const userId = req.session.userId;
    pool.query(`
        SELECT senhas.*, users_senhas.sala, users_senhas.mesa
        FROM senhas
        JOIN users_senhas ON users_senhas.id = $1
        WHERE senhas.chamadoPor = $2
        ORDER BY senhas.id DESC
        LIMIT 1
    `, [userId, userId], (err, result) => {
        if (err) {
            return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
        }
        if (result.rows.length === 0) {
            return res.json({ sucesso: false, mensagem: 'Você ainda não chamou nenhuma senha.' });
        }
        const row = result.rows[0];
        const senhaChamada = {
            tipo: row.tipo,
            numero: row.numero,
            sala: row.sala,
            mesa: row.mesa
        };
        io.emit('senhaChamada', senhaChamada);
        return res.json({ sucesso: true, senha: `${row.tipo}${row.numero}` });
    });
});

// Rota para limpar a tabela de senhas
app.post('/limpar-senhas', checkAuth, (req, res) => {
    pool.query('DELETE FROM senhas', (err) => {
        if (err) {
            return res.json({ mensagem: 'Erro ao limpar tabela de senhas.' });
        }
        // Reiniciar sequência da tabela senhas no Postgres
        pool.query('ALTER SEQUENCE senhas_id_seq RESTART WITH 1', (err2) => {
            if (err2) {
                return res.json({ mensagem: 'Erro ao reiniciar sequência de senhas.' });
            }
            return res.json({ mensagem: 'Tabela de senhas limpa com sucesso!' });
        });
    });
});

// Rota raiz (login/cadastro)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------- SOCKET.IO -------------------- //
io.on('connection', (socket) => {
    console.log('Cliente conectado ao Socket.io');
});

// Inicia o servidor
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
