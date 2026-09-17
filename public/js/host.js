/* Tela do professor: biblioteca, editor, sala, partida e relatórios. */

const socket = io();
const TELAS = [
  'tela-login', 'tela-biblioteca', 'tela-editor', 'tela-lobby', 'tela-contagem',
  'tela-pergunta', 'tela-resultado', 'tela-fim', 'tela-relatorios', 'tela-relatorio',
];
const TELAS_GESTAO = ['tela-biblioteca', 'tela-editor', 'tela-relatorios', 'tela-relatorio'];
const navegar = criarNavegador(TELAS);
const atualizarRelogio = montarRelogio($('q-relogio'));

let quiz = null;          // quiz aberto no editor
let editando = null;      // índice da pergunta em edição
let salvando = null;      // timer do salvamento automático
let cronometro = null;
let telaAtual = '';
let ultimaPartida = null;

function mostrar(id) {
  telaAtual = id;
  navegar(id);
  $('cabecalho').hidden = !TELAS_GESTAO.includes(id);
  $('aba-biblioteca').classList.toggle('ativa', id === 'tela-biblioteca' || id === 'tela-editor');
  $('aba-relatorios').classList.toggle('ativa', id === 'tela-relatorios' || id === 'tela-relatorio');
}

/* ================= SESSÃO ================= */
async function verificarSessao() {
  const sessao = await api('/api/sessao');
  $('etiqueta-modo').hidden = !sessao.semSenha;
  $('btn-sair').hidden = sessao.semSenha;
  if (sessao.autenticado) abrirBiblioteca();
  else mostrar('tela-login');
}

async function entrar() {
  $('erro-login').textContent = '';
  try {
    await api('/api/login', { method: 'POST', corpo: { senha: $('senha').value } });
    $('senha').value = '';
    abrirBiblioteca();
  } catch (e) {
    $('erro-login').textContent = e.message;
  }
}

$('btn-login').addEventListener('click', entrar);
$('senha').addEventListener('keydown', (e) => e.key === 'Enter' && entrar());
$('btn-sair').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  mostrar('tela-login');
});
$('aba-biblioteca').addEventListener('click', abrirBiblioteca);
$('aba-relatorios').addEventListener('click', abrirRelatorios);

/* ================= BIBLIOTECA ================= */
async function abrirBiblioteca() {
  mostrar('tela-biblioteca');
  const lista = $('lista-quizzes');
  lista.innerHTML = '<p class="suave">Carregando...</p>';
  let quizzes;
  try {
    quizzes = await api('/api/quizzes');
  } catch (e) {
    return (lista.innerHTML = `<p class="erro">${escapar(e.message)}</p>`);
  }

  if (!quizzes.length) {
    lista.innerHTML =
      '<div class="vazio"><p>Você ainda não tem quizzes.</p><p class="pequeno">Clique em <b>+ Novo quiz</b> para começar.</p></div>';
    return;
  }

  lista.innerHTML = '';
  for (const q of quizzes) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="conteudo">
        <div class="titulo-item">${escapar(q.titulo)}</div>
        <span class="suave pequeno">${q.qtd} pergunta(s) · alterado em ${formatarData(q.alterado_em)}</span>
      </div>`;

    const acoes = document.createElement('div');
    acoes.className = 'linha';
    acoes.innerHTML = `
      <button class="btn mini" data-acao="duplicar">Duplicar</button>
      <button class="btn mini perigo" data-acao="excluir">Excluir</button>
      <button class="btn" data-acao="abrir">Abrir</button>`;
    acoes.addEventListener('click', async (e) => {
      const acao = e.target.dataset.acao;
      if (!acao) return;
      try {
        if (acao === 'abrir') return abrirEditor(q.id);
        if (acao === 'duplicar') {
          await api(`/api/quizzes/${q.id}/duplicar`, { method: 'POST' });
          aviso('Quiz duplicado.');
        }
        if (acao === 'excluir') {
          if (!confirm(`Excluir "${q.titulo}"? Essa ação não pode ser desfeita.`)) return;
          await api(`/api/quizzes/${q.id}`, { method: 'DELETE' });
          aviso('Quiz excluído.');
        }
        abrirBiblioteca();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    });

    item.appendChild(acoes);
    lista.appendChild(item);
  }
}

$('btn-novo-quiz').addEventListener('click', async () => {
  try {
    const novo = await api('/api/quizzes', { method: 'POST', corpo: { titulo: 'Novo quiz', perguntas: [] } });
    abrirEditor(novo.id);
  } catch (e) {
    aviso(e.message, 'erro');
  }
});

$('btn-importar').addEventListener('click', () => $('arquivo').click());
$('arquivo').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  try {
    const dados = JSON.parse(await arquivo.text());
    const perguntas = Array.isArray(dados) ? dados : dados.perguntas;
    const titulo = (!Array.isArray(dados) && dados.titulo) || arquivo.name.replace(/\.json$/i, '');
    const novo = await api('/api/quizzes', { method: 'POST', corpo: { titulo, perguntas } });
    aviso('Quiz importado.');
    abrirEditor(novo.id);
  } catch (erro) {
    aviso(erro.message.includes('JSON') ? 'Arquivo inválido.' : erro.message, 'erro');
  }
});

/* ================= EDITOR ================= */
async function abrirEditor(id) {
  try {
    quiz = await api(`/api/quizzes/${id}`);
  } catch (e) {
    return aviso(e.message, 'erro');
  }
  $('titulo-quiz').value = quiz.titulo;
  limparFormulario();
  renderPerguntas();
  mostrar('tela-editor');
}

$('btn-voltar-biblioteca').addEventListener('click', abrirBiblioteca);

function marcarSalvo(texto, classe) {
  $('estado-salvo').textContent = texto;
  $('estado-salvo').style.color = classe || '';
}

function salvarQuiz({ imediato = false } = {}) {
  if (!quiz) return Promise.resolve();
  clearTimeout(salvando);
  marcarSalvo('salvando...');
  const executar = async () => {
    try {
      const atualizado = await api(`/api/quizzes/${quiz.id}`, {
        method: 'PUT',
        corpo: { titulo: $('titulo-quiz').value, perguntas: quiz.perguntas },
      });
      quiz = atualizado;
      marcarSalvo('salvo');
    } catch (e) {
      marcarSalvo('não salvo', '#fca5a5');
      aviso(e.message, 'erro');
    }
  };
  if (imediato) return executar();
  salvando = setTimeout(executar, 700);
  return Promise.resolve();
}

$('titulo-quiz').addEventListener('input', () => salvarQuiz());

function camposAlternativas(qtd = 4) {
  const caixa = $('f-alternativas');
  caixa.innerHTML = '';
  for (let i = 0; i < qtd; i++) {
    const linha = document.createElement('div');
    linha.className = 'alternativa-edit';
    linha.innerHTML = `
      ${forma(i, true)}
      <input type="text" data-alt="${i}" placeholder="Alternativa ${i + 1}" maxlength="200" />
      <input type="radio" name="correta" value="${i}" title="Esta é a correta" ${i === 0 ? 'checked' : ''} />`;
    caixa.appendChild(linha);
  }
  aplicarFonteAlternativas();
}

const camposDeAlternativa = () => $$('#f-alternativas input[type=text]');

function aplicarFonteAlternativas() {
  const mono = $('f-alt-codigo').checked;
  camposDeAlternativa().forEach((campo) => campo.classList.toggle('mono', mono));
}
$('f-alt-codigo').addEventListener('change', aplicarFonteAlternativas);

function limparFormulario() {
  editando = null;
  $('f-alt-codigo').checked = false;
  camposAlternativas(4);
  $('f-enunciado').value = '';
  $('f-codigo').value = '';
  $('f-tempo').value = '20';
  $('titulo-form').textContent = 'Nova pergunta';
  $('numero-form').textContent = (quiz ? quiz.perguntas.length : 0) + 1;
  $('btn-salvar-pergunta').textContent = 'Adicionar pergunta';
  $('btn-cancelar-edicao').hidden = true;
  $('erro-form').textContent = '';
}

function renderPerguntas() {
  const lista = $('lista-perguntas');
  $('qtd-perguntas').textContent = quiz.perguntas.length;
  lista.innerHTML = '';

  if (!quiz.perguntas.length) {
    lista.innerHTML = '<div class="vazio">Nenhuma pergunta ainda. Cadastre a primeira acima.</div>';
    return;
  }

  quiz.perguntas.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'item';
    const previa = p.codigo ? `<pre class="previa">${escapar(p.codigo.split('\n').slice(0, 3).join('\n'))}</pre>` : '';
    item.innerHTML = `
      <span class="ordem">${i + 1}</span>
      <div class="conteudo">
        <div class="titulo-item">${comInline(p.enunciado)}</div>
        ${previa}
        <span class="suave pequeno">${forma(p.correta, true)} ${escapar(p.alternativas[p.correta])}
          · ${p.tempo}s · ${p.alternativas.length} alternativas${p.codigo ? ' · com código' : ''}</span>
      </div>`;

    const acoes = document.createElement('div');
    acoes.className = 'linha';
    acoes.innerHTML = `
      <button class="btn mini icone" data-acao="cima" title="Subir">↑</button>
      <button class="btn mini icone" data-acao="baixo" title="Descer">↓</button>
      <button class="btn mini" data-acao="editar">Editar</button>
      <button class="btn mini perigo icone" data-acao="excluir" title="Excluir">×</button>`;
    acoes.addEventListener('click', (e) => {
      const acao = e.target.dataset.acao;
      if (!acao) return;
      if (acao === 'editar') return editarPergunta(i);
      if (acao === 'excluir') quiz.perguntas.splice(i, 1);
      if (acao === 'cima' && i > 0) quiz.perguntas.splice(i - 1, 0, quiz.perguntas.splice(i, 1)[0]);
      if (acao === 'baixo' && i < quiz.perguntas.length - 1) {
        quiz.perguntas.splice(i + 1, 0, quiz.perguntas.splice(i, 1)[0]);
      }
      if (editando !== null) limparFormulario();
      renderPerguntas();
      salvarQuiz();
    });

    item.appendChild(acoes);
    lista.appendChild(item);
  });
}

function editarPergunta(i) {
  const p = quiz.perguntas[i];
  editando = i;
  $('f-alt-codigo').checked = !!p.altCodigo;
  camposAlternativas(p.alternativas.length);
  $('f-enunciado').value = p.enunciado;
  $('f-codigo').value = p.codigo || '';
  camposDeAlternativa().forEach((campo, idx) => (campo.value = p.alternativas[idx] || ''));
  document.querySelector(`input[name=correta][value="${p.correta}"]`).checked = true;
  $('f-tempo').value = String(p.tempo);
  $('titulo-form').textContent = 'Editando pergunta';
  $('numero-form').textContent = i + 1;
  $('btn-salvar-pergunta').textContent = 'Salvar alterações';
  $('btn-cancelar-edicao').hidden = false;
  $('f-enunciado').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('btn-salvar-pergunta').addEventListener('click', () => {
  const enunciado = $('f-enunciado').value.trim();
  const alternativas = camposDeAlternativa().map((c) => c.value.trim());
  const marcada = document.querySelector('input[name=correta]:checked');

  if (!enunciado) return ($('erro-form').textContent = 'Escreva o enunciado.');
  if (alternativas.some((a) => !a)) return ($('erro-form').textContent = 'Preencha todas as alternativas.');
  if (!marcada) return ($('erro-form').textContent = 'Marque qual alternativa é a correta.');

  const pergunta = {
    enunciado,
    codigo: $('f-codigo').value.replace(/\s+$/, ''),
    altCodigo: $('f-alt-codigo').checked,
    alternativas,
    correta: Number(marcada.value),
    tempo: Number($('f-tempo').value),
  };

  if (editando === null) quiz.perguntas.push(pergunta);
  else quiz.perguntas[editando] = pergunta;

  renderPerguntas();
  limparFormulario();
  salvarQuiz();
  aviso('Pergunta salva.');
});

$('btn-cancelar-edicao').addEventListener('click', limparFormulario);

function redimensionar(delta) {
  const valores = camposDeAlternativa().map((c) => c.value);
  const marcada = document.querySelector('input[name=correta]:checked');
  const correta = marcada ? Number(marcada.value) : 0;
  const nova = valores.length + delta;
  if (nova < 2 || nova > MAX_ALTERNATIVAS) return;
  camposAlternativas(nova);
  camposDeAlternativa().forEach((campo, i) => (campo.value = valores[i] || ''));
  const alvo = document.querySelector(`input[name=correta][value="${Math.min(correta, nova - 1)}"]`);
  if (alvo) alvo.checked = true;
}
$('btn-add-alt').addEventListener('click', () => redimensionar(1));
$('btn-rem-alt').addEventListener('click', () => redimensionar(-1));

// Tab dentro do código indenta em vez de pular de campo
$('f-codigo').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const el = e.target;
  const pos = el.selectionStart;
  el.value = el.value.slice(0, pos) + '  ' + el.value.slice(el.selectionEnd);
  el.selectionStart = el.selectionEnd = pos + 2;
});

$('btn-exportar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ titulo: quiz.titulo, perguntas: quiz.perguntas }, null, 2)], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${quiz.titulo.replace(/[^\w-]+/g, '_') || 'quiz'}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

/* ================= SALA ================= */
$('btn-abrir-sala').addEventListener('click', async () => {
  if (!quiz.perguntas.length) return aviso('Cadastre ao menos uma pergunta.', 'erro');
  await salvarQuiz({ imediato: true });
  abrirSala();
});

function abrirSala() {
  socket.emit('host:criar', { quizId: quiz.id }, async (res) => {
    if (!res.ok) return aviso(res.erro, 'erro');
    $('lobby-titulo').textContent = res.titulo;
    $('pin').textContent = res.pin;
    $('jogadores').innerHTML = '';
    $('qtd-jogadores').textContent = '0';
    $('btn-iniciar').disabled = false;

    let base = location.origin;
    try {
      base = (await api('/api/endereco')).url;
    } catch (_) {}
    $('url-jogo').textContent = base.replace(/^https?:\/\//, '');
    desenharQr(`${base}/?pin=${res.pin}`);
    mostrar('tela-lobby');
  });
}

function desenharQr(url) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qrcode').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (_) {
    $('qrcode').innerHTML = '';
  }
}

$('btn-cancelar-sala').addEventListener('click', () => {
  socket.emit('host:fecharSala');
  mostrar('tela-editor');
});
$('btn-iniciar').addEventListener('click', () => {
  $('btn-iniciar').disabled = true;
  socket.emit('host:iniciar');
});
$('btn-tela-cheia').addEventListener('click', alternarTelaCheia);
$('btn-cheia-2').addEventListener('click', alternarTelaCheia);
$('btn-encerrar').addEventListener('click', () => socket.emit('host:encerrarPergunta'));
$('btn-proxima').addEventListener('click', () => socket.emit('host:proxima'));
['btn-maior', 'btn-maior-2'].forEach((id) => $(id).addEventListener('click', () => mudarEscala(0.1)));
['btn-menor', 'btn-menor-2'].forEach((id) => $(id).addEventListener('click', () => mudarEscala(-0.1)));

socket.on('host:lobby', (jogadores) => {
  $('qtd-jogadores').textContent = jogadores.length;
  const caixa = $('jogadores');
  caixa.innerHTML = '';
  for (const j of jogadores) {
    const chip = document.createElement('div');
    chip.className = 'jogador';
    chip.innerHTML = `<span>${j.avatar}</span><span>${escapar(j.nome)}</span>`;
    const remover = document.createElement('button');
    remover.textContent = '×';
    remover.title = 'Remover aluno';
    remover.addEventListener('click', () => socket.emit('host:removerJogador', j.id));
    chip.appendChild(remover);
    caixa.appendChild(chip);
  }
});

socket.on('host:aviso', (mensagem) => {
  aviso(mensagem, 'erro');
  $('btn-iniciar').disabled = false;
});

/* ================= PARTIDA ================= */
socket.on('host:contagem', ({ indice, total, segundos, enunciado }) => {
  clearInterval(cronometro);
  $('contagem-info').textContent = `Pergunta ${indice + 1} de ${total}`;
  $('contagem-enunciado').textContent = enunciado;
  let n = segundos;
  const pintar = () => {
    const el = $('contagem-numero');
    el.textContent = n;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  };
  pintar();
  mostrar('tela-contagem');
  cronometro = setInterval(() => {
    n -= 1;
    if (n <= 0) return clearInterval(cronometro);
    pintar();
  }, 1000);
});

function caixaAlternativa(texto, i, ehCodigo) {
  const div = document.createElement('div');
  div.className = `alt alt-${i}${ehCodigo ? ' codigo' : ''}`;
  div.innerHTML = `${forma(i)}<span class="texto">${ehCodigo ? escapar(texto) : comInline(texto)}</span>`;
  return div;
}

socket.on('host:pergunta', ({ indice, total, enunciado, codigo, altCodigo, alternativas, tempo }) => {
  clearInterval(cronometro);
  $('q-contador').textContent = `Pergunta ${indice + 1} de ${total}`;
  $('q-respostas').textContent = '0 respostas';
  $('q-enunciado').className = classeEnunciado(enunciado, !!codigo);
  $('q-enunciado').innerHTML = comInline(enunciado);
  pintarCodigo($('q-codigo'), codigo);

  const caixa = $('q-alternativas');
  caixa.innerHTML = '';
  alternativas.forEach((texto, i) => caixa.appendChild(caixaAlternativa(texto, i, altCodigo)));

  let restante = tempo;
  atualizarRelogio(restante, tempo);
  cronometro = setInterval(() => {
    restante -= 1;
    atualizarRelogio(restante, tempo);
    if (restante <= 0) clearInterval(cronometro);
  }, 1000);

  mostrar('tela-pergunta');
});

socket.on('host:respostas', ({ responderam, total }) => {
  $('q-respostas').textContent = `${responderam}/${total} responderam`;
});

socket.on('host:resultado', (r) => {
  clearInterval(cronometro);
  $('r-enunciado').className = classeEnunciado(r.enunciado, true);
  $('r-enunciado').innerHTML = comInline(r.enunciado);
  pintarCodigo($('r-codigo'), r.codigo);

  const maior = Math.max(1, ...r.contagem);
  const caixa = $('r-alternativas');
  caixa.innerHTML = '';
  r.alternativas.forEach((texto, i) => {
    const div = caixaAlternativa(texto, i, r.altCodigo);
    div.classList.add(i === r.correta ? 'certa' : 'apagada');
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">
        ${forma(i)}
        <span class="texto">${r.altCodigo ? escapar(texto) : comInline(texto)}</span>
        <b>${r.contagem[i] || 0}</b>
        ${i === r.correta ? '<span>✔</span>' : ''}
      </div>
      <div class="barra"><div></div></div>`;
    caixa.appendChild(div);
    requestAnimationFrame(() => {
      div.querySelector('.barra > div').style.width = `${((r.contagem[i] || 0) / maior) * 100}%`;
    });
  });

  $('r-info').textContent = `${r.responderam} de ${r.totalJogadores} responderam · pergunta ${r.indice + 1} de ${r.total}`;
  $('r-ranking').innerHTML =
    '<tbody>' +
    r.ranking
      .map(
        (j) =>
          `<tr><td style="width:46px">${j.posicao}º</td><td>${j.avatar} ${escapar(j.nome)}</td>` +
          `<td class="num">${j.pontos}</td></tr>`
      )
      .join('') +
    '</tbody>';
  $('btn-proxima').textContent = r.ultima ? 'Ver resultado final' : 'Próxima pergunta';
  mostrar('tela-resultado');
});

socket.on('host:fim', ({ ranking, partidaId }) => {
  clearInterval(cronometro);
  ultimaPartida = partidaId;

  const podio = $('podio');
  podio.innerHTML = '';
  const ordemVisual = [ranking[1], ranking[0], ranking[2]].filter(Boolean);
  const degraus = new Map([
    [1, { altura: 'clamp(110px, 17vh, 190px)', classe: 'ouro' }],
    [2, { altura: 'clamp(76px, 12vh, 132px)', classe: 'prata' }],
    [3, { altura: 'clamp(52px, 8vh, 92px)', classe: 'bronze' }],
  ]);
  const medalhas = { 1: '🥇', 2: '🥈', 3: '🥉' };
  for (const j of ordemVisual) {
    const degrau = document.createElement('div');
    degrau.className = 'degrau';
    const estilo = degraus.get(j.posicao);
    degrau.innerHTML = `
      <div class="medalha">${medalhas[j.posicao]}</div>
      <div class="nome">${j.avatar} ${escapar(j.nome)}</div>
      <div class="bloco ${estilo.classe}" style="height:${estilo.altura}">${j.pontos}</div>`;
    podio.appendChild(degrau);
  }

  const restantes = ranking.slice(3);
  $('f-ranking').innerHTML = restantes.length
    ? '<tbody>' +
      restantes
        .map(
          (j) =>
            `<tr><td style="width:56px">${j.posicao}º</td><td>${j.avatar} ${escapar(j.nome)}</td>` +
            `<td class="num">${j.pontos}</td></tr>`
        )
        .join('') +
      '</tbody>'
    : '';

  mostrar('tela-fim');
  confete();
});

$('btn-nova-sala').addEventListener('click', abrirSala);
$('btn-fim-biblioteca').addEventListener('click', abrirBiblioteca);
$('btn-ver-relatorio').addEventListener('click', () => ultimaPartida && abrirRelatorio(ultimaPartida));

/* ================= RELATÓRIOS ================= */
async function abrirRelatorios() {
  mostrar('tela-relatorios');
  const lista = $('lista-relatorios');
  lista.innerHTML = '<p class="suave">Carregando...</p>';
  let partidas;
  try {
    partidas = await api('/api/partidas');
  } catch (e) {
    return (lista.innerHTML = `<p class="erro">${escapar(e.message)}</p>`);
  }

  if (!partidas.length) {
    lista.innerHTML = '<div class="vazio">Nenhuma partida encerrada ainda.</div>';
    return;
  }

  lista.innerHTML = '';
  for (const p of partidas) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="conteudo">
        <div class="titulo-item">${escapar(p.quiz_titulo)}</div>
        <span class="suave pequeno">${formatarData(p.iniciada_em)} · ${p.jogadores} aluno(s) · ${p.total_perguntas} pergunta(s)</span>
      </div>`;
    const acoes = document.createElement('div');
    acoes.className = 'linha';
    acoes.innerHTML = `
      <button class="btn mini perigo" data-acao="excluir">Excluir</button>
      <button class="btn" data-acao="abrir">Abrir</button>`;
    acoes.addEventListener('click', async (e) => {
      const acao = e.target.dataset.acao;
      if (acao === 'abrir') return abrirRelatorio(p.id);
      if (acao === 'excluir') {
        if (!confirm('Excluir este relatório?')) return;
        await api(`/api/partidas/${p.id}`, { method: 'DELETE' });
        abrirRelatorios();
      }
    });
    item.appendChild(acoes);
    lista.appendChild(item);
  }
}

async function abrirRelatorio(id) {
  let dados;
  try {
    dados = await api(`/api/partidas/${id}`);
  } catch (e) {
    return aviso(e.message, 'erro');
  }
  const { partida, perguntas, jogadores } = dados;

  $('rel-titulo').textContent = partida.quiz_titulo;
  $('rel-data').textContent = formatarData(partida.iniciada_em);
  $('btn-csv').onclick = () => (location.href = `/api/partidas/${id}/csv`);

  const mediaAcertos = jogadores.length
    ? Math.round(jogadores.reduce((soma, j) => soma + j.percentual, 0) / jogadores.length)
    : 0;
  const maisDificil = [...perguntas].sort((a, b) => a.percentual - b.percentual)[0];

  $('rel-numeros').innerHTML = [
    ['Alunos', jogadores.length],
    ['Perguntas', partida.total_perguntas],
    ['Acerto médio da turma', `${mediaAcertos}%`],
    ['Pergunta mais difícil', maisDificil ? `P${maisDificil.indice + 1} · ${maisDificil.percentual}%` : '—'],
  ]
    .map(([rotulo, valor]) => `<div class="cartao-numero"><strong>${valor}</strong><span>${rotulo}</span></div>`)
    .join('');

  $('rel-perguntas').innerHTML = perguntas
    .map(
      (p) => `
      <div class="item">
        <span class="ordem">P${p.indice + 1}</span>
        <div class="conteudo">
          <div class="titulo-item">${comInline(p.enunciado)}</div>
          <span class="suave pequeno">${p.acertos} de ${p.respostas} acertaram${
            p.semResposta ? ` · ${p.semResposta} em branco` : ''
          }</span>
          <div class="barra"><div style="width:${p.percentual}%;background:${
            p.percentual >= 70 ? '#4ade80' : p.percentual >= 40 ? '#fbbf24' : '#f87171'
          }"></div></div>
        </div>
        <b style="font-size:20px">${p.percentual}%</b>
      </div>`
    )
    .join('');

  const marca = { acerto: 'OK', erro: 'X', branco: '–' };
  $('rel-alunos').innerHTML = `
    <thead><tr>
      <th>#</th><th>Aluno</th><th style="text-align:right">Pontos</th><th style="text-align:right">Acertos</th>
      ${perguntas.map((p) => `<th style="text-align:center">P${p.indice + 1}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${jogadores
        .map(
          (j) => `<tr>
            <td>${j.posicao}º</td>
            <td>${escapar(j.nome)}</td>
            <td class="num">${j.pontos}</td>
            <td class="num">${j.acertos}/${partida.total_perguntas}</td>
            ${perguntas
              .map((p) => {
                const estado = j.porPergunta[p.indice] || 'branco';
                return `<td style="text-align:center"><span class="marca-resposta ${estado}">${marca[estado]}</span></td>`;
              })
              .join('')}
          </tr>`
        )
        .join('')}
    </tbody>`;

  mostrar('tela-relatorio');
}

$('btn-voltar-relatorios').addEventListener('click', abrirRelatorios);

/* ================= ATALHOS ================= */
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === '+' || e.key === '=') mudarEscala(0.1);
  if (e.key === '-') mudarEscala(-0.1);
  if (e.key === 'f' || e.key === 'F') alternarTelaCheia();
  if (e.key === ' ' || e.key === 'Enter') {
    if (!['tela-lobby', 'tela-pergunta', 'tela-resultado'].includes(telaAtual)) return;
    e.preventDefault();
    if (telaAtual === 'tela-pergunta') socket.emit('host:encerrarPergunta');
    else if (telaAtual === 'tela-resultado') socket.emit('host:proxima');
    else if (telaAtual === 'tela-lobby') socket.emit('host:iniciar');
  }
});

socket.on('disconnect', () => aviso('Conexão perdida. Reconectando...', 'erro'));

aplicarEscala();
verificarSessao().catch((e) => aviso(e.message, 'erro'));
