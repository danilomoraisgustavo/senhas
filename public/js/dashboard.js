// public/js/dashboard.js

// Mantém todas as constantes e atribuições originais:
const btnChamarSenha = document.getElementById('btnChamarSenha');
const btnCadastrarSenha = document.getElementById('btnCadastrarSenha');
const btnGerenciarBD = document.getElementById('btnGerenciarBD');

const chamarSenhaSection = document.getElementById('chamarSenhaSection');
const cadastrarSenhaSection = document.getElementById('cadastrarSenhaSection');
const gerenciarBDSection = document.getElementById('gerenciarBDSection');

const chamarNormalBtn = document.getElementById('chamarNormal');
const chamarPreferencialBtn = document.getElementById('chamarPreferencial');
const chamarUltimaBtn = document.getElementById('chamarUltima');
const lastCalledElement = document.getElementById('lastCalled');

// Formulário de cadastro manual
const formCadastro = document.getElementById('formCadastroSenhas');
const msgCadastro = document.getElementById('msgCadastro');

// Gerenciar banco
const limparSenhasBtn = document.getElementById('limparSenhas');
const dbMessageContainer = document.getElementById('dbMessageContainer');

// Socket.io
const socket = io();

/* Alterna para a seção de chamar senha */
if (btnChamarSenha) {
    btnChamarSenha.addEventListener('click', (e) => {
        e.preventDefault();
        if (chamarSenhaSection) {
            chamarSenhaSection.classList.add('section-active');
            chamarSenhaSection.classList.remove('section-hidden');
        }
        if (cadastrarSenhaSection) {
            cadastrarSenhaSection.classList.add('section-hidden');
            cadastrarSenhaSection.classList.remove('section-active');
        }
        if (gerenciarBDSection) {
            gerenciarBDSection.classList.add('section-hidden');
            gerenciarBDSection.classList.remove('section-active');
        }
    });
}

/* Alterna para a seção de cadastrar senha */
if (btnCadastrarSenha) {
    btnCadastrarSenha.addEventListener('click', (e) => {
        e.preventDefault();
        if (cadastrarSenhaSection) {
            cadastrarSenhaSection.classList.add('section-active');
            cadastrarSenhaSection.classList.remove('section-hidden');
        }
        if (chamarSenhaSection) {
            chamarSenhaSection.classList.add('section-hidden');
            chamarSenhaSection.classList.remove('section-active');
        }
        if (gerenciarBDSection) {
            gerenciarBDSection.classList.add('section-hidden');
            gerenciarBDSection.classList.remove('section-active');
        }
    });
}

/* Alterna para a seção de gerenciar BD */
if (btnGerenciarBD) {
    btnGerenciarBD.addEventListener('click', (e) => {
        e.preventDefault();
        if (gerenciarBDSection) {
            gerenciarBDSection.classList.add('section-active');
            gerenciarBDSection.classList.remove('section-hidden');
        }
        if (chamarSenhaSection) {
            chamarSenhaSection.classList.add('section-hidden');
            chamarSenhaSection.classList.remove('section-active');
        }
        if (cadastrarSenhaSection) {
            cadastrarSenhaSection.classList.add('section-hidden');
            cadastrarSenhaSection.classList.remove('section-active');
        }
    });
}

/* Botão Chamar Senha Normal */
if (chamarNormalBtn) {
    chamarNormalBtn.addEventListener('click', () => {
        fetch('/chamar-senha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'N' })
        })
            .then(res => res.json())
            .then(data => {
                if (data.sucesso) {
                    if (lastCalledElement) {
                        lastCalledElement.textContent = data.senha;
                    }
                } else {
                    alert(data.mensagem || 'Erro ao chamar senha.');
                }
            })
            .catch(err => console.error(err));
    });
}

/* Botão Chamar Senha Preferencial */
if (chamarPreferencialBtn) {
    chamarPreferencialBtn.addEventListener('click', () => {
        fetch('/chamar-senha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'P' })
        })
            .then(res => res.json())
            .then(data => {
                if (data.sucesso) {
                    if (lastCalledElement) {
                        lastCalledElement.textContent = data.senha;
                    }
                } else {
                    alert(data.mensagem || 'Erro ao chamar senha.');
                }
            })
            .catch(err => console.error(err));
    });
}

/* Botão Rechamar Última Senha (chamada pelo usuário) */
if (chamarUltimaBtn) {
    chamarUltimaBtn.addEventListener('click', () => {
        fetch('/rechamar-senha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
            .then(res => res.json())
            .then(data => {
                if (data.sucesso) {
                    if (lastCalledElement) {
                        lastCalledElement.textContent = data.senha;
                    }
                } else {
                    alert(data.mensagem || 'Erro ao rechamar senha.');
                }
            })
            .catch(err => console.error(err));
    });
}

/* Formulário de cadastro manual de senha */
if (formCadastro) {
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
                if (msgCadastro) {
                    msgCadastro.textContent = data.mensagem || '';
                }
                formCadastro.reset();
            })
            .catch(err => console.error(err));
    });
}

/* Botão para limpar tabela de senhas */
if (limparSenhasBtn) {
    limparSenhasBtn.addEventListener('click', () => {
        fetch('/limpar-senhas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
            .then(res => res.json())
            .then(data => {
                if (dbMessageContainer) {
                    dbMessageContainer.textContent = data.mensagem || 'Sem resposta.';
                }
            })
            .catch(err => console.error(err));
    });
}

/* Recebe a senha chamada em tempo real via Socket.io */
socket.on('senhaChamada', (senha) => {
    if (lastCalledElement) {
        lastCalledElement.textContent = `${senha.tipo}${senha.numero}`;
    }
});
