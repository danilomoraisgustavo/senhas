// server.js
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const db = new sqlite3.Database('usuarios.db');

// Cria tabela de usuários (se não existir)
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomeCompleto TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    sala TEXT NOT NULL,
    mesa TEXT NOT NULL
  )
`);

// Cria tabela de senhas (se não existir)
db.run(`
  CREATE TABLE IF NOT EXISTS senhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,      -- 'N' para normal, 'P' para preferencial
    numero INTEGER NOT NULL, -- número sequencial da senha
    chamada INTEGER NOT NULL DEFAULT 0, -- 0 = não chamada, 1 = chamada
    chamadoPor INTEGER       -- guarda o ID do usuário que chamou
  )
`);

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
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) {
            return res.json({ success: false, message: 'Erro ao verificar e-mail.' });
        }
        if (row) {
            return res.json({ success: false, message: 'E-mail já cadastrado!' });
        }
        db.run(`
            INSERT INTO users (nomeCompleto, email, senha, sala, mesa)
            VALUES (?, ?, ?, ?, ?)
        `,
        [nomeCompleto, email, senha, sala, mesa],
        function(err) {
            if (err) {
                return res.json({ success: false, message: 'Erro ao cadastrar usuário.' });
            }
            return res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
        });
    });
});

// Rota de login (retorna JSON)
app.post('/login', (req, res) => {
    const { email, senha } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) {
            return res.json({ success: false, message: 'Erro ao acessar o banco de dados.' });
        }
        if (!row) {
            return res.json({ success: false, message: 'Usuário não encontrado.' });
        }
        if (row.senha !== senha) {
            return res.json({ success: false, message: 'Senha incorreta.' });
        }
        req.session.userId = row.id;
        return res.json({
            success: true,
            message: `Bem-vindo, ${row.nomeCompleto}!`,
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

// Rota para cadastrar senha única
app.post('/cadastrar-senha', checkAuth, (req, res) => {
    const { tipo, numero } = req.body;
    if (!tipo || !['N', 'P'].includes(tipo)) {
        return res.json({ mensagem: 'Tipo inválido.' });
    }
    const num = parseInt(numero, 10);
    if (isNaN(num) || num <= 0) {
        return res.json({ mensagem: 'Número inválido.' });
    }
    db.run(
        `INSERT INTO senhas (tipo, numero) VALUES (?, ?)`,
        [tipo, num],
        function(err) {
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
    if (!tipo || !['N','P'].includes(tipo)) {
        return res.json({ sucesso: false, mensagem: 'Tipo inválido.' });
    }
    const userId = req.session.userId;
    db.get(`
        SELECT * FROM senhas
        WHERE tipo = ? AND chamada = 0
        ORDER BY id ASC
        LIMIT 1
    `, [tipo], (err, row) => {
        if (err) {
            return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
        }
        if (!row) {
            return res.json({ sucesso: false, mensagem: 'Não há senhas desse tipo na fila.' });
        }
        db.get(`SELECT sala, mesa FROM users WHERE id = ?`, [userId], (errUser, userRow) => {
            if (errUser || !userRow) {
                return res.json({ sucesso: false, mensagem: 'Erro ao obter dados do usuário.' });
            }
            db.run(`UPDATE senhas SET chamada = 1, chamadoPor = ? WHERE id = ?`, [userId, row.id], (err2) => {
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
            });
        });
    });
});

// Rota para rechamar a última senha que o usuário chamou
app.post('/rechamar-senha', checkAuth, (req, res) => {
    const userId = req.session.userId;
    db.get(`
        SELECT senhas.*, users.sala, users.mesa
        FROM senhas
        JOIN users
        ON users.id = ?
        WHERE senhas.chamadoPor = ?
        ORDER BY senhas.id DESC
        LIMIT 1
    `, [userId, userId], (err, row) => {
        if (err) {
            return res.json({ sucesso: false, mensagem: 'Erro no banco de dados.' });
        }
        if (!row) {
            return res.json({ sucesso: false, mensagem: 'Você ainda não chamou nenhuma senha.' });
        }
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
    db.serialize(() => {
        db.run(`DELETE FROM senhas`);
        db.run(`DELETE FROM sqlite_sequence WHERE name='senhas'`);
    });
    return res.json({ mensagem: 'Tabela de senhas limpa com sucesso!' });
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
