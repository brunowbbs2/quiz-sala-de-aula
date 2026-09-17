const crypto = require('crypto');
const { rodar, lote } = require('./db');
const { socketAutenticado } = require('./auth');
const { lerQuiz } = require('./api');

const PONTOS_BASE = 1000;
const BONUS_SEQUENCIA = 100;
const MAX_BONUS = 5;
const SEGUNDOS_CONTAGEM = 3;

const AVATARES = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐝', '🦁', '🐢', '🦀', '🐳', '🦖', '🐨', '🦩', '🐧', '🦚'];

const novoId = () => crypto.randomUUID();

/** Partidas em andamento, indexadas pelo PIN. O banco guarda só o histórico. */
const salas = new Map();

function novoPin() {
  let pin;
  do {
    pin = String(crypto.randomInt(100000, 1000000));
  } while (salas.has(pin));
  return pin;
}

const avatarDe = (nome) =>
  AVATARES[[...nome].reduce((soma, c) => soma + c.charCodeAt(0), 0) % AVATARES.length];

const publico = (sala) =>
  [...sala.jogadores.values()]
    .filter((j) => j.conectado)
    .map((j) => ({ id: j.socketId, nome: j.nome, avatar: j.avatar, pontos: j.pontos }));

const ranking = (sala) =>
  [...sala.jogadores.values()]
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome))
    .map((j, i) => ({ posicao: i + 1, nome: j.nome, avatar: j.avatar, pontos: j.pontos, acertos: j.acertos }));

function limparTimers(sala) {
  clearTimeout(sala.timer);
  sala.timer = null;
}

/** O jogo não pode travar por causa do banco: falha de gravação só afeta o relatório. */
function gravar(promessa, sala, io, contexto) {
  return Promise.resolve(promessa).catch((e) => {
    console.error(`Falha ao gravar (${contexto}):`, e.message);
    if (sala && !sala.avisouBanco) {
      sala.avisouBanco = true;
      io.to(sala.hostId).emit('host:aviso', 'O relatório desta partida pode ficar incompleto (falha no banco).');
    }
  });
}

function instalar(io) {
  const paraHost = (sala, evento, dados) => io.to(sala.hostId).emit(evento, dados);
  const paraJogadores = (sala, evento, dados) => io.to(`jogadores:${sala.pin}`).emit(evento, dados);

  function iniciarContagem(sala) {
    sala.estado = 'contagem';
    const pergunta = sala.perguntas[sala.indice];
    const base = { indice: sala.indice, total: sala.perguntas.length, segundos: SEGUNDOS_CONTAGEM };
    paraHost(sala, 'host:contagem', { ...base, enunciado: pergunta.enunciado });
    paraJogadores(sala, 'player:contagem', base);
    limparTimers(sala);
    sala.timer = setTimeout(() => enviarPergunta(sala), SEGUNDOS_CONTAGEM * 1000);
  }

  function enviarPergunta(sala) {
    const pergunta = sala.perguntas[sala.indice];
    sala.estado = 'pergunta';
    sala.respostas = new Map();
    sala.inicio = Date.now();

    // Host recebe enunciado, código e gabarito. Alunos recebem só a quantidade de alternativas.
    paraHost(sala, 'host:pergunta', {
      indice: sala.indice,
      total: sala.perguntas.length,
      enunciado: pergunta.enunciado,
      codigo: pergunta.codigo,
      altCodigo: pergunta.altCodigo,
      alternativas: pergunta.alternativas,
      tempo: pergunta.tempo,
    });
    paraJogadores(sala, 'player:pergunta', {
      indice: sala.indice,
      total: sala.perguntas.length,
      quantidade: pergunta.alternativas.length,
      tempo: pergunta.tempo,
    });

    limparTimers(sala);
    sala.timer = setTimeout(() => encerrarPergunta(sala), pergunta.tempo * 1000);
  }

  function encerrarPergunta(sala) {
    if (sala.estado !== 'pergunta') return;
    limparTimers(sala);
    sala.estado = 'resultado';

    const pergunta = sala.perguntas[sala.indice];
    const limite = pergunta.tempo * 1000;
    const contagem = pergunta.alternativas.map(() => 0);
    const gravacoes = [];

    for (const jogador of sala.jogadores.values()) {
      const resposta = sala.respostas.get(jogador.id);
      let pontos = 0;
      let acertou = false;

      if (resposta) {
        contagem[resposta.alternativa] += 1;
        acertou = resposta.alternativa === pergunta.correta;
        if (acertou) {
          // quanto mais rápido, mais pontos: 1000 no início, 500 no último segundo
          const fator = Math.max(0, 1 - resposta.ms / limite / 2);
          jogador.sequencia += 1;
          pontos =
            Math.round(PONTOS_BASE * fator) + Math.min(jogador.sequencia - 1, MAX_BONUS) * BONUS_SEQUENCIA;
          jogador.acertos += 1;
        } else {
          jogador.sequencia = 0;
        }
        resposta.acertou = acertou;
        resposta.pontos = pontos;
      } else {
        jogador.sequencia = 0;
      }

      jogador.pontos += pontos;
      gravacoes.push({
        sql: `INSERT INTO respostas (partida_id, participante_id, indice, enunciado, escolha, correta, acertou, pontos, ms)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sala.partidaId,
          jogador.id,
          sala.indice,
          pergunta.enunciado,
          resposta ? resposta.alternativa : null,
          pergunta.correta,
          acertou ? 1 : 0,
          pontos,
          resposta ? resposta.ms : null,
        ],
      });
    }

    const classificacao = ranking(sala);
    const posicoes = new Map(classificacao.map((r) => [r.nome, r.posicao]));

    paraHost(sala, 'host:resultado', {
      indice: sala.indice,
      total: sala.perguntas.length,
      enunciado: pergunta.enunciado,
      codigo: pergunta.codigo,
      altCodigo: pergunta.altCodigo,
      alternativas: pergunta.alternativas,
      correta: pergunta.correta,
      contagem,
      responderam: sala.respostas.size,
      totalJogadores: sala.jogadores.size,
      ranking: classificacao.slice(0, 5),
      ultima: sala.indice >= sala.perguntas.length - 1,
    });

    for (const jogador of sala.jogadores.values()) {
      const resposta = sala.respostas.get(jogador.id);
      io.to(jogador.socketId).emit('player:resultado', {
        respondeu: !!resposta,
        acertou: resposta ? resposta.acertou : false,
        pontos: resposta ? resposta.pontos : 0,
        total: jogador.pontos,
        posicao: posicoes.get(jogador.nome) || sala.jogadores.size,
        sequencia: jogador.sequencia,
        totalJogadores: sala.jogadores.size,
      });
    }

    if (gravacoes.length) gravar(lote(gravacoes), sala, io, 'respostas');
  }

  function encerrarJogo(sala) {
    limparTimers(sala);
    sala.estado = 'fim';
    const classificacao = ranking(sala);

    paraHost(sala, 'host:fim', { ranking: classificacao, partidaId: sala.partidaId });
    for (const jogador of sala.jogadores.values()) {
      const posicao = classificacao.find((r) => r.nome === jogador.nome);
      io.to(jogador.socketId).emit('player:fim', {
        posicao: posicao ? posicao.posicao : classificacao.length,
        pontos: jogador.pontos,
        acertos: jogador.acertos,
        totalPerguntas: sala.perguntas.length,
        totalJogadores: classificacao.length,
      });
    }

    const comandos = [...sala.jogadores.values()].map((j) => ({
      sql: `INSERT INTO participantes (id, partida_id, nome, pontos, acertos) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET pontos = EXCLUDED.pontos, acertos = EXCLUDED.acertos`,
      args: [j.id, sala.partidaId, j.nome, j.pontos, j.acertos],
    }));
    comandos.push({
      sql: 'UPDATE partidas SET encerrada_em = ? WHERE id = ?',
      args: [Date.now(), sala.partidaId],
    });
    gravar(lote(comandos), sala, io, 'encerramento');
  }

  function avancar(sala) {
    if (sala.indice >= sala.perguntas.length - 1) return encerrarJogo(sala);
    sala.indice += 1;
    iniciarContagem(sala);
  }

  io.on('connection', (socket) => {
    const salaDoSocket = () => (socket.data.pin ? salas.get(socket.data.pin) : null);
    const ehHost = () => {
      const sala = salaDoSocket();
      return sala && sala.hostId === socket.id ? sala : null;
    };

    // ---------------- PROFESSOR ----------------
    socket.on('host:criar', async ({ quizId } = {}, ack = () => {}) => {
      try {
        if (!socketAutenticado(socket)) return ack({ ok: false, erro: 'Sessão expirada. Faça login de novo.' });

        const quiz = await lerQuiz(quizId);
        if (!quiz) return ack({ ok: false, erro: 'Quiz não encontrado.' });
        if (!quiz.perguntas.length) return ack({ ok: false, erro: 'Este quiz ainda não tem perguntas.' });

        const pin = novoPin();
        const partidaId = novoId();
        const sala = {
          pin,
          partidaId,
          hostId: socket.id,
          titulo: quiz.titulo,
          perguntas: quiz.perguntas,
          jogadores: new Map(),
          respostas: new Map(),
          estado: 'lobby',
          indice: -1,
          inicio: 0,
          timer: null,
          avisouBanco: false,
        };
        salas.set(pin, sala);
        socket.data.pin = pin;
        socket.data.papel = 'host';

        await rodar(
          `INSERT INTO partidas (id, quiz_id, quiz_titulo, pin, total_perguntas, iniciada_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [partidaId, quiz.id, quiz.titulo, pin, quiz.perguntas.length, Date.now()]
        );
        ack({ ok: true, pin, titulo: quiz.titulo, total: quiz.perguntas.length });
      } catch (e) {
        console.error('Erro ao abrir sala:', e);
        ack({ ok: false, erro: 'Não foi possível abrir a sala.' });
      }
    });

    socket.on('host:iniciar', () => {
      const sala = ehHost();
      if (!sala || sala.estado !== 'lobby') return;
      if (!sala.jogadores.size) return paraHost(sala, 'host:aviso', 'Nenhum aluno entrou ainda.');
      sala.indice = -1;
      avancar(sala);
    });

    socket.on('host:encerrarPergunta', () => {
      const sala = ehHost();
      if (sala) encerrarPergunta(sala);
    });

    socket.on('host:proxima', () => {
      const sala = ehHost();
      if (sala && sala.estado === 'resultado') avancar(sala);
    });

    socket.on('host:encerrarJogo', () => {
      const sala = ehHost();
      if (sala && !['fim', 'lobby'].includes(sala.estado)) encerrarJogo(sala);
    });

    socket.on('host:fecharSala', () => {
      const sala = ehHost();
      if (!sala || sala.estado !== 'lobby') return;
      paraJogadores(sala, 'player:hostSaiu');
      salas.delete(sala.pin);
      socket.data.pin = null;
      gravar(rodar('DELETE FROM partidas WHERE id = ?', [sala.partidaId]), null, io, 'sala cancelada');
    });

    socket.on('host:removerJogador', (socketId) => {
      const sala = ehHost();
      if (!sala) return;
      const jogador = [...sala.jogadores.values()].find((j) => j.socketId === socketId);
      if (!jogador) return;
      sala.jogadores.delete(jogador.id);
      io.to(socketId).emit('player:removido');
      io.sockets.sockets.get(socketId)?.leave(`jogadores:${sala.pin}`);
      paraHost(sala, 'host:lobby', publico(sala));
    });

    // ---------------- ALUNO ----------------
    socket.on('player:entrar', ({ pin, nome } = {}, ack = () => {}) => {
      const sala = salas.get(String(pin || '').trim());
      const apelido = String(nome || '').trim().replace(/\s+/g, ' ').slice(0, 18);
      if (!sala) return ack({ ok: false, erro: 'PIN não encontrado.' });
      if (!apelido) return ack({ ok: false, erro: 'Digite seu nome.' });

      const existente = [...sala.jogadores.values()].find(
        (j) => j.nome.toLowerCase() === apelido.toLowerCase()
      );
      if (existente && existente.conectado && existente.socketId !== socket.id) {
        return ack({ ok: false, erro: 'Esse nome já está em uso.' });
      }
      if (!existente && sala.estado !== 'lobby') {
        return ack({ ok: false, erro: 'A partida já começou.' });
      }

      let jogador = existente;
      if (jogador) {
        jogador.socketId = socket.id;
        jogador.conectado = true;
      } else {
        jogador = {
          id: novoId(),
          socketId: socket.id,
          nome: apelido,
          avatar: avatarDe(apelido),
          pontos: 0,
          acertos: 0,
          sequencia: 0,
          conectado: true,
        };
        sala.jogadores.set(jogador.id, jogador);
      }

      socket.data.pin = sala.pin;
      socket.data.papel = 'jogador';
      socket.data.jogadorId = jogador.id;
      socket.join(`jogadores:${sala.pin}`);
      paraHost(sala, 'host:lobby', publico(sala));
      ack({ ok: true, nome: jogador.nome, avatar: jogador.avatar, titulo: sala.titulo, pontos: jogador.pontos });

      if (sala.estado === 'pergunta') {
        const pergunta = sala.perguntas[sala.indice];
        const restante = Math.max(1, Math.round((pergunta.tempo * 1000 - (Date.now() - sala.inicio)) / 1000));
        socket.emit('player:pergunta', {
          indice: sala.indice,
          total: sala.perguntas.length,
          quantidade: pergunta.alternativas.length,
          tempo: restante,
          jaRespondeu: sala.respostas.has(jogador.id),
        });
      }
    });

    socket.on('player:responder', (alternativa, ack = () => {}) => {
      const sala = salaDoSocket();
      if (!sala || sala.estado !== 'pergunta') return ack({ ok: false });
      const jogador = sala.jogadores.get(socket.data.jogadorId);
      if (!jogador || sala.respostas.has(jogador.id)) return ack({ ok: false });

      const pergunta = sala.perguntas[sala.indice];
      const escolha = Number(alternativa);
      if (!Number.isInteger(escolha) || escolha < 0 || escolha >= pergunta.alternativas.length) {
        return ack({ ok: false });
      }

      sala.respostas.set(jogador.id, { alternativa: escolha, ms: Date.now() - sala.inicio });
      ack({ ok: true });
      paraHost(sala, 'host:respostas', { responderam: sala.respostas.size, total: sala.jogadores.size });

      if (sala.respostas.size >= sala.jogadores.size) {
        limparTimers(sala);
        sala.timer = setTimeout(() => encerrarPergunta(sala), 600);
      }
    });

    socket.on('disconnect', () => {
      const sala = salaDoSocket();
      if (!sala) return;

      if (sala.hostId === socket.id) {
        limparTimers(sala);
        paraJogadores(sala, 'player:hostSaiu');
        salas.delete(sala.pin);
        if (sala.estado !== 'fim') {
          gravar(
            rodar('UPDATE partidas SET encerrada_em = ? WHERE id = ? AND encerrada_em IS NULL', [
              Date.now(),
              sala.partidaId,
            ]),
            null,
            io,
            'host desconectado'
          );
        }
        return;
      }

      const jogador = sala.jogadores.get(socket.data.jogadorId);
      if (!jogador) return;
      if (sala.estado === 'lobby') sala.jogadores.delete(jogador.id);
      else jogador.conectado = false;
      paraHost(sala, 'host:lobby', publico(sala));
    });
  });
}

module.exports = { instalar, salas };
