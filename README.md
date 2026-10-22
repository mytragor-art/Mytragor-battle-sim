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

