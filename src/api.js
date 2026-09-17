const crypto = require('crypto');
const { um, todos, rodar } = require('./db');
const { exigirLogin } = require('./auth');
const { validarPerguntas } = require('./perguntas');

const agora = () => Date.now();
const novoId = () => crypto.randomUUID();

/** Envolve um handler async para que erros virem resposta JSON em vez de derrubar a requisição. */
const rota = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error('Erro na API:', e);
    if (!res.headersSent) res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
  });

async function lerQuiz(id) {
  // a coluna é JSONB, então o driver já devolve o array pronto
  return um('SELECT * FROM quizzes WHERE id = ?', [id]);
}

function registrar(app) {
  // ---------------- QUIZZES ----------------
  app.get(
    '/api/quizzes',
    exigirLogin,
    rota(async (_req, res) => {
      res.json(
        await todos(`SELECT id, titulo, criado_em, alterado_em, jsonb_array_length(perguntas) AS qtd
                     FROM quizzes ORDER BY alterado_em DESC`)
      );
    })
  );

  app.get(
    '/api/quizzes/:id',
    exigirLogin,
    rota(async (req, res) => {
      const quiz = await lerQuiz(req.params.id);
      if (!quiz) return res.status(404).json({ erro: 'Quiz não encontrado.' });
      res.json(quiz);
    })
  );

  app.post(
    '/api/quizzes',
    exigirLogin,
    rota(async (req, res) => {
      const titulo = String((req.body && req.body.titulo) || '').trim() || 'Novo quiz';
      let perguntas;
      try {
        perguntas = validarPerguntas((req.body && req.body.perguntas) || []);
      } catch (e) {
        return res.status(400).json({ erro: e.message });
      }
      const id = novoId();
      const t = agora();
      await rodar('INSERT INTO quizzes (id, titulo, perguntas, criado_em, alterado_em) VALUES (?, ?, ?, ?, ?)', [
        id,
        titulo.slice(0, 120),
        JSON.stringify(perguntas),
        t,
        t,
      ]);
      res.status(201).json(await lerQuiz(id));
    })
  );

  app.put(
    '/api/quizzes/:id',
    exigirLogin,
    rota(async (req, res) => {
      if (!(await um('SELECT id FROM quizzes WHERE id = ?', [req.params.id]))) {
        return res.status(404).json({ erro: 'Quiz não encontrado.' });
      }
      const titulo = String((req.body && req.body.titulo) || '').trim() || 'Quiz sem título';
      let perguntas;
      try {
        perguntas = validarPerguntas((req.body && req.body.perguntas) || []);
      } catch (e) {
        return res.status(400).json({ erro: e.message });
      }
      await rodar('UPDATE quizzes SET titulo = ?, perguntas = ?, alterado_em = ? WHERE id = ?', [
        titulo.slice(0, 120),
        JSON.stringify(perguntas),
        agora(),
        req.params.id,
      ]);
      res.json(await lerQuiz(req.params.id));
    })
  );

  app.post(
    '/api/quizzes/:id/duplicar',
    exigirLogin,
    rota(async (req, res) => {
      const quiz = await lerQuiz(req.params.id);
      if (!quiz) return res.status(404).json({ erro: 'Quiz não encontrado.' });
      const id = novoId();
      const t = agora();
      await rodar('INSERT INTO quizzes (id, titulo, perguntas, criado_em, alterado_em) VALUES (?, ?, ?, ?, ?)', [
        id,
        `${quiz.titulo} (cópia)`.slice(0, 120),
        JSON.stringify(quiz.perguntas),
        t,
        t,
      ]);
      res.status(201).json(await lerQuiz(id));
    })
  );

  app.delete(
    '/api/quizzes/:id',
    exigirLogin,
    rota(async (req, res) => {
      await rodar('DELETE FROM quizzes WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ---------------- RELATÓRIOS ----------------
  app.get(
    '/api/partidas',
    exigirLogin,
    rota(async (_req, res) => {
      res.json(
        await todos(
          `SELECT p.*, (SELECT COUNT(*) FROM participantes j WHERE j.partida_id = p.id) AS jogadores
           FROM partidas p
           WHERE p.encerrada_em IS NOT NULL
             AND EXISTS (SELECT 1 FROM participantes j WHERE j.partida_id = p.id)
           ORDER BY p.iniciada_em DESC LIMIT 50`
        )
      );
    })
  );

  app.get(
    '/api/partidas/:id',
    exigirLogin,
    rota(async (req, res) => {
      const relatorio = await montarRelatorio(req.params.id);
      if (!relatorio) return res.status(404).json({ erro: 'Partida não encontrada.' });
      res.json(relatorio);
    })
  );

  app.get(
    '/api/partidas/:id/csv',
    exigirLogin,
    rota(async (req, res) => {
      const relatorio = await montarRelatorio(req.params.id);
      if (!relatorio) return res.status(404).json({ erro: 'Partida não encontrada.' });
      const nome = relatorio.partida.quiz_titulo.replace(/[^\w-]+/g, '_').slice(0, 40) || 'relatorio';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
      res.send('﻿' + gerarCsv(relatorio)); // BOM: o Excel abre com os acentos certos
    })
  );

  app.delete(
    '/api/partidas/:id',
    exigirLogin,
    rota(async (req, res) => {
      await rodar('DELETE FROM respostas WHERE partida_id = ?', [req.params.id]);
      await rodar('DELETE FROM participantes WHERE partida_id = ?', [req.params.id]);
      await rodar('DELETE FROM partidas WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    })
  );
}

async function montarRelatorio(partidaId) {
  const partida = await um('SELECT * FROM partidas WHERE id = ?', [partidaId]);
  if (!partida) return null;

  const jogadores = await todos(
    'SELECT * FROM participantes WHERE partida_id = ? ORDER BY pontos DESC, nome',
    [partidaId]
  );
  const respostas = await todos('SELECT * FROM respostas WHERE partida_id = ? ORDER BY indice', [partidaId]);

  const perguntas = [];
  for (const r of respostas) {
    if (!perguntas[r.indice]) {
      perguntas[r.indice] = { indice: r.indice, enunciado: r.enunciado, acertos: 0, respostas: 0, semResposta: 0 };
    }
    const p = perguntas[r.indice];
    p.respostas += 1;
    if (r.acertou) p.acertos += 1;
    if (r.escolha === null) p.semResposta += 1;
  }

  const porJogador = new Map(jogadores.map((j) => [j.id, {}]));
  for (const r of respostas) {
    const mapa = porJogador.get(r.participante_id);
    if (mapa) mapa[r.indice] = r.acertou ? 'acerto' : r.escolha === null ? 'branco' : 'erro';
  }

  return {
    partida,
    perguntas: perguntas.filter(Boolean).map((p) => ({
      ...p,
      percentual: p.respostas ? Math.round((p.acertos / p.respostas) * 100) : 0,
    })),
    jogadores: jogadores.map((j, i) => ({
      ...j,
      posicao: i + 1,
      percentual: partida.total_perguntas ? Math.round((j.acertos / partida.total_perguntas) * 100) : 0,
      porPergunta: porJogador.get(j.id) || {},
    })),
  };
}

function gerarCsv({ partida, perguntas, jogadores }) {
  const celula = (v) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const marca = { acerto: 'OK', erro: 'X', branco: '-' };

  const cabecalho = ['Posicao', 'Aluno', 'Pontos', 'Acertos', 'Percentual'].concat(
    perguntas.map((p) => `P${p.indice + 1}`)
  );
  const linhas = jogadores.map((j) =>
    [j.posicao, j.nome, j.pontos, `${j.acertos}/${partida.total_perguntas}`, `${j.percentual}%`]
      .concat(perguntas.map((p) => marca[j.porPergunta[p.indice]] || '-'))
      .map(celula)
      .join(';')
  );

  return [
    celula(partida.quiz_titulo),
    `Data;${new Date(partida.iniciada_em).toLocaleString('pt-BR')}`,
    '',
    cabecalho.map(celula).join(';'),
    ...linhas,
    '',
    'Pergunta;Enunciado;Acerto da turma',
    ...perguntas.map((p) => [`P${p.indice + 1}`, p.enunciado, `${p.percentual}%`].map(celula).join(';')),
  ].join('\n');
}

module.exports = { registrar, lerQuiz };
