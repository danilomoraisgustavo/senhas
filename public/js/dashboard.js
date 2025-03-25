// public/js/dashboard.js
const btnChamarSenha = document.getElementById('btnChamarSenha');
const btnGerarSenha = document.getElementById('btnGerarSenha');
const btnGerenciarBD = document.getElementById('btnGerenciarBD');

const chamarSenhaSection = document.getElementById('chamarSenhaSection');
const gerarSenhaSection = document.getElementById('gerarSenhaSection');
const cadastrarSenhaSection = document.getElementById('cadastrarSenhaSection');
const gerenciarBDSection = document.getElementById('gerenciarBDSection');

const chamarNormalBtn = document.getElementById('chamarNormal');
const chamarPreferencialBtn = document.getElementById('chamarPreferencial');
const chamarUltimaBtn = document.getElementById('chamarUltima');

const lastCalledElement = document.getElementById('lastCalled');

// Seção nova: gerar senhas
const btnGerarNormal = document.getElementById('btnGerarNormal');
const btnGerarPreferencial = document.getElementById('btnGerarPreferencial');
const msgGerarSenha = document.getElementById('msgGerarSenha');

// Formulário antigo (mantido) de cadastro manual
const formCadastro = document.getElementById('formCadastroSenhas');
const msgCadastro = document.getElementById('msgCadastro');

// Gerenciar banco
const limparSenhasBtn = document.getElementById('limparSenhas');
const dbMessageContainer = document.getElementById('dbMessageContainer');

// Socket.io
const socket = io();

/* Alterna abas do dashboard */
btnChamarSenha.addEventListener('click', (e) => {
    e.preventDefault();
    chamarSenhaSection.classList.add('section-active');
    chamarSenhaSection.classList.remove('section-hidden');

    gerarSenhaSection.classList.add('section-hidden');
    gerarSenhaSection.classList.remove('section-active');

    cadastrarSenhaSection.classList.add('section-hidden');
    cadastrarSenhaSection.classList.remove('section-active');

    gerenciarBDSection.classList.add('section-hidden');
    gerenciarBDSection.classList.remove('section-active');
});

btnGerarSenha.addEventListener('click', (e) => {
    e.preventDefault();
    gerarSenhaSection.classList.add('section-active');
    gerarSenhaSection.classList.remove('section-hidden');

    chamarSenhaSection.classList.add('section-hidden');
    chamarSenhaSection.classList.remove('section-active');

    cadastrarSenhaSection.classList.add('section-hidden');
    cadastrarSenhaSection.classList.remove('section-active');

    gerenciarBDSection.classList.add('section-hidden');
    gerenciarBDSection.classList.remove('section-active');
});

btnGerenciarBD.addEventListener('click', (e) => {
    e.preventDefault();
    gerenciarBDSection.classList.add('section-active');
    gerenciarBDSection.classList.remove('section-hidden');

    chamarSenhaSection.classList.add('section-hidden');
    chamarSenhaSection.classList.remove('section-active');

    gerarSenhaSection.classList.add('section-hidden');
    gerarSenhaSection.classList.remove('section-active');

    cadastrarSenhaSection.classList.add('section-hidden');
    cadastrarSenhaSection.classList.remove('section-active');
});

/* Botão Chamar Senha Normal */
chamarNormalBtn.addEventListener('click', () => {
    fetch('/chamar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'N' })
    })
        .then(res => res.json())
        .then(data => {
            if (data.sucesso) {
                lastCalledElement.textContent = data.senha;
            } else {
                alert(data.mensagem || 'Erro ao chamar senha.');
            }
        })
        .catch(err => console.error(err));
});

/* Botão Chamar Senha Preferencial */
chamarPreferencialBtn.addEventListener('click', () => {
    fetch('/chamar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'P' })
    })
        .then(res => res.json())
        .then(data => {
            if (data.sucesso) {
                lastCalledElement.textContent = data.senha;
            } else {
                alert(data.mensagem || 'Erro ao chamar senha.');
            }
        })
        .catch(err => console.error(err));
});

/* Botão Rechamar Última Senha (chamada pelo usuário) */
chamarUltimaBtn.addEventListener('click', () => {
    fetch('/rechamar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(data => {
            if (data.sucesso) {
                lastCalledElement.textContent = data.senha;
            } else {
                alert(data.mensagem || 'Erro ao rechamar senha.');
            }
        })
        .catch(err => console.error(err));
});

/* ----- NOVOS BOTÕES PARA GERAR SENHA AUTOMÁTICA ----- */
btnGerarNormal.addEventListener('click', () => {
    gerarSenha('N');
});

btnGerarPreferencial.addEventListener('click', () => {
    gerarSenha('P');
});

function gerarSenha(tipo) {
    fetch('/gerar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo })
    })
        .then(res => res.json())
        .then(data => {
            if (data.sucesso) {
                msgGerarSenha.textContent = data.mensagem;
            } else {
                msgGerarSenha.textContent = data.mensagem || 'Erro ao gerar senha.';
            }
        })
        .catch(err => console.error(err));
}

/* ----- Formulário antigo de cadastro manual (mantido para não omitir nada) ----- */
formCadastro.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(formCadastro);
    const tipo = formData.get('tipo');
    const numero = parseInt(formData.get('numero'), 10);

    fetch('/cadastrar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, numero })
    })
        .then(res => res.json())
        .then(data => {
            msgCadastro.textContent = data.mensagem || '';
            formCadastro.reset();
        })
        .catch(err => console.error(err));
});

/* Botão para limpar tabela de senhas */
limparSenhasBtn.addEventListener('click', () => {
    fetch('/limpar-senhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(data => {
            dbMessageContainer.textContent = data.mensagem || 'Sem resposta.';
        })
        .catch(err => console.error(err));
});

/* Recebe a senha chamada em tempo real via Socket.io */
socket.on('senhaChamada', (senha) => {
    lastCalledElement.textContent = `${senha.tipo}${senha.numero}`;
});
