# Quiz para sala de aula

Quiz ao vivo no estilo Kahoot, feito para aula de programação.

**A pergunta aparece só no seu telão.** No celular do aluno aparecem apenas os botões
coloridos (▲ ◆ ● ■) — o enunciado e o gabarito nunca são enviados para a máquina dele,
então não adianta abrir o DevTools.

---

## Rodando na sua máquina

```bash
npm install
npm start
```

O terminal mostra os dois endereços:

| Quem | Endereço |
| --- | --- |
| Você (professor) | http://localhost:3000/host |
| Alunos | `http://SEU-IP:3000` (o IP aparece no terminal) |

Sem `ADMIN_PASSWORD` definida, o painel abre sem login — conveniente para desenvolver,
e o servidor **se recusa a subir em produção** nessa condição.

---

## Publicando

O servidor é um Node comum com WebSocket. Roda em qualquer hospedagem que mantenha um
processo vivo. **Não funciona na Vercel** (funções serverless não mantêm WebSocket nem o
estado da partida).

### Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `ADMIN_PASSWORD` | sim, em produção | senha da área do professor |
| `DATABASE_URL` | se o host não tiver disco | banco libSQL/Turso (`libsql://...`) |
| `DATABASE_AUTH_TOKEN` | com Turso | token do banco |
| `SESSION_SECRET` | não | mantém o login válido entre reinícios |
| `PUBLIC_URL` | não | endereço mostrado aos alunos, se a detecção falhar |
| `PORT` | não | a hospedagem costuma definir sozinha |

### Onde hospedar (planos gratuitos)

As condições dos planos grátis mudam com frequência — **confirme na página do provedor
antes de decidir**. Em linhas gerais:

- **Render** (plano free): simples, WebSocket funciona. O serviço **dorme após ~15 min
  sem uso** e leva ~1 min para acordar. Abra a página uns minutos antes da aula. O plano
  free **não tem disco persistente**, então use `DATABASE_URL` com Turso.
  Há um `render.yaml` pronto: *New +* → *Blueprint* → aponte para o repositório.
- **Koyeb** (plano free): não dorme, também sem disco — mesma combinação com Turso.
- **Fly.io**: tem disco persistente (aí o banco pode ser o arquivo local, sem Turso), mas
  hoje é pago/crédito de teste.

Existe um `Dockerfile` pronto, então qualquer host de container serve.

### Banco de dados

Sem `DATABASE_URL`, o banco é um arquivo SQLite em `./data` — é o modo mais simples e não
exige nenhuma conta extra. **Só serve para testes em hospedagem grátis**, porque o disco é
apagado a cada deploy e toda vez que a instância acorda depois de dormir.

Para os quizzes e relatórios sobreviverem entre as aulas, use o Turso (grátis):

1. Crie um banco no Turso (plano grátis) e copie a URL `libsql://...` e o token.
2. Defina `DATABASE_URL` e `DATABASE_AUTH_TOKEN` no painel da hospedagem.

As tabelas são criadas sozinhas na primeira execução. O SQL é o mesmo do modo local.

---

## Usando na aula

1. Entre em `/host` com sua senha.
2. **Meus quizzes** → crie um quiz e cadastre as perguntas (salva sozinho).
3. **Abrir sala** → aparece o PIN gigante e um **QR code**. O aluno aponta a câmera e cai
   na tela de entrada com o PIN já preenchido.
4. Quando a turma estiver na lista, **Começar**.
5. A cada pergunta: contagem 3-2-1, a pergunta no seu telão, os botões no celular deles.
6. Depois de cada pergunta: gabarito, quantos marcaram cada alternativa e o ranking.
7. No fim: pódio e **relatório da turma**.

### Atalhos durante a partida

| Tecla | Ação |
| --- | --- |
| `espaço` | encerra a pergunta / avança para a próxima |
| `+` `−` | aumenta e diminui o tamanho de tudo (fica salvo) |
| `F` | tela cheia |

---

## Perguntas com código

- **Bloco de código**: cola o trecho com indentação preservada e destaque de sintaxe
  (comentários, textos, números, palavras-chave). `Tab` indenta dentro do campo.
- **Alternativas são código**: quando as próprias opções são trechos de código.
- Crases no enunciado destacam um trecho curto: ``qual o valor de `x`?``
- As ligaduras da fonte ficam desligadas de propósito: `===` aparece como três sinais,
  não como um glifo só.

## Legibilidade no datashow

Fontes grandes, cores escurecidas e sombra no texto, pensadas para projetor fraco. Se a
sala for muito ruim, `+` algumas vezes aumenta tudo proporcionalmente — a preferência fica
salva para as próximas aulas.

## Pontuação

Quem responde mais rápido ganha mais: o acerto vale **1000 pontos** no instante em que a
pergunta aparece e cai até **500** no último segundo (metade do tempo = 750). Cada acerto
seguido a partir do segundo dá **+100**, até +500. Errar ou não responder zera a sequência.

## Relatórios

Toda partida encerrada vira um relatório: acerto médio da turma, desempenho por pergunta
(com a mais difícil destacada), tabela de alunos com o resultado de cada pergunta e
**exportação em CSV** (separador `;`, abre direto no Excel em português).

---

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `server.js` | Express + Socket.IO, arquivos estáticos, cache e endereço da sala |
| `src/db.js` | Banco: arquivo local ou Turso, mesmo SQL nos dois |
| `src/auth.js` | Senha do professor, cookie de sessão assinado |
| `src/api.js` | API de quizzes e relatórios (+ CSV) |
| `src/game.js` | Motor da partida: estado, tempo, pontuação, gravação |
| `src/perguntas.js` | Validação das perguntas |
| `public/host.html` + `js/host.js` | Biblioteca, editor, sala, partida e relatórios |
| `public/index.html` + `js/player.js` | Tela do aluno (só as alternativas) |
| `public/js/ui.js` | Formas SVG, destaque de código, relógio, confete, avisos |
| `public/css/app.css` | Sistema visual |

## Limitações conhecidas

- **Precisa de internet** para todo mundo, já que fica hospedado. Se a rede da escola for
  ruim, dá para rodar no seu notebook (`npm start`) com os alunos na mesma Wi-Fi.
- A partida vive na memória do servidor: se o servidor reiniciar no meio, a sala cai
  (os relatórios já gravados continuam). Fechar a aba do professor encerra a sala.
- Ao trocar arquivos de `public/`, suba o `?v=` nos links do HTML para os alunos não
  pegarem versão antiga em cache.
