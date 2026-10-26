// Servidor do site CCM — integra o site ao banco MySQL "flecha".
// Sessões ficam SÓ na memória do servidor (nada é gravado no navegador).
const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const path = require('path');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'Flecha',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- sessões em memória ----------
const sessoes = new Map(); // token -> { id, nome, cargo, expira }
const DURACAO = 1000 * 60 * 60 * 4; // 4 horas

function autenticar(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const s = sessoes.get(token);
  if (!s || s.expira < Date.now()) {
    sessoes.delete(token);
    return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  }
  s.expira = Date.now() + DURACAO;
  req.usuario = s;
  req.token = token;
  next();
}
const permitir = (...cargos) => (req, res, next) =>
  cargos.includes(req.usuario.cargo) ? next() : res.status(403).json({ erro: 'Seu cargo não tem permissão para isso.' });

const GESTOR = 'gestor', PROF = 'professor', MON = 'aluno monitor';
const TIPOS = ['notebook', 'chromebook', 'notebook ds', 'celular', 'tablet'];
const CARGOS = [MON, PROF, GESTOR];

const rota = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.sqlState === '45000') return res.status(400).json({ erro: e.sqlMessage });
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um registro com esses dados.' });
    if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ erro: 'Este registro possui histórico e não pode ser excluído.' });
    if (e.erroUsuario) return res.status(e.status || 400).json({ erro: e.erroUsuario });
    console.error(e);
    res.status(500).json({ erro: 'Erro no servidor ou no banco de dados.' });
  }
};
const falha = (msg, status = 400) => { const e = new Error(msg); e.erroUsuario = msg; e.status = status; throw e; };

// ---------- login / cadastro ----------
app.post('/api/login', rota(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) falha('Preencha todos os campos.');
  const [r] = await pool.query(
    'SELECT id_usuario, nome_usuario, cargo_usuario FROM usuarios WHERE nome_usuario = ? AND senha_usuario = ?',
    [String(username).trim(), String(password)]);
  if (!r.length) falha('Usuário ou senha incorretos.', 401);
  const token = crypto.randomBytes(32).toString('hex');
  const u = { id: r[0].id_usuario, nome: r[0].nome_usuario, cargo: r[0].cargo_usuario, expira: Date.now() + DURACAO };
  sessoes.set(token, u);
  res.json({ token, usuario: { nome: u.nome, cargo: u.cargo } });
}));

// Cadastro público SEMPRE cria "aluno monitor". Outros cargos só o gestor concede.
app.post('/api/register', rota(async (req, res) => {
  const { username, password } = req.body || {};
  const nome = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,99}$/.test(nome)) falha('Usuário: 3 a 99 caracteres (letras, números, ponto, hífen ou _).');
  if (!password || password.length < 4 || password.length > 30) falha('A senha deve ter de 4 a 30 caracteres.');
  await pool.query('INSERT INTO usuarios (nome_usuario, senha_usuario, cargo_usuario) VALUES (?,?,?)', [nome, password, MON]);
  res.json({ ok: true });
}));

app.post('/api/logout', autenticar, (req, res) => { sessoes.delete(req.token); res.json({ ok: true }); });
app.get('/api/me', autenticar, (req, res) => res.json({ nome: req.usuario.nome, cargo: req.usuario.cargo }));

// ---------- dados auxiliares ----------
app.get('/api/opcoes', autenticar, rota(async (req, res) => {
  const [professores] = await pool.query('SELECT nome_professor, disciplina_professor FROM professores ORDER BY nome_professor');
  const [turmas] = await pool.query('SELECT nome_turma, turno_escolar FROM turmas ORDER BY nome_turma');
  res.json({ professores, turmas, tipos: TIPOS });
}));

// ---------- aparelhos (usa as procedures do SQL) ----------
app.get('/api/aparelhos', autenticar, rota(async (req, res) => {
  const tipo = req.query.tipo || null;
  const disp = req.query.disponivel === undefined || req.query.disponivel === '' ? null : Number(req.query.disponivel);
  const [r] = await pool.query('CALL sp_aparelho_listar(?,?)', [tipo, disp]);
  res.json(r[0]);
}));
app.get('/api/aparelhos/:id', autenticar, rota(async (req, res) => {
  const [r] = await pool.query('CALL sp_aparelho_buscar(?)', [req.params.id]);
  res.json(r[0][0]);
}));
const dadosAparelho = (b) => [b.marca, b.modelo, b.tipo, Number(b.numero), b.patrimonio, b.observacoes || 'nenhuma', b.disponivel ? 1 : 0];
app.post('/api/aparelhos', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const [r] = await pool.query('CALL sp_aparelho_criar(?,?,?,?,?,?,?)', dadosAparelho(req.body));
  res.json(r[0][0]);
}));
app.put('/api/aparelhos/:id', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const [r] = await pool.query('CALL sp_aparelho_atualizar(?,?,?,?,?,?,?,?)', [req.params.id, ...dadosAparelho(req.body)]);
  res.json(r[0][0]);
}));
app.delete('/api/aparelhos/:id', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const [r] = await pool.query('CALL sp_aparelho_excluir(?)', [req.params.id]);
  res.json(r[0][0]);
}));

// ---------- carregamento ----------
app.get('/api/carregamentos', autenticar, rota(async (req, res) => {
  const [r] = await pool.query(`
    SELECT ap.id_aparelho, ap.tipo_aparelho, ap.marca_aparelho, ap.modelo_aparelho, ap.numero_aparelho, ap.patrimonio,
           IF(ap.disponivel,'Disponível','Indisponível') AS disponibilidade, c.ultima_recarga,
           CASE WHEN c.id_carregamento IS NULL THEN 'Sem registro' WHEN c.carregando = 1 THEN 'Carregando' ELSE 'Fora da tomada' END AS estado_carregamento
    FROM carregamentos c RIGHT JOIN aparelhos ap ON ap.id_aparelho = c.fk_aparelho_carregado
    ORDER BY ap.tipo_aparelho, ap.numero_aparelho`);
  res.json(r);
}));
app.post('/api/carregamentos/:id', autenticar, permitir(GESTOR, MON), rota(async (req, res) => {
  const carregando = req.body.carregando ? 1 : 0;
  const [ex] = await pool.query('SELECT id_carregamento FROM carregamentos WHERE fk_aparelho_carregado = ?', [req.params.id]);
  if (ex.length) {
    await pool.query(`UPDATE carregamentos SET carregando = ?, ultima_recarga = IF(?=1, NOW(), ultima_recarga) WHERE fk_aparelho_carregado = ?`,
      [carregando, carregando, req.params.id]);
  } else {
    await pool.query('INSERT INTO carregamentos (fk_aparelho_carregado, ultima_recarga, carregando) VALUES (?, NOW(), ?)', [req.params.id, carregando]);
  }
  res.json({ ok: true });
}));

// ---------- empréstimos ----------
app.get('/api/emprestimos', autenticar, rota(async (req, res) => {
  const [r] = await pool.query(`
    SELECT e.id_emprestimo, e.data_emprestimo, u.nome_usuario AS registrado_por, p.nome_professor AS professor,
           p.disciplina_professor AS disciplina, t.nome_turma AS turma, t.sala, e.aparelho_emprestado AS tipo_aparelho,
           e.quantidade_emprestada AS quantidade, e.devolucao
    FROM emprestimos e
    INNER JOIN usuarios u ON u.nome_usuario = e.fk_usuario
    INNER JOIN professores p ON p.nome_professor = e.fk_professor
    INNER JOIN turmas t ON t.nome_turma = e.fk_turma
    ORDER BY e.data_emprestimo DESC, e.id_emprestimo DESC LIMIT 300`);
  res.json(r);
}));
app.post('/api/emprestimos', autenticar, permitir(GESTOR, MON), rota(async (req, res) => {
  const { professor, turma, tipo, aparelhos } = req.body || {};
  if (!professor || !turma || !TIPOS.includes(tipo)) falha('Preencha professor, turma e tipo de aparelho.');
  if (!Array.isArray(aparelhos) || !aparelhos.length) falha('Selecione ao menos um aparelho.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [disp] = await conn.query(
      'SELECT id_aparelho FROM aparelhos WHERE id_aparelho IN (?) AND tipo_aparelho = ? AND disponivel = 1 FOR UPDATE', [aparelhos, tipo]);
    if (disp.length !== aparelhos.length) falha('Algum aparelho selecionado não está mais disponível.', 409);
    const [r] = await conn.query(
      'INSERT INTO emprestimos (fk_usuario, data_emprestimo, fk_professor, fk_turma, aparelho_emprestado, quantidade_emprestada, devolucao) VALUES (?, CURDATE(), ?, ?, ?, ?, 0)',
      [req.usuario.nome, professor, turma, tipo, aparelhos.length]);
    for (const id of aparelhos) {
      await conn.query('INSERT INTO especificacao_emprestimos (fk_emprestimo, fk_aparelho_emprestimo) VALUES (?,?)', [r.insertId, id]);
    }
    await conn.query('UPDATE aparelhos SET disponivel = 0 WHERE id_aparelho IN (?)', [aparelhos]);
    await conn.commit();
    res.json({ id: r.insertId });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
app.post('/api/emprestimos/:id/devolver', autenticar, permitir(GESTOR, MON), rota(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [e] = await conn.query('SELECT devolucao FROM emprestimos WHERE id_emprestimo = ? FOR UPDATE', [req.params.id]);
    if (!e.length) falha('Empréstimo não encontrado.', 404);
    if (e[0].devolucao) falha('Este empréstimo já foi devolvido.', 409);
    await conn.query('UPDATE emprestimos SET devolucao = 1 WHERE id_emprestimo = ?', [req.params.id]);
    await conn.query(`UPDATE aparelhos SET disponivel = 1 WHERE id_aparelho IN
      (SELECT fk_aparelho_emprestimo FROM especificacao_emprestimos WHERE fk_emprestimo = ?)`, [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// ---------- relatórios ----------
app.get('/api/relatorios', autenticar, rota(async (req, res) => {
  const [r] = await pool.query(`SELECT id_relatorio, fk_usuario_relatorio AS usuario, data_relatorio AS data,
    aparelho_relatorio AS tipo, quantidade_relatorio AS quantidade, observacoes_relatorio AS observacoes
    FROM relatorios ORDER BY data_relatorio DESC, id_relatorio DESC LIMIT 300`);
  res.json(r);
}));
app.post('/api/relatorios', autenticar, permitir(GESTOR, MON), rota(async (req, res) => {
  const { tipo, quantidade, observacoes } = req.body || {};
  if (!TIPOS.includes(tipo)) falha('Tipo de aparelho inválido.');
  if (!(Number(quantidade) >= 0)) falha('Quantidade inválida.');
  await pool.query('INSERT INTO relatorios (fk_usuario_relatorio, data_relatorio, aparelho_relatorio, quantidade_relatorio, observacoes_relatorio) VALUES (?, CURDATE(), ?, ?, ?)',
    [req.usuario.nome, tipo, Number(quantidade), String(observacoes || 'nenhuma').slice(0, 304)]);
  res.json({ ok: true });
}));

// ---------- usuários (só gestor) ----------
app.get('/api/usuarios', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const [r] = await pool.query('SELECT id_usuario, nome_usuario, cargo_usuario FROM usuarios ORDER BY cargo_usuario, nome_usuario');
  res.json(r);
}));
app.post('/api/usuarios', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const { nome, senha, cargo } = req.body || {};
  if (!/^[a-z0-9._-]{3,99}$/.test(String(nome || '').toLowerCase())) falha('Nome de usuário inválido.');
  if (!senha || senha.length < 4 || senha.length > 30) falha('A senha deve ter de 4 a 30 caracteres.');
  if (!CARGOS.includes(cargo)) falha('Cargo inválido.');
  await pool.query('INSERT INTO usuarios (nome_usuario, senha_usuario, cargo_usuario) VALUES (?,?,?)', [nome.toLowerCase(), senha, cargo]);
  res.json({ ok: true });
}));
app.put('/api/usuarios/:id', autenticar, permitir(GESTOR), rota(async (req, res) => {
  const { cargo, senha } = req.body || {};
  if (cargo !== undefined) {
    if (!CARGOS.includes(cargo)) falha('Cargo inválido.');
    if (Number(req.params.id) === req.usuario.id && cargo !== GESTOR) falha('Você não pode remover seu próprio cargo de gestor.');
    await pool.query('UPDATE usuarios SET cargo_usuario = ? WHERE id_usuario = ?', [cargo, req.params.id]);
  }
  if (senha) {
    if (senha.length < 4 || senha.length > 30) falha('A senha deve ter de 4 a 30 caracteres.');
    await pool.query('UPDATE usuarios SET senha_usuario = ? WHERE id_usuario = ?', [senha, req.params.id]);
  }
  for (const [t, s] of sessoes) if (s.id === Number(req.params.id) && cargo) s.cargo = cargo;
  res.json({ ok: true });
}));
app.delete('/api/usuarios/:id', autenticar, permitir(GESTOR), rota(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) falha('Você não pode excluir a própria conta.');
  await pool.query('DELETE FROM usuarios WHERE id_usuario = ?', [req.params.id]);
  res.json({ ok: true });
}));

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Site CCM rodando em http://localhost:${PORTA}`));