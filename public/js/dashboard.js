// public/js/dashboard.js (Atualizado: Municipal/Estadual)

// Socket.io
const socket = io();

// Tabs
const navButtons = document.querySelectorAll('.nav-btn');
const sections = document.querySelectorAll('.section');

const lastCalledElement = document.getElementById('lastCalled');
const lastMesaElement = document.getElementById('lastMesa');

// GERAR (rápido)
const gerarNormalEstadualBtn = document.getElementById('gerarNormalEstadualRapido');
const gerarPreferencialEstadualBtn = document.getElementById('gerarPreferencialEstadualRapido');
const gerarNormalMunicipalBtn = document.getElementById('gerarNormalMunicipalRapido');
const gerarPreferencialMunicipalBtn = document.getElementById('gerarPreferencialMunicipalRapido');

const msgGerarRapido = document.getElementById('msgGerarRapido');

// BD
const limparSenhasBtn = document.getElementById('limparSenhas');
const dbMessageContainer = document.getElementById('dbMessageContainer');

// CHAMAR
const chamarNormalEstadualBtn = document.getElementById('chamarNormalEstadual');
const chamarPreferencialEstadualBtn = document.getElementById('chamarPreferencialEstadual');
const chamarNormalMunicipalBtn = document.getElementById('chamarNormalMunicipal');
const chamarPreferencialMunicipalBtn = document.getElementById('chamarPreferencialMunicipal');
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

function openPrint(printUrl) {
  if (!printUrl) return;
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

function labelTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'EN') return 'Normal Estadual';
  if (t === 'EP') return 'Preferencial Estadual';
  if (t === 'MN') return 'Normal Municipal';
  if (t === 'MP') return 'Preferencial Municipal';
  return t || '—';
}

async function gerarProxima(tipo) {
  try {
    if (msgGerarRapido) setFeedback(msgGerarRapido, 'Gerando...', 'warning');
    const { data } = await postJson('/gerar-proxima', { tipo });
    if (data.ok) {
      if (msgGerarRapido) setFeedback(msgGerarRapido, data.mensagem || 'Senha gerada.', 'success');
      toast(data.mensagem || 'Senha gerada.', 'success');
      if (data.printUrl) openPrint(data.printUrl);
    } else {
      if (msgGerarRapido) setFeedback(msgGerarRapido, data.mensagem || 'Falha ao gerar.', 'error');
      toast(data.mensagem || 'Falha ao gerar.', 'error');
    }
  } catch (e) {
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

  const active = document.querySelector('.nav-btn.active');
  if (active) {
    const targetId = active.getAttribute('data-target');
    if (targetId) showSection(targetId);
  }
}

// CHAMAR
async function chamarSenha(tipo) {
  try {
    const { data } = await postJson('/chamar-senha', { tipo });
    if (data.sucesso) {
      if (lastCalledElement) lastCalledElement.textContent = data.senha;
      if (lastMesaElement) lastMesaElement.textContent = `Mesa: ${data.mesa ?? '—'}`;
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
      if (lastMesaElement) lastMesaElement.textContent = `Mesa: ${data.mesa ?? '—'}`;
      toast(`Rechamando ${data.senha}`, 'success');
    } else {
      toast(data.mensagem || 'Erro ao rechamar.', 'error');
    }
  } catch (e) {
    console.error(e);
    toast('Falha ao rechamar.', 'error');
  }
}

if (chamarNormalEstadualBtn) chamarNormalEstadualBtn.addEventListener('click', () => chamarSenha('EN'));
if (chamarPreferencialEstadualBtn) chamarPreferencialEstadualBtn.addEventListener('click', () => chamarSenha('EP'));
if (chamarNormalMunicipalBtn) chamarNormalMunicipalBtn.addEventListener('click', () => chamarSenha('MN'));
if (chamarPreferencialMunicipalBtn) chamarPreferencialMunicipalBtn.addEventListener('click', () => chamarSenha('MP'));
if (chamarUltimaBtn) chamarUltimaBtn.addEventListener('click', () => rechamarUltima());

// GERAR (rápido)
if (gerarNormalEstadualBtn) gerarNormalEstadualBtn.addEventListener('click', () => gerarProxima('EN'));
if (gerarPreferencialEstadualBtn) gerarPreferencialEstadualBtn.addEventListener('click', () => gerarProxima('EP'));
if (gerarNormalMunicipalBtn) gerarNormalMunicipalBtn.addEventListener('click', () => gerarProxima('MN'));
if (gerarPreferencialMunicipalBtn) gerarPreferencialMunicipalBtn.addEventListener('click', () => gerarProxima('MP'));

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

  // backend envia: { tipo:'EN'|'EP'|'MN'|'MP', numero, ... }
  const t = String(senha.tipo || '').toUpperCase();
  const numero = senha.numero;
  const label = labelTipo(t);

  if (t && numero != null) {
    // Exibe no painel: "MUNICIPAL N12" / "ESTADUAL P7"
    const origem = t.startsWith('M') ? 'MUNICIPAL' : (t.startsWith('E') ? 'ESTADUAL' : '');
    const prio = t.endsWith('P') ? 'P' : 'N';
    lastCalledElement.textContent = origem ? `${origem} ${prio}${numero}` : `${t}${numero}`;
    if (lastMesaElement) lastMesaElement.textContent = `Mesa: ${senha.mesa ?? '—'}`;
    return;
  }

  // fallback
  if (senha.senha) lastCalledElement.textContent = senha.senha;
  if (lastMesaElement) lastMesaElement.textContent = `Mesa: ${senha.mesa ?? '—'}`;
});
