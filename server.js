const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const COOKIE_NOME = 'flecha_sid';
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 4; // 4 horas

const GESTOR = 'gestor';
const MON = 'aluno monitor';
const PROF = 'professor';

const TIPOS_VALIDOS = new Set(['notebook', 'chromebook', 'notebook ds', 'celular', 'tablet']);
const MARCAS_VALIDAS = new Set(['vaio', 'positivo', 'samsung', 'honor', 'xiaomi']);
const CARGOS_VALIDOS = new Set([MON, PROF, GESTOR]);
const PERIODOS_PROF_VALIDOS = new Set(['matutino', 'vespertino', 'integral']);
const TURNOS_TURMA_VALIDOS = new Set(['matutino', 'vespertino']);
const ANDARES_VALIDOS = new Set(['térreo', 'primeiro piso', 'segundo piso']);
const MODALIDADES_VALIDAS = new Set([
  'desenvolvimento de sistemas',
  'administração',
  'ensino regular',
  'formação de docentes'
]);

// =====================================================================
// Matriz de Permissões por Cargo (verificada no Backend e Frontend)
// =====================================================================
const MATRIZ_PERMISSOES = {
  [MON]: new Set([
    'dashboard:ler',
    'aparelhos:ler',
    'aparelhos:editar_obs',
    'carregamentos:gerenciar',
    'emprestimos:ler',
    'emprestimos:criar',
    'emprestimos:devolver',
    'relatorios:ler',
    'relatorios:criar',
    'reservas:ler',
    'reservas:gerenciar_status',
    'horarios_fixos:ler'
  ]),
  [PROF]: new Set([
    'dashboard:ler',
    'aparelhos:ler',
    'emprestimos:ler',
    'reservas:ler',
    'reservas:criar',
    'reservas:cancelar_propria',
    'horarios_fixos:ler'
  ]),
  [GESTOR]: new Set([
    'dashboard:ler',
    'aparelhos:ler',
    'aparelhos:criar',
    'aparelhos:editar',
    'aparelhos:editar_obs',
    'aparelhos:excluir',
    'carregamentos:gerenciar',
    'emprestimos:ler',
    'emprestimos:criar',
    'emprestimos:devolver',
    'relatorios:ler',
    'relatorios:criar',
    'reservas:ler',
    'reservas:criar',
    'reservas:gerenciar_status',
    'reservas:cancelar_propria',
    'horarios_fixos:ler',
    'horarios_fixos:gerenciar',
    'cadastros:gerenciar',
    'usuarios:gerenciar'
  ])
};

function temPermissao(cargo, permissao) {
  const perms = MATRIZ_PERMISSOES[cargo];
  return Boolean(perms && perms.has(permissao));
}

// dateStrings: true garante que DATE, DATETIME e TIME do MySQL retornem como strings
// literais sem conversão automática de fuso horário UTC pelo driver.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'Flecha',
  waitForConnections: true,
  connectionLimit: 12,
  charset: 'utf8mb4',
  dateStrings: true
});

app.use(express.json({ limit: '1mb' }));

// Serve arquivos estáticos bloqueando arquivos sensíveis do servidor/SQL
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  const bloqueados = /^\/(server\.js|package(-lock)?\.json|.*\.sql|\.env.*)$/i;
  if (bloqueados.test(req.path)) return res.status(404).end();
  return express.static(__dirname)(req, res, next);
});

const sessoes = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((parte) => {
    const idx = parte.indexOf('=');
    if (idx === -1) return;
    const chave = parte.slice(0, idx).trim();
    const valor = parte.slice(idx + 1).trim();
    if (!chave) return;
    try {
      cookies[chave] = decodeURIComponent(valor);
    } catch {
      cookies[chave] = valor;
    }
  });
  return cookies;
}

function isSecureRequest(req) {
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(req.secure) ||
    req.headers['x-forwarded-proto'] === 'https'
  );
}

function definirCookieSessao(req, res, token) {
  const maxAgeSeg = Math.floor(DURACAO_SESSAO_MS / 1000);
  const partes = [
    `${COOKIE_NOME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeg}`
  ];
  if (isSecureRequest(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function limparCookieSessao(req, res) {
  const partes = [
    `${COOKIE_NOME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (isSecureRequest(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

// =====================================================================
// Helpers Puros de Data/Hora Local (sem conversão UTC/toISOString)
// =====================================================================
function pad2(n) {
  return String(n).padStart(2, '0');
}

function diasNoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

function normalizarData(valor) {
  const limpo = String(valor || '').trim();
  const m = limpo.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizarDataHora(valor) {
  const limpo = String(valor || '').trim().replace('T', ' ');
  const m = limpo.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const hora = Number(m[4]);
  const min = Number(m[5]);
  const seg = Number(m[6] || '0');
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasNoMes(ano, mes)) return null;
  if (hora < 0 || hora > 23 || min < 0 || min > 59 || seg < 0 || seg > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${pad2(seg)}`;
}

function normalizarHora(valor) {
  const limpo = String(valor || '').trim();
  const m = limpo.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hora = Number(m[1]);
  const min = Number(m[2]);
  const seg = Number(m[3] || '0');
  if (hora < 0 || hora > 23 || min < 0 || min > 59 || seg < 0 || seg > 59) return null;
  return `${m[1]}:${m[2]}:${pad2(seg)}`;
}

function agoraLocalSql() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function somarMinutosDataHoraLocal(dataHoraSql, minutos) {
  const m = String(dataHoraSql).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  d.setMinutes(d.getMinutes() + minutos);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Retorna lista de ocorrências diárias [{ diaSemana (0=Seg..6=Dom), horaInicio, horaFim }] cobertas por [inicioSql, fimSql]
function extrairSegmentosDiarios(inicioSql, fimSql) {
  const mi = inicioSql.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const mf = fimSql.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!mi || !mf) return [];

  const dtInicio = new Date(Number(mi[1]), Number(mi[2]) - 1, Number(mi[3]), Number(mi[4]), Number(mi[5]), Number(mi[6]));
  const dtFim = new Date(Number(mf[1]), Number(mf[2]) - 1, Number(mf[3]), Number(mf[4]), Number(mf[5]), Number(mf[6]));
  if (dtInicio >= dtFim) return [];

  const segmentos = [];
  let cursorDia = new Date(dtInicio.getFullYear(), dtInicio.getMonth(), dtInicio.getDate(), 0, 0, 0);
  const limiteDias = 31; // evita loop infinito em intervalos gigantes
  let passos = 0;

  while (cursorDia < dtFim && passos < limiteDias) {
    const proxDia = new Date(cursorDia.getFullYear(), cursorDia.getMonth(), cursorDia.getDate() + 1, 0, 0, 0);
    const segIni = dtInicio > cursorDia ? dtInicio : cursorDia;
    const segFim = dtFim < proxDia ? dtFim : proxDia;

    if (segIni < segFim) {
      // JS getDay(): 0=Dom, 1=Seg..6=Sab -> MySQL WEEKDAY(): 0=Seg..6=Dom
      const diaSemana = (cursorDia.getDay() + 6) % 7;
      const horaInicio = `${pad2(segIni.getHours())}:${pad2(segIni.getMinutes())}:${pad2(segIni.getSeconds())}`;
      const horaFim =
        segFim.getTime() === proxDia.getTime()
          ? '23:59:59'
          : `${pad2(segFim.getHours())}:${pad2(segFim.getMinutes())}:${pad2(segFim.getSeconds())}`;
      segmentos.push({ diaSemana, horaInicio, horaFim });
    }

    cursorDia = proxDia;
    passos++;
  }

  return segmentos;
}

// =====================================================================
// Inicialização e Migração Segura Automática no Startup
// =====================================================================
async function colunaExiste(tabela, coluna) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  );
  return Number(row.total) > 0;
}

async function inicializarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessoes_ativas (
      token_hash CHAR(64) PRIMARY KEY,
      id_usuario BIGINT NOT NULL,
      nome_usuario VARCHAR(99) NOT NULL,
      cargo_usuario ENUM('aluno monitor', 'professor', 'gestor') NOT NULL,
      expira_em BIGINT NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sessoes_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE CASCADE,
      INDEX idx_sessoes_expira (expira_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Evolução não-destrutiva de `emprestimos`
  if (!(await colunaExiste('emprestimos', 'hora_inicio'))) {
    await pool.query('ALTER TABLE emprestimos ADD COLUMN hora_inicio DATETIME NULL AFTER data_emprestimo');
    await pool.query("UPDATE emprestimos SET hora_inicio = CONCAT(data_emprestimo, ' 08:00:00') WHERE hora_inicio IS NULL");
  }
  if (!(await colunaExiste('emprestimos', 'hora_fim_prevista'))) {
    await pool.query('ALTER TABLE emprestimos ADD COLUMN hora_fim_prevista DATETIME NULL AFTER hora_inicio');
    await pool.query('UPDATE emprestimos SET hora_fim_prevista = DATE_ADD(hora_inicio, INTERVAL 50 MINUTE) WHERE hora_fim_prevista IS NULL');
  }
  if (!(await colunaExiste('emprestimos', 'devolvido_em'))) {
    await pool.query('ALTER TABLE emprestimos ADD COLUMN devolvido_em DATETIME NULL AFTER devolucao');
    await pool.query('UPDATE emprestimos SET devolvido_em = hora_fim_prevista WHERE devolucao = 1 AND devolvido_em IS NULL');
  }

  // Tabelas de Horários Fixos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS horarios_fixos (
      id_horario_fixo BIGINT PRIMARY KEY AUTO_INCREMENT,
      dia_semana TINYINT NOT NULL,
      hora_inicio TIME NOT NULL,
      hora_fim TIME NOT NULL,
      fk_professor VARCHAR(99) NOT NULL,
      disciplina VARCHAR(99) NOT NULL,
      fk_turma VARCHAR(5) NOT NULL,
      fk_usuario_criador VARCHAR(99) NOT NULL,
      status_horario ENUM('ativo', 'cancelado') NOT NULL DEFAULT 'ativo',
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_hf_professor FOREIGN KEY (fk_professor) REFERENCES professores(nome_professor)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_hf_turma FOREIGN KEY (fk_turma) REFERENCES turmas(nome_turma)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_hf_usuario FOREIGN KEY (fk_usuario_criador) REFERENCES usuarios(nome_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_hf_dia_status (dia_semana, status_horario, hora_inicio, hora_fim)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS especificacao_horarios_fixos (
      fk_horario_fixo BIGINT NOT NULL,
      fk_aparelho BIGINT NOT NULL,
      PRIMARY KEY (fk_horario_fixo, fk_aparelho),
      CONSTRAINT fk_ehf_horario FOREIGN KEY (fk_horario_fixo) REFERENCES horarios_fixos(id_horario_fixo)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_ehf_aparelho FOREIGN KEY (fk_aparelho) REFERENCES aparelhos(id_aparelho)
        ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await colunaExiste('emprestimos', 'fk_horario_fixo'))) {
    await pool.query('ALTER TABLE emprestimos ADD COLUMN fk_horario_fixo BIGINT NULL AFTER fk_turma');
    await pool.query(`
      ALTER TABLE emprestimos
      ADD CONSTRAINT fk_emprestimos_horario_fixo
      FOREIGN KEY (fk_horario_fixo) REFERENCES horarios_fixos(id_horario_fixo)
      ON UPDATE CASCADE ON DELETE SET NULL
    `).catch(() => {});
  }

  // Tabela `reservas` reestruturada + `especificacao_reservas` N:N
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id_reserva BIGINT PRIMARY KEY AUTO_INCREMENT,
      fk_usuario VARCHAR(99) NOT NULL,
      fk_professor VARCHAR(99) NULL,
      disciplina_snapshot VARCHAR(99) NULL,
      fk_turma VARCHAR(5) NULL,
      inicio_reserva DATETIME NOT NULL,
      fim_reserva DATETIME NOT NULL,
      status_reserva ENUM('ativa', 'cancelada', 'concluida') NOT NULL DEFAULT 'ativa',
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_reservas_usuario FOREIGN KEY (fk_usuario) REFERENCES usuarios(nome_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_reservas_professor FOREIGN KEY (fk_professor) REFERENCES professores(nome_professor)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_reservas_turma FOREIGN KEY (fk_turma) REFERENCES turmas(nome_turma)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_reservas_periodo (status_reserva, inicio_reserva, fim_reserva),
      INDEX idx_reservas_usuario (fk_usuario)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await colunaExiste('reservas', 'fk_professor'))) {
    await pool.query('ALTER TABLE reservas ADD COLUMN fk_professor VARCHAR(99) NULL AFTER fk_usuario');
  }
  if (!(await colunaExiste('reservas', 'disciplina_snapshot'))) {
    await pool.query('ALTER TABLE reservas ADD COLUMN disciplina_snapshot VARCHAR(99) NULL AFTER fk_professor');
  }
  if (!(await colunaExiste('reservas', 'fk_turma'))) {
    await pool.query('ALTER TABLE reservas ADD COLUMN fk_turma VARCHAR(5) NULL AFTER disciplina_snapshot');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS especificacao_reservas (
      id_especificacao_reserva BIGINT PRIMARY KEY AUTO_INCREMENT,
      fk_reserva BIGINT NOT NULL,
      fk_aparelho BIGINT NOT NULL,
      status_item ENUM('ativo', 'concluido', 'cancelado') NOT NULL DEFAULT 'ativo',
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_reserva_aparelho (fk_reserva, fk_aparelho),
      CONSTRAINT fk_er_reserva FOREIGN KEY (fk_reserva) REFERENCES reservas(id_reserva)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_er_aparelho FOREIGN KEY (fk_aparelho) REFERENCES aparelhos(id_aparelho)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_er_aparelho_status (fk_aparelho, status_item)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migração automática caso exista a coluna legada `fk_aparelho` em `reservas`
  if (await colunaExiste('reservas', 'fk_aparelho')) {
    await pool.query(`
      INSERT IGNORE INTO especificacao_reservas (fk_reserva, fk_aparelho, status_item)
      SELECT id_reserva,
             fk_aparelho,
             CASE status_reserva
               WHEN 'concluida' THEN 'concluido'
               WHEN 'cancelada' THEN 'cancelado'
               ELSE 'ativo'
             END
      FROM reservas
      WHERE fk_aparelho IS NOT NULL
    `);

    const [fks] = await pool.query(`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas'
        AND COLUMN_NAME = 'fk_aparelho' AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    for (const fk of fks) {
      await pool.query(`ALTER TABLE reservas DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``).catch(() => {});
    }
    await pool.query('ALTER TABLE reservas DROP INDEX idx_reservas_aparelho_periodo').catch(() => {});
    await pool.query('ALTER TABLE reservas DROP COLUMN fk_aparelho').catch(() => {});
  }

  if (await colunaExiste('reservas', 'finalidade')) {
    await pool.query('ALTER TABLE reservas DROP COLUMN finalidade').catch(() => {});
  }

  await pool.query('DELETE FROM sessoes_ativas WHERE expira_em < ?', [Date.now()]);
}

// =====================================================================
// Controle de Erros, Sessão e Autorização
// =====================================================================
function erroHttp(msg, status = 400) {
  const err = new Error(msg);
  err.status = status;
  return err;
}

function falha(msg, status = 400) {
  throw erroHttp(msg, status);
}

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function criarSessao(req, res, usuarioRow) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expira = Date.now() + DURACAO_SESSAO_MS;

  const dadosSessao = {
    id: Number(usuarioRow.id_usuario),
    nome: usuarioRow.nome_usuario,
    cargo: usuarioRow.cargo_usuario,
    expira
  };

  sessoes.set(tokenHash, dadosSessao);

  await pool.query(
    `INSERT INTO sessoes_ativas (token_hash, id_usuario, nome_usuario, cargo_usuario, expira_em)
     VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, dadosSessao.id, dadosSessao.nome, dadosSessao.cargo, expira]
  );

  definirCookieSessao(req, res, token);
  return dadosSessao;
}

async function obterSessaoValida(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  let s = sessoes.get(tokenHash);

  if (!s) {
    const [rows] = await pool.query(
      'SELECT id_usuario, nome_usuario, cargo_usuario, expira_em FROM sessoes_ativas WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );
    if (rows.length) {
      s = {
        id: Number(rows[0].id_usuario),
        nome: rows[0].nome_usuario,
        cargo: rows[0].cargo_usuario,
        expira: Number(rows[0].expira_em)
      };
      sessoes.set(tokenHash, s);
    }
  }

  if (!s) return null;

  if (s.expira <= Date.now()) {
    sessoes.delete(tokenHash);
    await pool.query('DELETE FROM sessoes_ativas WHERE token_hash = ?', [tokenHash]).catch(() => {});
    return null;
  }

  s.expira = Date.now() + DURACAO_SESSAO_MS;
  pool.query('UPDATE sessoes_ativas SET expira_em = ? WHERE token_hash = ?', [s.expira, tokenHash]).catch(() => {});

  return { tokenHash, sessao: s };
}

const autenticar = rota(async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  const token = cookies[COOKIE_NOME] || bearer;

  const resultado = await obterSessaoValida(token);
  if (!resultado) {
    if (cookies[COOKIE_NOME]) limparCookieSessao(req, res);
    return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  }

  if (cookies[COOKIE_NOME]) {
    definirCookieSessao(req, res, cookies[COOKIE_NOME]);
  }

  req.usuario = resultado.sessao;
  req.tokenHash = resultado.tokenHash;
  return next();
});

function exigirPermissao(...permissoesNecessarias) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    const autorizado = permissoesNecessarias.some((p) => temPermissao(req.usuario.cargo, p));
    if (!autorizado) {
      return res.status(403).json({ erro: 'Seu cargo não possui permissão para realizar esta operação.' });
    }
    return next();
  };
}

// =====================================================================
// Motor Central de Disponibilidade e Conflitos Temporais
// =====================================================================
async function consultarHorariosFixosConflitantes(conn, inicioSql, fimSql, idsAparelhos = null) {
  const segmentos = extrairSegmentosDiarios(inicioSql, fimSql);
  if (!segmentos.length) return [];

  const condicoesSeg = segmentos.map(() => '(hf.dia_semana = ? AND hf.hora_inicio < ? AND hf.hora_fim > ?)').join(' OR ');
  const params = [];
  for (const seg of segmentos) {
    params.push(seg.diaSemana, seg.horaFim, seg.horaInicio);
  }

  let filtroAparelhos = '';
  if (Array.isArray(idsAparelhos) && idsAparelhos.length) {
    filtroAparelhos = 'AND ehf.fk_aparelho IN (?)';
    params.push(idsAparelhos);
  }

  const [rows] = await conn.query(
    `SELECT hf.id_horario_fixo,
            hf.dia_semana,
            hf.hora_inicio,
            hf.hora_fim,
            hf.fk_professor,
            hf.disciplina,
            hf.fk_turma,
            ehf.fk_aparelho
     FROM horarios_fixos hf
     INNER JOIN especificacao_horarios_fixos ehf ON ehf.fk_horario_fixo = hf.id_horario_fixo
     WHERE hf.status_horario = 'ativo'
       AND (${condicoesSeg})
       ${filtroAparelhos}`,
    params
  );

  return rows;
}

async function verificarConflitosAparelhos(conn, {
  ids,
  inicioSql,
  fimSql,
  ignorarReservaId = null,
  permitirHorarioFixoProfessor = null,
  permitirHorarioFixoTurma = null
}) {
  const [equip] = await conn.query(
    'SELECT id_aparelho, tipo_aparelho, numero_aparelho, disponivel FROM aparelhos WHERE id_aparelho IN (?) ORDER BY id_aparelho FOR UPDATE',
    [ids]
  );

  if (equip.length !== ids.length) {
    falha('Um ou mais aparelhos selecionados não foram encontrados.', 404);
  }

  const mapaEquip = new Map(equip.map((a) => [Number(a.id_aparelho), a]));

  // 1. Verifica disponibilidade física/manutenção
  for (const id of ids) {
    const ap = mapaEquip.get(id);
    if (!Number(ap.disponivel)) {
      // Verifica se está indisponível por empréstimo aberto ou por manutenção/bloqueio administrativo
      const [empAtivo] = await conn.query(
        `SELECT e.id_emprestimo, e.fk_professor, e.fk_turma
         FROM especificacao_emprestimos se
         INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
         WHERE se.fk_aparelho_emprestimo = ? AND e.devolucao = 0
         LIMIT 1`,
        [id]
      );
      if (empAtivo.length) {
        falha(
          `O aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} está em empréstimo ativo com ${empAtivo[0].fk_professor} (${empAtivo[0].fk_turma}).`,
          409
        );
      }
      falha(`O aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} está marcado como indisponível (manutenção/bloqueio).`, 409);
    }
  }

  // 2. Verifica empréstimos em andamento com sobreposição temporal
  const [empConflitos] = await conn.query(
    `SELECT se.fk_aparelho_emprestimo AS id_aparelho, e.fk_professor, e.fk_turma, e.hora_inicio, e.hora_fim_prevista
     FROM especificacao_emprestimos se
     INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
     WHERE se.fk_aparelho_emprestimo IN (?)
       AND e.devolucao = 0
       AND COALESCE(e.hora_inicio, CONCAT(e.data_emprestimo, ' 00:00:00')) < ?
       AND COALESCE(e.hora_fim_prevista, DATE_ADD(CONCAT(e.data_emprestimo, ' 23:59:59'), INTERVAL 0 SECOND)) > ?
     LIMIT 1`,
    [ids, fimSql, inicioSql]
  );

  if (empConflitos.length) {
    const c = empConflitos[0];
    const ap = mapaEquip.get(Number(c.id_aparelho));
    falha(
      `O aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} possui empréstimo em andamento (${c.fk_professor} - ${c.fk_turma}).`,
      409
    );
  }

  // 3. Verifica reservas com sobreposição real de intervalo (inicio_existente < fim_novo AND fim_existente > inicio_novo)
  const paramsRes = [ids, fimSql, inicioSql];
  let sqlIgnorar = '';
  if (ignorarReservaId) {
    sqlIgnorar = 'AND r.id_reserva <> ?';
    paramsRes.push(ignorarReservaId);
  }

  const [resConflitos] = await conn.query(
    `SELECT er.fk_aparelho AS id_aparelho,
            r.id_reserva,
            r.inicio_reserva,
            r.fim_reserva,
            COALESCE(r.fk_professor, r.fk_usuario) AS responsavel,
            r.fk_turma
     FROM especificacao_reservas er
     INNER JOIN reservas r ON r.id_reserva = er.fk_reserva
     WHERE er.fk_aparelho IN (?)
       AND er.status_item = 'ativo'
       AND r.status_reserva = 'ativa'
       AND r.inicio_reserva < ?
       AND r.fim_reserva > ?
       ${sqlIgnorar}
     LIMIT 1`,
    paramsRes
  );

  if (resConflitos.length) {
    const c = resConflitos[0];
    const ap = mapaEquip.get(Number(c.id_aparelho));
    const hIni = String(c.inicio_reserva).slice(11, 16);
    const hFim = String(c.fim_reserva).slice(11, 16);
    falha(
      `O aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} já está reservado de ${hIni} às ${hFim} (${c.responsavel}${c.fk_turma ? ' • ' + c.fk_turma : ''}).`,
      409
    );
  }

  // 4. Verifica Horários Fixos recorrentes
  const hfConflitos = await consultarHorariosFixosConflitantes(conn, inicioSql, fimSql, ids);
  let horarioFixoCompativel = null;

  for (const hf of hfConflitos) {
    const mesmoProf =
      permitirHorarioFixoProfessor &&
      hf.fk_professor.toLowerCase() === permitirHorarioFixoProfessor.toLowerCase() &&
      (!permitirHorarioFixoTurma || hf.fk_turma.toLowerCase() === permitirHorarioFixoTurma.toLowerCase());

    if (mesmoProf) {
      horarioFixoCompativel = Number(hf.id_horario_fixo);
      continue;
    }

    const ap = mapaEquip.get(Number(hf.fk_aparelho));
    const hIni = String(hf.hora_inicio).slice(0, 5);
    const hFim = String(hf.hora_fim).slice(0, 5);
    falha(
      `O aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} está destinado a Horário Fixo (${hf.fk_professor} • ${hf.fk_turma}, ${hIni} às ${hFim}).`,
      409
    );
  }

  return { mapaEquip, horarioFixoCompativel };
}

// =====================================================================
// Autenticação e Sessão
// =====================================================================
app.post('/api/login', rota(async (req, res) => {
  const nome = String(req.body?.username || '').trim().toLowerCase();
  const senha = String(req.body?.password || '');
  if (!nome || !senha) falha('Informe usuário e senha.', 400);

  const [rows] = await pool.query(
    'SELECT id_usuario, nome_usuario, senha_usuario, cargo_usuario FROM usuarios WHERE LOWER(nome_usuario) = ? LIMIT 1',
    [nome]
  );

  if (!rows.length || rows[0].senha_usuario !== senha) {
    falha('Usuário ou senha incorretos.', 401);
  }

  const dadosSessao = await criarSessao(req, res, rows[0]);
  res.json({
    ok: true,
    usuario: {
      nome: dadosSessao.nome,
      cargo: dadosSessao.cargo,
      permissoes: [...(MATRIZ_PERMISSOES[dadosSessao.cargo] || [])]
    }
  });
}));

app.post('/api/register', rota(async (req, res) => {
  const nome = String(req.body?.username || '').trim().toLowerCase();
  const senha = String(req.body?.password || '');

  if (nome.length < 3 || nome.length > 99) falha('O nome de usuário deve ter entre 3 e 99 caracteres.', 400);
  if (!/^[a-z0-9._-]+$/.test(nome)) falha('Use apenas letras minúsculas, números, ponto, traço ou sublinhado.', 400);
  if (senha.length < 4 || senha.length > 30) falha('A senha deve ter entre 4 e 30 caracteres.', 400);

  const [existe] = await pool.query('SELECT id_usuario FROM usuarios WHERE LOWER(nome_usuario) = ? LIMIT 1', [nome]);
  if (existe.length) falha('Este nome de usuário já está em uso.', 409);

  await pool.query(
    'INSERT INTO usuarios (nome_usuario, senha_usuario, cargo_usuario) VALUES (?, ?, ?)',
    [nome, senha, MON]
  );

  res.status(201).json({ ok: true });
}));

app.get('/api/me', autenticar, (req, res) => {
  res.json({
    autenticado: true,
    usuario: {
      nome: req.usuario.nome,
      cargo: req.usuario.cargo,
      permissoes: [...(MATRIZ_PERMISSOES[req.usuario.cargo] || [])]
    }
  });
});

app.post('/api/logout', rota(async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  const token = cookies[COOKIE_NOME] || bearer;

  if (token) {
    const tokenHash = hashToken(token);
    sessoes.delete(tokenHash);
    await pool.query('DELETE FROM sessoes_ativas WHERE token_hash = ?', [tokenHash]).catch(() => {});
  }

  limparCookieSessao(req, res);
  res.json({ ok: true });
}));

// =====================================================================
// Dashboard SaaS — KPIs e Múltiplos Gráficos Analíticos (100% SQL Real)
// =====================================================================
app.get('/api/dashboard/saas', autenticar, exigirPermissao('dashboard:ler'), rota(async (req, res) => {
  const periodo = String(req.query.periodo || 'todos').trim().toLowerCase();
  const dataInicioParam = normalizarData(req.query.inicio);
  const dataFimParam = normalizarData(req.query.fim);

  let filtroEmpSql = '';
  let filtroResSql = '';
  const paramsEmp = [];
  const paramsRes = [];

  if (dataInicioParam && dataFimParam) {
    filtroEmpSql = 'WHERE e.data_emprestimo BETWEEN ? AND ?';
    paramsEmp.push(dataInicioParam, dataFimParam);
    filtroResSql = 'WHERE DATE(r.inicio_reserva) BETWEEN ? AND ?';
    paramsRes.push(dataInicioParam, dataFimParam);
  } else if (periodo === '7d' || periodo === '30d' || periodo === '90d') {
    const dias = periodo === '7d' ? 7 : (periodo === '30d' ? 30 : 90);
    filtroEmpSql = 'WHERE e.data_emprestimo >= DATE_SUB(CURDATE(), INTERVAL ? DAY)';
    paramsEmp.push(dias);
    filtroResSql = 'WHERE r.inicio_reserva >= DATE_SUB(NOW(), INTERVAL ? DAY)';
    paramsRes.push(dias);
  }

  const agoraSql = agoraLocalSql();

  const [
    [[kpisAparelhos]],
    [[kpisEmp]],
    [[kpisRes]],
    [usoDiaSemana],
    [usoPorHorario],
    [evolucaoDiaria],
    [evolucaoSemanal],
    [evolucaoMensal],
    [usoPorTipo],
    [topAparelhos],
    [usoPorSala],
    [usoPorAndar],
    [usoPorTurma],
    [topProfessores],
    [topDisciplinas],
    [reservasPorDiaStatus],
    [comparativoReservaEmprestimo]
  ] = await Promise.all([
    // KPIs de Aparelhos
    pool.query(`
      SELECT COUNT(*) AS total_aparelhos,
             SUM(CASE WHEN disponivel = 1 THEN 1 ELSE 0 END) AS disponiveis_cadastro,
             SUM(CASE WHEN disponivel = 0 THEN 1 ELSE 0 END) AS indisponiveis_cadastro
      FROM aparelhos
    `),
    // KPIs de Empréstimos
    pool.query(
      `SELECT COUNT(*) AS total_registros_emp,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total_aparelhos_emp,
              SUM(CASE WHEN e.devolucao = 0 THEN 1 ELSE 0 END) AS emprestimos_em_andamento,
              COALESCE(SUM(CASE WHEN e.devolucao = 0 THEN e.quantidade_emprestada ELSE 0 END), 0) AS aparelhos_emprestados_agora
       FROM emprestimos e
       ${filtroEmpSql}`,
      paramsEmp
    ),
    // KPIs de Reservas e Horários Fixos
    pool.query(
      `SELECT COUNT(*) AS total_reservas,
              SUM(CASE WHEN r.status_reserva = 'ativa' AND r.inicio_reserva > ? THEN 1 ELSE 0 END) AS reservas_futuras,
              SUM(CASE WHEN r.status_reserva = 'ativa' AND r.inicio_reserva <= ? AND r.fim_reserva > ? THEN 1 ELSE 0 END) AS reservas_em_andamento,
              SUM(CASE WHEN r.status_reserva = 'concluida' THEN 1 ELSE 0 END) AS reservas_concluidas,
              SUM(CASE WHEN r.status_reserva = 'cancelada' THEN 1 ELSE 0 END) AS reservas_canceladas
       FROM reservas r
       ${filtroResSql}`,
      [agoraSql, agoraSql, agoraSql, ...paramsRes]
    ),
    // 1. Utilização por dia da semana
    pool.query(
      `SELECT WEEKDAY(e.data_emprestimo) AS dia_idx,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY WEEKDAY(e.data_emprestimo)
       ORDER BY dia_idx`,
      paramsEmp
    ),
    // 2. Quantidade de empréstimos por horário (07h às 22h)
    pool.query(
      `SELECT HOUR(COALESCE(e.hora_inicio, CONCAT(e.data_emprestimo, ' 08:00:00'))) AS hora,
              COUNT(*) AS qtd_emprestimos,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS qtd_aparelhos
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY hora
       ORDER BY hora`,
      paramsEmp
    ),
    // 3. Evolução da utilização ao longo dos dias
    pool.query(
      `SELECT e.data_emprestimo AS dia,
              COUNT(*) AS registros,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS aparelhos
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY e.data_emprestimo
       ORDER BY e.data_emprestimo ASC
       LIMIT 60`,
      paramsEmp
    ),
    // 4. Evolução semanal
    pool.query(
      `SELECT YEARWEEK(e.data_emprestimo, 1) AS semana_cod,
              MIN(e.data_emprestimo) AS inicio_semana,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS aparelhos,
              COUNT(*) AS registros
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY YEARWEEK(e.data_emprestimo, 1)
       ORDER BY semana_cod ASC
       LIMIT 24`,
      paramsEmp
    ),
    // 5. Evolução mensal
    pool.query(
      `SELECT DATE_FORMAT(e.data_emprestimo, '%Y-%m') AS mes,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS aparelhos,
              COUNT(*) AS registros
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY DATE_FORMAT(e.data_emprestimo, '%Y-%m')
       ORDER BY mes ASC
       LIMIT 24`,
      paramsEmp
    ),
    // 6. Histórico/distribuição por categoria de aparelho ao longo dos dias da semana
    pool.query(
      `SELECT WEEKDAY(e.data_emprestimo) AS dia_idx,
              e.aparelho_emprestado AS tipo,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY WEEKDAY(e.data_emprestimo), e.aparelho_emprestado
       ORDER BY dia_idx`,
      paramsEmp
    ),
    // 7. Aparelhos individuais mais utilizados
    pool.query(
      `SELECT CONCAT(ap.tipo_aparelho, ' #', ap.numero_aparelho) AS rotulo,
              COUNT(*) AS usos
       FROM especificacao_emprestimos se
       INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
       INNER JOIN aparelhos ap ON ap.id_aparelho = se.fk_aparelho_emprestimo
       ${filtroEmpSql}
       GROUP BY ap.id_aparelho, ap.tipo_aparelho, ap.numero_aparelho
       ORDER BY usos DESC, ap.numero_aparelho ASC
       LIMIT 12`,
      paramsEmp
    ),
    // 8. Salas com maior utilização
    pool.query(
      `SELECT CONCAT('Sala ', t.sala) AS rotulo,
              t.sala,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       INNER JOIN turmas t ON t.nome_turma = e.fk_turma
       ${filtroEmpSql}
       GROUP BY t.sala
       ORDER BY total DESC, t.sala ASC
       LIMIT 12`,
      paramsEmp
    ),
    // 9. Movimentação por andar escolar ao longo da semana
    pool.query(
      `SELECT WEEKDAY(e.data_emprestimo) AS dia_idx,
              t.andar_escolar AS andar,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       INNER JOIN turmas t ON t.nome_turma = e.fk_turma
       ${filtroEmpSql}
       GROUP BY WEEKDAY(e.data_emprestimo), t.andar_escolar
       ORDER BY dia_idx`,
      paramsEmp
    ),
    // 10. Distribuição de empréstimos por turma
    pool.query(
      `SELECT e.fk_turma AS turma,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY e.fk_turma
       ORDER BY total DESC
       LIMIT 12`,
      paramsEmp
    ),
    // 11. Professores que mais utilizam equipamentos
    pool.query(
      `SELECT e.fk_professor AS professor,
              COUNT(*) AS qtd_emprestimos,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total_aparelhos
       FROM emprestimos e
       ${filtroEmpSql}
       GROUP BY e.fk_professor
       ORDER BY total_aparelhos DESC
       LIMIT 10`,
      paramsEmp
    ),
    // 12. Disciplinas com maior utilização
    pool.query(
      `SELECT p.disciplina_professor AS disciplina,
              COALESCE(SUM(e.quantidade_emprestada), 0) AS total
       FROM emprestimos e
       INNER JOIN professores p ON p.nome_professor = e.fk_professor
       ${filtroEmpSql}
       GROUP BY p.disciplina_professor
       ORDER BY total DESC
       LIMIT 10`,
      paramsEmp
    ),
    // 13. Reservas por dia da semana e status
    pool.query(
      `SELECT WEEKDAY(r.inicio_reserva) AS dia_idx,
              r.status_reserva AS status,
              COUNT(*) AS total
       FROM reservas r
       ${filtroResSql}
       GROUP BY WEEKDAY(r.inicio_reserva), r.status_reserva
       ORDER BY dia_idx`,
      paramsRes
    ),
    // 14. Comparação Reservas vs Empréstimos por dia da semana
    pool.query(
      `SELECT d.dia_idx,
              COALESCE(emp.total_emp, 0) AS emprestimos,
              COALESCE(res.total_res, 0) AS reservas
       FROM (
         SELECT 0 AS dia_idx UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
       ) d
       LEFT JOIN (
         SELECT WEEKDAY(e.data_emprestimo) AS dia_idx, COUNT(*) AS total_emp
         FROM emprestimos e
         ${filtroEmpSql}
         GROUP BY WEEKDAY(e.data_emprestimo)
       ) emp ON emp.dia_idx = d.dia_idx
       LEFT JOIN (
         SELECT WEEKDAY(r.inicio_reserva) AS dia_idx, COUNT(*) AS total_res
         FROM reservas r
         ${filtroResSql}
         GROUP BY WEEKDAY(r.inicio_reserva)
       ) res ON res.dia_idx = d.dia_idx
       ORDER BY d.dia_idx`,
      [...paramsEmp, ...paramsRes]
    )
  ]);

  const nomesDias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  // Monta séries alinhadas
  const mapaDia = new Map(usoDiaSemana.map((r) => [Number(r.dia_idx), Number(r.total)]));
  const serieDiaSemana = nomesDias.map((label, idx) => ({ label, valor: mapaDia.get(idx) || 0 }));

  const mapaHora = new Map(usoPorHorario.map((r) => [Number(r.hora), r]));
  const horasRange = [];
  for (let h = 7; h <= 22; h++) {
    const item = mapaHora.get(h);
    horasRange.push({
      label: `${pad2(h)}h`,
      aparelhos: item ? Number(item.qtd_aparelhos) : 0,
      emprestimos: item ? Number(item.qtd_emprestimos) : 0
    });
  }

  const tiposOrdenados = ['notebook', 'notebook ds', 'chromebook', 'tablet', 'celular'];
  const seriesPorTipo = tiposOrdenados.map((t) => ({
    nome: t.toUpperCase(),
    dados: nomesDias.map((_, idx) => {
      const encontrado = usoPorTipo.find((r) => Number(r.dia_idx) === idx && r.tipo === t);
      return encontrado ? Number(encontrado.total) : 0;
    })
  }));

  const andaresOrdenados = ['térreo', 'primeiro piso', 'segundo piso'];
  const seriesPorAndar = andaresOrdenados.map((a) => ({
    nome: a.charAt(0).toUpperCase() + a.slice(1),
    dados: nomesDias.map((_, idx) => {
      const encontrado = usoPorAndar.find((r) => Number(r.dia_idx) === idx && r.andar === a);
      return encontrado ? Number(encontrado.total) : 0;
    })
  }));

  const statusReservaOrdenados = [
    { chave: 'ativa', nome: 'Ativas' },
    { chave: 'concluida', nome: 'Concluídas' },
    { chave: 'cancelada', nome: 'Canceladas' }
  ];
  const seriesReservasStatus = statusReservaOrdenados.map((st) => ({
    nome: st.nome,
    dados: nomesDias.map((_, idx) => {
      const encontrado = reservasPorDiaStatus.find((r) => Number(r.dia_idx) === idx && r.status === st.chave);
      return encontrado ? Number(encontrado.total) : 0;
    })
  }));

  // Cálculo de crescimento recente (última metade vs primeira metade da evolução diária)
  let variacaoUtilizacao = null;
  if (evolucaoDiaria.length >= 4) {
    const meio = Math.floor(evolucaoDiaria.length / 2);
    const somaAntes = evolucaoDiaria.slice(0, meio).reduce((acc, r) => acc + Number(r.aparelhos || 0), 0);
    const somaDepois = evolucaoDiaria.slice(meio).reduce((acc, r) => acc + Number(r.aparelhos || 0), 0);
    if (somaAntes > 0) {
      variacaoUtilizacao = Number((((somaDepois - somaAntes) / somaAntes) * 100).toFixed(1));
    }
  }

  res.json({
    kpis: {
      totalAparelhos: Number(kpisAparelhos?.total_aparelhos || 0),
      disponiveis: Number(kpisAparelhos?.disponiveis_cadastro || 0),
      indisponiveis: Number(kpisAparelhos?.indisponiveis_cadastro || 0),
      emprestimosEmAndamento: Number(kpisEmp?.emprestimos_em_andamento || 0),
      aparelhosEmprestadosAgora: Number(kpisEmp?.aparelhos_emprestados_agora || 0),
      emprestimosPeriodo: Number(kpisEmp?.total_registros_emp || 0),
      aparelhosUtilizadosPeriodo: Number(kpisEmp?.total_aparelhos_emp || 0),
      reservasAtivas: Number(kpisRes?.reservas_futuras || 0) + Number(kpisRes?.reservas_em_andamento || 0),
      reservasFuturas: Number(kpisRes?.reservas_futuras || 0),
      reservasEmAndamento: Number(kpisRes?.reservas_em_andamento || 0),
      reservasConcluidas: Number(kpisRes?.reservas_concluidas || 0),
      reservasCanceladas: Number(kpisRes?.reservas_canceladas || 0),
      variacaoUtilizacao
    },
    graficos: [
      {
        id: 'uso_dia_semana',
        categoria: 'UTILIZAÇÃO',
        titulo: 'Utilização por Dia da Semana',
        descricao: 'Volume acumulado de aparelhos emprestados de segunda a domingo.',
        labels: serieDiaSemana.map((d) => d.label),
        series: [{ nome: 'Aparelhos emprestados', dados: serieDiaSemana.map((d) => d.valor) }]
      },
      {
        id: 'emprestimos_por_horario',
        categoria: 'PICOS DE USO',
        titulo: 'Horários de Pico de Utilização',
        descricao: 'Distribuição de aparelhos retirados e registros por faixa horária (07h às 22h).',
        labels: horasRange.map((h) => h.label),
        series: [
          { nome: 'Aparelhos retirados', dados: horasRange.map((h) => h.aparelhos) },
          { nome: 'Registros de empréstimo', dados: horasRange.map((h) => h.emprestimos) }
        ]
      },
      {
        id: 'evolucao_diaria',
        categoria: 'HISTÓRICO',
        titulo: 'Evolução Diária da Utilização',
        descricao: 'Tendência diária da quantidade de equipamentos emprestados no período.',
        labels: evolucaoDiaria.map((r) => {
          const p = String(r.dia).split('-');
          return p.length === 3 ? `${p[2]}/${p[1]}` : r.dia;
        }),
        series: [{ nome: 'Aparelhos emprestados', dados: evolucaoDiaria.map((r) => Number(r.aparelhos)) }]
      },
      {
        id: 'evolucao_semanal',
        categoria: 'HISTÓRICO',
        titulo: 'Comparação Entre Semanas',
        descricao: 'Evolução semanal de equipamentos movimentados e chamados de empréstimo.',
        labels: evolucaoSemanal.map((r) => {
          const p = String(r.inicio_semana).split('-');
          return p.length === 3 ? `Sem ${p[2]}/${p[1]}` : String(r.semana_cod);
        }),
        series: [{ nome: 'Aparelhos por semana', dados: evolucaoSemanal.map((r) => Number(r.aparelhos)) }]
      },
      {
        id: 'evolucao_mensal',
        categoria: 'HISTÓRICO',
        titulo: 'Evolução Mensal da Demanda',
        descricao: 'Comparativo consolidado mês a mês de utilização dos equipamentos.',
        labels: evolucaoMensal.map((r) => r.mes),
        series: [{ nome: 'Aparelhos no mês', dados: evolucaoMensal.map((r) => Number(r.aparelhos)) }]
      },
      {
        id: 'uso_por_categoria',
        categoria: 'EQUIPAMENTOS',
        titulo: 'Utilização por Tipo de Aparelho',
        descricao: 'Comparativo semanal entre Notebooks, Notebooks DS, Chromebooks, Tablets e Celulares.',
        labels: nomesDias,
        series: seriesPorTipo
      },
      {
        id: 'top_aparelhos',
        categoria: 'EQUIPAMENTOS',
        titulo: 'Aparelhos Individuais Mais Utilizados',
        descricao: 'Ranking dos 12 equipamentos específicos com maior frequência de empréstimo.',
        labels: topAparelhos.map((r) => r.rotulo),
        series: [{ nome: 'Total de usos', dados: topAparelhos.map((r) => Number(r.usos)) }]
      },
      {
        id: 'uso_por_sala',
        categoria: 'LOCALIZAÇÃO',
        titulo: 'Salas com Maior Utilização',
        descricao: 'Quantidade de equipamentos utilizados por sala de aula.',
        labels: usoPorSala.map((r) => r.rotulo),
        series: [{ nome: 'Aparelhos utilizados', dados: usoPorSala.map((r) => Number(r.total)) }]
      },
      {
        id: 'movimentacao_por_andar',
        categoria: 'LOCALIZAÇÃO',
        titulo: 'Movimentação por Andar Escolar',
        descricao: 'Comparativo de demanda entre Térreo, Primeiro Piso e Segundo Piso.',
        labels: nomesDias,
        series: seriesPorAndar
      },
      {
        id: 'uso_por_turma',
        categoria: 'TURMAS',
        titulo: 'Turmas que Mais Utilizam Equipamentos',
        descricao: 'Distribuição do volume de aparelhos emprestados nas 12 turmas mais ativas.',
        labels: usoPorTurma.map((r) => r.turma),
        series: [{ nome: 'Aparelhos emprestados', dados: usoPorTurma.map((r) => Number(r.total)) }]
      },
      {
        id: 'top_professores',
        categoria: 'DOCENTES',
        titulo: 'Professores que Mais Utilizam Equipamentos',
        descricao: 'Top 10 docentes por volume de aparelhos retirados e quantidade de aulas.',
        labels: topProfessores.map((r) => r.professor.split(' ').slice(0, 2).join(' ')),
        series: [
          { nome: 'Aparelhos retirados', dados: topProfessores.map((r) => Number(r.total_aparelhos)) },
          { nome: 'Empréstimos realizados', dados: topProfessores.map((r) => Number(r.qtd_emprestimos)) }
        ]
      },
      {
        id: 'top_disciplinas',
        categoria: 'DOCENTES',
        titulo: 'Disciplinas com Maior Utilização',
        descricao: 'Componentes curriculares que mais demandam recursos tecnológicos.',
        labels: topDisciplinas.map((r) => r.disciplina.slice(0, 18)),
        series: [{ nome: 'Aparelhos utilizados', dados: topDisciplinas.map((r) => Number(r.total)) }]
      },
      {
        id: 'reservas_por_status',
        categoria: 'RESERVAS',
        titulo: 'Reservas por Dia e Status',
        descricao: 'Distribuição semanal de reservas Ativas, Concluídas e Canceladas.',
        labels: nomesDias,
        series: seriesReservasStatus
      },
      {
        id: 'comparativo_reservas_emprestimos',
        categoria: 'RESERVAS',
        titulo: 'Reservas vs. Empréstimos Realizados',
        descricao: 'Comparação direta entre solicitações de reserva e empréstimos efetivados.',
        labels: nomesDias,
        series: [
          { nome: 'Empréstimos realizados', dados: comparativoReservaEmprestimo.map((r) => Number(r.emprestimos)) },
          { nome: 'Reservas registradas', dados: comparativoReservaEmprestimo.map((r) => Number(r.reservas)) }
        ]
      }
    ]
  });
}));

// Mantém compatibilidade com rota antiga caso algum cliente externo a chame
app.get('/api/dashboard/uso-semanal', autenticar, exigirPermissao('dashboard:ler'), rota(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT WEEKDAY(data_emprestimo) AS dia_idx,
           COALESCE(SUM(quantidade_emprestada), 0) AS total
    FROM emprestimos
    GROUP BY WEEKDAY(data_emprestimo)
  `);
  const nomesDias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const mapa = new Map(rows.map((r) => [Number(r.dia_idx), Number(r.total)]));
  res.json(nomesDias.map((dia, idx) => ({ dia, total: mapa.get(idx) || 0 })));
}));

// =====================================================================
// Opções Auxiliares e Gerenciamento de Professores e Turmas (Gestor)
// =====================================================================
app.get('/api/opcoes', autenticar, rota(async (req, res) => {
  const [[professores], [turmas]] = await Promise.all([
    pool.query('SELECT id_professor, nome_professor, disciplina_professor, periodo_escolar FROM professores ORDER BY nome_professor'),
    pool.query('SELECT id_turma, nome_turma, quantidade_alunos, modalidade, turno_escolar, andar_escolar, sala FROM turmas ORDER BY nome_turma')
  ]);
  res.json({ professores, turmas });
}));

app.post('/api/professores', autenticar, exigirPermissao('cadastros:gerenciar'), rota(async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const disciplina = String(req.body?.disciplina || '').trim().toLowerCase();
  const periodo = String(req.body?.periodo || '').trim().toLowerCase();

  if (nome.length < 3 || nome.length > 99) falha('Nome do professor deve ter entre 3 e 99 caracteres.');
  if (!disciplina || disciplina.length > 99) falha('Informe a disciplina do professor.');
  if (!PERIODOS_PROF_VALIDOS.has(periodo)) falha('Período escolar inválido.');

  await pool.query(
    'INSERT INTO professores (nome_professor, disciplina_professor, periodo_escolar) VALUES (?, ?, ?)',
    [nome, disciplina, periodo]
  );
  res.status(201).json({ ok: true });
}));

app.delete('/api/professores/:id', autenticar, exigirPermissao('cadastros:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de professor inválido.');
  await pool.query('DELETE FROM professores WHERE id_professor = ?', [id]);
  res.json({ ok: true });
}));

app.post('/api/turmas', autenticar, exigirPermissao('cadastros:gerenciar'), rota(async (req, res) => {
  const nome = String(req.body?.nome || '').trim().toUpperCase();
  const alunos = Number(req.body?.quantidade_alunos);
  const modalidade = String(req.body?.modalidade || '').trim().toLowerCase();
  const turno = String(req.body?.turno || '').trim().toLowerCase();
  const andar = String(req.body?.andar || '').trim().toLowerCase();
  const sala = Number(req.body?.sala);

  if (!nome || nome.length > 5) falha('Nome da turma obrigatório (até 5 caracteres, ex.: 1DS).');
  if (!Number.isInteger(alunos) || alunos <= 0) falha('Quantidade de alunos inválida.');
  if (!MODALIDADES_VALIDAS.has(modalidade)) falha('Modalidade inválida.');
  if (!TURNOS_TURMA_VALIDOS.has(turno)) falha('Turno escolar inválido.');
  if (!ANDARES_VALIDOS.has(andar)) falha('Andar escolar inválido.');
  if (!Number.isInteger(sala) || sala <= 0) falha('Número da sala inválido.');

  await pool.query(
    'INSERT INTO turmas (nome_turma, quantidade_alunos, modalidade, turno_escolar, andar_escolar, sala) VALUES (?, ?, ?, ?, ?, ?)',
    [nome, alunos, modalidade, turno, andar, sala]
  );
  res.status(201).json({ ok: true });
}));

app.delete('/api/turmas/:id', autenticar, exigirPermissao('cadastros:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de turma inválido.');
  await pool.query('DELETE FROM turmas WHERE id_turma = ?', [id]);
  res.json({ ok: true });
}));

// =====================================================================
// Aparelhos, Observações e Carregamento
// =====================================================================
app.get('/api/aparelhos', autenticar, exigirPermissao('aparelhos:ler'), rota(async (req, res) => {
  const tipo = String(req.query.tipo || '').trim().toLowerCase();
  const dispRaw = req.query.disponivel;
  const dispParam = dispRaw === '1' || dispRaw === 'true' ? 1 : (dispRaw === '0' || dispRaw === 'false' ? 0 : null);

  // Intervalo opcional para consulta contextual de disponibilidade (padrão: agora até +50 min)
  const inicioSql = normalizarDataHora(req.query.inicio) || agoraLocalSql();
  const fimSql = normalizarDataHora(req.query.fim) || somarMinutosDataHoraLocal(inicioSql, 50);

  const [rows] = await pool.query(
    `SELECT ap.id_aparelho,
            ap.marca_aparelho,
            ap.modelo_aparelho,
            ap.tipo_aparelho,
            ap.numero_aparelho,
            ap.patrimonio,
            ap.observacoes_aparelho,
            ap.disponivel,
            (
              SELECT CONCAT(e.fk_professor, ' (', e.fk_turma, ')')
              FROM especificacao_emprestimos se
              INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
              WHERE se.fk_aparelho_emprestimo = ap.id_aparelho
                AND e.devolucao = 0
              LIMIT 1
            ) AS emprestimo_ativo_info,
            (
              SELECT CONCAT(COALESCE(r.fk_professor, r.fk_usuario), ' • ', TIME_FORMAT(r.inicio_reserva, '%H:%i'), '–', TIME_FORMAT(r.fim_reserva, '%H:%i'))
              FROM especificacao_reservas er
              INNER JOIN reservas r ON r.id_reserva = er.fk_reserva
              WHERE er.fk_aparelho = ap.id_aparelho
                AND er.status_item = 'ativo'
                AND r.status_reserva = 'ativa'
                AND r.inicio_reserva < ?
                AND r.fim_reserva > ?
              ORDER BY r.inicio_reserva ASC
              LIMIT 1
            ) AS reserva_periodo_info
     FROM aparelhos ap
     WHERE (? = '' OR ap.tipo_aparelho = ?)
     ORDER BY ap.tipo_aparelho, ap.numero_aparelho`,
    [fimSql, inicioSql, tipo, tipo]
  );

  const hfConflitos = await consultarHorariosFixosConflitantes(pool, inicioSql, fimSql);
  const mapaHf = new Map();
  for (const hf of hfConflitos) {
    const idAp = Number(hf.fk_aparelho);
    if (!mapaHf.has(idAp)) {
      mapaHf.set(idAp, `${hf.fk_professor} (${hf.fk_turma}) • ${String(hf.hora_inicio).slice(0, 5)}–${String(hf.hora_fim).slice(0, 5)}`);
    }
  }

  let lista = rows.map((ap) => {
    const idAp = Number(ap.id_aparelho);
    const hfInfo = mapaHf.get(idAp) || null;
    let situacao = 'Disponível';
    let motivoIndisponivel = '';

    if (ap.emprestimo_ativo_info) {
      situacao = 'Emprestado';
      motivoIndisponivel = `Emprestado para ${ap.emprestimo_ativo_info}`;
    } else if (!Number(ap.disponivel)) {
      situacao = 'Manutenção';
      motivoIndisponivel = 'Indisponível / Manutenção';
    } else if (ap.reserva_periodo_info) {
      situacao = 'Reservado';
      motivoIndisponivel = `Reservado: ${ap.reserva_periodo_info}`;
    } else if (hfInfo) {
      situacao = 'Horário Fixo';
      motivoIndisponivel = `Horário Fixo: ${hfInfo}`;
    }

    return {
      ...ap,
      situacao,
      motivo_indisponivel: motivoIndisponivel,
      horario_fixo_info: hfInfo
    };
  });

  if (dispParam === 1) {
    lista = lista.filter((item) => item.situacao === 'Disponível');
  } else if (dispParam === 0) {
    lista = lista.filter((item) => item.situacao !== 'Disponível');
  }

  res.json(lista);
}));

app.get('/api/aparelhos/:id', autenticar, exigirPermissao('aparelhos:ler'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de aparelho inválido.');
  const [procRes] = await pool.query('CALL sp_aparelho_buscar(?)', [id]);
  const rows = procRes[0] || [];
  if (!rows.length) falha('Aparelho não encontrado.', 404);
  res.json(rows[0]);
}));

app.post('/api/aparelhos', autenticar, exigirPermissao('aparelhos:criar'), rota(async (req, res) => {
  const marca = String(req.body?.marca || '').trim().toLowerCase();
  const modelo = String(req.body?.modelo || '').trim();
  const tipo = String(req.body?.tipo || '').trim().toLowerCase();
  const numero = Number(req.body?.numero);
  const patrimonio = Number(req.body?.patrimonio);
  const observacoes = String(req.body?.observacoes || 'nenhuma').trim() || 'nenhuma';
  const disponivel = req.body?.disponivel ? 1 : 0;

  if (!MARCAS_VALIDAS.has(marca)) falha('Marca inválida.');
  if (!TIPOS_VALIDOS.has(tipo)) falha('Tipo inválido.');
  if (!modelo || modelo.length > 45) falha('Modelo obrigatório (até 45 caracteres).');
  if (!Number.isInteger(numero) || numero < 0) falha('Número do aparelho inválido.');
  if (!Number.isInteger(patrimonio) || patrimonio <= 0) falha('Número de patrimônio inválido.');

  await pool.query('CALL sp_aparelho_criar(?, ?, ?, ?, ?, ?, ?)', [
    marca, modelo, tipo, numero, patrimonio, observacoes.slice(0, 304), disponivel
  ]);
  res.status(201).json({ ok: true });
}));

app.put('/api/aparelhos/:id', autenticar, exigirPermissao('aparelhos:editar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de aparelho inválido.');

  const marca = String(req.body?.marca || '').trim().toLowerCase();
  const modelo = String(req.body?.modelo || '').trim();
  const tipo = String(req.body?.tipo || '').trim().toLowerCase();
  const numero = Number(req.body?.numero);
  const patrimonio = Number(req.body?.patrimonio);
  const observacoes = String(req.body?.observacoes || 'nenhuma').trim() || 'nenhuma';
  const disponivel = req.body?.disponivel ? 1 : 0;

  if (!MARCAS_VALIDAS.has(marca)) falha('Marca inválida.');
  if (!TIPOS_VALIDOS.has(tipo)) falha('Tipo inválido.');
  if (!modelo || modelo.length > 45) falha('Modelo obrigatório (até 45 caracteres).');
  if (!Number.isInteger(numero) || numero < 0) falha('Número do aparelho inválido.');
  if (!Number.isInteger(patrimonio) || patrimonio <= 0) falha('Número de patrimônio inválido.');

  await pool.query('CALL sp_aparelho_atualizar(?, ?, ?, ?, ?, ?, ?, ?)', [
    id, marca, modelo, tipo, numero, patrimonio, observacoes.slice(0, 304), disponivel
  ]);
  res.json({ ok: true });
}));

// Rota específica para Aluno Monitor e Gestor atualizarem apenas observações do aparelho
app.patch('/api/aparelhos/:id/observacoes', autenticar, exigirPermissao('aparelhos:editar_obs'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de aparelho inválido.');
  const observacoes = String(req.body?.observacoes || 'nenhuma').trim().slice(0, 304) || 'nenhuma';

  const [result] = await pool.query(
    'UPDATE aparelhos SET observacoes_aparelho = ? WHERE id_aparelho = ?',
    [observacoes, id]
  );
  if (!result.affectedRows) falha('Aparelho não encontrado.', 404);
  res.json({ ok: true });
}));

app.delete('/api/aparelhos/:id', autenticar, exigirPermissao('aparelhos:excluir'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de aparelho inválido.');
  await pool.query('CALL sp_aparelho_excluir(?)', [id]);
  res.json({ ok: true });
}));

app.get('/api/carregamentos', autenticar, exigirPermissao('aparelhos:ler'), rota(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT ap.id_aparelho,
           ap.tipo_aparelho,
           ap.marca_aparelho,
           ap.modelo_aparelho,
           ap.numero_aparelho,
           ap.patrimonio,
           c.ultima_recarga,
           CASE
             WHEN c.id_carregamento IS NULL THEN 'Sem registro'
             WHEN c.carregando = 1 THEN 'Carregando'
             ELSE 'Fora da tomada'
           END AS estado_carregamento
    FROM aparelhos ap
    LEFT JOIN carregamentos c
      ON c.id_carregamento = (
        SELECT MAX(c2.id_carregamento)
        FROM carregamentos c2
        WHERE c2.fk_aparelho_carregado = ap.id_aparelho
      )
    ORDER BY ap.tipo_aparelho, ap.numero_aparelho
  `);
  res.json(rows);
}));

app.post('/api/carregamentos/:id', autenticar, exigirPermissao('carregamentos:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de aparelho inválido.');
  const carregando = req.body?.carregando ? 1 : 0;

  const [ap] = await pool.query('SELECT id_aparelho FROM aparelhos WHERE id_aparelho = ? LIMIT 1', [id]);
  if (!ap.length) falha('Aparelho não encontrado.', 404);

  await pool.query(
    'INSERT INTO carregamentos (fk_aparelho_carregado, ultima_recarga, carregando) VALUES (?, NOW(), ?)',
    [id, carregando]
  );
  res.json({ ok: true });
}));

// =====================================================================
// Empréstimos (com verificação real de intervalo e Horários Fixos)
// =====================================================================
app.get('/api/emprestimos', autenticar, exigirPermissao('emprestimos:ler'), rota(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT e.id_emprestimo,
           e.data_emprestimo,
           e.hora_inicio,
           e.hora_fim_prevista,
           e.devolvido_em,
           e.fk_horario_fixo,
           u.nome_usuario AS registrado_por,
           u.cargo_usuario AS cargo,
           p.nome_professor AS professor,
           p.disciplina_professor AS disciplina,
           t.nome_turma AS turma,
           t.sala,
           e.aparelho_emprestado AS tipo_aparelho,
           e.quantidade_emprestada AS quantidade,
           e.devolucao,
           GROUP_CONCAT(CONCAT('#', ap.numero_aparelho) ORDER BY ap.numero_aparelho SEPARATOR ', ') AS aparelhos_numeros
    FROM emprestimos e
    INNER JOIN usuarios u ON u.nome_usuario = e.fk_usuario
    INNER JOIN professores p ON p.nome_professor = e.fk_professor
    INNER JOIN turmas t ON t.nome_turma = e.fk_turma
    LEFT JOIN especificacao_emprestimos se ON se.fk_emprestimo = e.id_emprestimo
    LEFT JOIN aparelhos ap ON ap.id_aparelho = se.fk_aparelho_emprestimo
    GROUP BY e.id_emprestimo
    ORDER BY COALESCE(e.hora_inicio, CONCAT(e.data_emprestimo, ' 00:00:00')) DESC, e.id_emprestimo DESC
  `);
  res.json(rows);
}));

// Consulta aparelhos disponíveis para empréstimo em um intervalo real (ex: agora até fim da aula)
app.get('/api/emprestimos/disponibilidade', autenticar, exigirPermissao('emprestimos:ler'), rota(async (req, res) => {
  const tipo = String(req.query.tipo || '').trim().toLowerCase();
  const professor = String(req.query.professor || '').trim();
  const turma = String(req.query.turma || '').trim();
  const inicioSql = normalizarDataHora(req.query.inicio) || agoraLocalSql();
  const fimSql = normalizarDataHora(req.query.fim) || somarMinutosDataHoraLocal(inicioSql, 50);

  if (inicioSql >= fimSql) falha('O horário previsto de devolução deve ser posterior ao início.');

  const [aparelhos] = await pool.query(
    `SELECT ap.id_aparelho,
            ap.tipo_aparelho,
            ap.marca_aparelho,
            ap.modelo_aparelho,
            ap.numero_aparelho,
            ap.patrimonio,
            ap.disponivel,
            (
              SELECT CONCAT(e.fk_professor, ' (', e.fk_turma, ')')
              FROM especificacao_emprestimos se
              INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
              WHERE se.fk_aparelho_emprestimo = ap.id_aparelho AND e.devolucao = 0
              LIMIT 1
            ) AS emprestimo_aberto,
            (
              SELECT CONCAT(COALESCE(r.fk_professor, r.fk_usuario), ' • ', TIME_FORMAT(r.inicio_reserva, '%H:%i'), ' às ', TIME_FORMAT(r.fim_reserva, '%H:%i'))
              FROM especificacao_reservas er
              INNER JOIN reservas r ON r.id_reserva = er.fk_reserva
              WHERE er.fk_aparelho = ap.id_aparelho
                AND er.status_item = 'ativo'
                AND r.status_reserva = 'ativa'
                AND r.inicio_reserva < ?
                AND r.fim_reserva > ?
              ORDER BY r.inicio_reserva ASC
              LIMIT 1
            ) AS reserva_conflitante
     FROM aparelhos ap
     WHERE (? = '' OR ap.tipo_aparelho = ?)
     ORDER BY ap.tipo_aparelho, ap.numero_aparelho`,
    [fimSql, inicioSql, tipo, tipo]
  );

  const hfConflitos = await consultarHorariosFixosConflitantes(pool, inicioSql, fimSql);
  const mapaHf = new Map();
  for (const hf of hfConflitos) {
    mapaHf.set(Number(hf.fk_aparelho), hf);
  }

  const resultado = aparelhos.map((ap) => {
    const id = Number(ap.id_aparelho);
    const hf = mapaHf.get(id);
    let livre = true;
    let motivo = 'Disponível';
    let horarioFixoCompativel = null;

    if (ap.emprestimo_aberto) {
      livre = false;
      motivo = `Emprestado: ${ap.emprestimo_aberto}`;
    } else if (!Number(ap.disponivel)) {
      livre = false;
      motivo = 'Indisponível (manutenção)';
    } else if (ap.reserva_conflitante) {
      livre = false;
      motivo = `Reservado (${ap.reserva_conflitante})`;
    } else if (hf) {
      const mesmoProf =
        professor &&
        hf.fk_professor.toLowerCase() === professor.toLowerCase() &&
        (!turma || hf.fk_turma.toLowerCase() === turma.toLowerCase());
      if (mesmoProf) {
        livre = true;
        motivo = `Horário Fixo do docente (${String(hf.hora_inicio).slice(0, 5)}–${String(hf.hora_fim).slice(0, 5)})`;
        horarioFixoCompativel = Number(hf.id_horario_fixo);
      } else {
        livre = false;
        motivo = `Horário Fixo: ${hf.fk_professor} (${hf.fk_turma}) ${String(hf.hora_inicio).slice(0, 5)}–${String(hf.hora_fim).slice(0, 5)}`;
      }
    }

    return {
      ...ap,
      livre,
      motivo,
      horario_fixo_id: horarioFixoCompativel
    };
  });

  res.json(resultado);
}));

app.post('/api/emprestimos', autenticar, exigirPermissao('emprestimos:criar'), rota(async (req, res) => {
  const professor = String(req.body?.professor || '').trim();
  const turma = String(req.body?.turma || '').trim();
  const tipo = String(req.body?.tipo || '').trim().toLowerCase();
  const inicioSql = normalizarDataHora(req.body?.inicio) || agoraLocalSql();
  const fimSql = normalizarDataHora(req.body?.fim) || somarMinutosDataHoraLocal(inicioSql, 50);
  const ids = [...new Set((Array.isArray(req.body?.aparelhos) ? req.body.aparelhos : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!professor || !turma) falha('Informe o professor e a turma.');
  if (!TIPOS_VALIDOS.has(tipo)) falha('Tipo de aparelho inválido.');
  if (!ids.length) falha('Selecione pelo menos um aparelho.');
  if (inicioSql >= fimSql) falha('O horário previsto de devolução deve ser posterior ao início do empréstimo.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { mapaEquip, horarioFixoCompativel } = await verificarConflitosAparelhos(conn, {
      ids,
      inicioSql,
      fimSql,
      permitirHorarioFixoProfessor: professor,
      permitirHorarioFixoTurma: turma
    });

    for (const id of ids) {
      const ap = mapaEquip.get(id);
      if (ap.tipo_aparelho !== tipo) {
        falha(`O aparelho nº ${ap.numero_aparelho} não pertence ao tipo ${tipo}.`, 409);
      }
    }

    const dataEmprestimo = inicioSql.slice(0, 10);
    const [ins] = await conn.query(
      `INSERT INTO emprestimos
        (fk_usuario, data_emprestimo, hora_inicio, hora_fim_prevista, fk_professor, fk_turma, fk_horario_fixo, aparelho_emprestado, quantidade_emprestada, devolucao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [req.usuario.nome, dataEmprestimo, inicioSql, fimSql, professor, turma, horarioFixoCompativel, tipo, ids.length]
    );

    const idEmprestimo = ins.insertId;
    const valoresSpec = ids.map((idAp) => [idEmprestimo, idAp]);
    await conn.query('INSERT INTO especificacao_emprestimos (fk_emprestimo, fk_aparelho_emprestimo) VALUES ?', [valoresSpec]);
    await conn.query('UPDATE aparelhos SET disponivel = 0 WHERE id_aparelho IN (?)', [ids]);

    await conn.commit();
    res.status(201).json({
      ok: true,
      id_emprestimo: idEmprestimo,
      horario_fixo_vinculado: horarioFixoCompativel
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.post('/api/emprestimos/:id/devolver', autenticar, exigirPermissao('emprestimos:devolver'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de empréstimo inválido.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [emp] = await conn.query('SELECT id_emprestimo, devolucao FROM emprestimos WHERE id_emprestimo = ? FOR UPDATE', [id]);
    if (!emp.length) falha('Empréstimo não encontrado.', 404);
    if (emp[0].devolucao) falha('Este empréstimo já foi devolvido.', 409);

    const agoraSql = agoraLocalSql();
    await conn.query('UPDATE emprestimos SET devolucao = 1, devolvido_em = ? WHERE id_emprestimo = ?', [agoraSql, id]);

    const [specs] = await conn.query('SELECT fk_aparelho_emprestimo FROM especificacao_emprestimos WHERE fk_emprestimo = ?', [id]);
    const idsAp = specs.map((s) => s.fk_aparelho_emprestimo);
    if (idsAp.length) {
      await conn.query('UPDATE aparelhos SET disponivel = 1 WHERE id_aparelho IN (?)', [idsAp]);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// =====================================================================
// Relatórios
// =====================================================================
app.get('/api/relatorios', autenticar, exigirPermissao('relatorios:ler'), rota(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id_relatorio,
           fk_usuario_relatorio AS usuario,
           data_relatorio AS data,
           aparelho_relatorio AS tipo,
           quantidade_relatorio AS quantidade,
           observacoes_relatorio AS observacoes
    FROM relatorios
    ORDER BY data_relatorio DESC, id_relatorio DESC
  `);
  res.json(rows);
}));

app.post('/api/relatorios', autenticar, exigirPermissao('relatorios:criar'), rota(async (req, res) => {
  const tipo = String(req.body?.tipo || '').trim().toLowerCase();
  const quantidade = Number(req.body?.quantidade);
  const observacoes = String(req.body?.observacoes || 'nenhuma').trim() || 'nenhuma';

  if (!TIPOS_VALIDOS.has(tipo)) falha('Tipo de aparelho inválido.');
  if (!Number.isInteger(quantidade) || quantidade < 0) falha('Quantidade inválida.');

  await pool.query(
    `INSERT INTO relatorios (fk_usuario_relatorio, data_relatorio, aparelho_relatorio, quantidade_relatorio, observacoes_relatorio)
     VALUES (?, CURDATE(), ?, ?, ?)`,
    [req.usuario.nome, tipo, quantidade, observacoes.slice(0, 304)]
  );
  res.status(201).json({ ok: true });
}));

// =====================================================================
// Reservas N:N, Expansão e Controle Individual/Geral de Itens
// =====================================================================
app.get('/api/reservas/disponibilidade', autenticar, exigirPermissao('reservas:ler'), rota(async (req, res) => {
  const inicioSql = normalizarDataHora(req.query.inicio);
  const fimSql = normalizarDataHora(req.query.fim);

  if (!inicioSql || !fimSql) falha('Informe datas válidas de início e fim para consulta.');
  if (inicioSql >= fimSql) falha('A data/hora de fim deve ser posterior ao início.');

  const [rows] = await pool.query(`
    SELECT ap.id_aparelho,
           ap.tipo_aparelho,
           ap.marca_aparelho,
           ap.modelo_aparelho,
           ap.numero_aparelho,
           ap.patrimonio,
           ap.disponivel,
           (
             SELECT CONCAT(COALESCE(r.fk_professor, r.fk_usuario), ' (', TIME_FORMAT(r.inicio_reserva, '%H:%i'), '–', TIME_FORMAT(r.fim_reserva, '%H:%i'), ')')
             FROM especificacao_reservas er
             INNER JOIN reservas r ON r.id_reserva = er.fk_reserva
             WHERE er.fk_aparelho = ap.id_aparelho
               AND er.status_item = 'ativo'
               AND r.status_reserva = 'ativa'
               AND r.inicio_reserva < ?
               AND r.fim_reserva > ?
             ORDER BY r.inicio_reserva ASC
             LIMIT 1
           ) AS reserva_info,
           (
             SELECT CONCAT(e.fk_professor, ' (', e.fk_turma, ')')
             FROM especificacao_emprestimos se
             INNER JOIN emprestimos e ON e.id_emprestimo = se.fk_emprestimo
             WHERE se.fk_aparelho_emprestimo = ap.id_aparelho
               AND e.devolucao = 0
               AND COALESCE(e.hora_inicio, CONCAT(e.data_emprestimo, ' 00:00:00')) < ?
               AND COALESCE(e.hora_fim_prevista, DATE_ADD(CONCAT(e.data_emprestimo, ' 23:59:59'), INTERVAL 0 SECOND)) > ?
             LIMIT 1
           ) AS emprestimo_info
    FROM aparelhos ap
    ORDER BY ap.tipo_aparelho, ap.numero_aparelho
  `, [fimSql, inicioSql, fimSql, inicioSql]);

  const hfConflitos = await consultarHorariosFixosConflitantes(pool, inicioSql, fimSql);
  const mapaHf = new Map();
  for (const hf of hfConflitos) {
    const id = Number(hf.fk_aparelho);
    if (!mapaHf.has(id)) {
      mapaHf.set(id, `${hf.fk_professor} • ${hf.fk_turma} (${String(hf.hora_inicio).slice(0, 5)}–${String(hf.hora_fim).slice(0, 5)})`);
    }
  }

  const enriquecidos = rows.map((ap) => {
    const id = Number(ap.id_aparelho);
    const horarioFixoInfo = mapaHf.get(id) || null;
    const emprestado = Boolean(ap.emprestimo_info);
    const reservado = Boolean(ap.reserva_info);
    const horarioFixo = Boolean(horarioFixoInfo);
    const manutencao = !Number(ap.disponivel) && !emprestado;

    return {
      ...ap,
      emprestado: emprestado ? 1 : 0,
      reservado: reservado ? 1 : 0,
      horario_fixo: horarioFixo ? 1 : 0,
      manutencao: manutencao ? 1 : 0,
      horario_fixo_info: horarioFixoInfo
    };
  });

  res.json(enriquecidos);
}));

app.get('/api/reservas', autenticar, exigirPermissao('reservas:ler'), rota(async (req, res) => {
  const agoraSql = agoraLocalSql();
  const [reservas] = await pool.query(`
    SELECT r.id_reserva,
           r.fk_usuario AS usuario,
           r.fk_professor AS professor,
           COALESCE(r.disciplina_snapshot, p.disciplina_professor, '—') AS disciplina,
           r.fk_turma AS turma,
           t.sala,
           r.inicio_reserva,
           r.fim_reserva,
           r.status_reserva,
           r.criado_em
    FROM reservas r
    LEFT JOIN professores p ON p.nome_professor = r.fk_professor
    LEFT JOIN turmas t ON t.nome_turma = r.fk_turma
    ORDER BY r.inicio_reserva DESC, r.id_reserva DESC
  `);

  if (!reservas.length) return res.json([]);

  const idsReservas = reservas.map((r) => Number(r.id_reserva));
  const [itens] = await pool.query(`
    SELECT er.id_especificacao_reserva,
           er.fk_reserva,
           er.fk_aparelho,
           er.status_item,
           ap.tipo_aparelho,
           ap.numero_aparelho,
           ap.marca_aparelho,
           ap.modelo_aparelho,
           ap.patrimonio
    FROM especificacao_reservas er
    INNER JOIN aparelhos ap ON ap.id_aparelho = er.fk_aparelho
    WHERE er.fk_reserva IN (?)
    ORDER BY ap.tipo_aparelho, ap.numero_aparelho
  `, [idsReservas]);

  const mapaItens = new Map();
  for (const item of itens) {
    const idR = Number(item.fk_reserva);
    if (!mapaItens.has(idR)) mapaItens.set(idR, []);
    mapaItens.get(idR).push(item);
  }

  const resposta = reservas.map((r) => {
    const listaItens = mapaItens.get(Number(r.id_reserva)) || [];
    let estadoTemporal = r.status_reserva;
    if (r.status_reserva === 'ativa') {
      if (r.inicio_reserva <= agoraSql && r.fim_reserva > agoraSql) {
        estadoTemporal = 'em_andamento';
      } else if (r.inicio_reserva > agoraSql) {
        estadoTemporal = 'futura';
      } else {
        estadoTemporal = 'ativa_pendente';
      }
    }

    return {
      ...r,
      estado_temporal: estadoTemporal,
      total_itens: listaItens.length,
      itens_ativos: listaItens.filter((i) => i.status_item === 'ativo').length,
      itens_concluidos: listaItens.filter((i) => i.status_item === 'concluido').length,
      itens_cancelados: listaItens.filter((i) => i.status_item === 'cancelado').length,
      itens: listaItens
    };
  });

  res.json(resposta);
}));

app.post('/api/reservas', autenticar, exigirPermissao('reservas:criar'), rota(async (req, res) => {
  const professor = String(req.body?.professor || '').trim();
  const turma = String(req.body?.turma || '').trim();
  const inicioSql = normalizarDataHora(req.body?.inicio);
  const fimSql = normalizarDataHora(req.body?.fim);
  const ids = [...new Set((Array.isArray(req.body?.aparelhos) ? req.body.aparelhos : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!professor) falha('Selecione o professor responsável pela reserva.');
  if (!turma) falha('Selecione a turma que utilizará os equipamentos.');
  if (!inicioSql || !fimSql) falha('Informe datas válidas para início e fim da reserva.');
  if (inicioSql >= fimSql) falha('O término da reserva deve ser posterior ao início.');
  if (!ids.length) falha('Selecione pelo menos um aparelho disponível.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [profRows] = await conn.query(
      'SELECT nome_professor, disciplina_professor FROM professores WHERE nome_professor = ? LIMIT 1',
      [professor]
    );
    if (!profRows.length) falha('Professor selecionado não encontrado.', 404);

    const [turmaRows] = await conn.query(
      'SELECT nome_turma FROM turmas WHERE nome_turma = ? LIMIT 1',
      [turma]
    );
    if (!turmaRows.length) falha('Turma selecionada não encontrada.', 404);

    await verificarConflitosAparelhos(conn, {
      ids,
      inicioSql,
      fimSql
    });

    const [ins] = await conn.query(
      `INSERT INTO reservas (fk_usuario, fk_professor, disciplina_snapshot, fk_turma, inicio_reserva, fim_reserva, status_reserva)
       VALUES (?, ?, ?, ?, ?, ?, 'ativa')`,
      [req.usuario.nome, profRows[0].nome_professor, profRows[0].disciplina_professor, turmaRows[0].nome_turma, inicioSql, fimSql]
    );

    const idReserva = ins.insertId;
    const linhasItens = ids.map((idAp) => [idReserva, idAp, 'ativo']);
    await conn.query(
      'INSERT INTO especificacao_reservas (fk_reserva, fk_aparelho, status_item) VALUES ?',
      [linhasItens]
    );

    await conn.commit();
    res.status(201).json({ ok: true, id_reserva: idReserva, total: ids.length });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Sincroniza status geral da reserva a partir do status individual de seus aparelhos
async function recalcularStatusGeralReserva(conn, idReserva) {
  const [itens] = await conn.query(
    'SELECT status_item FROM especificacao_reservas WHERE fk_reserva = ? FOR UPDATE',
    [idReserva]
  );
  if (!itens.length) return;

  const temAtivo = itens.some((i) => i.status_item === 'ativo');
  if (temAtivo) {
    await conn.query("UPDATE reservas SET status_reserva = 'ativa' WHERE id_reserva = ?", [idReserva]);
    return;
  }

  const temConcluido = itens.some((i) => i.status_item === 'concluido');
  const novoStatus = temConcluido ? 'concluida' : 'cancelada';
  await conn.query('UPDATE reservas SET status_reserva = ? WHERE id_reserva = ?', [novoStatus, idReserva]);
}

// Concluir ou cancelar um aparelho INDIVIDUAL dentro da reserva
app.patch('/api/reservas/:id/itens/:idAparelho', autenticar, exigirPermissao('reservas:gerenciar_status', 'reservas:cancelar_propria'), rota(async (req, res) => {
  const idReserva = Number(req.params.id);
  const idAparelho = Number(req.params.idAparelho);
  const acao = String(req.body?.acao || '').trim().toLowerCase();

  if (!Number.isInteger(idReserva) || idReserva <= 0) falha('ID de reserva inválido.');
  if (!Number.isInteger(idAparelho) || idAparelho <= 0) falha('ID de aparelho inválido.');
  if (acao !== 'concluir' && acao !== 'cancelar') falha('Ação inválida. Use concluir ou cancelar.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [resRows] = await conn.query(
      'SELECT id_reserva, fk_usuario, status_reserva FROM reservas WHERE id_reserva = ? FOR UPDATE',
      [idReserva]
    );
    if (!resRows.length) falha('Reserva não encontrada.', 404);

    // Verifica permissão por cargo:
    // Gestor e Aluno Monitor têm `reservas:gerenciar_status` (podem concluir e cancelar).
    // Professor possui apenas `reservas:cancelar_propria` (só pode cancelar sua própria reserva).
    const podeGerenciarTodos = temPermissao(req.usuario.cargo, 'reservas:gerenciar_status');
    if (!podeGerenciarTodos) {
      if (acao !== 'cancelar' || resRows[0].fk_usuario !== req.usuario.nome) {
        falha('Professores só podem cancelar itens de suas próprias reservas.', 403);
      }
    }

    const [itemRows] = await conn.query(
      'SELECT id_especificacao_reserva, status_item FROM especificacao_reservas WHERE fk_reserva = ? AND fk_aparelho = ? FOR UPDATE',
      [idReserva, idAparelho]
    );
    if (!itemRows.length) falha('Aparelho não encontrado nesta reserva.', 404);
    if (itemRows[0].status_item !== 'ativo') {
      falha(`Este aparelho já está marcado como ${itemRows[0].status_item} e não pode ser alterado.`, 409);
    }

    const novoStatusItem = acao === 'concluir' ? 'concluido' : 'cancelado';
    await conn.query(
      'UPDATE especificacao_reservas SET status_item = ? WHERE id_especificacao_reserva = ?',
      [novoStatusItem, itemRows[0].id_especificacao_reserva]
    );

    await recalcularStatusGeralReserva(conn, idReserva);

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Concluir reserva inteira (somente itens ainda ativos; não reativa itens já cancelados)
app.post('/api/reservas/:id/concluir', autenticar, exigirPermissao('reservas:gerenciar_status'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de reserva inválido.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.query(
      'SELECT id_reserva, status_reserva FROM reservas WHERE id_reserva = ? FOR UPDATE',
      [id]
    );
    if (!r.length) falha('Reserva não encontrada.', 404);
    if (r[0].status_reserva !== 'ativa') falha('Esta reserva já está finalizada.', 409);

    await conn.query(
      "UPDATE especificacao_reservas SET status_item = 'concluido' WHERE fk_reserva = ? AND status_item = 'ativo'",
      [id]
    );
    await conn.query("UPDATE reservas SET status_reserva = 'concluida' WHERE id_reserva = ?", [id]);

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Cancelar reserva inteira (somente itens ainda ativos; não altera itens já concluídos)
app.post('/api/reservas/:id/cancelar', autenticar, exigirPermissao('reservas:gerenciar_status', 'reservas:cancelar_propria'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de reserva inválido.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.query(
      'SELECT id_reserva, fk_usuario, status_reserva FROM reservas WHERE id_reserva = ? FOR UPDATE',
      [id]
    );
    if (!r.length) falha('Reserva não encontrada.', 404);
    if (r[0].status_reserva !== 'ativa') falha('Esta reserva já não está ativa.', 409);

    const podeGerenciarTodos = temPermissao(req.usuario.cargo, 'reservas:gerenciar_status');
    if (!podeGerenciarTodos && r[0].fk_usuario !== req.usuario.nome) {
      falha('Você só pode cancelar suas próprias reservas.', 403);
    }

    await conn.query(
      "UPDATE especificacao_reservas SET status_item = 'cancelado' WHERE fk_reserva = ? AND status_item = 'ativo'",
      [id]
    );

    await recalcularStatusGeralReserva(conn, id);

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// =====================================================================
// Sistema de Horários Fixos (Reservas Recorrentes Semanais)
// =====================================================================
app.get('/api/horarios-fixos', autenticar, exigirPermissao('horarios_fixos:ler'), rota(async (req, res) => {
  const [horarios] = await pool.query(`
    SELECT hf.id_horario_fixo,
           hf.dia_semana,
           hf.hora_inicio,
           hf.hora_fim,
           hf.fk_professor AS professor,
           hf.disciplina,
           hf.fk_turma AS turma,
           t.sala,
           hf.fk_usuario_criador AS criado_por,
           hf.status_horario,
           hf.criado_em,
           (
             SELECT COUNT(*)
             FROM emprestimos e
             WHERE e.fk_horario_fixo = hf.id_horario_fixo
           ) AS total_utilizacoes
    FROM horarios_fixos hf
    LEFT JOIN turmas t ON t.nome_turma = hf.fk_turma
    ORDER BY hf.status_horario ASC, hf.dia_semana ASC, hf.hora_inicio ASC
  `);

  if (!horarios.length) return res.json([]);

  const ids = horarios.map((h) => Number(h.id_horario_fixo));
  const [itens] = await pool.query(`
    SELECT ehf.fk_horario_fixo,
           ap.id_aparelho,
           ap.tipo_aparelho,
           ap.numero_aparelho,
           ap.marca_aparelho,
           ap.modelo_aparelho
    FROM especificacao_horarios_fixos ehf
    INNER JOIN aparelhos ap ON ap.id_aparelho = ehf.fk_aparelho
    WHERE ehf.fk_horario_fixo IN (?)
    ORDER BY ap.tipo_aparelho, ap.numero_aparelho
  `, [ids]);

  const mapa = new Map();
  for (const item of itens) {
    const idH = Number(item.fk_horario_fixo);
    if (!mapa.has(idH)) mapa.set(idH, []);
    mapa.get(idH).push(item);
  }

  res.json(
    horarios.map((h) => ({
      ...h,
      aparelhos: mapa.get(Number(h.id_horario_fixo)) || []
    }))
  );
}));

app.post('/api/horarios-fixos', autenticar, exigirPermissao('horarios_fixos:gerenciar'), rota(async (req, res) => {
  const diasRaw = Array.isArray(req.body?.dias_semana)
    ? req.body.dias_semana
    : (req.body?.dia_semana !== undefined ? [req.body.dia_semana] : []);
  const dias = [...new Set(diasRaw.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

  const horaInicio = normalizarHora(req.body?.hora_inicio);
  const horaFim = normalizarHora(req.body?.hora_fim);
  const professor = String(req.body?.professor || '').trim();
  const disciplina = String(req.body?.disciplina || '').trim();
  const turma = String(req.body?.turma || '').trim();
  const ids = [...new Set((Array.isArray(req.body?.aparelhos) ? req.body.aparelhos : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!dias.length) falha('Selecione pelo menos um dia da semana.');
  if (!horaInicio || !horaFim) falha('Informe horários válidos de início e término.');
  if (horaInicio >= horaFim) falha('O horário de término deve ser posterior ao início.');
  if (!professor || !turma) falha('Selecione o professor e a turma.');
  if (!ids.length) falha('Selecione pelo menos um equipamento para o horário fixo.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [profRows] = await conn.query(
      'SELECT nome_professor, disciplina_professor FROM professores WHERE nome_professor = ? LIMIT 1',
      [professor]
    );
    if (!profRows.length) falha('Professor não encontrado.', 404);
    const disciplinaFinal = disciplina || profRows[0].disciplina_professor;

    const [turmaRows] = await conn.query('SELECT nome_turma FROM turmas WHERE nome_turma = ? LIMIT 1', [turma]);
    if (!turmaRows.length) falha('Turma não encontrada.', 404);

    const [equip] = await conn.query(
      'SELECT id_aparelho, tipo_aparelho, numero_aparelho FROM aparelhos WHERE id_aparelho IN (?) FOR UPDATE',
      [ids]
    );
    if (equip.length !== ids.length) falha('Um ou mais aparelhos selecionados não existem.', 404);
    const mapaEquip = new Map(equip.map((a) => [Number(a.id_aparelho), a]));

    const nomesDias = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

    for (const dia of dias) {
      // 1. Verifica conflito com outro horário fixo ativo
      const [hfConflitos] = await conn.query(
        `SELECT hf.id_horario_fixo, hf.fk_professor, hf.fk_turma, hf.hora_inicio, hf.hora_fim, ehf.fk_aparelho
         FROM horarios_fixos hf
         INNER JOIN especificacao_horarios_fixos ehf ON ehf.fk_horario_fixo = hf.id_horario_fixo
         WHERE hf.status_horario = 'ativo'
           AND hf.dia_semana = ?
           AND hf.hora_inicio < ?
           AND hf.hora_fim > ?
           AND ehf.fk_aparelho IN (?)
         LIMIT 1`,
        [dia, horaFim, horaInicio, ids]
      );

      if (hfConflitos.length) {
        const c = hfConflitos[0];
        const ap = mapaEquip.get(Number(c.fk_aparelho));
        falha(
          `Conflito na ${nomesDias[dia]}: ${ap.tipo_aparelho} nº ${ap.numero_aparelho} já possui horário fixo (${c.fk_professor} • ${c.fk_turma}, ${String(c.hora_inicio).slice(0, 5)}–${String(c.hora_fim).slice(0, 5)}).`,
          409
        );
      }

      // 2. Verifica conflito com reservas ativas futuras nesse dia da semana e horário
      const [resConflitos] = await conn.query(
        `SELECT r.id_reserva, r.inicio_reserva, r.fim_reserva, er.fk_aparelho
         FROM reservas r
         INNER JOIN especificacao_reservas er ON er.fk_reserva = r.id_reserva
         WHERE r.status_reserva = 'ativa'
           AND er.status_item = 'ativo'
           AND r.fim_reserva > NOW()
           AND WEEKDAY(r.inicio_reserva) = ?
           AND TIME(r.inicio_reserva) < ?
           AND TIME(r.fim_reserva) > ?
           AND er.fk_aparelho IN (?)
         LIMIT 1`,
        [dia, horaFim, horaInicio, ids]
      );

      if (resConflitos.length) {
        const c = resConflitos[0];
        const ap = mapaEquip.get(Number(c.fk_aparelho));
        falha(
          `Conflito na ${nomesDias[dia]}: ${ap.tipo_aparelho} nº ${ap.numero_aparelho} possui reserva comum ativa em ${c.inicio_reserva}.`,
          409
        );
      }

      const [ins] = await conn.query(
        `INSERT INTO horarios_fixos (dia_semana, hora_inicio, hora_fim, fk_professor, disciplina, fk_turma, fk_usuario_criador, status_horario)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo')`,
        [dia, horaInicio, horaFim, professor, disciplinaFinal, turma, req.usuario.nome]
      );

      const idHf = ins.insertId;
      const linhas = ids.map((idAp) => [idHf, idAp]);
      await conn.query('INSERT INTO especificacao_horarios_fixos (fk_horario_fixo, fk_aparelho) VALUES ?', [linhas]);
    }

    await conn.commit();
    res.status(201).json({ ok: true, criados: dias.length });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.put('/api/horarios-fixos/:id', autenticar, exigirPermissao('horarios_fixos:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de horário fixo inválido.');

  const dia = Number(req.body?.dia_semana);
  const horaInicio = normalizarHora(req.body?.hora_inicio);
  const horaFim = normalizarHora(req.body?.hora_fim);
  const professor = String(req.body?.professor || '').trim();
  const disciplina = String(req.body?.disciplina || '').trim();
  const turma = String(req.body?.turma || '').trim();
  const ids = [...new Set((Array.isArray(req.body?.aparelhos) ? req.body.aparelhos : []).map(Number))]
    .filter((apId) => Number.isInteger(apId) && apId > 0);

  if (!Number.isInteger(dia) || dia < 0 || dia > 6) falha('Dia da semana inválido.');
  if (!horaInicio || !horaFim || horaInicio >= horaFim) falha('Intervalo de horário inválido.');
  if (!professor || !turma) falha('Informe professor e turma.');
  if (!ids.length) falha('Selecione pelo menos um aparelho.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [atual] = await conn.query('SELECT id_horario_fixo, status_horario FROM horarios_fixos WHERE id_horario_fixo = ? FOR UPDATE', [id]);
    if (!atual.length) falha('Horário fixo não encontrado.', 404);

    const [profRows] = await conn.query('SELECT disciplina_professor FROM professores WHERE nome_professor = ? LIMIT 1', [professor]);
    if (!profRows.length) falha('Professor não encontrado.', 404);
    const disciplinaFinal = disciplina || profRows[0].disciplina_professor;

    const [equip] = await conn.query('SELECT id_aparelho, tipo_aparelho, numero_aparelho FROM aparelhos WHERE id_aparelho IN (?) FOR UPDATE', [ids]);
    if (equip.length !== ids.length) falha('Um ou mais aparelhos não foram encontrados.', 404);
    const mapaEquip = new Map(equip.map((a) => [Number(a.id_aparelho), a]));

    const [hfConflitos] = await conn.query(
      `SELECT hf.fk_professor, hf.fk_turma, ehf.fk_aparelho
       FROM horarios_fixos hf
       INNER JOIN especificacao_horarios_fixos ehf ON ehf.fk_horario_fixo = hf.id_horario_fixo
       WHERE hf.status_horario = 'ativo'
         AND hf.id_horario_fixo <> ?
         AND hf.dia_semana = ?
         AND hf.hora_inicio < ?
         AND hf.hora_fim > ?
         AND ehf.fk_aparelho IN (?)
       LIMIT 1`,
      [id, dia, horaFim, horaInicio, ids]
    );

    if (hfConflitos.length) {
      const c = hfConflitos[0];
      const ap = mapaEquip.get(Number(c.fk_aparelho));
      falha(`Conflito com outro horário fixo no aparelho ${ap.tipo_aparelho} nº ${ap.numero_aparelho} (${c.fk_professor} • ${c.fk_turma}).`, 409);
    }

    await conn.query(
      `UPDATE horarios_fixos
       SET dia_semana = ?, hora_inicio = ?, hora_fim = ?, fk_professor = ?, disciplina = ?, fk_turma = ?
       WHERE id_horario_fixo = ?`,
      [dia, horaInicio, horaFim, professor, disciplinaFinal, turma, id]
    );

    await conn.query('DELETE FROM especificacao_horarios_fixos WHERE fk_horario_fixo = ?', [id]);
    const linhas = ids.map((idAp) => [id, idAp]);
    await conn.query('INSERT INTO especificacao_horarios_fixos (fk_horario_fixo, fk_aparelho) VALUES ?', [linhas]);

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.post('/api/horarios-fixos/:id/cancelar', autenticar, exigirPermissao('horarios_fixos:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de horário fixo inválido.');

  const [result] = await pool.query(
    "UPDATE horarios_fixos SET status_horario = 'cancelado' WHERE id_horario_fixo = ? AND status_horario = 'ativo'",
    [id]
  );
  if (!result.affectedRows) falha('Horário fixo não encontrado ou já cancelado.', 404);
  res.json({ ok: true });
}));

// =====================================================================
// Usuários (Somente Gestor)
// =====================================================================
app.get('/api/usuarios', autenticar, exigirPermissao('usuarios:gerenciar'), rota(async (req, res) => {
  const [rows] = await pool.query('SELECT id_usuario, nome_usuario, cargo_usuario FROM usuarios ORDER BY nome_usuario');
  res.json(rows);
}));

app.post('/api/usuarios', autenticar, exigirPermissao('usuarios:gerenciar'), rota(async (req, res) => {
  const nome = String(req.body?.nome || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const cargo = String(req.body?.cargo || '').trim().toLowerCase();

  if (nome.length < 3 || nome.length > 99) falha('O nome de usuário deve ter entre 3 e 99 caracteres.');
  if (senha.length < 4 || senha.length > 30) falha('A senha deve ter entre 4 e 30 caracteres.');
  if (!CARGOS_VALIDOS.has(cargo)) falha('Cargo inválido.');

  const [existe] = await pool.query('SELECT id_usuario FROM usuarios WHERE LOWER(nome_usuario) = ? LIMIT 1', [nome]);
  if (existe.length) falha('Já existe um usuário com este nome.', 409);

  await pool.query('INSERT INTO usuarios (nome_usuario, senha_usuario, cargo_usuario) VALUES (?, ?, ?)', [nome, senha, cargo]);
  res.status(201).json({ ok: true });
}));

app.put('/api/usuarios/:id', autenticar, exigirPermissao('usuarios:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de usuário inválido.');

  const [atualRows] = await pool.query('SELECT id_usuario, nome_usuario, cargo_usuario FROM usuarios WHERE id_usuario = ? LIMIT 1', [id]);
  if (!atualRows.length) falha('Usuário não encontrado.', 404);
  const atual = atualRows[0];

  if (req.body?.cargo !== undefined) {
    const novoCargo = String(req.body.cargo).trim().toLowerCase();
    if (!CARGOS_VALIDOS.has(novoCargo)) falha('Cargo inválido.');

    if (atual.cargo_usuario === GESTOR && novoCargo !== GESTOR) {
      const [[{ totalGestores }]] = await pool.query("SELECT COUNT(*) AS totalGestores FROM usuarios WHERE cargo_usuario = 'gestor'");
      if (Number(totalGestores) <= 1) falha('Não é possível remover o último gestor do sistema.', 409);
    }

    await pool.query('UPDATE usuarios SET cargo_usuario = ? WHERE id_usuario = ?', [novoCargo, id]);
    await pool.query('UPDATE sessoes_ativas SET cargo_usuario = ? WHERE id_usuario = ?', [novoCargo, id]);
    for (const s of sessoes.values()) {
      if (Number(s.id) === id) s.cargo = novoCargo;
    }
  }

  if (req.body?.senha !== undefined) {
    const novaSenha = String(req.body.senha);
    if (novaSenha.length < 4 || novaSenha.length > 30) falha('A senha deve ter entre 4 e 30 caracteres.');
    await pool.query('UPDATE usuarios SET senha_usuario = ? WHERE id_usuario = ?', [novaSenha, id]);
  }

  res.json({ ok: true });
}));

app.delete('/api/usuarios/:id', autenticar, exigirPermissao('usuarios:gerenciar'), rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) falha('ID de usuário inválido.');
  if (id === Number(req.usuario.id)) falha('Você não pode excluir sua própria conta enquanto está logado.', 409);

  await pool.query('DELETE FROM sessoes_ativas WHERE id_usuario = ?', [id]);
  for (const [k, s] of sessoes.entries()) {
    if (Number(s.id) === id) sessoes.delete(k);
  }

  await pool.query('DELETE FROM usuarios WHERE id_usuario = ?', [id]);
  res.json({ ok: true });
}));

// =====================================================================
// Tratamento Global de Erros
// =====================================================================
app.use((err, req, res, next) => {
  if (err && err.sqlMessage) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ erro: 'Este registro possui histórico vinculado e não pode ser excluído.' });
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Registro duplicado no banco de dados.' });
    }
    return res.status(400).json({ erro: err.sqlMessage });
  }
  const status = err?.status || 500;
  return res.status(status).json({ erro: err?.message || 'Erro interno no servidor.' });
});

setInterval(() => {
  const agora = Date.now();
  for (const [k, s] of sessoes.entries()) {
    if (s.expira <= agora) sessoes.delete(k);
  }
  pool.query('DELETE FROM sessoes_ativas WHERE expira_em < ?', [agora]).catch(() => {});
}, 1000 * 60 * 15).unref();

inicializarBanco()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor Flecha Automações rodando em http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao inicializar estrutura do banco MySQL:', err.message);
    app.listen(PORT, () => {
      console.log(`Servidor iniciado em http://localhost:${PORT} (verifique a conexão com o MySQL)`);
    });
  });