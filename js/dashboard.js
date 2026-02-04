// public/js/dashboard.js
// Dashboard v2: Filas (E/M) + Tipos (N/P) com UI nova

const socket = io();

const navItems = Array.from(document.querySelectorAll('.nav__item'));
const views = Array.from(document.querySelectorAll('.view'));

const lastCalled = document.getElementById('lastCalled');
const lastCalledMeta = document.getElementById('lastCalledMeta');
const lastCalledPill = document.getElementById('lastCalledPill');

const chamarMsg = document.getElementById('chamarMsg');
const gerarMsg = document.getElementById('gerarMsg');
const msgCadastro = document.getElementById('msgCadastro');
const dbMessageContainer = document.getElementById('dbMessageContainer');

const btnRechamar = document.getElementById('btnRechamar');
const btnLimparSenhas = document.getElementById('btnLimparSenhas');

const formCadastro = document.getElementById('formCadastroSenhas');

const toastEl = document.getElementById('toast');
let toastTimer = null;

const countEN = document.getElementById('count-EN');
const countEP = document.getElementById('count-EP');
const countMN = document.getElementById('count-MN');
const countMP = document.getElementById('count-MP');

function filaLabel(f) { return f === 'E' ? 'Estadual' : 'Municipal'; }
function tipoLabel(t) { return t === 'P' ? 'Prioridade' : 'Normal'; }

function setAlert(el, text, variant = 'info') {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('inline-alert--info', 'inline-alert--success', 'inline-alert--warning', 'inline-alert--error');
  el.classList.add(`inline-alert--${variant}`);
  if (!text) el.style.display = 'none';
  else el.style.display = 'block';
}

function toast(message, variant = 'success') {
  if (!toastEl) return;
  toastEl.textContent = message || '';
  toastEl.classList.remove('toast--hidden', 'toast--success', 'toast--error', 'toast--warning', 'toast--info');
  toastEl.classList.add(`toast--${variant}`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('toast--hidden'), 3200);
}

function openPrint(printUrl) {
  if (!printUrl) return;
  window.open(printUrl, '_blank', 'noopener,noreferrer');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {})
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const t = await res.text();
    throw new Error(`Resposta não-JSON (${res.status}): ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function refreshCounts() {
  try {
    const res = await fetch('/contagens', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.ok) return;
    if (countEN) countEN.textContent = String(data.EN ?? 0);
    if (countEP) countEP.textContent = String(data.EP ?? 0);
    if (countMN) countMN.textContent = String(data.MN ?? 0);
    if (countMP) countMP.textContent = String(data.MP ?? 0);
  } catch (_) { /* ignore */ }
}

// Navegação (tabs)
function showView(name) {
  views.forEach(v => v.classList.remove('view--active'));
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.add('view--active');

  navItems.forEach(b => b.classList.remove('nav__item--active'));
  const active = navItems.find(b => b.getAttribute('data-view') === name);
  if (active) active.classList.add('nav__item--active');

  setAlert(chamarMsg, '');
  setAlert(gerarMsg, '');
  setAlert(msgCadastro, '');
  setAlert(dbMessageContainer, '');
}

navItems.forEach(btn => {
  btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
});

// Ações: chamar / gerar (botões com data-action)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  const fila = btn.getAttribute('data-fila');
  const tipo = btn.getAttribute('data-tipo');

  if (!fila || !tipo) return;

  if (action === 'chamar') {
    try {
      setAlert(chamarMsg, 'Chamando...', 'info');
      const data = await postJson('/chamar-senha', { fila, tipo });
      if (data.sucesso) {
        const senha = data.senha;
        if (lastCalled) lastCalled.textContent = senha;
        if (lastCalledPill) lastCalledPill.textContent = `${filaLabel(fila)} • ${tipoLabel(tipo)}`;
        if (lastCalledMeta) lastCalledMeta.textContent = 'Chamada enviada ao painel.';
        setAlert(chamarMsg, `Chamando ${senha}`, 'success');
        toast(`Chamando ${senha}`, 'success');
        await refreshCounts();
      } else {
        setAlert(chamarMsg, data.mensagem || 'Falha ao chamar senha.', 'error');
        toast(data.mensagem || 'Falha ao chamar senha.', 'error');
      }
    } catch (err) {
      console.error(err);
      setAlert(chamarMsg, 'Falha ao chamar (verifique sessão/backend).', 'error');
      toast('Falha ao chamar (verifique sessão/backend).', 'error');
    }
  }

  if (action === 'gerar') {
    try {
      setAlert(gerarMsg, 'Gerando...', 'info');
      const data = await postJson('/gerar-proxima', { fila, tipo });
      if (data.ok) {
        setAlert(gerarMsg, data.mensagem || 'Senha gerada.', 'success');
        toast(data.mensagem || 'Senha gerada.', 'success');
        if (data.printUrl) openPrint(data.printUrl);
        await refreshCounts();
      } else {
        setAlert(gerarMsg, data.mensagem || 'Falha ao gerar.', 'error');
        toast(data.mensagem || 'Falha ao gerar.', 'error');
      }
    } catch (err) {
      console.error(err);
      setAlert(gerarMsg, 'Erro ao gerar senha.', 'error');
      toast('Erro ao gerar senha.', 'error');
    }
  }
});

// Rechamar
if (btnRechamar) {
  btnRechamar.addEventListener('click', async () => {
    try {
      setAlert(chamarMsg, 'Rechamando...', 'info');
      const data = await postJson('/rechamar-senha', {});
      if (data.sucesso) {
        if (lastCalled) lastCalled.textContent = data.senha;
        if (lastCalledMeta) lastCalledMeta.textContent = 'Rechamada enviada ao painel.';
        setAlert(chamarMsg, `Rechamando ${data.senha}`, 'success');
        toast(`Rechamando ${data.senha}`, 'success');
      } else {
        setAlert(chamarMsg, data.mensagem || 'Erro ao rechamar.', 'error');
        toast(data.mensagem || 'Erro ao rechamar.', 'error');
      }
    } catch (err) {
      console.error(err);
      setAlert(chamarMsg, 'Falha ao rechamar.', 'error');
      toast('Falha ao rechamar.', 'error');
    }
  });
}

// Cadastro manual
if (formCadastro) {
  formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(formCadastro);
      const fila = fd.get('fila');
      const tipo = fd.get('tipo');
      const numero = Number.parseInt(fd.get('numero'), 10);

      if (!fila) {
        setAlert(msgCadastro, 'Selecione a fila.', 'warning');
        toast('Selecione a fila.', 'warning');
        return;
      }
      if (!tipo) {
        setAlert(msgCadastro, 'Selecione o tipo.', 'warning');
        toast('Selecione o tipo.', 'warning');
        return;
      }
      if (!Number.isFinite(numero) || numero <= 0) {
        setAlert(msgCadastro, 'Informe um número válido.', 'warning');
        toast('Informe um número válido.', 'warning');
        return;
      }

      setAlert(msgCadastro, 'Cadastrando...', 'info');
      const data = await postJson('/cadastrar-senha', { fila, tipo, numero });

      if (data.ok) {
        setAlert(msgCadastro, data.mensagem || 'Concluído.', 'success');
        toast(data.mensagem || 'Concluído.', 'success');
        if (data.printUrl) openPrint(data.printUrl);
        formCadastro.reset();
        await refreshCounts();
      } else {
        setAlert(msgCadastro, data.mensagem || 'Falha ao cadastrar.', 'error');
        toast(data.mensagem || 'Falha ao cadastrar.', 'error');
      }
    } catch (err) {
      console.error(err);
      setAlert(msgCadastro, 'Erro ao cadastrar senha.', 'error');
      toast('Erro ao cadastrar senha.', 'error');
    }
  });
}

// Limpar
if (btnLimparSenhas) {
  btnLimparSenhas.addEventListener('click', async () => {
    const ok = confirm('Tem certeza que deseja limpar todas as senhas?');
    if (!ok) return;

    try {
      setAlert(dbMessageContainer, 'Executando...', 'info');
      const data = await postJson('/limpar-senhas', {});
      setAlert(dbMessageContainer, data.mensagem || 'Operação concluída.', 'success');
      toast(data.mensagem || 'Operação concluída.', 'success');
      await refreshCounts();
    } catch (err) {
      console.error(err);
      setAlert(dbMessageContainer, 'Erro ao limpar senhas.', 'error');
      toast('Erro ao limpar senhas.', 'error');
    }
  });
}

// Tempo real: quando alguém chama uma senha, atualiza o painel
socket.on('senhaChamada', (payload) => {
  if (!payload) return;
  const senha = payload.senha || (payload.fila && payload.tipo && payload.numero ? `${payload.fila}${payload.tipo}${payload.numero}` : '');
  if (!senha) return;

  if (lastCalled) lastCalled.textContent = senha;
  if (lastCalledPill && payload.fila && payload.tipo) {
    lastCalledPill.textContent = `${filaLabel(payload.fila)} • ${tipoLabel(payload.tipo)}`;
  }
  if (lastCalledMeta) {
    const sala = payload.sala ? `Sala ${payload.sala}` : '';
    const mesa = payload.mesa ? `Mesa ${payload.mesa}` : '';
    const loc = [sala, mesa].filter(Boolean).join(' • ');
    lastCalledMeta.textContent = loc ? `Chamado em ${loc}` : 'Senha chamada.';
  }

  refreshCounts();
});

// init
showView('chamar');
refreshCounts();
