// =====================================================================
// Site CCM — front-end. NADA é salvo no navegador (sem localStorage,
// sessionStorage ou cookies): a sessão vive só em variáveis desta aba.
// Recarregar a página = voltar para a tela de login.
// =====================================================================

const sessao = { token: null, usuario: null };

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loginScreen = $('login-screen');
const loginForm = $('login-form');
const registerForm = $('register-form');
const loginError = $('login-error');
const registerError = $('register-error');
const tabLogin = $('tab-login');
const tabRegister = $('tab-register');
const formTitle = $('form-title');
const formSubtitle = $('form-subtitle');
const btnLogout = $('btn-logout');

async function api(caminho, opcoes = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessao.token) headers.Authorization = 'Bearer ' + sessao.token;
  let r;
  try {
    r = await fetch('/api' + caminho, {
      method: opcoes.method || 'GET',
      headers,
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
      credentials: 'omit'
    });
  } catch (e) {
    throw new Error('Não foi possível conectar ao servidor.');
  }
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && sessao.token) { encerrarSessao(); throw new Error('Sessão expirada. Entre novamente.'); }
  if (!r.ok) throw new Error(dados.erro || 'Erro inesperado.');
  return dados;
}

function mostrarErro(el, msg) { el.textContent = msg; el.classList.add('show'); }
function highlightError(input) { input.classList.add('error'); setTimeout(() => input.classList.remove('error'), 500); }

function switchToLogin() {
  tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  loginForm.style.display = 'block'; registerForm.style.display = 'none';
  formTitle.textContent = 'Bem-vindo'; formSubtitle.textContent = 'Faça login para continuar';
  loginError.classList.remove('show');
}
function switchToRegister() {
  tabRegister.classList.add('active'); tabLogin.classList.remove('active');
  loginForm.style.display = 'none'; registerForm.style.display = 'block';
  formTitle.textContent = 'Criar Conta'; formSubtitle.textContent = 'Novas contas entram como aluno monitor';
  registerError.classList.remove('show'); registerError.textContent = '';
}
tabLogin.addEventListener('click', switchToLogin);
tabRegister.addEventListener('click', switchToRegister);

// ---------- permissões por cargo ----------
const CARGO_NOME = { 'gestor': 'Gestor', 'professor': 'Professor', 'aluno monitor': 'Aluno monitor' };
const podeEscrever = () => ['gestor', 'aluno monitor'].includes(sessao.usuario?.cargo);
const ehGestor = () => sessao.usuario?.cargo === 'gestor';

function aplicarCargoNaInterface() {
  const u = sessao.usuario;
  $('painel-nome').textContent = u.nome;
  $('painel-cargo').textContent = CARGO_NOME[u.cargo] || u.cargo;
  $('opcao4').style.display = ehGestor() ? '' : 'none';
}

function entrar(token, usuario) {
  sessao.token = token; sessao.usuario = usuario;
  aplicarCargoNaInterface();
  loginScreen.classList.add('hidden');
  loginForm.reset(); registerForm.reset();
}

function encerrarSessao() {
  const token = sessao.token;
  sessao.token = null; sessao.usuario = null;
  if (token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, credentials: 'omit' }).catch(() => {});
  fecharJanelaAgora();
  $('painel-ccm').classList.remove('aberto');
  menu.classList.remove('aberto');
  loginForm.reset(); registerForm.reset();
  loginError.classList.remove('show'); registerError.classList.remove('show');
  switchToLogin();
  loginScreen.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('username'), pass = $('password');
  if (!user.value.trim() || !pass.value) {
    mostrarErro(loginError, 'Preencha todos os campos');
    if (!user.value.trim()) highlightError(user);
    if (!pass.value) highlightError(pass);
    return;
  }
  $('login-btn').disabled = true;
  try {
    const r = await api('/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
    loginError.classList.remove('show');
    entrar(r.token, r.usuario);
  } catch (err) {
    mostrarErro(loginError, err.message);
    highlightError(pass); pass.value = ''; pass.focus();
  } finally { $('login-btn').disabled = false; }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('reg-username'), p1 = $('reg-password'), p2 = $('reg-password2');
  if (p1.value !== p2.value) { mostrarErro(registerError, 'As senhas não coincidem'); highlightError(p2); return; }
  $('register-btn').disabled = true;
  try {
    await api('/register', { method: 'POST', body: { username: user.value, password: p1.value } });
    const r = await api('/login', { method: 'POST', body: { username: user.value.trim().toLowerCase(), password: p1.value } });
    entrar(r.token, r.usuario);
  } catch (err) { mostrarErro(registerError, err.message); }
  finally { $('register-btn').disabled = false; }
});

btnLogout.addEventListener('click', encerrarSessao);

// ---------- canvas / mascote (código original) ----------
const canvas = $('bg-canvas');
const ctx = canvas.getContext('2d');
const sidebar = document.querySelector('.menu-lateral');
const menu = sidebar;
const areaMenu = document.querySelector('.area-menu');
let width = 0;
let height = 0;
let dpr = window.devicePixelRatio || 1;

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const gaze = { x: width / 2, y: height / 2, targetX: width / 2, targetY: height / 2 };

let isMouseOverSidebar = false;
let isWindowActive = true;
let isMouseInsideWindow = true;
let lastRandomGazeTime = 0;
let randomGazeInterval = 2000;

function generateRandomGaze() {
  const marginX = width * 0.2;
  const marginY = height * 0.2;
  gaze.targetX = marginX + Math.random() * (width - marginX * 2);
  gaze.targetY = marginY + Math.random() * (height - marginY * 2);
  randomGazeInterval = 1600 + Math.random() * 1800;
  lastRandomGazeTime = Date.now();
}

sidebar.addEventListener('mouseenter', () => {
  isMouseOverSidebar = true;
  generateRandomGaze();
});

sidebar.addEventListener('mouseleave', () => {
  isMouseOverSidebar = false;
});

window.addEventListener('mousemove', (e) => {
  isMouseInsideWindow = true;

  if (!isMouseOverSidebar && isWindowActive) {
    gaze.targetX = e.clientX;
    gaze.targetY = e.clientY;
  }
});

document.documentElement.addEventListener('mouseleave', () => {
  isMouseInsideWindow = false;
});

document.documentElement.addEventListener('mouseenter', () => {
  isMouseInsideWindow = true;
});

document.addEventListener('visibilitychange', () => {
  isWindowActive = !document.hidden;
});

class ZParticle {
  constructor(x, y) {
    this.reset(x, y);
  }

  reset(x, y) {
    this.x = x + (Math.random() - 0.5) * 20;
    this.y = y - 20;
    this.size = Math.random() * 6 + 12;
    this.alpha = 1;
    this.vy = Math.random() * 0.5 + 0.4;
  }

  update() {
    this.y -= this.vy;
    this.x += Math.sin(this.y * 0.05) * 0.5;
    this.alpha -= 0.008;
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(56, 189, 248, ${Math.max(0, this.alpha)})`;
    ctx.font = `bold ${this.size}px monospace`;
    ctx.fillText('zZZ', this.x, this.y);
    ctx.restore();
  }
}

class WhiteComputer {
  constructor() {
    this.monitorWidth = 320;
    this.monitorHeight = 240;
    this.screenWidth = 260;
    this.screenHeight = 170;
    this.zParticles = [];
    this.lastZTime = 0;

    this.eyeOpenness = 1;
    this.targetEyeOpenness = 1;
  }

  update() {
    const now = Date.now();
    const shouldSleep = !isMouseInsideWindow || !isWindowActive;

    this.targetEyeOpenness = shouldSleep ? 0 : 1;
    this.eyeOpenness += (this.targetEyeOpenness - this.eyeOpenness) * 0.1;

    if (shouldSleep) {
      if (now - this.lastZTime > 650) {
        const pos = this.getPosition();
        this.zParticles.push(new ZParticle(pos.x + 130, pos.y - 100));
        this.lastZTime = now;
      }
    } else if (isMouseOverSidebar) {
      if (now - lastRandomGazeTime > randomGazeInterval) {
        generateRandomGaze();
      }
    }

    gaze.x += (gaze.targetX - gaze.x) * 0.08;
    gaze.y += (gaze.targetY - gaze.y) * 0.08;

    for (let i = this.zParticles.length - 1; i >= 0; i--) {
      const p = this.zParticles[i];
      p.update();
      if (p.alpha <= 0) {
        this.zParticles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    const { x: pcX, y: pcY, scale } = this.getPosition();

    ctx.save();
    ctx.translate(pcX, pcY);
    ctx.scale(scale, scale);
    ctx.translate(-pcX, -pcY);

    const pulse = (Math.sin(Date.now() / 600) + 1) / 2;
    const awake = this.eyeOpenness > 0.5;
    const rgb = awake ? '56, 189, 248' : '245, 158, 11';
    const alpha = awake ? 0.18 + pulse * 0.17 : 0.06 + pulse * 0.06;
    const radius = 240 + pulse * 40;

    const glowgradient = ctx.createRadialGradient(pcX, pcY, 40, pcX, pcY, radius);
    glowgradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    glowgradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowgradient;
    ctx.beginPath();
    ctx.arc(pcX, pcY, radius, 0, Math.PI * 2);
    ctx.fill();

    this.drawStand(ctx, pcX, pcY);
    this.drawWhiteCase(ctx, pcX, pcY);
    this.drawScreenArea(ctx, pcX, pcY);
    this.drawDigitalFace(ctx, pcX, pcY);

    this.zParticles.forEach(p => p.draw(ctx));
    ctx.restore();
  }

  drawStand(ctx, baseX, baseY) {
    ctx.save();
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.ellipse(baseX, baseY + 145, 95, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const neckGrad = ctx.createLinearGradient(baseX - 20, baseY, baseX + 20, baseY);
    neckGrad.addColorStop(0, '#cbd5e1');
    neckGrad.addColorStop(0.5, '#f8fafc');
    neckGrad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = neckGrad;
    ctx.beginPath();
    ctx.roundRect(baseX - 20, baseY + 40, 40, 105, 12);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  getPosition(){
    const scale = Math.min(width / 1920, height / 1080, 1);
    const margin = 40;

    return {
      scale,
      x: width - margin - (this.monitorWidth / 2) * scale,
      y: height - margin - 165 * scale
    }; 

  }

  drawWhiteCase(ctx, x, y) {
    ctx.save();

    const w = this.monitorWidth;
    const h = this.monitorHeight;
    const rx = x - w / 2;
    const ry = y - h / 2;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;

    const caseGrad = ctx.createLinearGradient(rx, ry, rx + w, ry + h);
    caseGrad.addColorStop(0, '#ffffff');
    caseGrad.addColorStop(0.7, '#f1f5f9');
    caseGrad.addColorStop(1, '#e2e8f0');

    ctx.fillStyle = caseGrad;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.roundRect(rx, ry, w, h, 16);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = 'transparent';

    const ledX = rx + w - 32;
    const ledY = ry + h - 22;
    const isAwake = this.eyeOpenness > 0.5;
    const ledColor = isAwake ? (isMouseOverSidebar ? '#f59e0b' : '#10b981') : '#f59e0b';

    ctx.beginPath();
    ctx.arc(ledX, ledY, 4, 0, Math.PI * 2);
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = 8;
    ctx.fill();

    ctx.restore();
  }

  drawScreenArea(ctx, x, y) {
    ctx.save();

    const sw = this.screenWidth;
    const sh = this.screenHeight;
    const sx = x - sw / 2;
    const sy = y - sh / 2 - 8;

    const screenGrad = ctx.createLinearGradient(sx, sy, sx, sy + sh);
    screenGrad.addColorStop(0, '#090d16');
    screenGrad.addColorStop(1, '#020617');

    ctx.fillStyle = screenGrad;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 10);
    ctx.fill();
    ctx.stroke();

    const glassGrad = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
    glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    glassGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.01)');
    glassGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + sw * 0.6, sy);
    ctx.lineTo(sx, sy + sh * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawDigitalFace(ctx, x, y) {
    const screenY = y - 8;
    const eyeSpacing = 48;
    const eyeY = screenY - 10;

    this.drawEye(ctx, x - eyeSpacing, eyeY);
    this.drawEye(ctx, x + eyeSpacing, eyeY);
    this.drawMouth(ctx, x, screenY + 32);
  }

  drawEye(ctx, eyeX, eyeY) {
    const eyeRadius = 26;

    ctx.save();

    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (this.eyeOpenness > 0.05) {
      const dx = gaze.x - eyeX;
      const dy = gaze.y - eyeY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);

      const maxPupilOffset = 12;
      const pupilDist = Math.min(dist * 0.08, maxPupilOffset);
      const pupilX = eyeX + Math.cos(angle) * pupilDist;
      const pupilY = eyeY + Math.sin(angle) * pupilDist;

      ctx.save();
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeRadius - 1, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(pupilX, pupilY, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#428a46';
      ctx.beginPath();
      ctx.arc(pupilX, pupilY, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pupilX - 4, pupilY - 4, 3.5, 0, Math.PI * 2);
      ctx.arc(pupilX + 3, pupilY + 3, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    const eyelidHeight = (1 - this.eyeOpenness) * (eyeRadius * 2 + 4);
    if (eyelidHeight > 0) {
      ctx.fillStyle = '#090d16';
      ctx.beginPath();
      ctx.rect(eyeX - eyeRadius - 2, eyeY - eyeRadius - 2, eyeRadius * 2 + 4, eyelidHeight);
      ctx.fill();

      ctx.strokeStyle = '#428a46';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI, false);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawMouth(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = '#428a46';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    if (this.eyeOpenness > 0.5) {
      ctx.beginPath();
      ctx.arc(x, y - 8, 15, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.stroke();
    }

    ctx.restore();
  }
}

const computer = new WhiteComputer();

function animate() {
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, width, height);

  computer.update();
  computer.draw(ctx);

  requestAnimationFrame(animate);
}

animate();

// =====================================================================
// Janela de conteúdo
// =====================================================================
const modoPc = window.matchMedia('(hover: hover) and (pointer: fine)');
const janela = $('janela');
const janelaTitulo = $('janela-titulo');
const janelaConteudo = $('janela-conteudo');
const fecharJanela = $('fecharJanela');
const expandirJanela = $('expandirJanela');

let telaAtual = null;

function abrirJanela(titulo, renderizar) {
  if (!sessao.token) return;
  janelaTitulo.textContent = titulo;
  telaAtual = renderizar;
  janela.classList.add('aberta');
  recarregarTela();
}
async function recarregarTela() {
  if (!telaAtual) return;
  janelaConteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try { await telaAtual(janelaConteudo); }
  catch (e) { janelaConteudo.innerHTML = '<p class="msg-erro">' + esc(e.message) + '</p>'; }
}
function fecharJanelaAgora() {
  janela.classList.remove('aberta');
  telaAtual = null;
  setTimeout(() => {
    if (!janela.classList.contains('aberta')) {
      janela.classList.remove('expandida');
      janelaConteudo.innerHTML = '';
      expandirJanela.title = 'Expandir';
      expandirJanela.setAttribute('aria-label', 'Expandir');
    }
  }, 300);
}
fecharJanela.addEventListener('click', fecharJanelaAgora);
expandirJanela.addEventListener('click', () => {
  const expandida = janela.classList.toggle('expandida');
  const t = expandida ? 'Reduzir' : 'Expandir';
  expandirJanela.title = t; expandirJanela.setAttribute('aria-label', t);
});
// composedPath: continua funcionando mesmo quando o botão clicado foi re-renderizado
document.addEventListener('click', (e) => {
  const path = e.composedPath();
  const dentro = path.includes(janela) || path.includes(menu) || path.includes($('painel-ccm')) || path.includes($('aba-ccm'));
  if (!dentro && janela.classList.contains('aberta')) fecharJanelaAgora();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && janela.classList.contains('aberta')) fecharJanelaAgora(); });

// ---------- helpers de UI ----------
function aviso(container, msg, tipo = 'ok') {
  let el = container.querySelector('.aviso');
  if (!el) { el = document.createElement('div'); container.prepend(el); }
  el.className = 'aviso ' + tipo; el.textContent = msg;
}
function tabela(colunas, linhas) {
  if (!linhas.length) return '<p class="vazio">Nenhum registro encontrado.</p>';
  return '<div class="tabela-wrap"><table><thead><tr>' + colunas.map((c) => '<th>' + esc(c.titulo) + '</th>').join('') +
    '</tr></thead><tbody>' + linhas.map((l) => '<tr>' + colunas.map((c) => '<td>' + (c.html ? c.html(l) : esc(c.valor(l))) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
const opts = (lista, sel) => lista.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(t)}</option>`; }).join('');
const fmtData = (d) => { const s = String(d || '').slice(0, 10).split('-'); return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : esc(d || '—'); };
const fmtDataHora = (d) => d ? fmtData(d) + ' ' + String(d).slice(11, 16) : '—';
const TIPOS = ['notebook', 'chromebook', 'notebook ds', 'celular', 'tablet'];
const MARCAS = ['vaio', 'positivo', 'samsung', 'honor', 'xiaomi'];

// =====================================================================
// Aparelhos (+ carregamento)
// =====================================================================
async function telaAparelhos(box, sub = 'lista', filtros = { tipo: '', disp: '' }) {
  box.innerHTML = `
    <div class="subabas">
      <button class="subaba${sub === 'lista' ? ' ativa' : ''}" data-sub="lista">Aparelhos</button>
      <button class="subaba${sub === 'carga' ? ' ativa' : ''}" data-sub="carga">Carregamento</button>
    </div><div id="sub-corpo"></div>`;
  box.querySelectorAll('.subaba').forEach((b) => b.addEventListener('click', () => telaAparelhos(box, b.dataset.sub, filtros)));
  const corpo = box.querySelector('#sub-corpo');

  if (sub === 'carga') {
    const dados = await api('/carregamentos');
    corpo.innerHTML = tabela([
      { titulo: 'Tipo', valor: (r) => r.tipo_aparelho }, { titulo: 'Nº', valor: (r) => r.numero_aparelho },
      { titulo: 'Modelo', valor: (r) => r.marca_aparelho + ' ' + r.modelo_aparelho },
      { titulo: 'Estado', valor: (r) => r.estado_carregamento }, { titulo: 'Última recarga', valor: (r) => fmtDataHora(r.ultima_recarga) },
      ...(podeEscrever() ? [{ titulo: 'Ação', html: (r) => `<button class="mini" data-carga="${r.id_aparelho}" data-estado="${r.estado_carregamento === 'Carregando' ? 0 : 1}">${r.estado_carregamento === 'Carregando' ? 'Tirar da tomada' : 'Colocar para carregar'}</button>` }] : [])
    ], dados);
    corpo.querySelectorAll('[data-carga]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/carregamentos/' + b.dataset.carga, { method: 'POST', body: { carregando: b.dataset.estado === '1' } }); telaAparelhos(box, 'carga', filtros); }
      catch (e) { aviso(box, e.message, 'erro'); }
    }));
    return;
  }

  const q = new URLSearchParams();
  if (filtros.tipo) q.set('tipo', filtros.tipo);
  if (filtros.disp !== '') q.set('disponivel', filtros.disp);
  const dados = await api('/aparelhos?' + q);
  corpo.innerHTML = `
    <div class="barra">
      <select id="f-tipo"><option value="">Todos os tipos</option>${opts(TIPOS, filtros.tipo)}</select>
      <select id="f-disp"><option value="">Qualquer situação</option><option value="1"${filtros.disp === '1' ? ' selected' : ''}>Disponível</option><option value="0"${filtros.disp === '0' ? ' selected' : ''}>Indisponível</option></select>
      ${ehGestor() ? '<button class="mini destaque" id="novo-ap">+ Novo aparelho</button>' : ''}
    </div>` + tabela([
      { titulo: 'Tipo', valor: (r) => r.tipo_aparelho }, { titulo: 'Nº', valor: (r) => r.numero_aparelho },
      { titulo: 'Marca / modelo', valor: (r) => r.marca_aparelho + ' ' + r.modelo_aparelho },
      { titulo: 'Patrimônio', valor: (r) => r.patrimonio }, { titulo: 'Situação', html: (r) => `<span class="selo ${r.situacao === 'Disponível' ? 'ok' : 'x'}">${esc(r.situacao)}</span>` },
      { titulo: 'Obs.', valor: (r) => r.observacoes_aparelho },
      ...(ehGestor() ? [{ titulo: 'Ações', html: (r) => `<button class="mini" data-ed="${r.id_aparelho}">Editar</button> <button class="mini perigo" data-del="${r.id_aparelho}">Excluir</button>` }] : [])
    ], dados);
  const refiltrar = () => telaAparelhos(box, 'lista', { tipo: $('f-tipo').value, disp: $('f-disp').value });
  $('f-tipo').addEventListener('change', refiltrar); $('f-disp').addEventListener('change', refiltrar);
  if (ehGestor()) {
    $('novo-ap').addEventListener('click', () => formAparelho(box, null, filtros));
    corpo.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', async () => {
      try { formAparelho(box, await api('/aparelhos/' + b.dataset.ed), filtros); } catch (e) { aviso(box, e.message, 'erro'); }
    }));
    corpo.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Excluir este aparelho?')) return;
      try { await api('/aparelhos/' + b.dataset.del, { method: 'DELETE' }); await telaAparelhos(box, 'lista', filtros); aviso(box, 'Aparelho excluído.'); }
      catch (e) { aviso(box, e.message, 'erro'); }
    }));
  }
}

function formAparelho(box, ap, filtros) {
  const a = ap || { marca_aparelho: 'positivo', modelo_aparelho: '', tipo_aparelho: 'notebook', numero_aparelho: '', patrimonio: '', observacoes_aparelho: 'nenhuma', disponivel: 1 };
  box.innerHTML = `<h3>${ap ? 'Editar' : 'Novo'} aparelho</h3>
    <form class="form-grid" id="f-ap">
      <label>Marca<select name="marca">${opts(MARCAS, a.marca_aparelho)}</select></label>
      <label>Modelo<input name="modelo" required maxlength="45" value="${esc(a.modelo_aparelho)}"></label>
      <label>Tipo<select name="tipo">${opts(TIPOS, a.tipo_aparelho)}</select></label>
      <label>Número<input name="numero" type="number" min="0" required value="${esc(a.numero_aparelho)}"></label>
      <label>Patrimônio<input name="patrimonio" type="number" min="0" required value="${esc(a.patrimonio)}"></label>
      <label>Disponível<select name="disponivel">${opts([['1', 'Sim'], ['0', 'Não']], String(a.disponivel ? 1 : 0))}</select></label>
      <label class="largo">Observações<input name="observacoes" maxlength="304" value="${esc(a.observacoes_aparelho)}"></label>
      <div class="largo acoes"><button class="mini destaque" type="submit">Salvar</button> <button class="mini" type="button" id="cancela">Cancelar</button></div>
    </form>`;
  $('cancela').addEventListener('click', () => telaAparelhos(box, 'lista', filtros));
  $('f-ap').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.disponivel = f.disponivel === '1';
    try {
      await api(ap ? '/aparelhos/' + a.id_aparelho : '/aparelhos', { method: ap ? 'PUT' : 'POST', body: f });
      await telaAparelhos(box, 'lista', filtros); aviso(box, 'Aparelho salvo.');
    } catch (err) { aviso(box, err.message, 'erro'); }
  });
}

// =====================================================================
// Empréstimos
// =====================================================================
async function telaEmprestimos(box) {
  const dados = await api('/emprestimos');
  box.innerHTML = (podeEscrever() ? '<div class="barra"><button class="mini destaque" id="novo-emp">+ Novo empréstimo</button></div>' : '') + tabela([
    { titulo: 'Data', valor: (r) => fmtData(r.data_emprestimo) }, { titulo: 'Professor', valor: (r) => r.professor },
    { titulo: 'Turma', valor: (r) => r.turma + ' (sala ' + r.sala + ')' }, { titulo: 'Aparelho', valor: (r) => r.quantidade + '× ' + r.tipo_aparelho },
    { titulo: 'Registrado por', valor: (r) => r.registrado_por },
    { titulo: 'Situação', html: (r) => `<span class="selo ${r.devolucao ? 'ok' : 'x'}">${r.devolucao ? 'Devolvido' : 'Pendente'}</span>` },
    ...(podeEscrever() ? [{ titulo: 'Ação', html: (r) => r.devolucao ? '' : `<button class="mini" data-dev="${r.id_emprestimo}">Devolver</button>` }] : [])
  ], dados);
  if (!podeEscrever()) return;
  $('novo-emp').addEventListener('click', () => formEmprestimo(box));
  box.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/emprestimos/${b.dataset.dev}/devolver`, { method: 'POST' }); await telaEmprestimos(box); aviso(box, 'Devolução registrada.'); }
    catch (e) { aviso(box, e.message, 'erro'); }
  }));
}

async function formEmprestimo(box) {
  const o = await api('/opcoes');
  box.innerHTML = `<h3>Novo empréstimo</h3>
    <form class="form-grid" id="f-emp">
      <label>Professor<select name="professor" required>${opts(o.professores.map((p) => [p.nome_professor, `${p.nome_professor} — ${p.disciplina_professor}`]))}</select></label>
      <label>Turma<select name="turma" required>${opts(o.turmas.map((t) => [t.nome_turma, `${t.nome_turma} (${t.turno_escolar})`]))}</select></label>
      <label>Tipo de aparelho<select name="tipo" id="emp-tipo">${opts(TIPOS)}</select></label>
      <div class="largo"><strong>Aparelhos disponíveis</strong><div id="emp-lista" class="checks"></div></div>
      <div class="largo acoes"><button class="mini destaque" type="submit">Registrar empréstimo</button> <button class="mini" type="button" id="cancela">Cancelar</button></div>
    </form>`;
  const carregarLista = async () => {
    const l = await api('/aparelhos?disponivel=1&tipo=' + encodeURIComponent($('emp-tipo').value));
    $('emp-lista').innerHTML = l.length ? l.map((a) => `<label class="chk"><input type="checkbox" value="${a.id_aparelho}"> nº ${esc(a.numero_aparelho)} — ${esc(a.marca_aparelho)} ${esc(a.modelo_aparelho)}</label>`).join('') : '<p class="vazio">Nenhum aparelho disponível deste tipo.</p>';
  };
  $('emp-tipo').addEventListener('change', () => carregarLista().catch((e) => aviso(box, e.message, 'erro')));
  await carregarLista();
  $('cancela').addEventListener('click', () => telaEmprestimos(box));
  $('f-emp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.aparelhos = [...box.querySelectorAll('.chk input:checked')].map((c) => Number(c.value));
    try { await api('/emprestimos', { method: 'POST', body: f }); await telaEmprestimos(box); aviso(box, 'Empréstimo registrado.'); }
    catch (err) { aviso(box, err.message, 'erro'); }
  });
}

// =====================================================================
// Relatórios
// =====================================================================
async function telaRelatorios(box) {
  const dados = await api('/relatorios');
  box.innerHTML = (podeEscrever() ? '<div class="barra"><button class="mini destaque" id="novo-rel">+ Novo relatório</button></div>' : '') + tabela([
    { titulo: 'Data', valor: (r) => fmtData(r.data) }, { titulo: 'Usuário', valor: (r) => r.usuario },
    { titulo: 'Aparelho', valor: (r) => r.tipo }, { titulo: 'Qtd.', valor: (r) => r.quantidade }, { titulo: 'Observações', valor: (r) => r.observacoes }
  ], dados);
  if (!podeEscrever()) return;
  $('novo-rel').addEventListener('click', () => {
    box.innerHTML = `<h3>Novo relatório</h3>
      <form class="form-grid" id="f-rel">
        <label>Tipo de aparelho<select name="tipo">${opts(TIPOS)}</select></label>
        <label>Quantidade conferida<input name="quantidade" type="number" min="0" required></label>
        <label class="largo">Observações<input name="observacoes" maxlength="304" value="nenhuma"></label>
        <div class="largo acoes"><button class="mini destaque" type="submit">Salvar</button> <button class="mini" type="button" id="cancela">Cancelar</button></div>
      </form>`;
    $('cancela').addEventListener('click', () => telaRelatorios(box));
    $('f-rel').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/relatorios', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await telaRelatorios(box); aviso(box, 'Relatório salvo.'); }
      catch (err) { aviso(box, err.message, 'erro'); }
    });
  });
}

// =====================================================================
// Usuários (somente gestor)
// =====================================================================
async function telaUsuarios(box) {
  const dados = await api('/usuarios');
  const CARGOS = ['aluno monitor', 'professor', 'gestor'];
  box.innerHTML = `<h3>Novo usuário</h3>
    <form class="form-grid" id="f-usr">
      <label>Usuário<input name="nome" required minlength="3" maxlength="99" autocomplete="off"></label>
      <label>Senha<input name="senha" type="text" required minlength="4" maxlength="30" autocomplete="off"></label>
      <label>Cargo<select name="cargo">${opts(CARGOS)}</select></label>
      <div class="acoes"><button class="mini destaque" type="submit">Criar</button></div>
    </form><h3>Usuários cadastrados</h3>` + tabela([
      { titulo: 'Usuário', valor: (r) => r.nome_usuario },
      { titulo: 'Cargo', html: (r) => `<select data-cargo="${r.id_usuario}">${opts(CARGOS, r.cargo_usuario)}</select>` },
      { titulo: 'Ações', html: (r) => `<button class="mini" data-senha="${r.id_usuario}">Nova senha</button> <button class="mini perigo" data-del="${r.id_usuario}">Excluir</button>` }
    ], dados);
  $('f-usr').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/usuarios', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await telaUsuarios(box); aviso(box, 'Usuário criado.'); }
    catch (err) { aviso(box, err.message, 'erro'); }
  });
  box.querySelectorAll('[data-cargo]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('/usuarios/' + s.dataset.cargo, { method: 'PUT', body: { cargo: s.value } }); aviso(box, 'Cargo atualizado.'); }
    catch (err) { await telaUsuarios(box); aviso(box, err.message, 'erro'); }
  }));
  box.querySelectorAll('[data-senha]').forEach((b) => b.addEventListener('click', async () => {
    const nova = prompt('Nova senha (4 a 30 caracteres):');
    if (!nova) return;
    try { await api('/usuarios/' + b.dataset.senha, { method: 'PUT', body: { senha: nova } }); aviso(box, 'Senha alterada.'); }
    catch (err) { aviso(box, err.message, 'erro'); }
  }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Excluir este usuário?')) return;
    try { await api('/usuarios/' + b.dataset.del, { method: 'DELETE' }); await telaUsuarios(box); aviso(box, 'Usuário excluído.'); }
    catch (err) { aviso(box, err.message, 'erro'); }
  }));
}

// ---------- ligação dos botões do menu ----------
$('opcao1').addEventListener('click', () => abrirJanela('Aparelhos', (b) => telaAparelhos(b)));
$('opcao2').addEventListener('click', () => abrirJanela('Empréstimos', telaEmprestimos));
$('opcao3').addEventListener('click', () => abrirJanela('Relatórios', telaRelatorios));
$('opcao4').addEventListener('click', () => abrirJanela('Usuários', telaUsuarios));

// ---------- menu lateral (hover no PC, arrastar no celular) ----------
areaMenu.addEventListener('mouseenter', () => { if (modoPc.matches && sessao.token) menu.classList.add('aberto'); });
menu.addEventListener('mouseenter', () => { if (modoPc.matches && sessao.token) menu.classList.add('aberto'); });
menu.addEventListener('mouseleave', () => { if (modoPc.matches) menu.classList.remove('aberto'); });

const MENU_ESCONDIDO = -300;
let arrastando = false, moveu = false, inicioX = 0, leftInicial = MENU_ESCONDIDO, leftAtual = MENU_ESCONDIDO;

function iniciarArraste(e) {
  if (!sessao.token) return;
  if (modoPc.matches && e.pointerType !== 'touch') return;
  if (e.target.closest('button')) return; // antes era "e.target.closest === 'BUTTON'" (nunca verdadeiro) e engolia os cliques
  arrastando = true; moveu = false; inicioX = e.clientX;
  leftInicial = menu.classList.contains('aberto') ? 0 : MENU_ESCONDIDO; leftAtual = leftInicial;
  e.currentTarget.setPointerCapture(e.pointerId);
  menu.style.transition = 'none';
}
function moverArrasto(e) {
  if (!arrastando) return;
  const delta = e.clientX - inicioX;
  if (Math.abs(delta) > 5) moveu = true;
  leftAtual = Math.min(0, Math.max(MENU_ESCONDIDO, leftInicial + delta));
  menu.style.left = leftAtual + 'px';
}
function soltarArrasto() {
  if (!arrastando) return;
  arrastando = false; menu.style.transition = ''; menu.style.left = '';
  if (!moveu) menu.classList.toggle('aberto');
  else if (leftAtual > MENU_ESCONDIDO / 2) menu.classList.add('aberto');
  else menu.classList.remove('aberto');
}
[areaMenu, menu].forEach((el) => {
  el.addEventListener('pointerdown', iniciarArraste);
  el.addEventListener('pointermove', moverArrasto);
  el.addEventListener('pointerup', soltarArrasto);
  el.addEventListener('pointercancel', soltarArrasto);
});

// ---------- aba lateral do CCM (direita) ----------
const painelCcm = $('painel-ccm');
$('aba-ccm').addEventListener('click', () => { if (sessao.token) painelCcm.classList.toggle('aberto'); });
$('fechar-painel').addEventListener('click', () => painelCcm.classList.remove('aberto'));
document.querySelectorAll('.logo-ccm').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'logo-fallback', textContent: 'CCM' })); }));

// ---------- splash ----------
const splash = $('splash');
window.addEventListener('load', () => {
  setTimeout(() => splash.classList.add('sumindo'), 2600);
  setTimeout(() => splash.remove(), 3400);
});