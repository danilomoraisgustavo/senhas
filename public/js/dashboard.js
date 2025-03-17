const btnChamarSenha = document.getElementById('btnChamarSenha');
const btnCadastrarSenha = document.getElementById('btnCadastrarSenha');
const chamarSenhaSection = document.getElementById('chamarSenhaSection');
const cadastrarSenhaSection = document.getElementById('cadastrarSenhaSection');
const chamarNormalBtn = document.getElementById('chamarNormal');
const chamarPreferencialBtn = document.getElementById('chamarPreferencial');
const lastCalledElement = document.getElementById('lastCalled');
const formCadastro = document.getElementById('formCadastroSenhas');
const msgCadastro = document.getElementById('msgCadastro');

// Socket.io
const socket = io();

/* Alterna abas do dashboard */
btnChamarSenha.addEventListener('click', (e) => {
    e.preventDefault();
    chamarSenhaSection.classList.add('section-active');
    chamarSenhaSection.classList.remove('section-hidden');

    cadastrarSenhaSection.classList.add('section-hidden');
    cadastrarSenhaSection.classList.remove('section-active');
});

btnCadastrarSenha.addEventListener('click', (e) => {
    e.preventDefault();
    cadastrarSenhaSection.classList.add('section-active');
    cadastrarSenhaSection.classList.remove('section-hidden');

    chamarSenhaSection.classList.add('section-hidden');
    chamarSenhaSection.classList.remove('section-active');
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

/* Formulário de cadastro de senhas (intervalo) */
formCadastro.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(formCadastro);
    const tipo = formData.get('tipo');
    const rangeInicio = parseInt(formData.get('rangeInicio'), 10);
    const rangeFim = parseInt(formData.get('rangeFim'), 10);

    fetch('/cadastrar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, rangeInicio, rangeFim })
    })
        .then(res => res.json())
        .then(data => {
            msgCadastro.textContent = data.mensagem || '';
            formCadastro.reset();
        })
        .catch(err => console.error(err));
});

/* Recebe a senha chamada em tempo real via Socket.io */
socket.on('senhaChamada', (senha) => {
    lastCalledElement.textContent = senha;
});
