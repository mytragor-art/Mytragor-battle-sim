# Mytragor Sim

Simulador multiplayer com frontend em Vite + TypeScript e backend em Colyseus + Express.

## Ambientes

O projeto foi preparado para trabalhar com dois ambientes:

- `teste`: seu simulador pessoal para experimentar cartas, imagens e regras novas.
- `producao`: versão estável para os jogadores.

O recomendado é manter um único repositório com duas branches:

- `main`: produção.
- `dev`: teste.

Fluxo sugerido:

1. Você desenvolve e valida na branch `dev`.
2. Publica o ambiente de teste usando as variáveis de `teste`.
3. Quando aprovar, faz merge para `main`.
4. Publica a versão dos jogadores com as variáveis de `producao`.

## Configuração do cliente

O frontend agora aceita a URL do backend por variável de ambiente `VITE_SERVER_URL`.

Arquivos de exemplo:

- `client/.env.test.example`
- `client/.env.production.example`

Exemplo local para teste:

```bash
cd client
copy .env.test.example .env.test
npm.cmd run dev:test
```

Se nenhuma variável for definida, o cliente usa automaticamente o host atual com porta `2567`.

## Configuração do servidor

O backend aceita:

- `PORT`: porta do servidor Colyseus.
- `CORS_ORIGIN`: origem ou lista de origens liberadas, separadas por vírgula.

Arquivos de exemplo:

- `server/.env.test.example`
- `server/.env.production.example`

Exemplo local:

```bash
cd server
npm install
npm run dev
```

Sem `CORS_ORIGIN`, o servidor aceita qualquer origem. Para produção, defina explicitamente o domínio do client.

## Scripts do cliente

```bash
cd client
npm install
npm.cmd run dev
npm.cmd run dev:test
npm.cmd run build:test
npm.cmd run build:prod
```

Os builds do cliente agora regeneram automaticamente as miniaturas em `client/public/publicadas` antes do `vite build`.
Isso evita que a grade do deckbuilder e de decks salvos fique com thumbs antigas quando a arte original muda mantendo o mesmo nome.

## Combate: Interpor e Desafio

Desafio continua restringindo a escolha do alvo inicial do ataque. Depois de declarado um ataque válido,
outro aliado com Interpor pode bloquear, mesmo quando o alvo tem Desafio. O bloqueador precisa estar
vivo e não exaurido; ao interpor, fica exaurido e recebe o ataque no lugar do alvo original.

Teste de regressão (servidor e cliente): `npm.cmd --prefix server run build`, seguido de
`npm.cmd --prefix client run smoke:interpor-combat`.

## Apresentação do campo

Os campos são espelhados verticalmente: aliados e Escolhidos ficam frente a frente, perto do centro,
e os fragmentos nas bordas externas (os do oponente no alto, os seus embaixo). Os fragmentos mantêm
o tamanho de carta e a sobreposição horizontal; aliados, Escolhidos e ambientes são um pouco maiores.
A faixa de identificação e os intervalos junto aos controles centrais são compactos para aproximar
os personagens sem reduzir o tamanho das cartas.
Fragmentos disponíveis mostram a frente; indisponíveis mostram o verso, sem transparência.
Os slots de ambiente ficam dentro de cada playmat, à lateral e perto da divisória central, sem
moldura ou título adicional. No celular em pé, ficam na mesma lateral das pilhas para não reduzir
a largura dos aliados. Os mesmos slots e ações de consulta e arraste são preservados.
Equipamentos vinculados mostram uma faixa sob seu personagem, também espelhada no campo do oponente;
passe o mouse ou use a consulta por toque para ver a carta inteira.
As faixas são compactas e a linha de suportes não estica os espaços vazios: os fragmentos continuam
abaixo dos aliados, mas ficam mais próximos deles (com o movimento espelhado para o oponente).
Suportes sem vínculo continuam em sua própria faixa. Slots, índices, regras e ações não são alterados
por essa organização visual.

A mão do jogador fica sobreposta à borda inferior, podendo cobrir parte dos fragmentos sem reservar
uma faixa que reduza o campo. As cartas formam um leque discreto, centralizado, com sobreposição
adaptativa e destaque por mouse ou teclado. Quando a quantidade não cabe sem prejudicar a seleção,
a mão permite rolagem horizontal, inclusive por toque. Os custos ficam na parte exposta das cartas;
no PC, a altura da mão acompanha o espaço liberado pelos fragmentos, mantendo a maior parte das cartas
visível, e somente a carta apontada ou focada sobe para consulta.
Cliques, arraste e consulta por toque são preservados. Em celulares deitados, a base da mão é recortada
para não invadir a linha dos personagens; a consulta continua mostrando a carta inteira.
Na preparação do seu turno, todas as cartas com custo disponível e condições de entrada atendidas
recebem brilho, independentemente da seleção. O destaque acompanha os fragmentos restantes a cada
atualização da partida. Truques reativos não recebem esse brilho: seus gatilhos continuam sendo
oferecidos pelas escolhas de reação existentes.
Os destaques usam contorno luminoso e halo curto: dourado para cartas jogáveis, atacante selecionado
e poder do Escolhido; vermelho para atacantes disponíveis; verde para alvos válidos; coral para
o alvo apontado; azul para escolhas de efeito; turquesa para destino de arraste. A aura do Escolhido
pulsa suavemente apenas no contorno e fica estática com a preferência de movimento reduzido.
Efeitos com alvos identificáveis no campo, como Mãos Flamejantes, permitem escolher diretamente nas
cartas destacadas, por clique, toque ou Enter/Espaço, sem abrir modal. Uma indicação curta mostra
a instrução, o prazo e as opções de cancelar ou confirmar seleções múltiplas, quando permitidas.
Os mesmos IDs e limites de escolha são enviados ao servidor; dano, custos, gatilhos e regras não mudam.
Buscas, cartas fora da mesa e escolhas ambíguas continuam no modal original centralizado.
Os modais de confirmação de ataque e espera também permanecem na posição original.

Escolhas diretas revisadas no catálogo:

- Dano e cura: Mãos Flamejantes, Aranhas Negras, Milícia (as duas etapas), Cervo de Galhos Brancos,
  Pica-pau Agulheiro, Troca de Energia, Tônico Revigorante, Fruto Abençoado, Redoma Santa e o poder de Leafae.
- Controle, bônus e remoção: Aranhas Negras, Executor, Goblin Sabotador, Profanação de Terreno,
  Controle de Correntezas, Quebra-Aço, Sede de Vingança, Invasão de Cativeiro e Bem Treinado.
- Catedral Ensolarada, pagamento alternativo com Aranhas Negras, Agiota e substituição de aliados
  também usam os alvos do campo. Em cartas de escolha A/B, a decisão do efeito continua no modal;
  somente a etapa seguinte de selecionar um alvo no campo dispensa o modal.
- Interpor permite clicar no bloqueador: Jabuti Barreira, Gladiador Impenetrável, Aerin Nieloy e O Protetor.
  A opção de não interpor permanece disponível na indicação da escolha.
- Para equipar Lâmina Serralhada, Manto de Couro, Orbe de Absorção, Redoma Santa,
  Aranhas Negras, Quelíceras ou Livro Arcano Instável, clique diretamente no portador destacado.
  Ao destruir ou deslocar equipamentos acoplados, os elegíveis se abrem temporariamente em cartas
  inteiras separadas, sobre a faixa de suportes/fragmentos, sem cobrir os portadores ou redimensionar
  o campo. A mão fica oculta apenas durante essa seleção para não cobrir os equipamentos.
  Ao escolher, cancelar ou esgotar o prazo, as faixas compactas e a mão voltam ao normal.

Escolhas da mão, deck e cemitério continuam no modal, mesmo quando existe uma cópia idêntica no campo.
Isso inclui buscas, descartes, Orbe de Absorção e a decisão de topo do Livro Arcano Instável;
confirmações de ativação de truques também permanecem no modal.
Efeitos de entrada reavaliam os alvos quando a atualização do campo chega, sem reiniciar o prazo da escolha.

Testes de apresentação: `npm.cmd --prefix client run smoke:field-layout` e
`npm.cmd --prefix client run smoke:hand-layout`.
Testes de escolhas: `npm.cmd --prefix client run smoke:field-choice`; para conferir o catálogo
contra as escolhas reais do motor, execute `npm.cmd --prefix server run build` e depois
`npm.cmd --prefix client run smoke:field-choice-catalog`.

## Estatísticas de uso (sem Vercel Pro)

Abra `/stats.html` no frontend ou use o link **Estatísticas** na página inicial.
O painel consulta o backend configurado em `VITE_SERVER_URL` e não usa eventos pagos da Vercel.

- Escolhidos: participações em partidas que chegaram à abertura do mulligan.
- Cartas nos baralhos: uma ocorrência por carta diferente em cada baralho; cópias são exibidas separadamente.
- Jogadas: cartas resolvidas da mão que emitem `card_played`, inclusive gratuitas. Não inclui tokens gerados nem reações que só emitem `effect_log`.
- Filtros: PvP (os dois jogadores), Solo (humano), IA (oponente solo), ou todos; últimos 7, 30 ou 90 dias UTC.
- Sem histórico retroativo, nomes de jogadores, nomes/IDs de baralhos, IPs, sessões ou listas de partidas armazenados. O ranking agregado é público e somente leitura.
- Reconexões e espectadores não contam novamente. Não há polling no painel. Gravações são agrupadas a cada 5 segundos; uma parada abrupta pode perder o último lote.

### Persistência no Railway — configuração necessária em produção

O arquivo local **não sobrevive obrigatoriamente a redeploys** em discos efêmeros.
No serviço do backend, configure um volume persistente, por exemplo montado em `/data`.
O coletor usa automaticamente `RAILWAY_VOLUME_MOUNT_PATH`, ou defina `USAGE_STATS_FILE=/data/usage-stats.json`.
Somente configurar a variável **não cria um volume**. O painel avisa quando o caminho persistente não está configurado ou houve erro de armazenamento.
Sem configuração, desenvolvimento local usa `server/.data/usage-stats.json` (quando iniciado pelo script do servidor), ignorado pelo Git.

Este armazenamento é para **uma única instância do backend**, não múltiplas réplicas escrevendo o mesmo arquivo. Para escalar, migrar para banco compartilhado.
Nenhuma infraestrutura paga é provisionada pelo código; confirme a disponibilidade e custo de volumes no plano do seu provedor.

API pública: `GET /usage-stats?mode=solo&days=30` (sem rota pública de escrita).
Teste isolado: `npm.cmd --prefix server run test:usage`.

## GitHub

Foi adicionada uma raiz `.gitignore` para evitar subir:

- `node_modules`
- `dist`
- arquivos `.env`
- logs e arquivos temporários do sistema

Antes de publicar no GitHub, crie seus arquivos reais de ambiente a partir dos arquivos `.example`.

Depois disso, o fluxo é:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git checkout -b dev
```

## Execução local atual

Servidor:

```bash
cd server
npm.cmd run dev
```

Cliente:

```bash
cd client
npm.cmd run dev
```

Depois abra a URL mostrada pelo Vite, normalmente `http://localhost:5173`.
