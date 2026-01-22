// public/js/dashboard.js

// ==============================
// Elementos (compatível com layout antigo e novo)
// ==============================

// Layout antigo (links no <nav>)
const btnChamarSenha = document.getElementById('btnChamarSenha');
const btnCadastrarSenha = document.getElementById('btnCadastrarSenha');
const btnGerenciarBD = document.getElementById('btnGerenciarBD');

// Layout novo (botões com data-target)
const navButtons = document.querySelectorAll('.nav-btn');

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

// ==============================
// Utilitários
// ==============================

function setFeedback(el, text, type) {
    if (!el) return;

    el.textContent = text || '';
    // classes opcionais (se quiser estilizar)
    el.classList.remove('feedback-success', 'feedback-error', 'feedback-warning');
    if (type) el.classList.add(`feedback-${type}`);
}

function showSection(targetId) {
    const sections = [chamarSenhaSection, cadastrarSenhaSection, gerenciarBDSection].filter(Boolean);

    sections.forEach((sec) => {
        sec.classList.add('section-hidden');
        sec.classList.remove('section-active');
    });

    const target = document.getElementById(targetId);
    if (target) {
        target.classList.remove('section-hidden');
        target.classList.add('section-active');
    }

    // limpa feedbacks quando troca de área (opcional)
    setFeedback(msgCadastro, '');
    setFeedback(dbMessageContainer, '');
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
    });

    // Se backend devolver HTML por erro, evita crash de JSON
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const t = await res.text();
        throw new Error(`Resposta não-JSON (${res.status}): ${t.slice(0, 200)}`);
    }

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
}

// ==============================
// Navegação - Layout NOVO (nav-btn com data-target)
// ==============================

if (navButtons && navButtons.length > 0) {
    navButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            navButtons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = btn.getAttribute('data-target');
            if (targetId) showSection(targetId);
        });
    });
}

// ==============================
// Navegação - Layout ANTIGO (links no nav)
// ==============================

if (btnChamarSenha) {
    btnChamarSenha.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('chamarSenhaSection');
    });
}

if (btnCadastrarSenha) {
    btnCadastrarSenha.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('cadastrarSenhaSection');
    });
}

if (btnGerenciarBD) {
    btnGerenciarBD.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('gerenciarBDSection');
    });
}

// ==============================
// Ações
// ==============================

async function chamarSenha(tipo) {
    try {
        const { data } = await postJson('/chamar-senha', { tipo });

        if (data.sucesso) {
            if (lastCalledElement) lastCalledElement.textContent = data.senha;
            setFeedback(dbMessageContainer, '');
            setFeedback(msgCadastro, '');
        } else {
            alert(data.mensagem || 'Erro ao chamar senha.');
        }
    } catch (err) {
        console.error(err);
        alert('Falha ao chamar senha (verifique sessão e backend).');
    }
}

async function rechamarUltima() {
    try {
        const { data } = await postJson('/rechamar-senha');

        if (data.sucesso) {
            if (lastCalledElement) lastCalledElement.textContent = data.senha;
        } else {
            alert(data.mensagem || 'Erro ao rechamar senha.');
        }
    } catch (err) {
        console.error(err);
        alert('Falha ao rechamar senha.');
    }
}

if (chamarNormalBtn) {
    chamarNormalBtn.addEventListener('click', () => chamarSenha('N'));
}

if (chamarPreferencialBtn) {
    chamarPreferencialBtn.addEventListener('click', () => chamarSenha('P'));
}

if (chamarUltimaBtn) {
    chamarUltimaBtn.addEventListener('click', () => rechamarUltima());
}

// ==============================
// Cadastro manual
// ==============================

if (formCadastro) {
    formCadastro.addEventListener('submit', async (e) => {
        e.preventDefault();

        try {
            const formData = new FormData(formCadastro);
            const tipo = formData.get('tipo');
            const numero = Number.parseInt(formData.get('numero'), 10);

            if (!tipo) {
                setFeedback(msgCadastro, 'Selecione o tipo da senha.', 'warning');
                return;
            }
            if (!Number.isFinite(numero) || numero <= 0) {
                setFeedback(msgCadastro, 'Informe um número válido (maior que zero).', 'warning');
                return;
            }

            const { data } = await postJson('/cadastrar-senha', { tipo, numero });

            setFeedback(msgCadastro, data.mensagem || 'Solicitação enviada.', data.mensagem?.toLowerCase().includes('erro') ? 'error' : 'success');
            formCadastro.reset();
        } catch (err) {
            console.error(err);
            setFeedback(msgCadastro, 'Erro ao cadastrar senha. Verifique o backend.', 'error');
        }
    });
}

// ==============================
// Gerenciar BD
// ==============================

if (limparSenhasBtn) {
    limparSenhasBtn.addEventListener('click', async () => {
        const ok = confirm('Tem certeza que deseja limpar todas as senhas?');
        if (!ok) return;

        try {
            const { data } = await postJson('/limpar-senhas');
            setFeedback(dbMessageContainer, data.mensagem || 'Operação concluída.', 'success');
        } catch (err) {
            console.error(err);
            setFeedback(dbMessageContainer, 'Erro ao limpar senhas. Verifique o backend.', 'error');
        }
    });
}

// ==============================
// Socket.io (tempo real)
// ==============================

socket.on('senhaChamada', (senha) => {
    if (!lastCalledElement) return;
    if (!senha) return;

    // aceita ambos formatos
    const texto = senha.tipo && senha.numero ? `${senha.tipo}${senha.numero}` : (senha.senha || '');
    if (texto) lastCalledElement.textContent = texto;
});

// ==============================
// Estado inicial
// ==============================

// Se estiver no layout novo, já garante uma seção visível coerente com "active"
if (navButtons && navButtons.length > 0) {
    const active = document.querySelector('.nav-btn.active');
    if (active) {
        const targetId = active.getAttribute('data-target');
        if (targetId) showSection(targetId);
    } else {
        showSection('chamarSenhaSection');
    }
} else {
    showSection('chamarSenhaSection');
}
