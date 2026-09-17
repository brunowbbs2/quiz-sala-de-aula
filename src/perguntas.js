const LIMITE_ALTERNATIVAS = 6;

/** Normaliza e valida a lista de perguntas vinda do editor. Lança Error com mensagem em pt-BR. */
function validarPerguntas(lista) {
  if (!Array.isArray(lista)) throw new Error('Formato de perguntas inválido.');

  return lista.map((p, i) => {
    const posicao = `Pergunta ${i + 1}`;
    if (!p || typeof p !== 'object') throw new Error(`${posicao}: formato inválido.`);

    const enunciado = String(p.enunciado || '').trim();
    if (!enunciado) throw new Error(`${posicao}: escreva o enunciado.`);

    const alternativas = (Array.isArray(p.alternativas) ? p.alternativas : []).map((a) =>
      String(a == null ? '' : a).trim()
    );
    if (alternativas.length < 2 || alternativas.length > LIMITE_ALTERNATIVAS) {
      throw new Error(`${posicao}: use de 2 a ${LIMITE_ALTERNATIVAS} alternativas.`);
    }
    if (alternativas.some((a) => !a)) throw new Error(`${posicao}: preencha todas as alternativas.`);

    const correta = Number(p.correta);
    if (!Number.isInteger(correta) || correta < 0 || correta >= alternativas.length) {
      throw new Error(`${posicao}: marque qual alternativa é a correta.`);
    }

    const tempo = Number(p.tempo);
    return {
      enunciado,
      codigo: String(p.codigo || ''),
      altCodigo: !!p.altCodigo,
      alternativas,
      correta,
      tempo: Number.isFinite(tempo) ? Math.min(300, Math.max(5, Math.round(tempo))) : 20,
    };
  });
}

module.exports = { validarPerguntas, LIMITE_ALTERNATIVAS };
