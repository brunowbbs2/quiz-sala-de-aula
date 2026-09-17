const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const banco = require('./src/db');
const auth = require('./src/auth');
const api = require('./src/api');
const jogo = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000 });

app.set('trust proxy', 1); // hospedagens ficam atrás de proxy
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

auth.rotas(app);
api.registrar(app);
jogo.instalar(io);

app.get('/healthz', (_req, res) => res.json({ ok: true, salas: jogo.salas.size }));

/** Endereço que os alunos digitam: domínio público quando publicado, IP da rede quando local. */
app.get('/api/endereco', (req, res) => {
  if (process.env.PUBLIC_URL) return res.json({ url: process.env.PUBLIC_URL.replace(/\/$/, '') });
  const host = req.get('host') || '';
  const ehLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  if (!ehLocal) return res.json({ url: `${req.protocol}://${host}` });
  res.json({ url: `http://${ipLocal()}:${PORT}` });
});

const PRODUCAO = process.env.NODE_ENV === 'production';
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    // 'no-cache' = usa o cache, mas revalida (ETag) a cada carga. Assim um deploy
    // novo nunca serve HTML/CSS antigo, e o custo é só um 304 por arquivo.
    setHeaders(res) {
      res.setHeader('Cache-Control', PRODUCAO ? 'no-cache' : 'no-store');
    },
  })
);

function ipLocal() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

banco
  .iniciar()
  .then((info) => {
    server.listen(PORT, '0.0.0.0', () => {
      const aviso = auth.SEM_SENHA ? '  !  Sem senha. Defina ADMIN_PASSWORD antes de publicar.\n' : '';
      console.log(
        `\n  Quiz IF no ar  (banco: ${info.url})\n\n` +
          `  Professor:  http://localhost:${PORT}/host\n` +
          `  Alunos:     http://${ipLocal()}:${PORT}\n${aviso}`
      );
    });
  })
  .catch((erro) => {
    console.error('Não foi possível iniciar o banco:', erro);
    process.exit(1);
  });
