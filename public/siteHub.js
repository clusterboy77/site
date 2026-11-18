/* =====================================================================
   CCM — FLECHA AUTOMAÇÕES | FRONTEND COMPLETO (V2 SAAS)
   ===================================================================== */
(() => {
  'use strict';

  const state = {
    usuario: null,
    permissoes: new Set(),
    opcoes: { professores: [], turmas: [] },
    saas: {
      periodo: 'todos',
      inicio: '',
      fim: '',
      dados: null,
      graficoExpandidoIdx: 0
    },
    reservasExpandidas: new Set()
  };

  const NOMES_DIAS_SEMANA = [
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
    'Domingo'
  ];

  const PALETA_SERIES = [
    '#2563eb',
    '#0ea5e9',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6'
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function esc(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pode(permissao) {
    return state.permissoes.has(permissao);
  }

  // ===================================================================
  // Helpers Puros de Data e Hora Local (Zero conversão UTC/toISOString)
  // ===================================================================
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function agoraLocalInput() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function somarMinutosLocalInput(valorInput, minutos) {
    const limpo = String(valorInput || '').trim().replace(' ', 'T');
    const m = limpo.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return agoraLocalInput();
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
    d.setMinutes(d.getMinutes() + minutos);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function inputParaSql(valorInput) {
    const limpo = String(valorInput || '').trim().replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(limpo)) return `${limpo}:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(limpo)) return limpo;
    return '';
  }

  function formatarDataBr(dataStr) {
    if (!dataStr) return '—';
    const apenasData = String(dataStr).slice(0, 10);
    const p = apenasData.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : apenasData;
  }

  function formatarDataHoraBr(dtStr) {
    if (!dtStr) return '—';
    const limpo = String(dtStr).trim().replace('T', ' ');
    const m = limpo.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) return limpo;
    return `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}`;
  }

  function formatarHoraCurta(hStr) {
    return String(hStr || '').slice(0, 5) || '—';
  }

  // ===================================================================
  // Cliente HTTP Centralizado
  // ===================================================================
  async function api(url, opts = {}) {
    const config = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    };
    if (opts.body !== undefined) {
      config.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }

    const resp = await fetch(url, config);
    const data = await resp.json().catch(() => ({}));

    if (resp.status === 401 && !url.includes('/api/login') && !url.includes('/api/me')) {
      exibirTelaLogin();
      throw new Error(data.erro || 'Sessão expirada. Faça login novamente.');
    }

    if (!resp.ok) {
      throw new Error(data.erro || `Erro HTTP ${resp.status}`);
    }
    return data;
  }

  // ===================================================================
  // Tema Claro / Escuro & Canvas Animado
  // ===================================================================
  function inicializarTema() {
    const btnConfig = $('#btn-tema-config');
    const menuTema = $('#menu-tema');
    const opcoes = $$('.opcao-tema');

    function aplicarTema(valor) {
      const tema = valor === 'escuro' ? 'escuro' : 'claro';
      document.documentElement.setAttribute('data-theme', tema);
      try {
        localStorage.setItem('flecha_tema', tema);
      } catch {}
      opcoes.forEach((btn) => {
        btn.setAttribute('aria-checked', btn.dataset.temaValor === tema ? 'true' : 'false');
      });
    }

    const inicial = document.documentElement.getAttribute('data-theme') || 'claro';
    aplicarTema(inicial);

    btnConfig?.addEventListener('click', (e) => {
      e.stopPropagation();
      const aberto = menuTema.classList.toggle('aberto');
      btnConfig.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });

    opcoes.forEach((btn) => {
      btn.addEventListener('click', () => {
        aplicarTema(btn.dataset.temaValor);
        menuTema.classList.remove('aberto');
        btnConfig.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#theme-switcher')) {
        menuTema?.classList.remove('aberto');
        btnConfig?.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function inicializarCanvasFundo() {
    const canvas = $('#bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let largura = (canvas.width = window.innerWidth);
    let altura = (canvas.height = window.innerHeight);

    const pontos = Array.from({ length: 34 }, () => ({
      x: Math.random() * largura,
      y: Math.random() * altura,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 1.5 + Math.random() * 1.8
    }));

    window.addEventListener('resize', () => {
      largura = canvas.width = window.innerWidth;
      altura = canvas.height = window.innerHeight;
    });

    function animar() {
      ctx.clearRect(0, 0, largura, altura);
      const escuro = document.documentElement.getAttribute('data-theme') === 'escuro';
      ctx.fillStyle = escuro ? 'rgba(96, 165, 250, 0.22)' : 'rgba(29, 78, 216, 0.14)';
      ctx.strokeStyle = escuro ? 'rgba(96, 165, 250, 0.08)' : 'rgba(29, 78, 216, 0.06)';

      for (let i = 0; i < pontos.length; i++) {
        const p = pontos[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > largura) p.vx *= -1;
        if (p.y < 0 || p.y > altura) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < pontos.length; j++) {
          const q = pontos[j];
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist < 135) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(animar);
    }
    animar();
  }

  // ===================================================================
  // Autenticação, Sessão e Controle de Menu
  // ===================================================================
  function exibirTelaLogin() {
    state.usuario = null;
    state.permissoes = new Set();
    $('#login-screen')?.classList.remove('oculto');
    $('#toggle-menu')?.classList.remove('visivel');
    fecharMenuLateral();
    fecharJanela();
  }

  async function entrarNoSistema(usuarioObj) {
    state.usuario = usuarioObj;
    state.permissoes = new Set(usuarioObj.permissoes || []);

    $('#login-screen')?.classList.add('oculto');
    $('#toggle-menu')?.classList.add('visivel');

    $('#painel-nome').textContent = usuarioObj.nome;
    const seloCargo = $('#painel-cargo');
    seloCargo.textContent = usuarioObj.cargo;
    seloCargo.className = `selo ${
      usuarioObj.cargo === 'gestor' ? 'info' : usuarioObj.cargo === 'professor' ? 'aviso' : 'ok'
    }`;

    // Exibição dinâmica do menu conforme permissão do cargo
    $('#opcao1').style.display = pode('aparelhos:ler') ? 'flex' : 'none';
    $('#opcao2').style.display = pode('emprestimos:ler') ? 'flex' : 'none';
    $('#opcao5').style.display = pode('reservas:ler') ? 'flex' : 'none';
    $('#opcao6').style.display = pode('horarios_fixos:ler') ? 'flex' : 'none';
    $('#opcao3').style.display = pode('relatorios:ler') ? 'flex' : 'none';
    $('#opcao7').style.display = pode('cadastros:gerenciar') ? 'flex' : 'none';
    $('#opcao4').style.display = pode('usuarios:gerenciar') ? 'flex' : 'none';

    await carregarOpcoesAuxiliares();
    await carregarDashboardSaas();
  }

  async function carregarOpcoesAuxiliares() {
    try {
      const dados = await api('/api/opcoes');
      state.opcoes.professores = dados.professores || [];
      state.opcoes.turmas = dados.turmas || [];
    } catch {}
  }

  function inicializarLogin() {
    const tabLogin = $('#tab-login');
    const tabRegister = $('#tab-register');
    const formLogin = $('#login-form');
    const formRegister = $('#register-form');
    const errLogin = $('#login-error');
    const errRegister = $('#register-error');

    tabLogin?.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'block';
      formRegister.style.display = 'none';
      $('#form-title').textContent = 'Bem-vindo';
      $('#form-subtitle').textContent = 'Faça login para continuar';
      errLogin.classList.remove('visivel');
      errRegister.classList.remove('visivel');
    });

    tabRegister?.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'block';
      formLogin.style.display = 'none';
      $('#form-title').textContent = 'Criar Conta';
      $('#form-subtitle').textContent = 'Cadastro inicial como Aluno Monitor';
      errLogin.classList.remove('visivel');
      errRegister.classList.remove('visivel');
    });

    formLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errLogin.classList.remove('visivel');
      const btn = $('#login-btn');
      btn.disabled = true;
      btn.textContent = 'Entrando...';

      try {
        const res = await api('/api/login', {
          method: 'POST',
          body: {
            username: $('#username').value,
            password: $('#password').value
          }
        });
        $('#password').value = '';
        await entrarNoSistema(res.usuario);
      } catch (err) {
        errLogin.textContent = err.message;
        errLogin.classList.add('visivel');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });

    formRegister?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errRegister.classList.remove('visivel');
      const p1 = $('#reg-password').value;
      const p2 = $('#reg-password2').value;
      if (p1 !== p2) {
        errRegister.textContent = 'As senhas digitadas não coincidem.';
        errRegister.classList.add('visivel');
        return;
      }

      const btn = $('#register-btn');
      btn.disabled = true;
      btn.textContent = 'Criando conta...';

      try {
        await api('/api/register', {
          method: 'POST',
          body: {
            username: $('#reg-username').value,
            password: p1
          }
        });
        $('#reg-password').value = '';
        $('#reg-password2').value = '';
        tabLogin.click();
        $('#username').value = $('#reg-username').value.trim().toLowerCase();
        errLogin.style.background = 'var(--ok-bg)';
        errLogin.style.color = 'var(--ok-text)';
        errLogin.style.borderColor = 'var(--ok-border)';
        errLogin.textContent = 'Conta criada com sucesso! Faça login para entrar.';
        errLogin.classList.add('visivel');
      } catch (err) {
        errRegister.textContent = err.message;
        errRegister.classList.add('visivel');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Criar Conta';
      }
    });

    $('#btn-logout')?.addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      exibirTelaLogin();
    });
  }

  // ===================================================================
  // Menu Lateral e Janela Modal
  // ===================================================================
  function abrirMenuLateral() {
    $('#menu-lateral')?.classList.add('aberto');
    $('#menu-backdrop')?.classList.add('aberto');
    $('#toggle-menu')?.setAttribute('aria-expanded', 'true');
  }

  function fecharMenuLateral() {
    $('#menu-lateral')?.classList.remove('aberto');
    $('#menu-backdrop')?.classList.remove('aberto');
    $('#toggle-menu')?.setAttribute('aria-expanded', 'false');
  }

  function abrirJanela(titulo, htmlConteudo) {
    fecharMenuLateral();
    $('#janela-titulo').textContent = titulo;
    $('#janela-conteudo').innerHTML = htmlConteudo;
    $('#janela')?.classList.add('aberta');
  }

  function fecharJanela() {
    $('#janela')?.classList.remove('aberta');
    $('#janela-conteudo').innerHTML = '';
    carregarDashboardSaas().catch(() => {});
  }

  function inicializarNavegacao() {
    $('#toggle-menu')?.addEventListener('click', () => {
      const aberto = $('#menu-lateral')?.classList.contains('aberto');
      if (aberto) fecharMenuLateral();
      else abrirMenuLateral();
    });

    $('#menu-backdrop')?.addEventListener('click', fecharMenuLateral);
    $('#fecharJanela')?.addEventListener('click', fecharJanela);

    $('#opcao1')?.addEventListener('click', abrirModuloAparelhos);
    $('#opcao2')?.addEventListener('click', abrirModuloEmprestimos);
    $('#opcao5')?.addEventListener('click', abrirModuloReservas);
    $('#opcao6')?.addEventListener('click', abrirModuloHorariosFixos);
    $('#opcao3')?.addEventListener('click', abrirModuloRelatorios);
    $('#opcao7')?.addEventListener('click', abrirModuloCadastros);
    $('#opcao4')?.addEventListener('click', abrirModuloUsuarios);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#modal-grafico')?.hasAttribute('hidden')) {
          fecharModalGrafico();
        } else if ($('#janela')?.classList.contains('aberta')) {
          fecharJanela();
        } else if ($('#menu-lateral')?.classList.contains('aberto')) {
          fecharMenuLateral();
        }
      }
    });
  }

  // ===================================================================
  // DASHBOARD SAAS — Gráficos de Linha Suaves SVG + Modal de Expansão
  // ===================================================================
  let tooltipEl = null;
  function obterTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chart-tooltip';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function gerarCaminhoSuave(pontos) {
    if (!pontos.length) return '';
    if (pontos.length === 1) return `M ${pontos[0].x} ${pontos[0].y}`;
    let d = `M ${pontos[0].x.toFixed(1)} ${pontos[0].y.toFixed(1)}`;
    for (let i = 0; i < pontos.length - 1; i++) {
      const p0 = pontos[i === 0 ? i : i - 1];
      const p1 = pontos[i];
      const p2 = pontos[i + 1];
      const p3 = pontos[i + 2 < pontos.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  function renderizarSvgLinhaSuave(grafico, { largura = 540, altura = 220, expandido = false } = {}) {
    const labels = grafico.labels || [];
    const series = grafico.series || [];

    if (!labels.length || !series.length) {
      return `<div class="vazio-estado">Sem registros suficientes no período selecionado para exibir este gráfico.</div>`;
    }

    const padEsq = 40;
    const padDir = 18;
    const padTopo = 18;
    const padBase = 34;
    const areaW = largura - padEsq - padDir;
    const areaH = altura - padTopo - padBase;

    const todosValores = series.flatMap((s) => s.dados || []);
    const maxRaw = Math.max(...todosValores, 1);
    const maxY = Math.ceil(maxRaw * 1.15);

    const gridLinhas = 4;
    let svgGrid = '';
    for (let i = 0; i <= gridLinhas; i++) {
      const y = padTopo + (areaH * i) / gridLinhas;
      const valTick = Math.round(maxY - (maxY * i) / gridLinhas);
      svgGrid += `
        <line x1="${padEsq}" y1="${y.toFixed(1)}" x2="${largura - padDir}" y2="${y.toFixed(1)}"
              stroke="var(--border-color)" stroke-dasharray="3 3" stroke-width="1" />
        <text x="${padEsq - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end"
              fill="var(--text-muted)" font-size="10.5" font-weight="600">${valTick}</text>
      `;
    }

    const passoX = labels.length > 1 ? areaW / (labels.length - 1) : 0;
    const saltoLabel = labels.length > 14 ? Math.ceil(labels.length / 10) : 1;

    let svgLabelsX = '';
    labels.forEach((lbl, idx) => {
      if (idx % saltoLabel !== 0 && idx !== labels.length - 1) return;
      const x = labels.length > 1 ? padEsq + idx * passoX : padEsq + areaW / 2;
      svgLabelsX += `
        <text x="${x.toFixed(1)}" y="${altura - 10}" text-anchor="middle"
              fill="var(--text-muted)" font-size="10.5" font-weight="600">${esc(lbl)}</text>
      `;
    });

    const uid = `${grafico.id}_${expandido ? 'exp' : 'card'}_${Math.random().toString(36).slice(2, 7)}`;
    let svgDefs = '<defs>';
    let svgSeries = '';
    let svgPontos = '';

    series.forEach((serie, sIdx) => {
      const cor = PALETA_SERIES[sIdx % PALETA_SERIES.length];
      const gradId = `grad_${uid}_${sIdx}`;
      svgDefs += `
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${cor}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${cor}" stop-opacity="0.01"/>
        </linearGradient>
      `;

      const coords = (serie.dados || []).map((val, idx) => {
        const x = labels.length > 1 ? padEsq + idx * passoX : padEsq + areaW / 2;
        const y = padTopo + areaH - (Number(val || 0) / maxY) * areaH;
        return { x, y, val: Number(val || 0), label: labels[idx] };
      });

      const dLinha = gerarCaminhoSuave(coords);
      if (coords.length > 1 && sIdx === 0) {
        const dArea = `${dLinha} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTopo + areaH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTopo + areaH).toFixed(1)} Z`;
        svgSeries += `<path d="${dArea}" fill="url(#${gradId})" />`;
      }

      svgSeries += `
        <path d="${dLinha}" fill="none" stroke="${cor}" stroke-width="${expandido ? 3 : 2.4}"
              stroke-linecap="round" stroke-linejoin="round" />
      `;

      coords.forEach((pt) => {
        svgPontos += `
          <circle class="ponto-grafico" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}"
                  r="${expandido ? 4.5 : 3.5}" fill="var(--bg-surface)" stroke="${cor}" stroke-width="2.2"
                  data-serie="${esc(serie.nome)}" data-label="${esc(pt.label)}" data-valor="${pt.val}" />
        `;
      });
    });

    svgDefs += '</defs>';

    return `
      <svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none">
        ${svgDefs}
        ${svgGrid}
        ${svgLabelsX}
        ${svgSeries}
        ${svgPontos}
      </svg>
    `;
  }

  function vincularTooltipsSvg(container) {
    const tip = obterTooltip();
    $$('.ponto-grafico', container).forEach((circulo) => {
      circulo.addEventListener('mouseenter', (e) => {
        const serie = circulo.dataset.serie;
        const label = circulo.dataset.label;
        const valor = circulo.dataset.valor;
        tip.innerHTML = `<strong>${esc(label)}</strong><br>${esc(serie)}: <b>${esc(valor)}</b>`;
        tip.classList.add('visivel');
        tip.style.left = `${e.clientX + 12}px`;
        tip.style.top = `${e.clientY - 12}px`;
      });
      circulo.addEventListener('mousemove', (e) => {
        tip.style.left = `${e.clientX + 12}px`;
        tip.style.top = `${e.clientY - 12}px`;
      });
      circulo.addEventListener('mouseleave', () => {
        tip.classList.remove('visivel');
      });
    });
  }

  async function carregarDashboardSaas() {
    const dashEl = $('#dashboard');
    if (!dashEl || !state.usuario) return;

    const params = new URLSearchParams();
    if (state.saas.inicio && state.saas.fim) {
      params.set('inicio', state.saas.inicio);
      params.set('fim', state.saas.fim);
    } else {
      params.set('periodo', state.saas.periodo);
    }

    try {
      const dados = await api(`/api/dashboard/saas?${params.toString()}`);
      state.saas.dados = dados;
      renderizarDashboardSaas();
    } catch (err) {
      dashEl.innerHTML = `<div class="feedback-msg erro">Erro ao carregar painel analítico: ${esc(err.message)}</div>`;
    }
  }

  function renderizarDashboardSaas() {
    const dashEl = $('#dashboard');
    const dados = state.saas.dados;
    if (!dashEl || !dados) return;

    const { kpis, graficos } = dados;
    const pAtivo = state.saas.inicio && state.saas.fim ? 'custom' : state.saas.periodo;
    const seloVariacao =
      kpis.variacaoUtilizacao === null
        ? ''
        : `<span class="selo ${kpis.variacaoUtilizacao >= 0 ? 'ok' : 'aviso'}">${
            kpis.variacaoUtilizacao >= 0 ? '+' : ''
          }${kpis.variacaoUtilizacao}%</span>`;

    dashEl.innerHTML = `
      <div class="saas-header">
        <div class="saas-titulo-bloco">
          <h1>Painel Analítico de Operações</h1>
          <p>Indicadores em tempo real de inventário, empréstimos, reservas e horários fixos.</p>
        </div>

        <div class="saas-filtros">
          <button type="button" class="btn-periodo ${pAtivo === '7d' ? 'ativo' : ''}" data-p="7d">7 dias</button>
          <button type="button" class="btn-periodo ${pAtivo === '30d' ? 'ativo' : ''}" data-p="30d">30 dias</button>
          <button type="button" class="btn-periodo ${pAtivo === '90d' ? 'ativo' : ''}" data-p="90d">90 dias</button>
          <button type="button" class="btn-periodo ${pAtivo === 'todos' ? 'ativo' : ''}" data-p="todos">Todo período</button>
          <input type="date" id="saas-data-ini" value="${esc(state.saas.inicio)}" title="Data inicial">
          <input type="date" id="saas-data-fim" value="${esc(state.saas.fim)}" title="Data final">
          <button type="button" class="mini primario" id="saas-filtrar-datas">Aplicar</button>
        </div>
      </div>

      <section class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-rotulo">Frota Total</span>
          <div class="kpi-valor-linha">
            <span class="kpi-valor">${kpis.totalAparelhos}</span>
            <span class="selo info">Cadastrados</span>
          </div>
          <span class="kpi-sub">${kpis.disponiveis} livres • ${kpis.indisponiveis} em uso/manutenção</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-rotulo">Empréstimos Ativos</span>
          <div class="kpi-valor-linha">
            <span class="kpi-valor">${kpis.emprestimosEmAndamento}</span>
            <span class="selo aviso">${kpis.aparelhosEmprestadosAgora} aparelhos</span>
          </div>
          <span class="kpi-sub">Aguardando devolução no momento</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-rotulo">Utilização no Período</span>
          <div class="kpi-valor-linha">
            <span class="kpi-valor">${kpis.aparelhosUtilizadosPeriodo}</span>
            ${seloVariacao}
          </div>
          <span class="kpi-sub">${kpis.emprestimosPeriodo} registros de empréstimo</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-rotulo">Reservas Ativas</span>
          <div class="kpi-valor-linha">
            <span class="kpi-valor">${kpis.reservasAtivas}</span>
            <span class="selo ok">${kpis.reservasFuturas} futuras</span>
          </div>
          <span class="kpi-sub">${kpis.reservasEmAndamento} em andamento agora</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-rotulo">Reservas Concluídas</span>
          <div class="kpi-valor-linha">
            <span class="kpi-valor">${kpis.reservasConcluidas}</span>
            <span class="selo ok">Atendidas</span>
          </div>
          <span class="kpi-sub">${kpis.reservasCanceladas} canceladas no período</span>
        </div>
      </section>

      <section class="charts-grid" id="saas-charts-grid">
        ${graficos
          .map(
            (g, idx) => `
          <article class="chart-card" data-chart-idx="${idx}">
            <div class="chart-card-topo">
              <div>
                <span class="chart-card-tag">${esc(g.categoria)}</span>
                <h3>${esc(g.titulo)}</h3>
                <p>${esc(g.descricao)}</p>
              </div>
              <button type="button" class="btn-expandir-grafico" data-chart-idx="${idx}">Expandir ⤢</button>
            </div>
            <div class="chart-svg-wrap">
              ${renderizarSvgLinhaSuave(g)}
            </div>
            <div class="chart-legenda">
              ${(g.series || [])
                .map(
                  (s, sIdx) => `
                <span class="chart-legenda-item">
                  <span class="chart-legenda-cor" style="background:${PALETA_SERIES[sIdx % PALETA_SERIES.length]}"></span>
                  ${esc(s.nome)}
                </span>
              `
                )
                .join('')}
            </div>
          </article>
        `
          )
          .join('')}
      </section>
    `;

    vincularTooltipsSvg(dashEl);

    $$('.btn-periodo', dashEl).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.saas.periodo = btn.dataset.p;
        state.saas.inicio = '';
        state.saas.fim = '';
        carregarDashboardSaas();
      });
    });

    $('#saas-filtrar-datas', dashEl)?.addEventListener('click', () => {
      const ini = $('#saas-data-ini').value;
      const fim = $('#saas-data-fim').value;
      if (ini && fim) {
        state.saas.inicio = ini;
        state.saas.fim = fim;
        carregarDashboardSaas();
      }
    });

    $$('.chart-card', dashEl).forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ponto-grafico')) return;
        const idx = Number(card.dataset.chartIdx);
        abrirModalGrafico(idx);
      });
    });
  }

  function abrirModalGrafico(idx) {
    const graficos = state.saas.dados?.graficos || [];
    if (!graficos.length) return;
    const indiceSeguro = ((idx % graficos.length) + graficos.length) % graficos.length;
    state.saas.graficoExpandidoIdx = indiceSeguro;

    const g = graficos[indiceSeguro];
    $('#modal-grafico-categoria').textContent = g.categoria;
    $('#modal-grafico-titulo').textContent = g.titulo;
    $('#modal-grafico-desc').textContent = g.descricao;

    const seletor = $('#modal-grafico-seletor');
    seletor.innerHTML = graficos
      .map((item, i) => `<option value="${i}" ${i === indiceSeguro ? 'selected' : ''}>${esc(item.titulo)}</option>`)
      .join('');

    const canvasWrap = $('#modal-grafico-canvas');
    canvasWrap.innerHTML = renderizarSvgLinhaSuave(g, { largura: 960, altura: 340, expandido: true });
    vincularTooltipsSvg(canvasWrap);

    // Tabela analítica detalhada dos pontos do gráfico expandido
    const tabelaWrap = $('#modal-grafico-tabela');
    if (g.labels?.length && g.series?.length) {
      tabelaWrap.innerHTML = `
        <div class="tabela-wrap">
          <table class="tabela">
            <thead>
              <tr>
                <th>Eixo / Categoria</th>
                ${g.series.map((s) => `<th>${esc(s.nome)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${g.labels
                .map(
                  (lbl, rowIdx) => `
                <tr>
                  <td><strong>${esc(lbl)}</strong></td>
                  ${g.series.map((s) => `<td>${esc(s.dados[rowIdx] ?? 0)}</td>`).join('')}
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      tabelaWrap.innerHTML = '';
    }

    $('#modal-grafico').removeAttribute('hidden');
  }

  function fecharModalGrafico() {
    $('#modal-grafico')?.setAttribute('hidden', '');
    obterTooltip().classList.remove('visivel');
  }

  function inicializarModalGrafico() {
    $('#modal-grafico-fechar')?.addEventListener('click', fecharModalGrafico);
    $('#modal-grafico-anterior')?.addEventListener('click', () => {
      abrirModalGrafico(state.saas.graficoExpandidoIdx - 1);
    });
    $('#modal-grafico-proximo')?.addEventListener('click', () => {
      abrirModalGrafico(state.saas.graficoExpandidoIdx + 1);
    });
    $('#modal-grafico-seletor')?.addEventListener('change', (e) => {
      abrirModalGrafico(Number(e.target.value));
    });
    $('#modal-grafico')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-grafico') fecharModalGrafico();
    });
  }

  // ===================================================================
  // MÓDULO 1: APARELHOS E CARREGAMENTO
  // ===================================================================
  async function abrirModuloAparelhos() {
    abrirJanela('Gerenciamento de Aparelhos e Carregamento', `<div class="vazio-estado">Carregando aparelhos...</div>`);

    async function renderizar(abaAtiva = 'lista') {
      const [aparelhos, carregamentos] = await Promise.all([
        api('/api/aparelhos'),
        api('/api/carregamentos')
      ]);

      const podeCriar = pode('aparelhos:criar');
      const podeEditarCompleto = pode('aparelhos:editar');
      const podeEditarObs = pode('aparelhos:editar_obs');
      const podeExcluir = pode('aparelhos:excluir');
      const podeCarregar = pode('carregamentos:gerenciar');

      const html = `
        <div class="subtabs">
          <button type="button" class="subtab ${abaAtiva === 'lista' ? 'ativo' : ''}" data-aba="lista">Inventário de Aparelhos (${aparelhos.length})</button>
          <button type="button" class="subtab ${abaAtiva === 'carregamento' ? 'ativo' : ''}" data-aba="carregamento">Controle de Carregamento</button>
          ${podeCriar ? `<button type="button" class="subtab ${abaAtiva === 'novo' ? 'ativo' : ''}" data-aba="novo">+ Novo Aparelho</button>` : ''}
        </div>

        <div id="aparelhos-feedback"></div>

        ${
          abaAtiva === 'lista'
            ? `
          <div class="barra-filtros">
            <select id="filtro-ap-tipo">
              <option value="">Todos os tipos</option>
              <option value="notebook">Notebook</option>
              <option value="notebook ds">Notebook DS</option>
              <option value="chromebook">Chromebook</option>
              <option value="tablet">Tablet</option>
              <option value="celular">Celular</option>
            </select>
            <select id="filtro-ap-situacao">
              <option value="">Todas as situações</option>
              <option value="Disponível">Disponível</option>
              <option value="Emprestado">Emprestado</option>
              <option value="Reservado">Reservado</option>
              <option value="Horário Fixo">Horário Fixo</option>
              <option value="Manutenção">Manutenção</option>
            </select>
            <input type="text" id="filtro-ap-busca" placeholder="Buscar nº, patrimônio ou modelo...">
          </div>

          <div class="tabela-wrap">
            <table class="tabela" id="tabela-aparelhos">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Tipo</th>
                  <th>Marca / Modelo</th>
                  <th>Patrimônio</th>
                  <th>Situação Atual</th>
                  <th>Observações</th>
                  ${podeEditarCompleto || podeEditarObs || podeExcluir ? '<th>Ações</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${aparelhos
                  .map((ap) => {
                    const classeSelo =
                      ap.situacao === 'Disponível'
                        ? 'ok'
                        : ap.situacao === 'Emprestado' || ap.situacao === 'Manutenção'
                        ? 'erro'
                        : 'aviso';
                    return `
                    <tr data-tipo="${esc(ap.tipo_aparelho)}" data-situacao="${esc(ap.situacao)}"
                        data-busca="${esc(`${ap.numero_aparelho} ${ap.patrimonio} ${ap.marca_aparelho} ${ap.modelo_aparelho}`.toLowerCase())}">
                      <td><strong>#${esc(ap.numero_aparelho)}</strong></td>
                      <td>${esc(ap.tipo_aparelho)}</td>
                      <td>${esc(ap.marca_aparelho)} • ${esc(ap.modelo_aparelho)}</td>
                      <td>${esc(ap.patrimonio)}</td>
                      <td>
                        <span class="selo ${classeSelo}">${esc(ap.situacao)}</span>
                        ${ap.motivo_indisponivel ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">${esc(ap.motivo_indisponivel)}</div>` : ''}
                      </td>
                      <td>${esc(ap.observacoes_aparelho)}</td>
                      ${
                        podeEditarCompleto || podeEditarObs || podeExcluir
                          ? `<td>
                              <div class="acoes-linha">
                                ${podeEditarObs && !podeEditarCompleto ? `<button type="button" class="mini" data-obs-id="${ap.id_aparelho}" data-obs-atual="${esc(ap.observacoes_aparelho)}">Editar Obs.</button>` : ''}
                                ${podeEditarCompleto ? `<button type="button" class="mini" data-edit-id="${ap.id_aparelho}">Editar</button>` : ''}
                                ${podeExcluir ? `<button type="button" class="mini perigo" data-del-id="${ap.id_aparelho}">Excluir</button>` : ''}
                              </div>
                            </td>`
                          : ''
                      }
                    </tr>
                  `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
          <div id="painel-edicao-aparelho"></div>
        `
            : ''
        }

        ${
          abaAtiva === 'carregamento'
            ? `
          <div class="tabela-wrap">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Aparelho</th>
                  <th>Marca / Modelo</th>
                  <th>Patrimônio</th>
                  <th>Estado</th>
                  <th>Última Atualização</th>
                  ${podeCarregar ? '<th>Ação</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${carregamentos
                  .map((c) => {
                    const carregando = c.estado_carregamento === 'Carregando';
                    return `
                    <tr>
                      <td><strong>${esc(c.tipo_aparelho)} #${esc(c.numero_aparelho)}</strong></td>
                      <td>${esc(c.marca_aparelho)} • ${esc(c.modelo_aparelho)}</td>
                      <td>${esc(c.patrimonio)}</td>
                      <td><span class="selo ${carregando ? 'ok' : 'neutro'}">${esc(c.estado_carregamento)}</span></td>
                      <td>${c.ultima_recarga ? formatarDataHoraBr(c.ultima_recarga) : '—'}</td>
                      ${
                        podeCarregar
                          ? `<td>
                              <button type="button" class="mini ${carregando ? '' : 'ok'}"
                                      data-carga-id="${c.id_aparelho}" data-carga-novo="${carregando ? '0' : '1'}">
                                ${carregando ? 'Retirar da tomada' : 'Colocar carregando'}
                              </button>
                            </td>`
                          : ''
                      }
                    </tr>
                  `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        `
            : ''
        }

        ${
          abaAtiva === 'novo' && podeCriar
            ? `
          <form id="form-novo-aparelho" class="painel-card">
            <h3>Cadastrar Novo Aparelho</h3>
            <div class="form-grid">
              <div class="campo">
                <label>Tipo</label>
                <select name="tipo" required>
                  <option value="notebook">Notebook</option>
                  <option value="notebook ds">Notebook DS</option>
                  <option value="chromebook">Chromebook</option>
                  <option value="tablet">Tablet</option>
                  <option value="celular">Celular</option>
                </select>
              </div>
              <div class="campo">
                <label>Marca</label>
                <select name="marca" required>
                  <option value="vaio">Vaio</option>
                  <option value="positivo">Positivo</option>
                  <option value="samsung">Samsung</option>
                  <option value="honor">Honor</option>
                  <option value="xiaomi">Xiaomi</option>
                </select>
              </div>
              <div class="campo">
                <label>Modelo</label>
                <input type="text" name="modelo" maxlength="45" required placeholder="Ex.: FE15 / Galaxy Tab">
              </div>
              <div class="campo">
                <label>Número do Aparelho</label>
                <input type="number" name="numero" min="1" required>
              </div>
              <div class="campo">
                <label>Patrimônio</label>
                <input type="number" name="patrimonio" min="1" required>
              </div>
              <div class="campo">
                <label>Disponibilidade Inicial</label>
                <select name="disponivel">
                  <option value="1">Disponível</option>
                  <option value="0">Indisponível / Manutenção</option>
                </select>
              </div>
              <div class="campo" style="grid-column: 1 / -1;">
                <label>Observações</label>
                <input type="text" name="observacoes" maxlength="304" value="nenhuma">
              </div>
            </div>
            <div style="margin-top:14px;">
              <button type="submit" class="btn-primario inline">Salvar Aparelho</button>
            </div>
          </form>
        `
            : ''
        }
      `;

      const cont = $('#janela-conteudo');
      cont.innerHTML = html;

      $$('.subtab', cont).forEach((btn) => {
        btn.addEventListener('click', () => renderizar(btn.dataset.aba));
      });

      // Filtros da tabela de inventário
      const filtrarTabela = () => {
        const fTipo = $('#filtro-ap-tipo')?.value || '';
        const fSit = $('#filtro-ap-situacao')?.value || '';
        const fBusca = ($('#filtro-ap-busca')?.value || '').trim().toLowerCase();
        $$('#tabela-aparelhos tbody tr', cont).forEach((tr) => {
          const okTipo = !fTipo || tr.dataset.tipo === fTipo;
          const okSit = !fSit || tr.dataset.situacao === fSit;
          const okBusca = !fBusca || tr.dataset.busca.includes(fBusca);
          tr.style.display = okTipo && okSit && okBusca ? '' : 'none';
        });
      };
      $('#filtro-ap-tipo', cont)?.addEventListener('change', filtrarTabela);
      $('#filtro-ap-situacao', cont)?.addEventListener('change', filtrarTabela);
      $('#filtro-ap-busca', cont)?.addEventListener('input', filtrarTabela);

      // Edição de observações (Aluno Monitor)
      $$('[data-obs-id]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.obsId;
          const atual = btn.dataset.obsAtual || 'nenhuma';
          const novaObs = window.prompt('Atualizar observações deste aparelho:', atual);
          if (novaObs === null) return;
          try {
            await api(`/api/aparelhos/${id}/observacoes`, {
              method: 'PATCH',
              body: { observacoes: novaObs }
            });
            await renderizar('lista');
          } catch (err) {
            $('#aparelhos-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Edição completa (Gestor)
      $$('[data-edit-id]', cont).forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.editId);
          const ap = aparelhos.find((a) => Number(a.id_aparelho) === id);
          if (!ap) return;

          const painelEd = $('#painel-edicao-aparelho', cont);
          painelEd.innerHTML = `
            <form id="form-editar-aparelho" class="painel-card" style="margin-top:16px;">
              <h3>Editando ${esc(ap.tipo_aparelho)} #${esc(ap.numero_aparelho)}</h3>
              <div class="form-grid">
                <div class="campo">
                  <label>Tipo</label>
                  <select name="tipo">
                    ${['notebook', 'notebook ds', 'chromebook', 'tablet', 'celular']
                      .map((t) => `<option value="${t}" ${ap.tipo_aparelho === t ? 'selected' : ''}>${t}</option>`)
                      .join('')}
                  </select>
                </div>
                <div class="campo">
                  <label>Marca</label>
                  <select name="marca">
                    ${['vaio', 'positivo', 'samsung', 'honor', 'xiaomi']
                      .map((m) => `<option value="${m}" ${ap.marca_aparelho === m ? 'selected' : ''}>${m}</option>`)
                      .join('')}
                  </select>
                </div>
                <div class="campo">
                  <label>Modelo</label>
                  <input type="text" name="modelo" value="${esc(ap.modelo_aparelho)}" maxlength="45" required>
                </div>
                <div class="campo">
                  <label>Número</label>
                  <input type="number" name="numero" value="${esc(ap.numero_aparelho)}" min="1" required>
                </div>
                <div class="campo">
                  <label>Patrimônio</label>
                  <input type="number" name="patrimonio" value="${esc(ap.patrimonio)}" min="1" required>
                </div>
                <div class="campo">
                  <label>Disponibilidade</label>
                  <select name="disponivel">
                    <option value="1" ${Number(ap.disponivel) ? 'selected' : ''}>Disponível</option>
                    <option value="0" ${!Number(ap.disponivel) ? 'selected' : ''}>Indisponível / Manutenção</option>
                  </select>
                </div>
                <div class="campo" style="grid-column:1 / -1;">
                  <label>Observações</label>
                  <input type="text" name="observacoes" value="${esc(ap.observacoes_aparelho)}" maxlength="304">
                </div>
              </div>
              <div class="acoes-linha" style="margin-top:14px;">
                <button type="submit" class="btn-primario inline">Salvar Alterações</button>
                <button type="button" class="mini" id="cancelar-edicao-ap">Cancelar</button>
              </div>
            </form>
          `;

          $('#cancelar-edicao-ap', painelEd)?.addEventListener('click', () => {
            painelEd.innerHTML = '';
          });

          $('#form-editar-aparelho', painelEd)?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
              await api(`/api/aparelhos/${id}`, {
                method: 'PUT',
                body: {
                  tipo: fd.get('tipo'),
                  marca: fd.get('marca'),
                  modelo: fd.get('modelo'),
                  numero: Number(fd.get('numero')),
                  patrimonio: Number(fd.get('patrimonio')),
                  disponivel: Number(fd.get('disponivel')) === 1,
                  observacoes: fd.get('observacoes')
                }
              });
              await renderizar('lista');
            } catch (err) {
              $('#aparelhos-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
            }
          });
        });
      });

      // Exclusão (Gestor)
      $$('[data-del-id]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.delId;
          if (!window.confirm('Tem certeza que deseja excluir este aparelho?')) return;
          try {
            await api(`/api/aparelhos/${id}`, { method: 'DELETE' });
            await renderizar('lista');
          } catch (err) {
            $('#aparelhos-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Carregamento
      $$('[data-carga-id]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/carregamentos/${btn.dataset.cargaId}`, {
              method: 'POST',
              body: { carregando: btn.dataset.cargaNovo === '1' }
            });
            await renderizar('carregamento');
          } catch (err) {
            $('#aparelhos-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Novo Aparelho
      $('#form-novo-aparelho', cont)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/aparelhos', {
            method: 'POST',
            body: {
              tipo: fd.get('tipo'),
              marca: fd.get('marca'),
              modelo: fd.get('modelo'),
              numero: Number(fd.get('numero')),
              patrimonio: Number(fd.get('patrimonio')),
              disponivel: Number(fd.get('disponivel')) === 1,
              observacoes: fd.get('observacoes')
            }
          });
          await renderizar('lista');
        } catch (err) {
          $('#aparelhos-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
        }
      });
    }

    await renderizar('lista');
  }

  // ===================================================================
  // MÓDULO 2: EMPRÉSTIMOS (Com Validação Real de Reservas e Horários Fixos)
  // ===================================================================
  async function abrirModuloEmprestimos() {
    abrirJanela('Controle de Empréstimos', `<div class="vazio-estado">Carregando empréstimos...</div>`);

    async function renderizar(abaAtiva = 'lista') {
      const emprestimos = await api('/api/emprestimos');
      const podeCriar = pode('emprestimos:criar');
      const podeDevolver = pode('emprestimos:devolver');

      const iniPadrao = agoraLocalInput();
      const fimPadrao = somarMinutosLocalInput(iniPadrao, 50);

      const cont = $('#janela-conteudo');
      cont.innerHTML = `
        <div class="subtabs">
          <button type="button" class="subtab ${abaAtiva === 'lista' ? 'ativo' : ''}" data-aba="lista">Registros de Empréstimo (${emprestimos.length})</button>
          ${podeCriar ? `<button type="button" class="subtab ${abaAtiva === 'novo' ? 'ativo' : ''}" data-aba="novo">+ Registrar Empréstimo</button>` : ''}
        </div>

        <div id="emp-feedback"></div>

        ${
          abaAtiva === 'lista'
            ? `
          <div class="tabela-wrap">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Início / Previsão</th>
                  <th>Professor / Disciplina</th>
                  <th>Turma / Sala</th>
                  <th>Equipamentos</th>
                  <th>Status</th>
                  ${podeDevolver ? '<th>Ação</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${
                  emprestimos.length
                    ? emprestimos
                        .map((e) => {
                          const devolvido = Number(e.devolucao) === 1;
                          return `
                          <tr>
                            <td>
                              <strong>${formatarDataHoraBr(e.hora_inicio || e.data_emprestimo)}</strong>
                              <div style="font-size:0.76rem;color:var(--text-muted);">
                                Prev.: ${formatarDataHoraBr(e.hora_fim_prevista)}
                                ${e.fk_horario_fixo ? ' • <span class="selo info">Horário Fixo</span>' : ''}
                              </div>
                            </td>
                            <td>
                              <strong>${esc(e.professor)}</strong>
                              <div style="font-size:0.76rem;color:var(--text-muted);">${esc(e.disciplina)}</div>
                            </td>
                            <td><strong>${esc(e.turma)}</strong> (Sala ${esc(e.sala)})</td>
                            <td>
                              <strong>${esc(e.quantidade)}x ${esc(e.tipo_aparelho)}</strong>
                              <div style="font-size:0.76rem;color:var(--text-muted);">${esc(e.aparelhos_numeros || '')}</div>
                            </td>
                            <td>
                              ${
                                devolvido
                                  ? `<span class="selo ok">Devolvido</span><div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">${formatarDataHoraBr(e.devolvido_em)}</div>`
                                  : `<span class="selo aviso">Em andamento</span>`
                              }
                            </td>
                            ${
                              podeDevolver
                                ? `<td>
                                    ${
                                      !devolvido
                                        ? `<button type="button" class="mini ok" data-devolver-id="${e.id_emprestimo}">Registrar Devolução</button>`
                                        : '—'
                                    }
                                  </td>`
                                : ''
                            }
                          </tr>
                        `;
                        })
                        .join('')
                    : `<tr><td colspan="6" class="vazio-estado">Nenhum empréstimo registrado.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        `
            : ''
        }

        ${
          abaAtiva === 'novo' && podeCriar
            ? `
          <form id="form-novo-emprestimo" class="painel-card">
            <h3>Novo Empréstimo de Equipamentos</h3>
            <div class="form-grid">
              <div class="campo">
                <label>Professor</label>
                <select id="emp-professor" required>
                  <option value="">Selecione o professor...</option>
                  ${state.opcoes.professores
                    .map((p) => `<option value="${esc(p.nome_professor)}">${esc(p.nome_professor)} (${esc(p.disciplina_professor)})</option>`)
                    .join('')}
                </select>
              </div>
              <div class="campo">
                <label>Turma</label>
                <select id="emp-turma" required>
                  <option value="">Selecione a turma...</option>
                  ${state.opcoes.turmas
                    .map((t) => `<option value="${esc(t.nome_turma)}">${esc(t.nome_turma)} • Sala ${esc(t.sala)}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="campo">
                <label>Tipo de Aparelho</label>
                <select id="emp-tipo" required>
                  <option value="notebook">Notebook</option>
                  <option value="notebook ds">Notebook DS</option>
                  <option value="chromebook">Chromebook</option>
                  <option value="tablet">Tablet</option>
                  <option value="celular">Celular</option>
                </select>
              </div>
              <div class="campo">
                <label>Início do Empréstimo</label>
                <input type="datetime-local" id="emp-inicio" value="${iniPadrao}" required>
              </div>
              <div class="campo">
                <label>Previsão de Devolução</label>
                <input type="datetime-local" id="emp-fim" value="${fimPadrao}" required>
              </div>
            </div>

            <div style="margin-top:16px;">
              <label style="font-size:0.83rem;font-weight:700;display:block;margin-bottom:8px;">
                Selecione os aparelhos disponíveis neste intervalo:
              </label>
              <div id="emp-lista-aparelhos" class="seletor-aparelhos-grid">
                <div class="vazio-estado">Carregando disponibilidade...</div>
              </div>
            </div>

            <div style="margin-top:16px;">
              <button type="submit" class="btn-primario inline">Confirmar Empréstimo</button>
            </div>
          </form>
        `
            : ''
        }
      `;

      $$('.subtab', cont).forEach((btn) => {
        btn.addEventListener('click', () => renderizar(btn.dataset.aba));
      });

      $$('[data-devolver-id]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/emprestimos/${btn.dataset.devolverId}/devolver`, { method: 'POST' });
            await renderizar('lista');
          } catch (err) {
            $('#emp-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      if (abaAtiva === 'novo' && podeCriar) {
        const selecionados = new Set();

        async function atualizarAparelhosEmp() {
          const tipo = $('#emp-tipo').value;
          const professor = $('#emp-professor').value;
          const turma = $('#emp-turma').value;
          const inicio = inputParaSql($('#emp-inicio').value);
          const fim = inputParaSql($('#emp-fim').value);
          const box = $('#emp-lista-aparelhos');

          if (!inicio || !fim || inicio >= fim) {
            box.innerHTML = `<div class="vazio-estado">Informe um intervalo válido (devolução posterior ao início).</div>`;
            return;
          }

          try {
            const params = new URLSearchParams({ tipo, professor, turma, inicio, fim });
            const lista = await api(`/api/emprestimos/disponibilidade?${params.toString()}`);
            selecionados.clear();

            if (!lista.length) {
              box.innerHTML = `<div class="vazio-estado">Nenhum aparelho cadastrado deste tipo.</div>`;
              return;
            }

            box.innerHTML = lista
              .map(
                (ap) => `
              <div class="chip-aparelho ${ap.livre ? '' : 'bloqueado'}" data-ap-id="${ap.id_aparelho}" data-livre="${ap.livre ? '1' : '0'}">
                <div class="chip-aparelho-topo">
                  <span>#${esc(ap.numero_aparelho)} • ${esc(ap.marca_aparelho)}</span>
                  <span class="selo ${ap.livre ? 'ok' : 'erro'}">${ap.livre ? 'Livre' : 'Ocupado'}</span>
                </div>
                <div class="chip-aparelho-sub">${esc(ap.motivo)}</div>
              </div>
            `
              )
              .join('');

            $$('.chip-aparelho', box).forEach((chip) => {
              chip.addEventListener('click', () => {
                if (chip.dataset.livre !== '1') return;
                const id = Number(chip.dataset.apId);
                if (selecionados.has(id)) {
                  selecionados.delete(id);
                  chip.classList.remove('selecionado');
                } else {
                  selecionados.add(id);
                  chip.classList.add('selecionado');
                }
              });
            });
          } catch (err) {
            box.innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        }

        $('#emp-tipo')?.addEventListener('change', atualizarAparelhosEmp);
        $('#emp-professor')?.addEventListener('change', atualizarAparelhosEmp);
        $('#emp-turma')?.addEventListener('change', atualizarAparelhosEmp);
        $('#emp-inicio')?.addEventListener('change', atualizarAparelhosEmp);
        $('#emp-fim')?.addEventListener('change', atualizarAparelhosEmp);
        await atualizarAparelhosEmp();

        $('#form-novo-emprestimo')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/api/emprestimos', {
              method: 'POST',
              body: {
                professor: $('#emp-professor').value,
                turma: $('#emp-turma').value,
                tipo: $('#emp-tipo').value,
                inicio: inputParaSql($('#emp-inicio').value),
                fim: inputParaSql($('#emp-fim').value),
                aparelhos: [...selecionados]
              }
            });
            await renderizar('lista');
          } catch (err) {
            $('#emp-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      }
    }

    await renderizar('lista');
  }

  // ===================================================================
  // MÓDULO 3: RESERVAS N:N (Professor, Disciplina, Turma, Expansão e Controle Individual)
  // ===================================================================
  async function abrirModuloReservas() {
    abrirJanela('Reservas de Equipamentos', `<div class="vazio-estado">Carregando reservas...</div>`);

    async function renderizar(abaAtiva = 'lista') {
      const reservas = await api('/api/reservas');
      const podeCriar = pode('reservas:criar');
      const podeGerenciarTodos = pode('reservas:gerenciar_status');
      const podeCancelarPropria = pode('reservas:cancelar_propria');

      const iniPadrao = somarMinutosLocalInput(agoraLocalInput(), 30);
      const fimPadrao = somarMinutosLocalInput(iniPadrao, 50);

      const cont = $('#janela-conteudo');
      cont.innerHTML = `
        <div class="subtabs">
          <button type="button" class="subtab ${abaAtiva === 'lista' ? 'ativo' : ''}" data-aba="lista">Reservas Registradas (${reservas.length})</button>
          ${podeCriar ? `<button type="button" class="subtab ${abaAtiva === 'nova' ? 'ativo' : ''}" data-aba="nova">+ Nova Reserva</button>` : ''}
        </div>

        <div id="res-feedback"></div>

        ${
          abaAtiva === 'lista'
            ? `
          <div class="tabela-wrap">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Professor / Disciplina</th>
                  <th>Turma</th>
                  <th>Aparelhos</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${
                  reservas.length
                    ? reservas
                        .map((r) => {
                          const idR = Number(r.id_reserva);
                          const expandida = state.reservasExpandidas.has(idR);
                          const ativa = r.status_reserva === 'ativa';
                          const eDono = r.usuario === state.usuario?.nome;
                          const podeCancelarEsta = ativa && (podeGerenciarTodos || (podeCancelarPropria && eDono));
                          const podeConcluirEsta = ativa && podeGerenciarTodos;

                          let badgeStatus = `<span class="selo ${
                            r.status_reserva === 'concluida'
                              ? 'ok'
                              : r.status_reserva === 'cancelada'
                              ? 'erro'
                              : 'info'
                          }">${esc(r.status_reserva)}</span>`;

                          if (r.estado_temporal === 'em_andamento') {
                            badgeStatus = `<span class="selo aviso">Em andamento</span>`;
                          } else if (r.estado_temporal === 'futura') {
                            badgeStatus = `<span class="selo info">Agendada</span>`;
                          }

                          return `
                          <tr>
                            <td>
                              <strong>${formatarDataHoraBr(r.inicio_reserva)}</strong>
                              <div style="font-size:0.76rem;color:var(--text-muted);">até ${formatarDataHoraBr(r.fim_reserva)}</div>
                            </td>
                            <td>
                              <strong>${esc(r.professor || r.usuario)}</strong>
                              <div style="font-size:0.76rem;color:var(--text-muted);">${esc(r.disciplina || '—')} • por ${esc(r.usuario)}</div>
                            </td>
                            <td><strong>${esc(r.turma || '—')}</strong>${r.sala ? ` (Sala ${esc(r.sala)})` : ''}</td>
                            <td>
                              <button type="button" class="mini" data-expandir-res="${idR}">
                                ${expandida ? '▾' : '▸'} ${r.total_itens} aparelho(s)
                                (${r.itens_ativos} ativo / ${r.itens_concluidos} concl. / ${r.itens_cancelados} canc.)
                              </button>
                            </td>
                            <td>${badgeStatus}</td>
                            <td>
                              <div class="acoes-linha">
                                ${podeConcluirEsta ? `<button type="button" class="mini ok" data-concluir-res="${idR}">Concluir Todos</button>` : ''}
                                ${podeCancelarEsta ? `<button type="button" class="mini perigo" data-cancelar-res="${idR}">Cancelar Todos</button>` : ''}
                              </div>
                            </td>
                          </tr>
                          ${
                            expandida
                              ? `
                            <tr class="linha-detalhes-reserva">
                              <td colspan="6">
                                <div style="font-size:0.79rem;font-weight:700;margin-bottom:8px;color:var(--text-secondary);">
                                  Controle individual dos equipamentos desta reserva:
                                </div>
                                <div class="lista-itens-reserva">
                                  ${(r.itens || [])
                                    .map((item) => {
                                      const itemAtivo = item.status_item === 'ativo';
                                      return `
                                      <div class="card-item-reserva">
                                        <div>
                                          <strong>${esc(item.tipo_aparelho)} #${esc(item.numero_aparelho)}</strong>
                                          <div style="font-size:0.75rem;color:var(--text-muted);">
                                            ${esc(item.marca_aparelho)} • ${esc(item.modelo_aparelho)}
                                          </div>
                                        </div>
                                        <div class="acoes-linha">
                                          <span class="selo ${
                                            item.status_item === 'concluido'
                                              ? 'ok'
                                              : item.status_item === 'cancelado'
                                              ? 'erro'
                                              : 'info'
                                          }">${esc(item.status_item)}</span>
                                          ${
                                            itemAtivo && podeConcluirEsta
                                              ? `<button type="button" class="mini ok" data-item-res="${idR}" data-item-ap="${item.fk_aparelho}" data-item-acao="concluir" title="Concluir este aparelho">✓</button>`
                                              : ''
                                          }
                                          ${
                                            itemAtivo && podeCancelarEsta
                                              ? `<button type="button" class="mini perigo" data-item-res="${idR}" data-item-ap="${item.fk_aparelho}" data-item-acao="cancelar" title="Cancelar este aparelho">✕</button>`
                                              : ''
                                          }
                                        </div>
                                      </div>
                                    `;
                                    })
                                    .join('')}
                                </div>
                              </td>
                            </tr>
                          `
                              : ''
                          }
                        `;
                        })
                        .join('')
                    : `<tr><td colspan="6" class="vazio-estado">Nenhuma reserva encontrada.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        `
            : ''
        }

        ${
          abaAtiva === 'nova' && podeCriar
            ? `
          <form id="form-nova-reserva" class="painel-card">
            <h3>Agendar Nova Reserva de Equipamentos</h3>
            <div class="form-grid">
              <div class="campo">
                <label>Professor</label>
                <select id="res-professor" required>
                  <option value="">Selecione o professor...</option>
                  ${state.opcoes.professores
                    .map(
                      (p) =>
                        `<option value="${esc(p.nome_professor)}" data-disciplina="${esc(p.disciplina_professor)}">${esc(
                          p.nome_professor
                        )}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="campo">
                <label>Disciplina (preenchida automaticamente)</label>
                <input type="text" id="res-disciplina" readonly placeholder="Selecione um professor">
              </div>
              <div class="campo">
                <label>Turma</label>
                <select id="res-turma" required>
                  <option value="">Selecione a turma...</option>
                  ${state.opcoes.turmas
                    .map((t) => `<option value="${esc(t.nome_turma)}">${esc(t.nome_turma)} • Sala ${esc(t.sala)}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="campo">
                <label>Início da Reserva</label>
                <input type="datetime-local" id="res-inicio" value="${iniPadrao}" required>
              </div>
              <div class="campo">
                <label>Término da Reserva</label>
                <input type="datetime-local" id="res-fim" value="${fimPadrao}" required>
              </div>
            </div>

            <div style="margin-top:16px;">
              <div class="barra-filtros">
                <strong style="font-size:0.84rem;">Aparelhos no período escolhido:</strong>
                <select id="res-filtro-tipo">
                  <option value="">Todos os tipos</option>
                  <option value="notebook">Notebook</option>
                  <option value="notebook ds">Notebook DS</option>
                  <option value="chromebook">Chromebook</option>
                  <option value="tablet">Tablet</option>
                  <option value="celular">Celular</option>
                </select>
              </div>
              <div id="res-lista-aparelhos" class="seletor-aparelhos-grid">
                <div class="vazio-estado">Carregando disponibilidade...</div>
              </div>
            </div>

            <div style="margin-top:16px;">
              <button type="submit" class="btn-primario inline">Confirmar Reserva</button>
            </div>
          </form>
        `
            : ''
        }
      `;

      $$('.subtab', cont).forEach((btn) => {
        btn.addEventListener('click', () => renderizar(btn.dataset.aba));
      });

      // Expansão de itens
      $$('[data-expandir-res]', cont).forEach((btn) => {
        btn.addEventListener('click', () => {
          const idR = Number(btn.dataset.expandirRes);
          if (state.reservasExpandidas.has(idR)) state.reservasExpandidas.delete(idR);
          else state.reservasExpandidas.add(idR);
          renderizar('lista');
        });
      });

      // Concluir reserva inteira
      $$('[data-concluir-res]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/reservas/${btn.dataset.concluirRes}/concluir`, { method: 'POST' });
            await renderizar('lista');
          } catch (err) {
            $('#res-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Cancelar reserva inteira
      $$('[data-cancelar-res]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Cancelar todos os itens ainda ativos desta reserva?')) return;
          try {
            await api(`/api/reservas/${btn.dataset.cancelarRes}/cancelar`, { method: 'POST' });
            await renderizar('lista');
          } catch (err) {
            $('#res-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Concluir ou cancelar item individual
      $$('[data-item-res]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const { itemRes, itemAp, itemAcao } = btn.dataset;
          try {
            await api(`/api/reservas/${itemRes}/itens/${itemAp}`, {
              method: 'PATCH',
              body: { acao: itemAcao }
            });
            await renderizar('lista');
          } catch (err) {
            $('#res-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      if (abaAtiva === 'nova' && podeCriar) {
        const selecionados = new Set();

        $('#res-professor')?.addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          $('#res-disciplina').value = opt?.dataset?.disciplina || '';
        });

        async function atualizarDisponibilidadeReserva() {
          const inicio = inputParaSql($('#res-inicio').value);
          const fim = inputParaSql($('#res-fim').value);
          const filtroTipo = $('#res-filtro-tipo').value;
          const box = $('#res-lista-aparelhos');

          if (!inicio || !fim || inicio >= fim) {
            box.innerHTML = `<div class="vazio-estado">O horário de término deve ser posterior ao início.</div>`;
            return;
          }

          try {
            const lista = await api(
              `/api/reservas/disponibilidade?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`
            );

            // Remove da seleção aparelhos que ficaram indisponíveis no novo horário
            const livresIds = new Set();
            const filtrados = lista.filter((ap) => !filtroTipo || ap.tipo_aparelho === filtroTipo);

            box.innerHTML = filtrados
              .map((ap) => {
                const livre =
                  !Number(ap.emprestado) &&
                  !Number(ap.reservado) &&
                  !Number(ap.horario_fixo) &&
                  !Number(ap.manutencao);
                const idAp = Number(ap.id_aparelho);
                if (livre) livresIds.add(idAp);

                let motivo = 'Disponível no horário';
                if (Number(ap.emprestado)) motivo = `Emprestado: ${ap.emprestimo_info}`;
                else if (Number(ap.manutencao)) motivo = 'Em manutenção';
                else if (Number(ap.reservado)) motivo = `Reservado: ${ap.reserva_info}`;
                else if (Number(ap.horario_fixo)) motivo = `Horário Fixo: ${ap.horario_fixo_info}`;

                const marcado = livre && selecionados.has(idAp);

                return `
                  <div class="chip-aparelho ${livre ? '' : 'bloqueado'} ${marcado ? 'selecionado' : ''}"
                       data-ap-id="${idAp}" data-livre="${livre ? '1' : '0'}">
                    <div class="chip-aparelho-topo">
                      <span>${esc(ap.tipo_aparelho)} #${esc(ap.numero_aparelho)}</span>
                      <span class="selo ${livre ? 'ok' : 'erro'}">${livre ? 'Livre' : 'Indisponível'}</span>
                    </div>
                    <div class="chip-aparelho-sub">${esc(motivo)}</div>
                  </div>
                `;
              })
              .join('');

            for (const idSel of [...selecionados]) {
              if (!livresIds.has(idSel)) selecionados.delete(idSel);
            }

            $$('.chip-aparelho', box).forEach((chip) => {
              chip.addEventListener('click', () => {
                if (chip.dataset.livre !== '1') return;
                const id = Number(chip.dataset.apId);
                if (selecionados.has(id)) {
                  selecionados.delete(id);
                  chip.classList.remove('selecionado');
                } else {
                  selecionados.add(id);
                  chip.classList.add('selecionado');
                }
              });
            });
          } catch (err) {
            box.innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        }

        $('#res-inicio')?.addEventListener('change', atualizarDisponibilidadeReserva);
        $('#res-fim')?.addEventListener('change', atualizarDisponibilidadeReserva);
        $('#res-filtro-tipo')?.addEventListener('change', atualizarDisponibilidadeReserva);
        await atualizarDisponibilidadeReserva();

        $('#form-nova-reserva')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/api/reservas', {
              method: 'POST',
              body: {
                professor: $('#res-professor').value,
                turma: $('#res-turma').value,
                inicio: inputParaSql($('#res-inicio').value),
                fim: inputParaSql($('#res-fim').value),
                aparelhos: [...selecionados]
              }
            });
            await renderizar('lista');
          } catch (err) {
            $('#res-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      }
    }

    await renderizar('lista');
  }

  // ===================================================================
  // MÓDULO 4: HORÁRIOS FIXOS (Reservas Recorrentes Semanais)
  // ===================================================================
  async function abrirModuloHorariosFixos() {
    abrirJanela('Horários Fixos Recorrentes', `<div class="vazio-estado">Carregando grade de horários fixos...</div>`);

    async function renderizar(abaAtiva = 'grade') {
      const [horarios, aparelhos] = await Promise.all([
        api('/api/horarios-fixos'),
        api('/api/aparelhos')
      ]);

      const podeGerenciar = pode('horarios_fixos:gerenciar');
      const cont = $('#janela-conteudo');

      cont.innerHTML = `
        <div class="subtabs">
          <button type="button" class="subtab ${abaAtiva === 'grade' ? 'ativo' : ''}" data-aba="grade">Grade de Horários Fixos (${horarios.length})</button>
          ${podeGerenciar ? `<button type="button" class="subtab ${abaAtiva === 'novo' ? 'ativo' : ''}" data-aba="novo">+ Novo Horário Fixo</button>` : ''}
        </div>

        <div id="hf-feedback"></div>

        ${
          abaAtiva === 'grade'
            ? `
          <div class="barra-filtros">
            <select id="filtro-hf-dia">
              <option value="">Todos os dias da semana</option>
              ${NOMES_DIAS_SEMANA.map((d, idx) => `<option value="${idx}">${d}</option>`).join('')}
            </select>
            <select id="filtro-hf-status">
              <option value="ativo">Somente Ativos</option>
              <option value="">Todos (Ativos e Cancelados)</option>
              <option value="cancelado">Cancelados</option>
            </select>
          </div>

          <div class="tabela-wrap">
            <table class="tabela" id="tabela-hf">
              <thead>
                <tr>
                  <th>Dia da Semana</th>
                  <th>Faixa Horária</th>
                  <th>Professor / Disciplina</th>
                  <th>Turma / Sala</th>
                  <th>Equipamentos Reservados</th>
                  <th>Status</th>
                  ${podeGerenciar ? '<th>Ações</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${
                  horarios.length
                    ? horarios
                        .map(
                          (h) => `
                        <tr data-dia="${h.dia_semana}" data-status="${esc(h.status_horario)}">
                          <td><strong>${esc(NOMES_DIAS_SEMANA[h.dia_semana] || '—')}</strong></td>
                          <td><strong>${formatarHoraCurta(h.hora_inicio)} às ${formatarHoraCurta(h.hora_fim)}</strong></td>
                          <td>
                            <strong>${esc(h.professor)}</strong>
                            <div style="font-size:0.76rem;color:var(--text-muted);">${esc(h.disciplina)}</div>
                          </td>
                          <td><strong>${esc(h.turma)}</strong>${h.sala ? ` (Sala ${esc(h.sala)})` : ''}</td>
                          <td>
                            ${(h.aparelhos || [])
                              .map((a) => `<span class="selo neutro" style="margin:2px;">${esc(a.tipo_aparelho)} #${esc(a.numero_aparelho)}</span>`)
                              .join('')}
                          </td>
                          <td>
                            <span class="selo ${h.status_horario === 'ativo' ? 'ok' : 'erro'}">${esc(h.status_horario)}</span>
                            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:2px;">${h.total_utilizacoes} uso(s) registrado(s)</div>
                          </td>
                          ${
                            podeGerenciar
                              ? `<td>
                                  <div class="acoes-linha">
                                    ${
                                      h.status_horario === 'ativo'
                                        ? `
                                      <button type="button" class="mini" data-edit-hf="${h.id_horario_fixo}">Editar</button>
                                      <button type="button" class="mini perigo" data-cancel-hf="${h.id_horario_fixo}">Cancelar</button>
                                    `
                                        : '—'
                                    }
                                  </div>
                                </td>`
                              : ''
                          }
                        </tr>
                      `
                        )
                        .join('')
                    : `<tr><td colspan="7" class="vazio-estado">Nenhum horário fixo cadastrado.</td></tr>`
                }
              </tbody>
            </table>
          </div>
          <div id="painel-edicao-hf"></div>
        `
            : ''
        }

        ${
          abaAtiva === 'novo' && podeGerenciar
            ? `
          <form id="form-novo-hf" class="painel-card">
            <h3>Cadastrar Horário Fixo Recorrente</h3>
            <div class="campo" style="margin-bottom:14px;">
              <label>Dias da Semana (selecione um ou mais dias)</label>
              <div class="dias-semana-picker" id="hf-dias-picker">
                ${NOMES_DIAS_SEMANA.map(
                  (nome, idx) => `
                  <button type="button" class="dia-pill ${idx < 5 ? '' : ''}" data-dia-idx="${idx}">${nome}</button>
                `
                ).join('')}
              </div>
            </div>

            <div class="form-grid">
              <div class="campo">
                <label>Horário de Início</label>
                <input type="time" id="hf-inicio" value="07:30" required>
              </div>
              <div class="campo">
                <label>Horário de Término</label>
                <input type="time" id="hf-fim" value="09:10" required>
              </div>
              <div class="campo">
                <label>Professor</label>
                <select id="hf-professor" required>
                  <option value="">Selecione o professor...</option>
                  ${state.opcoes.professores
                    .map(
                      (p) =>
                        `<option value="${esc(p.nome_professor)}" data-disciplina="${esc(p.disciplina_professor)}">${esc(
                          p.nome_professor
                        )}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="campo">
                <label>Disciplina</label>
                <input type="text" id="hf-disciplina" required placeholder="Preenchida ao escolher o professor">
              </div>
              <div class="campo">
                <label>Turma</label>
                <select id="hf-turma" required>
                  <option value="">Selecione a turma...</option>
                  ${state.opcoes.turmas
                    .map((t) => `<option value="${esc(t.nome_turma)}">${esc(t.nome_turma)} • Sala ${esc(t.sala)}</option>`)
                    .join('')}
                </select>
              </div>
            </div>

            <div style="margin-top:16px;">
              <label style="font-size:0.83rem;font-weight:700;display:block;margin-bottom:8px;">
                Selecione os aparelhos vinculados a este horário fixo:
              </label>
              <div class="seletor-aparelhos-grid" id="hf-lista-aparelhos">
                ${aparelhos
                  .map(
                    (ap) => `
                  <div class="chip-aparelho" data-ap-id="${ap.id_aparelho}">
                    <div class="chip-aparelho-topo">
                      <span>${esc(ap.tipo_aparelho)} #${esc(ap.numero_aparelho)}</span>
                      <span class="selo info">Pat. ${esc(ap.patrimonio)}</span>
                    </div>
                    <div class="chip-aparelho-sub">${esc(ap.marca_aparelho)} • ${esc(ap.modelo_aparelho)}</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div style="margin-top:16px;">
              <button type="submit" class="btn-primario inline">Salvar Horário Fixo</button>
            </div>
          </form>
        `
            : ''
        }
      `;

      $$('.subtab', cont).forEach((btn) => {
        btn.addEventListener('click', () => renderizar(btn.dataset.aba));
      });

      const aplicarFiltrosHf = () => {
        const fDia = $('#filtro-hf-dia')?.value ?? '';
        const fSt = $('#filtro-hf-status')?.value ?? '';
        $$('#tabela-hf tbody tr', cont).forEach((tr) => {
          const okDia = fDia === '' || tr.dataset.dia === fDia;
          const okSt = fSt === '' || tr.dataset.status === fSt;
          tr.style.display = okDia && okSt ? '' : 'none';
        });
      };
      $('#filtro-hf-dia', cont)?.addEventListener('change', aplicarFiltrosHf);
      $('#filtro-hf-status', cont)?.addEventListener('change', aplicarFiltrosHf);
      aplicarFiltrosHf();

      // Cancelar horário fixo
      $$('[data-cancel-hf]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Cancelar este horário fixo recorrente? Os aparelhos serão liberados para reservas normais.')) return;
          try {
            await api(`/api/horarios-fixos/${btn.dataset.cancelHf}/cancelar`, { method: 'POST' });
            await renderizar('grade');
          } catch (err) {
            $('#hf-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      // Editar horário fixo
      $$('[data-edit-hf]', cont).forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.editHf);
          const hf = horarios.find((item) => Number(item.id_horario_fixo) === id);
          if (!hf) return;

          const idsAtuais = new Set((hf.aparelhos || []).map((a) => Number(a.id_aparelho)));
          const boxEd = $('#painel-edicao-hf', cont);

          boxEd.innerHTML = `
            <form id="form-editar-hf" class="painel-card" style="margin-top:16px;">
              <h3>Editando Horário Fixo #${id}</h3>
              <div class="form-grid">
                <div class="campo">
                  <label>Dia da Semana</label>
                  <select id="ed-hf-dia">
                    ${NOMES_DIAS_SEMANA.map(
                      (nome, idx) => `<option value="${idx}" ${Number(hf.dia_semana) === idx ? 'selected' : ''}>${nome}</option>`
                    ).join('')}
                  </select>
                </div>
                <div class="campo">
                  <label>Início</label>
                  <input type="time" id="ed-hf-inicio" value="${formatarHoraCurta(hf.hora_inicio)}" required>
                </div>
                <div class="campo">
                  <label>Término</label>
                  <input type="time" id="ed-hf-fim" value="${formatarHoraCurta(hf.hora_fim)}" required>
                </div>
                <div class="campo">
                  <label>Professor</label>
                  <select id="ed-hf-prof">
                    ${state.opcoes.professores
                      .map(
                        (p) =>
                          `<option value="${esc(p.nome_professor)}" ${
                            p.nome_professor === hf.professor ? 'selected' : ''
                          }>${esc(p.nome_professor)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="campo">
                  <label>Disciplina</label>
                  <input type="text" id="ed-hf-disc" value="${esc(hf.disciplina)}" required>
                </div>
                <div class="campo">
                  <label>Turma</label>
                  <select id="ed-hf-turma">
                    ${state.opcoes.turmas
                      .map(
                        (t) =>
                          `<option value="${esc(t.nome_turma)}" ${t.nome_turma === hf.turma ? 'selected' : ''}>${esc(
                            t.nome_turma
                          )}</option>`
                      )
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="seletor-aparelhos-grid" style="margin-top:14px;" id="ed-hf-aparelhos">
                ${aparelhos
                  .map((ap) => {
                    const idAp = Number(ap.id_aparelho);
                    return `
                    <div class="chip-aparelho ${idsAtuais.has(idAp) ? 'selecionado' : ''}" data-ap-id="${idAp}">
                      <div class="chip-aparelho-topo">
                        <span>${esc(ap.tipo_aparelho)} #${esc(ap.numero_aparelho)}</span>
                      </div>
                      <div class="chip-aparelho-sub">${esc(ap.marca_aparelho)} • ${esc(ap.modelo_aparelho)}</div>
                    </div>
                  `;
                  })
                  .join('')}
              </div>

              <div class="acoes-linha" style="margin-top:14px;">
                <button type="submit" class="btn-primario inline">Salvar Alterações</button>
                <button type="button" class="mini" id="fechar-ed-hf">Cancelar</button>
              </div>
            </form>
          `;

          $$('.chip-aparelho', boxEd).forEach((chip) => {
            chip.addEventListener('click', () => {
              const idAp = Number(chip.dataset.apId);
              if (idsAtuais.has(idAp)) {
                idsAtuais.delete(idAp);
                chip.classList.remove('selecionado');
              } else {
                idsAtuais.add(idAp);
                chip.classList.add('selecionado');
              }
            });
          });

          $('#fechar-ed-hf', boxEd)?.addEventListener('click', () => {
            boxEd.innerHTML = '';
          });

          $('#form-editar-hf', boxEd)?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
              await api(`/api/horarios-fixos/${id}`, {
                method: 'PUT',
                body: {
                  dia_semana: Number($('#ed-hf-dia').value),
                  hora_inicio: $('#ed-hf-inicio').value,
                  hora_fim: $('#ed-hf-fim').value,
                  professor: $('#ed-hf-prof').value,
                  disciplina: $('#ed-hf-disc').value,
                  turma: $('#ed-hf-turma').value,
                  aparelhos: [...idsAtuais]
                }
              });
              await renderizar('grade');
            } catch (err) {
              $('#hf-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
            }
          });
        });
      });

      if (abaAtiva === 'novo' && podeGerenciar) {
        const diasSelecionados = new Set();
        const aparelhosSelecionados = new Set();

        $$('.dia-pill', cont).forEach((pill) => {
          pill.addEventListener('click', () => {
            const d = Number(pill.dataset.diaIdx);
            if (diasSelecionados.has(d)) {
              diasSelecionados.delete(d);
              pill.classList.remove('ativo');
            } else {
              diasSelecionados.add(d);
              pill.classList.add('ativo');
            }
          });
        });

        $('#hf-professor')?.addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          $('#hf-disciplina').value = opt?.dataset?.disciplina || '';
        });

        $$('#hf-lista-aparelhos .chip-aparelho', cont).forEach((chip) => {
          chip.addEventListener('click', () => {
            const id = Number(chip.dataset.apId);
            if (aparelhosSelecionados.has(id)) {
              aparelhosSelecionados.delete(id);
              chip.classList.remove('selecionado');
            } else {
              aparelhosSelecionados.add(id);
              chip.classList.add('selecionado');
            }
          });
        });

        $('#form-novo-hf')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/api/horarios-fixos', {
              method: 'POST',
              body: {
                dias_semana: [...diasSelecionados],
                hora_inicio: $('#hf-inicio').value,
                hora_fim: $('#hf-fim').value,
                professor: $('#hf-professor').value,
                disciplina: $('#hf-disciplina').value,
                turma: $('#hf-turma').value,
                aparelhos: [...aparelhosSelecionados]
              }
            });
            await renderizar('grade');
          } catch (err) {
            $('#hf-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      }
    }

    await renderizar('grade');
  }

  // ===================================================================
  // MÓDULO 5: RELATÓRIOS
  // ===================================================================
  async function abrirModuloRelatorios() {
    abrirJanela('Relatórios de Ocorrências e Vistoria', `<div class="vazio-estado">Carregando relatórios...</div>`);

    async function renderizar() {
      const lista = await api('/api/relatorios');
      const podeCriar = pode('relatorios:criar');

      const cont = $('#janela-conteudo');
      cont.innerHTML = `
        <div id="rel-feedback"></div>

        ${
          podeCriar
            ? `
          <form id="form-novo-relatorio" class="painel-card">
            <h3>Registrar Novo Relatório</h3>
            <div class="form-grid">
              <div class="campo">
                <label>Tipo de Aparelho</label>
                <select name="tipo" required>
                  <option value="notebook">Notebook</option>
                  <option value="notebook ds">Notebook DS</option>
                  <option value="chromebook">Chromebook</option>
                  <option value="tablet">Tablet</option>
                  <option value="celular">Celular</option>
                </select>
              </div>
              <div class="campo">
                <label>Quantidade Verificada</label>
                <input type="number" name="quantidade" min="0" value="1" required>
              </div>
              <div class="campo" style="grid-column: 1 / -1;">
                <label>Observações / Ocorrências</label>
                <input type="text" name="observacoes" maxlength="304" required placeholder="Descreva o estado dos aparelhos ou ocorrências">
              </div>
            </div>
            <div style="margin-top:14px;">
              <button type="submit" class="btn-primario inline">Salvar Relatório</button>
            </div>
          </form>
        `
            : ''
        }

        <div class="tabela-wrap">
          <table class="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Responsável</th>
                <th>Tipo de Aparelho</th>
                <th>Quantidade</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              ${
                lista.length
                  ? lista
                      .map(
                        (r) => `
                      <tr>
                        <td><strong>${formatarDataBr(r.data)}</strong></td>
                        <td>${esc(r.usuario)}</td>
                        <td>${esc(r.tipo)}</td>
                        <td>${esc(r.quantidade)}</td>
                        <td>${esc(r.observacoes)}</td>
                      </tr>
                    `
                      )
                      .join('')
                  : `<tr><td colspan="5" class="vazio-estado">Nenhum relatório registrado.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      `;

      $('#form-novo-relatorio', cont)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/relatorios', {
            method: 'POST',
            body: {
              tipo: fd.get('tipo'),
              quantidade: Number(fd.get('quantidade')),
              observacoes: fd.get('observacoes')
            }
          });
          await renderizar();
        } catch (err) {
          $('#rel-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
        }
      });
    }

    await renderizar();
  }

  // ===================================================================
  // MÓDULO 6: PROFESSORES E TURMAS (Gestor)
  // ===================================================================
  async function abrirModuloCadastros() {
    abrirJanela('Cadastro de Professores e Turmas', `<div class="vazio-estado">Carregando cadastros...</div>`);

    async function renderizar() {
      await carregarOpcoesAuxiliares();
      const { professores, turmas } = state.opcoes;

      const cont = $('#janela-conteudo');
      cont.innerHTML = `
        <div id="cad-feedback"></div>

        <div class="painel-card">
          <h3>Cadastrar Novo Professor</h3>
          <form id="form-novo-prof" class="form-grid">
            <div class="campo">
              <label>Nome Completo</label>
              <input type="text" name="nome" maxlength="99" required>
            </div>
            <div class="campo">
              <label>Disciplina</label>
              <input type="text" name="disciplina" maxlength="99" required>
            </div>
            <div class="campo">
              <label>Período Escolar</label>
              <select name="periodo">
                <option value="matutino">Matutino</option>
                <option value="vespertino">Vespertino</option>
                <option value="integral">Integral</option>
              </select>
            </div>
            <div>
              <button type="submit" class="btn-primario inline">Adicionar Professor</button>
            </div>
          </form>

          <div class="tabela-wrap" style="margin-top:16px;">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Professor</th>
                  <th>Disciplina</th>
                  <th>Período</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                ${professores
                  .map(
                    (p) => `
                  <tr>
                    <td><strong>${esc(p.nome_professor)}</strong></td>
                    <td>${esc(p.disciplina_professor)}</td>
                    <td>${esc(p.periodo_escolar)}</td>
                    <td><button type="button" class="mini perigo" data-del-prof="${p.id_professor}">Excluir</button></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="painel-card">
          <h3>Cadastrar Nova Turma</h3>
          <form id="form-nova-turma" class="form-grid">
            <div class="campo">
              <label>Sigla da Turma (máx. 5)</label>
              <input type="text" name="nome" maxlength="5" placeholder="Ex.: 2DS" required>
            </div>
            <div class="campo">
              <label>Qtd. Alunos</label>
              <input type="number" name="quantidade_alunos" min="1" value="35" required>
            </div>
            <div class="campo">
              <label>Modalidade</label>
              <select name="modalidade">
                <option value="desenvolvimento de sistemas">Desenvolvimento de Sistemas</option>
                <option value="administração">Administração</option>
                <option value="ensino regular">Ensino Regular</option>
                <option value="formação de docentes">Formação de Docentes</option>
              </select>
            </div>
            <div class="campo">
              <label>Turno</label>
              <select name="turno">
                <option value="matutino">Matutino</option>
                <option value="vespertino">Vespertino</option>
              </select>
            </div>
            <div class="campo">
              <label>Andar Escolar</label>
              <select name="andar">
                <option value="térreo">Térreo</option>
                <option value="primeiro piso">Primeiro Piso</option>
                <option value="segundo piso">Segundo Piso</option>
              </select>
            </div>
            <div class="campo">
              <label>Número da Sala</label>
              <input type="number" name="sala" min="1" required>
            </div>
            <div>
              <button type="submit" class="btn-primario inline">Adicionar Turma</button>
            </div>
          </form>

          <div class="tabela-wrap" style="margin-top:16px;">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Turma</th>
                  <th>Modalidade</th>
                  <th>Turno / Local</th>
                  <th>Alunos</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                ${turmas
                  .map(
                    (t) => `
                  <tr>
                    <td><strong>${esc(t.nome_turma)}</strong></td>
                    <td>${esc(t.modalidade)}</td>
                    <td>${esc(t.turno_escolar)} • ${esc(t.andar_escolar)} (Sala ${esc(t.sala)})</td>
                    <td>${esc(t.quantidade_alunos)}</td>
                    <td><button type="button" class="mini perigo" data-del-turma="${t.id_turma}">Excluir</button></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      $('#form-novo-prof', cont)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/professores', {
            method: 'POST',
            body: {
              nome: fd.get('nome'),
              disciplina: fd.get('disciplina'),
              periodo: fd.get('periodo')
            }
          });
          await renderizar();
        } catch (err) {
          $('#cad-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
        }
      });

      $$('[data-del-prof]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Excluir este professor?')) return;
          try {
            await api(`/api/professores/${btn.dataset.delProf}`, { method: 'DELETE' });
            await renderizar();
          } catch (err) {
            $('#cad-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      $('#form-nova-turma', cont)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/turmas', {
            method: 'POST',
            body: {
              nome: fd.get('nome'),
              quantidade_alunos: Number(fd.get('quantidade_alunos')),
              modalidade: fd.get('modalidade'),
              turno: fd.get('turno'),
              andar: fd.get('andar'),
              sala: Number(fd.get('sala'))
            }
          });
          await renderizar();
        } catch (err) {
          $('#cad-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
        }
      });

      $$('[data-del-turma]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Excluir esta turma?')) return;
          try {
            await api(`/api/turmas/${btn.dataset.delTurma}`, { method: 'DELETE' });
            await renderizar();
          } catch (err) {
            $('#cad-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });
    }

    await renderizar();
  }

  // ===================================================================
  // MÓDULO 7: GERENCIAMENTO DE USUÁRIOS E CARGOS (Gestor)
  // ===================================================================
  async function abrirModuloUsuarios() {
    abrirJanela('Gerenciamento de Usuários e Permissões', `<div class="vazio-estado">Carregando usuários...</div>`);

    async function renderizar() {
      const usuarios = await api('/api/usuarios');
      const cont = $('#janela-conteudo');

      cont.innerHTML = `
        <div id="usr-feedback"></div>

        <form id="form-novo-usuario" class="painel-card">
          <h3>Criar Novo Usuário</h3>
          <div class="form-grid">
            <div class="campo">
              <label>Nome de Usuário</label>
              <input type="text" name="nome" maxlength="99" required>
            </div>
            <div class="campo">
              <label>Senha Inicial</label>
              <input type="password" name="senha" minlength="4" maxlength="30" required>
            </div>
            <div class="campo">
              <label>Cargo / Nível de Acesso</label>
              <select name="cargo">
                <option value="aluno monitor">Aluno Monitor</option>
                <option value="professor">Professor</option>
                <option value="gestor">Gestor</option>
              </select>
            </div>
            <div>
              <button type="submit" class="btn-primario inline">Criar Usuário</button>
            </div>
          </div>
        </form>

        <div class="tabela-wrap">
          <table class="tabela">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Cargo Atual</th>
                <th>Alterar Cargo</th>
                <th>Redefinir Senha / Excluir</th>
              </tr>
            </thead>
            <tbody>
              ${usuarios
                .map(
                  (u) => `
                <tr>
                  <td><strong>${esc(u.nome_usuario)}</strong></td>
                  <td><span class="selo info">${esc(u.cargo_usuario)}</span></td>
                  <td>
                    <select data-cargo-usr="${u.id_usuario}" style="width:auto;">
                      <option value="aluno monitor" ${u.cargo_usuario === 'aluno monitor' ? 'selected' : ''}>Aluno Monitor</option>
                      <option value="professor" ${u.cargo_usuario === 'professor' ? 'selected' : ''}>Professor</option>
                      <option value="gestor" ${u.cargo_usuario === 'gestor' ? 'selected' : ''}>Gestor</option>
                    </select>
                  </td>
                  <td>
                    <div class="acoes-linha">
                      <button type="button" class="mini" data-senha-usr="${u.id_usuario}">Nova Senha</button>
                      <button type="button" class="mini perigo" data-del-usr="${u.id_usuario}">Excluir</button>
                    </div>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;

      $('#form-novo-usuario', cont)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/usuarios', {
            method: 'POST',
            body: {
              nome: fd.get('nome'),
              senha: fd.get('senha'),
              cargo: fd.get('cargo')
            }
          });
          await renderizar();
        } catch (err) {
          $('#usr-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
        }
      });

      $$('[data-cargo-usr]', cont).forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await api(`/api/usuarios/${sel.dataset.cargoUsr}`, {
              method: 'PUT',
              body: { cargo: sel.value }
            });
            await renderizar();
          } catch (err) {
            $('#usr-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      $$('[data-senha-usr]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const novaSenha = window.prompt('Digite a nova senha (4 a 30 caracteres):');
          if (!novaSenha) return;
          try {
            await api(`/api/usuarios/${btn.dataset.senhaUsr}`, {
              method: 'PUT',
              body: { senha: novaSenha }
            });
            $('#usr-feedback').innerHTML = `<div class="feedback-msg ok">Senha atualizada com sucesso.</div>`;
          } catch (err) {
            $('#usr-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });

      $$('[data-del-usr]', cont).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Excluir permanentemente este usuário?')) return;
          try {
            await api(`/api/usuarios/${btn.dataset.delUsr}`, { method: 'DELETE' });
            await renderizar();
          } catch (err) {
            $('#usr-feedback').innerHTML = `<div class="feedback-msg erro">${esc(err.message)}</div>`;
          }
        });
      });
    }

    await renderizar();
  }

  // ===================================================================
  // Inicialização Geral da Aplicação
  // ===================================================================
  async function boot() {
    inicializarTema();
    inicializarCanvasFundo();
    inicializarLogin();
    inicializarNavegacao();
    inicializarModalGrafico();

    try {
      const me = await api('/api/me');
      if (me && me.autenticado && me.usuario) {
        await entrarNoSistema(me.usuario);
      } else {
        exibirTelaLogin();
      }
    } catch {
      exibirTelaLogin();
    } finally {
      setTimeout(() => {
        $('#splash')?.classList.add('oculto');
      }, 350);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();