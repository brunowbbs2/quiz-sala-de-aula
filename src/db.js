const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

/*
 * Um único driver para dois cenários:
 *   - sem DATABASE_URL  -> arquivo SQLite local (desenvolvimento ou host com disco)
 *   - com DATABASE_URL  -> banco hospedado (Turso/libSQL), para hosts sem disco persistente
 * O SQL é idêntico nos dois casos.
 */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
let url = process.env.DATABASE_URL;

if (!url) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  url = 'file:' + path.join(DATA_DIR, 'quiz.db');
}

const cliente = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS quizzes (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  perguntas   TEXT NOT NULL DEFAULT '[]',
  criado_em   INTEGER NOT NULL,
  alterado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS partidas (
  id              TEXT PRIMARY KEY,
  quiz_id         TEXT,
  quiz_titulo     TEXT NOT NULL,
  pin             TEXT NOT NULL,
  total_perguntas INTEGER NOT NULL,
  iniciada_em     INTEGER NOT NULL,
  encerrada_em    INTEGER
);
CREATE TABLE IF NOT EXISTS participantes (
  id         TEXT PRIMARY KEY,
  partida_id TEXT NOT NULL,
  nome       TEXT NOT NULL,
  pontos     INTEGER NOT NULL DEFAULT 0,
  acertos    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS respostas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  partida_id      TEXT NOT NULL,
  participante_id TEXT NOT NULL,
  indice          INTEGER NOT NULL,
  enunciado       TEXT NOT NULL,
  escolha         INTEGER,
  correta         INTEGER NOT NULL,
  acertou         INTEGER NOT NULL,
  pontos          INTEGER NOT NULL,
  ms              INTEGER
);
CREATE INDEX IF NOT EXISTS idx_participantes_partida ON participantes(partida_id);
CREATE INDEX IF NOT EXISTS idx_respostas_partida ON respostas(partida_id);
CREATE INDEX IF NOT EXISTS idx_partidas_data ON partidas(iniciada_em DESC);
`;

async function iniciar() {
  await cliente.executeMultiple(ESQUEMA);
  return { url: url.startsWith('file:') ? 'arquivo local' : 'banco remoto' };
}

/** Uma linha ou null. */
async function um(sql, args = []) {
  const { rows } = await cliente.execute({ sql, args });
  return rows[0] || null;
}

/** Todas as linhas. */
async function todos(sql, args = []) {
  const { rows } = await cliente.execute({ sql, args });
  return rows;
}

/** Escrita simples. */
const rodar = (sql, args = []) => cliente.execute({ sql, args });

/** Várias escritas numa transação. */
const lote = (comandos) => cliente.batch(comandos, 'write');

module.exports = { cliente, iniciar, um, todos, rodar, lote };
