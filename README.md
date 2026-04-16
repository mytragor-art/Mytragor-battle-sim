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

