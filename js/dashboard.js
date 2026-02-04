// public/js/dashboard.js
// Dashboard v2 (filas: Estadual/Municipal + Normal/Prioridade)

(function () {
  // --------- Tabs (views) ----------
  const navItems = Array.from(document.querySelectorAll('.nav__item[data-view]'));
  const views = Array.from(document.querySelectorAll('.view'));

  function setActiveView(viewName) {
    navItems.forEach(btn => btn.classList.toggle('nav__item--active', btn.dataset.view === viewName));
    views.forEach(v => v.classList.toggle('view--active', v.id === `view-${viewName}`));
  }

  navItems.forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.view));
  });

  // --------- UI refs ----------
  const lastCalledMeta = document.getElementById('lastCalledMeta');
  const lastCalledPill = document.getElementById('lastCalledPill');
  const lastCalled = document.getElementById('lastCalled');
  const lastCalledHint = document.getElementById('lastCalledHint');

  const chamarMsg = document.getElementById('chamarMsg');
  const gerarMsg = document.getElementById('gerarMsg');

  const formCadastro = document.getElementById('formCadastroSenhas');
  const msgCadastro = document.getElementById('msgCadastro');

  const btnLimparSenhas = document.getElementById('btnLimparSenhas');
  const dbMessageContainer = document.getElementById('dbMessageContainer');

  const countEN = document.getElementById('count-EN');
  const countEP = document.getElementById('count-EP');
  const countMN = document.getElementById('count-MN');
  const countMP = document.getElementById('count-MP');

  const btnRechamar = document.getElementById('btnRechamar');

  // --------- Helpers ----------
  function filaLabel(fila) { return fila === 'E' ? 'Estadual' : 'Municipal'; }
  function tipoLabel(tipo) { return tipo === 'P' ? 'Prioridade' : 'Normal'; }

  function setInlineMessage(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('inline-alert--success', 'inline-alert--danger', 'inline-alert--info');
    if (kind === 'success') el.classList.add('inline-alert--success');
    else if (kind === 'danger') el.classList.add('inline-alert--danger');
    else el.classList.add('inline-alert--info');
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return res.json().catch(() => ({ ok: false, mensagem: 'Resposta inválida do servidor.' }));
  }

  async function refreshCounts() {
    try {
      const res = await fetch('/contagens', { method: 'GET' });
      const data = await res.json();
      if (data && data.ok) {
        if (countEN) countEN.textContent = String(data.contagens.EN ?? 0);
        if (countEP) countEP.textContent = String(data.contagens.EP ?? 0);
        if (countMN) countMN.textContent = String(data.contagens.MN ?? 0);
        if (countMP) countMP.textContent = String(data.contagens.MP ?? 0);
      }
    } catch (_) {
      // silencioso
    }
  }

  function updateLastCalled(payload) {
    if (!payload) return;

    const senha = payload.senha || payload.codigo || payload.display || '';
    const fila = payload.fila || (senha.startsWith('E') ? 'E' : senha.startsWith('M') ? 'M' : null);
    const tipo = payload.tipo || (senha.includes('P') ? 'P' : senha.includes('N') ? 'N' : null);

    if (lastCalled) lastCalled.textContent = senha || '-';
    if (lastCalledPill && fila && tipo) lastCalledPill.textContent = `${filaLabel(fila)} • ${tipoLabel(tipo)}`;
    if (lastCalledMeta) lastCalledMeta.textContent = payload.atualizado_em ? `Atualizado em ${payload.atualizado_em}` : '';
    if (lastCalledHint) lastCalledHint.textContent = payload.guiche ? `Guichê: ${payload.guiche}` : '';
  }

  // --------- Actions (Gerar / Chamar) ----------
  document.querySelectorAll('button[data-action][data-fila][data-tipo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const fila = btn.dataset.fila;
      const tipo = btn.dataset.tipo;

      // feedback rápido
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Processando...';

      try {
        if (action === 'gerar') {
          const r = await postJSON('/gerar-proxima', { fila, tipo });
          if (r.ok) {
            setInlineMessage(gerarMsg, r.mensagem || 'Senha gerada.', 'success');
            if (r.senha) updateLastCalled(r);
            if (r.printUrl) window.open(r.printUrl, '_blank', 'noopener,noreferrer');
            await refreshCounts();
          } else {
            setInlineMessage(gerarMsg, r.mensagem || 'Não foi possível gerar.', 'danger');
          }
        }

        if (action === 'chamar') {
          const r = await postJSON('/chamar-senha', { fila, tipo });
          if (r.ok) {
            setInlineMessage(chamarMsg, r.mensagem || 'Senha chamada.', 'success');
            if (r.senha) updateLastCalled(r);
            await refreshCounts();
          } else {
            setInlineMessage(chamarMsg, r.mensagem || 'Não foi possível chamar.', 'danger');
          }
        }
      } catch (e) {
        const msg = 'Erro de comunicação com o servidor.';
        if (action === 'gerar') setInlineMessage(gerarMsg, msg, 'danger');
        if (action === 'chamar') setInlineMessage(chamarMsg, msg, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  });

  // Rechamar (se existir endpoint)
  if (btnRechamar) {
    btnRechamar.addEventListener('click', async () => {
      btnRechamar.disabled = true;
      try {
        const r = await postJSON('/rechamar-senha', {});
        if (r.ok) {
          setInlineMessage(chamarMsg, r.mensagem || 'Senha rechamada.', 'success');
        } else {
          setInlineMessage(chamarMsg, r.mensagem || 'Não foi possível rechamar.', 'danger');
        }
      } catch (_) {
        setInlineMessage(chamarMsg, 'Erro de comunicação com o servidor.', 'danger');
      } finally {
        btnRechamar.disabled = false;
      }
    });
  }

  // Cadastro manual
  if (formCadastro) {
    formCadastro.addEventListener('submit', async (ev) => {
      ev.preventDefault();

      const fila = formCadastro.fila?.value;
      const tipo = formCadastro.tipo?.value;
      const numero = formCadastro.numero?.value;

      const r = await postJSON('/cadastrar-senha', { fila, tipo, numero });
      if (r.ok) {
        setInlineMessage(msgCadastro, r.mensagem || 'Senha cadastrada.', 'success');
        formCadastro.reset();
        await refreshCounts();
      } else {
        setInlineMessage(msgCadastro, r.mensagem || 'Não foi possível cadastrar.', 'danger');
      }
    });
  }

  // Limpar tabela
  if (btnLimparSenhas) {
    btnLimparSenhas.addEventListener('click', async () => {
      btnLimparSenhas.disabled = true;
      try {
        const r = await postJSON('/limpar-senhas', {});
        if (r.ok) {
          setInlineMessage(dbMessageContainer, r.mensagem || 'Tabela limpa.', 'success');
          await refreshCounts();
        } else {
          setInlineMessage(dbMessageContainer, r.mensagem || 'Não foi possível limpar.', 'danger');
        }
      } catch (_) {
        setInlineMessage(dbMessageContainer, 'Erro de comunicação com o servidor.', 'danger');
      } finally {
        btnLimparSenhas.disabled = false;
      }
    });
  }

  // --------- Socket.io (opcional) ----------
  try {
    const socket = io();
    socket.on('senhaChamada', (payload) => {
      updateLastCalled(payload);
      refreshCounts();
    });
  } catch (_) { /* sem socket */ }

  // init
  setActiveView('chamar');
  refreshCounts();
})();
