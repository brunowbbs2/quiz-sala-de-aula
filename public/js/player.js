/* Tela do aluno. Recebe do servidor apenas quantas alternativas existem —
   nunca o enunciado nem o gabarito. */

const socket = io();
const mostrar = criarNavegador(['tela-entrar', 'tela-lobby', 'tela-contagem', 'tela-pergunta', 'tela-status']);
const atualizarRelogio = montarRelogio($('aluno-relogio'));

let meusPontos = 0;
let cronometro = null;
let respondida = false;

/* ---------------- entrar ---------------- */
function entrar() {
  const pin = $('pin').value.replace(/\D/g, '');
  const nome = $('nome').value.trim();
  $('erro-entrar').textContent = '';

  if (pin.length < 6) return ($('erro-entrar').textContent = 'O PIN tem 6 dígitos.');
  if (!nome) return ($('erro-entrar').textContent = 'Digite seu nome.');

  $('btn-entrar').disabled = true;
  socket.emit('player:entrar', { pin, nome }, (res) => {
    $('btn-entrar').disabled = false;
    if (!res.ok) return ($('erro-entrar').textContent = res.erro);

    entrouNaSala(res, { pin, nome });
    mostrar('tela-lobby');
  });
}

$('btn-entrar').addEventListener('click', entrar);
$('pin').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) $('nome').focus();
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && $('nome').focus());
$('nome').addEventListener('keydown', (e) => e.key === 'Enter' && entrar());

// PIN vindo do QR code (?pin=123456)
const pinDaUrl = new URLSearchParams(location.search).get('pin');
if (pinDaUrl) {
  $('pin').value = pinDaUrl.replace(/\D/g, '').slice(0, 6);
  setTimeout(() => $('nome').focus(), 120);
}

/* ---------------- sessão que sobrevive ao F5 ----------------
   Fica em localStorage (e não sessionStorage) para o aluno voltar mesmo se o
   celular descartar a aba. O servidor devolve a pontuação acumulada. */
const CHAVE_SESSAO = 'quiz.aluno';

function guardarSessao(dados) {
  try {
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify(dados));
  } catch (_) {}
}

function lerSessao() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null');
  } catch (_) {
    return null;
  }
}

function esquecerSessao() {
  try {
    localStorage.removeItem(CHAVE_SESSAO);
  } catch (_) {}
}

function entrouNaSala(res, dados) {
  meusPontos = res.pontos || 0;
  $('lobby-avatar').textContent = res.avatar;
  $('lobby-nome').textContent = res.nome;
  $('lobby-quiz').textContent = res.titulo;
  guardarSessao(dados);
}

/** Tenta voltar para a sala sozinho: vale tanto para F5 quanto para queda de rede. */
function retomarSessao() {
  const sessao = lerSessao();
  if (!sessao || !sessao.pin || !sessao.nome) return;

  // Se o link traz outro PIN (QR code de uma sala nova), a sala antiga não
  // interessa mais — e o PIN dela não pode sobrescrever o que o aluno acabou de abrir.
  if (pinDaUrl && pinDaUrl.replace(/\D/g, '') !== sessao.pin) return esquecerSessao();

  socket.emit('player:entrar', sessao, (res) => {
    if (!res || !res.ok) {
      // sala encerrada ou nome tomado: volta para a tela de entrada
      esquecerSessao();
      if (!$('pin').value) $('pin').value = sessao.pin;
      if (!$('nome').value) $('nome').value = sessao.nome;
      mostrar('tela-entrar');
      if (res && res.erro) $('erro-entrar').textContent = res.erro;
      return;
    }
    entrouNaSala(res, sessao);
    if ($('tela-entrar').hidden === false || telaDeEspera()) {
      status('🔄', 'Você voltou!', 'Aguarde a próxima pergunta...');
    }
  });
}

const telaDeEspera = () => !$('tela-status').hidden || !$('tela-lobby').hidden;

/* ---------------- status ---------------- */
function status(icone, titulo, texto, comPlacar) {
  $('status-icone').innerHTML = icone;
  $('status-titulo').textContent = titulo;
  $('status-texto').textContent = texto || '';
  $('status-placar').hidden = !comPlacar;
  if (comPlacar) {
    $('status-pontos').textContent = comPlacar.pontos;
    $('status-posicao').textContent = comPlacar.posicao;
  }
  mostrar('tela-status');
}

/* ---------------- contagem regressiva ---------------- */
socket.on('player:contagem', ({ indice, total, segundos }) => {
  clearInterval(cronometro);
  $('contagem-info').textContent = `Pergunta ${indice + 1} de ${total}`;
  let n = segundos;
  const pintar = () => {
    $('contagem-numero').textContent = n;
    $('contagem-numero').style.animation = 'none';
    void $('contagem-numero').offsetWidth;
    $('contagem-numero').style.animation = '';
  };
  pintar();
  mostrar('tela-contagem');
  cronometro = setInterval(() => {
    n -= 1;
    if (n <= 0) return clearInterval(cronometro);
    pintar();
  }, 1000);
});

/* ---------------- pergunta ---------------- */
socket.on('player:pergunta', ({ indice, total, quantidade, tempo, jaRespondeu }) => {
  clearInterval(cronometro);
  respondida = !!jaRespondeu;

  $('aluno-contador').textContent = `${indice + 1}/${total}`;
  $('aluno-pontos').textContent = `${meusPontos} pts`;

  const caixa = $('aluno-alternativas');
  caixa.innerHTML = '';
  for (let i = 0; i < quantidade; i++) {
    const botao = document.createElement('button');
    botao.className = `alt alt-${i}`;
    botao.innerHTML = forma(i);
    botao.setAttribute('aria-label', `Alternativa ${i + 1}`);
    botao.addEventListener('click', () => responder(i));
    caixa.appendChild(botao);
  }

  let restante = tempo;
  atualizarRelogio(restante, tempo);
  cronometro = setInterval(() => {
    restante -= 1;
    atualizarRelogio(restante, tempo);
    if (restante <= 0) clearInterval(cronometro);
  }, 1000);

  if (respondida) status('⏳', 'Resposta enviada', 'Aguarde a próxima pergunta...');
  else mostrar('tela-pergunta');
});

function responder(indice) {
  if (respondida) return;
  respondida = true;
  socket.emit('player:responder', indice, (res) => {
    if (!res || !res.ok) {
      respondida = false;
      return;
    }
    clearInterval(cronometro);
    // Nunca mostrar qual alternativa foi escolhida: a tela fica exposta para quem
    // senta ao lado e ainda não respondeu.
    status('⏳', 'Resposta enviada!', 'Aguardando os outros...');
  });
}

/* ---------------- resultado ---------------- */
socket.on('player:resultado', (r) => {
  clearInterval(cronometro);
  meusPontos = r.total;
  const placar = { pontos: r.total, posicao: `${r.posicao}º` };

  if (!r.respondeu) {
    status('⏰', 'Tempo esgotado', 'Sem pontos nesta pergunta.', placar);
  } else if (r.acertou) {
    const sequencia = r.sequencia > 1 ? `  •  ${r.sequencia} acertos seguidos 🔥` : '';
    status('✅', 'Acertou!', `+${r.pontos} pontos${sequencia}`, placar);
  } else {
    status('❌', 'Não foi dessa vez', 'A resposta certa está no telão.', placar);
  }
});

socket.on('player:fim', (r) => {
  clearInterval(cronometro);
  const medalhas = { 1: '🥇', 2: '🥈', 3: '🥉' };
  status(
    medalhas[r.posicao] || '🎉',
    `${r.posicao}º lugar`,
    `${r.acertos} de ${r.totalPerguntas} perguntas certas`,
    { pontos: r.pontos, posicao: `${r.posicao}º de ${r.totalJogadores}` }
  );
  if (r.posicao <= 3) confete();
});

/* ---------------- avisos do servidor ---------------- */
socket.on('player:removido', () => {
  esquecerSessao();
  status('👋', 'Você saiu da sala', 'O professor removeu você da partida.');
});
socket.on('player:hostSaiu', () => {
  esquecerSessao();
  status('🔌', 'Partida encerrada', 'O professor fechou a sala.');
});
socket.on('disconnect', () => {
  clearInterval(cronometro);
  status('📡', 'Conexão perdida', 'Tentando reconectar...');
});
// Vale para o primeiro carregamento (inclusive depois de um F5) e para cada
// reconexão do socket: se houver sessão guardada, volta sozinho para a sala.
socket.on('connect', retomarSessao);
