// public/js/dashboard.js (Premium Update)

// Socket.io
const socket = io();

// Tabs
const navButtons = document.querySelectorAll('.nav-btn');
const sections = document.querySelectorAll('.section');

const lastCalledElement = document.getElementById('lastCalled');


const gerarNormalRapidoBtn = document.getElementById('gerarNormalRapido');
const gerarPreferencialRapidoBtn = document.getElementById('gerarPreferencialRapido');
const abrirIntervaloBtn = document.getElementById('abrirIntervalo');
const intervaloBox = document.getElementById('intervaloBox');
const msgGerarRapido = document.getElementById('msgGerarRapido');

// Forms
const formCadastro = document.getElementById('formCadastroSenhas');
const msgCadastro = document.getElementById('msgCadastro');

const formGerarIntervalo = document.getElementById('formGerarIntervalo');
const msgGerarIntervalo = document.getElementById('msgGerarIntervalo');

const limparSenhasBtn = document.getElementById('limparSenhas');
const dbMessageContainer = document.getElementById('dbMessageContainer');

// Buttons
const chamarNormalBtn = document.getElementById('chamarNormal');
const chamarPreferencialBtn = document.getElementById('chamarPreferencial');
const chamarUltimaBtn = document.getElementById('chamarUltima');

// Toast
const toastEl = document.getElementById('toast');
let toastTimer = null;

function toast(message, type = 'success') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden', 'success', 'error', 'warning');
  toastEl.classList.add(type);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
}


function openPrint(printUrl){
  if(!printUrl) return;
  // abre em nova aba/janela para permitir impressão térmica (evita bloqueio de pop-up quando acionado por click)
  window.open(printUrl, '_blank', 'noopener,noreferrer');
}

function setFeedback(el, text, type) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('success', 'error', 'warning');
  if (type) el.classList.add(type);
}

function showSection(targetId) {
  sections.forEach((sec) => {
    sec.classList.add('section-hidden');
    sec.classList.remove('section-active');
  });

  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('section-hidden');
    target.classList.add('section-active');
  }

  setFeedback(msgCadastro, '');
  setFeedback(msgGerarIntervalo, '');
  setFeedback(dbMessageContainer, '');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const t = await res.text();
    throw new Error(`Resposta não-JSON (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
async function gerarProxima(tipo){
  try{
    if (msgGerarRapido) setFeedback(msgGerarRapido, 'Gerando...', 'warning');
    const { data } = await postJson('/gerar-proxima', { tipo });
    if (data.ok){
      if (msgGerarRapido) setFeedback(msgGerarRapido, data.mensagem || 'Senha gerada.', 'success');
      toast(data.mensagem || 'Senha gerada.', 'success');
      if (data.printUrl) openPrint(data.printUrl);
    } else {
      if (msgGerarRapido) setFeedback(msgGerarRapido, data.mensagem || 'Falha ao gerar.', 'error');
      toast(data.mensagem || 'Falha ao gerar.', 'error');
    }
  } catch(e){
    console.error(e);
    if (msgGerarRapido) setFeedback(msgGerarRapido, 'Erro ao gerar senha.', 'error');
    toast('Erro ao gerar senha.', 'error');
  }
}



// Tabs behavior
if (navButtons && navButtons.length) {
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      if (targetId) showSection(targetId);
    });
  });

  // initial
  const active = document.querySelector('.nav-btn.active');
  if (active) {
    const targetId = active.getAttribute('data-target');
    if (targetId) showSection(targetId);
  }
}

// Actions
async function chamarSenha(tipo) {
  try {
    const { data } = await postJson('/chamar-senha', { tipo });
    if (data.sucesso) {
      if (lastCalledElement) lastCalledElement.textContent = data.senha;
      toast(`Chamando ${data.senha}`, 'success');
    } else {
      toast(data.mensagem || 'Erro ao chamar senha.', 'error');
    }
  } catch (e) {
    console.error(e);
    toast('Falha ao chamar senha (verifique sessão/backend).', 'error');
  }
}

async function rechamarUltima() {
  try {
    const { data } = await postJson('/rechamar-senha');
    if (data.sucesso) {
      if (lastCalledElement) lastCalledElement.textContent = data.senha;
      toast(`Rechamando ${data.senha}`, 'success');
    } else {
      toast(data.mensagem || 'Erro ao rechamar.', 'error');
    }
  } catch (e) {
    console.error(e);
    toast('Falha ao rechamar.', 'error');
  }
}

if (chamarNormalBtn) chamarNormalBtn.addEventListener('click', () => chamarSenha('N'));
if (chamarPreferencialBtn) chamarPreferencialBtn.addEventListener('click', () => chamarSenha('P'));
if (chamarUltimaBtn) chamarUltimaBtn.addEventListener('click', () => rechamarUltima());
if (gerarNormalRapidoBtn) gerarNormalRapidoBtn.addEventListener('click', () => gerarProxima('N'));
if (gerarPreferencialRapidoBtn) gerarPreferencialRapidoBtn.addEventListener('click', () => gerarProxima('P'));

if (abrirIntervaloBtn && intervaloBox){
  abrirIntervaloBtn.addEventListener('click', () => {
    const open = intervaloBox.style.display !== 'none';
    intervaloBox.style.display = open ? 'none' : 'block';
    toast(open ? 'Intervalo fechado.' : 'Intervalo aberto.', 'warning');
  });
}



// Cadastro unitário
if (formCadastro) {
  formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(formCadastro);
      const tipo = fd.get('tipo');
      const numero = Number.parseInt(fd.get('numero'), 10);

      if (!tipo) {
        setFeedback(msgCadastro, 'Selecione o tipo.', 'warning');
        toast('Selecione o tipo.', 'warning');
        return;
      }
      if (!Number.isFinite(numero) || numero <= 0) {
        setFeedback(msgCadastro, 'Informe um número válido.', 'warning');
        toast('Informe um número válido.', 'warning');
        return;
      }

      const { data } = await postJson('/cadastrar-senha', { tipo, numero });

      setFeedback(msgCadastro, data.mensagem || 'Concluído.', data.mensagem?.toLowerCase().includes('erro') ? 'error' : 'success');
      toast(data.mensagem || 'Concluído.', data.mensagem?.toLowerCase().includes('erro') ? 'error' : 'success');
      if (data.printUrl) openPrint(data.printUrl);
      formCadastro.reset();
    } catch (e2) {
      console.error(e2);
      setFeedback(msgCadastro, 'Erro ao cadastrar senha.', 'error');
      toast('Erro ao cadastrar senha.', 'error');
    }
  });
}

// Gerar por intervalo
if (formGerarIntervalo) {
  formGerarIntervalo.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(formGerarIntervalo);
      const tipo = fd.get('tipo');
      const inicio = Number.parseInt(fd.get('inicio'), 10);
      const fim = Number.parseInt(fd.get('fim'), 10);

      if (!tipo) {
        setFeedback(msgGerarIntervalo, 'Selecione o tipo.', 'warning');
        toast('Selecione o tipo.', 'warning');
        return;
      }
      if (!Number.isFinite(inicio) || inicio <= 0 || !Number.isFinite(fim) || fim <= 0) {
        setFeedback(msgGerarIntervalo, 'Informe início e fim válidos.', 'warning');
        toast('Informe início e fim válidos.', 'warning');
        return;
      }

      const { data } = await postJson('/gerar-intervalo', { tipo, inicio, fim });

      if (data.ok) {
        setFeedback(msgGerarIntervalo, data.mensagem || 'Intervalo gerado.', 'success');
        toast(data.mensagem || 'Intervalo gerado.', 'success');
        if (data.printUrl) openPrint(data.printUrl);
        formGerarIntervalo.reset();
      } else {
        setFeedback(msgGerarIntervalo, data.mensagem || 'Falha ao gerar intervalo.', 'error');
        toast(data.mensagem || 'Falha ao gerar intervalo.', 'error');
      }
    } catch (e2) {
      console.error(e2);
      setFeedback(msgGerarIntervalo, 'Erro ao gerar intervalo.', 'error');
      toast('Erro ao gerar intervalo.', 'error');
    }
  });
}

// Limpar senhas
if (limparSenhasBtn) {
  limparSenhasBtn.addEventListener('click', async () => {
    const ok = confirm('Tem certeza que deseja limpar todas as senhas?');
    if (!ok) return;

    try {
      const { data } = await postJson('/limpar-senhas');
      setFeedback(dbMessageContainer, data.mensagem || 'Operação concluída.', 'success');
      toast(data.mensagem || 'Operação concluída.', 'success');
    } catch (e) {
      console.error(e);
      setFeedback(dbMessageContainer, 'Erro ao limpar senhas.', 'error');
      toast('Erro ao limpar senhas.', 'error');
    }
  });
}

// Tempo real
socket.on('senhaChamada', (senha) => {
  if (!lastCalledElement || !senha) return;
  const texto = senha.tipo && senha.numero ? `${senha.tipo}${senha.numero}` : (senha.senha || '');
  if (texto) lastCalledElement.textContent = texto;
});
