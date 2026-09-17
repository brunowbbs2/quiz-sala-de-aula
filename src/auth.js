const crypto = require('crypto');

const SENHA = process.env.ADMIN_PASSWORD || '';
const PRODUCAO = process.env.NODE_ENV === 'production';
const DIAS = 30;

if (PRODUCAO && !SENHA) {
  throw new Error(
    'ADMIN_PASSWORD não definida. Configure-a nas variáveis de ambiente antes de subir em produção.'
  );
}

// Sem senha fora de produção o painel fica aberto, para facilitar o desenvolvimento.
const SEM_SENHA = !SENHA && !PRODUCAO;

const SEGREDO =
  process.env.SESSION_SECRET ||
  (SENHA ? crypto.createHash('sha256').update('sessao:' + SENHA).digest('hex') : crypto.randomBytes(32).toString('hex'));

const COOKIE = 'quiz_sessao';

function assinar(valor) {
  return crypto.createHmac('sha256', SEGREDO).update(valor).digest('hex');
}

function criarToken() {
  const expira = String(Date.now() + DIAS * 24 * 60 * 60 * 1000);
  return `${expira}.${assinar(expira)}`;
}

function tokenValido(token) {
  if (!token || typeof token !== 'string') return false;
  const [expira, assinatura] = token.split('.');
  if (!expira || !assinatura) return false;
  const esperada = Buffer.from(assinar(expira));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return false;
  return Number(expira) > Date.now();
}

function senhaConfere(enviada) {
  if (SEM_SENHA) return true;
  const a = Buffer.from(crypto.createHash('sha256').update(String(enviada)).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(SENHA).digest());
  return crypto.timingSafeEqual(a, b);
}

const autenticado = (req) => SEM_SENHA || tokenValido(req.cookies && req.cookies[COOKIE]);

function exigirLogin(req, res, next) {
  if (autenticado(req)) return next();
  res.status(401).json({ erro: 'Faça login para continuar.' });
}

/** Lê o cookie de sessão do handshake do socket. */
function socketAutenticado(socket) {
  if (SEM_SENHA) return true;
  const bruto = socket.handshake.headers.cookie || '';
  const par = bruto.split(';').map((p) => p.trim()).find((p) => p.startsWith(COOKIE + '='));
  return par ? tokenValido(decodeURIComponent(par.slice(COOKIE.length + 1))) : false;
}

function rotas(app) {
  app.get('/api/sessao', (req, res) => {
    res.json({ autenticado: autenticado(req), semSenha: SEM_SENHA });
  });

  app.post('/api/login', (req, res) => {
    if (!senhaConfere(req.body && req.body.senha)) {
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }
    res.cookie(COOKIE, criarToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: PRODUCAO,
      maxAge: DIAS * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });
}

module.exports = { exigirLogin, socketAutenticado, rotas, SEM_SENHA };
