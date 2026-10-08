// ========== SISTEMA DE LOGIN / REGISTRO ==========
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const btnLogout = document.getElementById('btn-logout');

// Apenas usuário admin
const ADMIN_USER = { name: 'Administrador', username: 'admin', password: '1234' };

function isLoggedIn() {
  return sessionStorage.getItem('siteHubLoggedIn') === 'true';
}

function setLoggedIn(value) {
  if (value) {
    sessionStorage.setItem('siteHubLoggedIn', 'true');
  } else {
    sessionStorage.removeItem('siteHubLoggedIn');
  }
}

function showMainSite() {
  loginScreen.classList.add('hidden');
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  loginForm.reset();
  registerForm.reset();
  loginError.classList.remove('show');
  registerError.classList.remove('show');
  registerError.textContent = '';
  switchToLogin();
}

function switchToLogin() {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.style.display = 'block';
  registerForm.style.display = 'none';
  formTitle.textContent = 'Bem-vindo';
  formSubtitle.textContent = 'Faça login para continuar';
  loginError.classList.remove('show');
}

function switchToRegister() {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  loginForm.style.display = 'none';
  registerForm.style.display = 'block';
  formTitle.textContent = 'Criar Conta';
  formSubtitle.textContent = 'Preencha os campos abaixo';
  registerError.classList.remove('show');
  registerError.textContent = '';
}

function highlightError(input) {
  input.classList.add('error');
  setTimeout(() => input.classList.remove('error'), 500);
}

// Inicialização
if (isLoggedIn()) {
  showMainSite();
} else {
  showLogin();
}

tabLogin.addEventListener('click', switchToLogin);
tabRegister.addEventListener('click', switchToRegister);

// LOGIN - Apenas Admin
loginForm.addEventListener('submit', function (e) {
  e.preventDefault();

  const user = usernameInput.value.trim();
  const pass = passwordInput.value;

  if (!user || !pass) {
    loginError.textContent = 'Preencha todos os campos';
    loginError.classList.add('show');
    if (!user) highlightError(usernameInput);
    if (!pass) highlightError(passwordInput);
    return;
  }

  if (user === ADMIN_USER.username && pass === ADMIN_USER.password) {
    setLoggedIn(true);
    loginError.classList.remove('show');
    showMainSite();
  } else {
    loginError.textContent = 'Usuário ou senha incorretos';
    loginError.classList.add('show');
    highlightError(passwordInput);
    passwordInput.value = '';
    passwordInput.focus();
  }
});

// REGISTRO DESATIVADO - Mostra mensagem
registerForm.addEventListener('submit', function (e) {
  e.preventDefault();
  registerError.textContent = 'Registro desativado. Use admin/1234';
  registerError.classList.add('show');
});

// LOGOUT
btnLogout.addEventListener('click', function () {
  setLoggedIn(false);
  showLogin();

  const menu = document.querySelector('.menu-lateral');
  if (menu) menu.classList.remove('aberto');
});

// ========== FIM DO SISTEMA DE LOGIN / REGISTRO ==========

const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
const sidebar = document.querySelector('.menu-lateral');

const opcao1 = document.getElementById('opcao1');
const opcao2 = document.getElementById('opcao2');
const opcao3 = document.getElementById('opcao3');

const janela = document.getElementById('janela');
const fecharJanela = document.getElementById('fecharJanela');

const areaMenu = document.querySelector('.area-menu');
const menu = document.querySelector('.menu-lateral');

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
        this.zParticles.push(new ZParticle(width / 2 + 130, height / 2 - 100));
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
    const pcX = width / 2;
    const pcY = height / 2;

    const scale = Math.min(width / 1920, height / 1080, 1);

    ctx.save();
    ctx.translate(pcX, pcY);
    ctx.scale(scale, scale);
    ctx.translate(-pcX, -pcY);

    const glowColor = this.eyeOpenness > 0.5 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(245, 158, 11, 0.03)';
    const glowGradient = ctx.createRadialGradient(pcX, pcY, 20, pcX, pcY, 260);
    glowGradient.addColorStop(0, glowColor);
    glowGradient.addColorStop(1, 'rgba(9, 13, 22, 0)');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(pcX, pcY, 260, 0, Math.PI * 2);
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
    ctx.roundRect(rx, ry, w, h, 36);
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
    ctx.roundRect(sx, sy, sw, sh, 20);
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

areaMenu.addEventListener('mouseenter', function () {
  menu.classList.add('aberto');
});

menu.addEventListener('mouseenter', function () {
  menu.classList.add('aberto');
});

menu.addEventListener('mouseleave', function () {
  menu.classList.remove('aberto');
});

opcao1.addEventListener('click', function () {
  janela.classList.add('aberta');
});

fecharJanela.addEventListener('click', function () {
  janela.classList.remove('aberta');
});

document.addEventListener('click', function (e) {
  const cliqueDentro = janela.contains(e.target) || opcao1.contains(e.target);
  if (!cliqueDentro) {
    janela.classList.remove('aberta');
  }
});

opcao2.addEventListener('click', function () {
  // ação opcao2
});

opcao3.addEventListener('click', function () {
  // ação opcao3
});