/* Utilidades compartilhadas entre a tela do professor e a do aluno. */

const $ = (id) => document.getElementById(id);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/* ---------------- formas das alternativas ----------------
   Em SVG porque os caracteres ▲ ◆ ● ■ são desenhados pela fonte
   em tamanhos visivelmente diferentes. */
const FORMAS = [
  '<polygon points="50,10 93,84 7,84" />',
  '<polygon points="50,6 94,50 50,94 6,50" />',
  '<circle cx="50" cy="50" r="42" />',
  '<rect x="10" y="10" width="80" height="80" rx="8" />',
  '<polygon points="50,6 62,38 96,38 68,58 79,91 50,71 21,91 32,58 4,38 38,38" />',
  '<polygon points="50,5 89,27 89,73 50,95 11,73 11,27" />',
];
const MAX_ALTERNATIVAS = FORMAS.length;

function forma(i, colorida) {
  const estilo = colorida ? ` style="color:var(--alt-${i})"` : '';
  return `<span class="forma"${estilo}><svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${FORMAS[i]}</svg></span>`;
}

/* ---------------- texto ---------------- */
const escapar = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `trecho` no meio do texto vira <code>trecho</code>. */
const comInline = (s) => escapar(s).replace(/`([^`]+)`/g, '<code class="inline">$1</code>');

const PALAVRAS = [
  'if','else','elif','for','while','do','switch','case','break','continue','return','function','func','def','lambda',
  'const','let','var','class','extends','implements','new','this','self','super','import','from','export','default',
  'public','private','protected','static','final','void','int','float','double','char','string','bool','boolean',
  'true','false','null','nil','undefined','None','True','False','async','await','try','catch','except','finally',
  'throw','raise','with','yield','print','println','echo','end','then','struct','interface','enum','type','package',
  'using','namespace','select','insert','update','delete','where','join','group','order','begin','foreach','in','of',
  // embutidas do Python que aparecem muito em exercício de sala
  'input','len','range','sum','min','max','abs','round','sorted','enumerate','zip','open','not','and','or','is',
  'append','pass','global','del','assert',
].join('|');

// `//` só é comentário no começo da linha ou depois de ; { } — no meio de uma
// expressão (`minutos // 60`) é a divisão inteira do Python.
const TOKENS = new RegExp(
  '((?:^|(?<=[;{}]))[ \\t]*\\/\\/[^\\n]*|#[^\\n]*|--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' +
    "|('(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\.|[^`\\\\])*`)" +
    '|\\b(\\d+(?:\\.\\d+)?)\\b' +
    '|\\b(' + PALAVRAS + ')\\b',
  'gm'
);

/** Destaque de sintaxe simples, propositalmente independente de linguagem. */
const realcar = (codigo) =>
  escapar(codigo).replace(TOKENS, (m, cmt, str, num, kw) => {
    if (cmt) return `<span class="cmt">${cmt}</span>`;
    if (str) return `<span class="str">${str}</span>`;
    if (num) return `<span class="num">${num}</span>`;
    if (kw) return `<span class="kw">${kw}</span>`;
    return m;
  });

function pintarCodigo(el, codigo) {
  const tem = !!(codigo && codigo.trim());
  el.hidden = !tem;
  if (!tem) {
    el.innerHTML = '';
    return;
  }
  el.style.setProperty('--ajuste', 1);
  el.innerHTML = realcar(codigo.replace(/\t/g, '  '));
}

/*
 * Encolhe o bloco de código até caber na altura disponível: no telão ninguém
 * pode rolar a página, então é melhor a fonte diminuir do que o código sumir.
 *
 * O fator sai direto da razão entre o que cabe e o que o bloco precisa — sem
 * laço de tentativa e erro, que custa um refluxo por volta. A segunda medida
 * corrige o arredondamento das alturas de linha.
 *
 * Roda de novo quando as fontes terminam de carregar: com a fonte substituta o
 * bloco mede diferente e voltaria a estourar depois.
 */
const AJUSTE_MINIMO = 0.5;

function ajustarCodigo(el) {
  if (!el || el.hidden) return;

  const medir = () => {
    if (el.hidden || !el.clientHeight) return;
    el.style.setProperty('--ajuste', 1);
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const cabe = el.clientHeight;
      const precisa = el.scrollHeight;
      if (precisa <= cabe + 1) return;
      const atual = Number(el.style.getPropertyValue('--ajuste')) || 1;
      const fator = Math.max(AJUSTE_MINIMO, atual * (cabe / precisa) * 0.97);
      el.style.setProperty('--ajuste', fator.toFixed(3));
      if (fator <= AJUSTE_MINIMO) return;
    }
  };

  // Medição síncrona de propósito: requestAnimationFrame não dispara em aba
  // oculta, e o ajuste precisa estar pronto quando a tela aparecer.
  medir();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(medir);
}

/** Enunciado longo (ou acompanhado de código) precisa de fonte menor para caber. */
function classeEnunciado(texto, temCodigo) {
  const n = String(texto || '').length;
  if (n > 110) return 'enunciado muito-longo';
  if (temCodigo || n > 55) return 'enunciado longo';
  return 'enunciado';
}

/* ---------------- telas ---------------- */
function criarNavegador(ids) {
  return function mostrar(id) {
    ids.forEach((t) => {
      const el = $(t);
      if (el) el.hidden = t !== id;
    });
    const atual = $(id);
    if (atual) {
      atual.style.animation = 'none';
      void atual.offsetWidth; // força o reinício da animação de entrada
      atual.style.animation = '';
    }
    window.scrollTo({ top: 0 });
  };
}

/* ---------------- avisos ---------------- */
let avisoAtual = null;
function aviso(mensagem, tipo = 'info') {
  if (avisoAtual) avisoAtual.remove();
  const el = document.createElement('div');
  el.className = 'aviso' + (tipo === 'erro' ? ' erro-toast' : '');
  el.textContent = mensagem;
  document.body.appendChild(el);
  avisoAtual = el;
  setTimeout(() => {
    if (el === avisoAtual) avisoAtual = null;
    el.remove();
  }, 3600);
}

/* ---------------- API ---------------- */
async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  if (resposta.status === 204) return null;
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `Falha na requisição (${resposta.status}).`);
  return dados;
}

/* ---------------- relógio circular ---------------- */
const RAIO = 44;
const VOLTA = 2 * Math.PI * RAIO;

function montarRelogio(el) {
  el.innerHTML =
    `<svg viewBox="0 0 100 100">` +
    `<circle class="trilho" cx="50" cy="50" r="${RAIO}" />` +
    `<circle class="progresso" cx="50" cy="50" r="${RAIO}" stroke-dasharray="${VOLTA}" stroke-dashoffset="0" />` +
    `</svg><div class="numero">0</div>`;
  const progresso = el.querySelector('.progresso');
  const numero = el.querySelector('.numero');
  return (restante, total) => {
    const fracao = total > 0 ? Math.max(0, Math.min(1, restante / total)) : 0;
    progresso.style.strokeDashoffset = String(VOLTA * (1 - fracao));
    numero.textContent = Math.max(0, Math.ceil(restante));
    el.classList.toggle('acabando', restante <= 5 && restante > 0);
  };
}

/* ---------------- confete ---------------- */
function confete(duracaoMs = 3500) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'confete';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const redimensionar = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  redimensionar();
  addEventListener('resize', redimensionar);

  const cores = ['#a78bfa', '#f472b6', '#facc15', '#4ade80', '#38bdf8', '#fb923c'];
  const pecas = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    r: 4 + Math.random() * 6,
    vy: 1.8 + Math.random() * 3,
    vx: -1 + Math.random() * 2,
    giro: Math.random() * Math.PI,
    vgiro: -0.1 + Math.random() * 0.2,
    cor: cores[Math.floor(Math.random() * cores.length)],
  }));

  const fim = Date.now() + duracaoMs;
  (function quadro() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pecas) {
      p.x += p.vx;
      p.y += p.vy;
      p.giro += p.vgiro;
      if (p.y > canvas.height + 20) p.y = -20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    if (Date.now() < fim) requestAnimationFrame(quadro);
    else {
      removeEventListener('resize', redimensionar);
      canvas.remove();
    }
  })();
}

/* ---------------- escala da fonte (datashow) ---------------- */
const CHAVE_ESCALA = 'quiz.escala';
let escalaAtual = Number(localStorage.getItem(CHAVE_ESCALA)) || 1;

function aplicarEscala(valor = escalaAtual) {
  escalaAtual = Math.min(2, Math.max(0.6, Number(valor.toFixed(2))));
  document.documentElement.style.setProperty('--escala', escalaAtual);
  try {
    localStorage.setItem(CHAVE_ESCALA, escalaAtual);
  } catch (_) {
    /* navegador sem armazenamento: segue sem lembrar */
  }
}
const mudarEscala = (delta) => aplicarEscala(escalaAtual + delta);

function alternarTelaCheia() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

const formatarData = (ms) =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
