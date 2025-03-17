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
    chamada INTEGER NOT NULL DEFAULT 0 -- 0 = não chamada, 1 = chamada
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

    // Verifica se o email já existe
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) {
            return res.json({ success: false, message: 'Erro ao verificar e-mail.' });
        }
        if (row) {
            return res.json({ success: false, message: 'E-mail já cadastrado!' });
        }
        // Se não existir, insere novo usuário
        db.run(`
            INSERT INTO users (nomeCompleto, email, senha, sala, mesa)
            VALUES (?, ?, ?, ?, ?)
        `,
            [nomeCompleto, email, senha, sala, mesa],
            function (err) {
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

        // Armazena ID do usuário na sessão
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

// Rota para cadastrar intervalo de senhas (usa transação para evitar inserções fora de ordem)
app.post('/cadastrar-senha', checkAuth, (req, res) => {
    const { tipo, rangeInicio, rangeFim } = req.body;
    if (!tipo || !['N', 'P'].includes(tipo)) {
        return res.json({ mensagem: 'Tipo inválido.' });
    }

    const inicio = parseInt(rangeInicio, 10);
    const fim = parseInt(rangeFim, 10);

    if (isNaN(inicio) || isNaN(fim) || inicio <= 0 || fim <= 0 || fim < inicio) {
        return res.json({ mensagem: 'Intervalo inválido.' });
    }

    db.serialize(() => {
        db.run('BEGIN');

        for (let i = inicio; i <= fim; i++) {
            db.run(`INSERT INTO senhas (tipo, numero) VALUES (?, ?)`, [tipo, i]);
        }

        db.run('COMMIT');
    });

    return res.json({
        mensagem: `Cadastrado intervalo de ${tipo} ${inicio} até ${fim}. Total: ${fim - inicio + 1} senhas.`
    });
});

// Rota para chamar a próxima senha
app.post('/chamar-senha', checkAuth, (req, res) => {
    const { tipo } = req.body;
    if (!tipo || !['N', 'P'].includes(tipo)) {
        return res.json({ sucesso: false, mensagem: 'Tipo inválido.' });
    }

    // Primeiro pega os dados de sala e mesa do usuário logado
    const userId = req.session.userId;
    db.get(`SELECT sala, mesa FROM users WHERE id = ?`, [userId], (errUser, userRow) => {
        if (errUser || !userRow) {
            return res.json({ sucesso: false, mensagem: 'Erro ao obter dados do usuário.' });
        }

        // Agora busca a senha não chamada mais antiga
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

            db.run(`UPDATE senhas SET chamada = 1 WHERE id = ?`, [row.id], (err2) => {
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

// Rota raiz (login/cadastro)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------- SOCKET.IO -------------------- //
io.on('connection', (socket) => {
    console.log('Cliente conectado ao Socket.io');
});

// Inicia o servidor
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
