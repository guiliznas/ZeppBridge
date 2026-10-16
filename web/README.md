# ZeppBridge web (somente leitura)

Abre o app do ZeppBridge num navegador comum, lendo a mesma biblioteca local que o desktop usa.
Nada em `src/` (front) ou `src-tauri/` (desktop) foi alterado: tudo vive aqui em `web/`.

```
Navegador ── GET / ──────────────▶ zeppbridge-web ── serve dist/ + injeta zb-shim.js
          ── POST /api/ipc/:cmd ─▶ allowlist ──▶ zeppbridge-core ──▶ zepp.db (somente leitura)
```

- `shim/zb-shim.js` cria um `window.__TAURI_INTERNALS__` que manda cada `invoke` por HTTP — o mesmo truque que o modo
  demo do projeto usa (`src/demo/runtime.ts`). O front acha que está no desktop.
- `server/` é um crate Rust com workspace próprio (fora de `src-tauri/Cargo.toml`): o build do desktop não muda.
  Reaproveita `src-tauri/src/ipc_types.rs` e `ipc_error.rs` por `#[path]`, sem cópia.

## Rodar

```bash
npm ci                      # se o npm 12 recusar a URL do zrender no lockfile: npx -y npm@10 ci
npm run build               # gera dist/ (o mesmo build do desktop)
cd web/server
cargo run --release         # ou: cargo run --release -- --data-dir /caminho/da/biblioteca
```

Abra o link impresso no terminal (`http://127.0.0.1:43930/?token=…`). O token muda a cada execução.

| Opção | Padrão |
|---|---|
| `--data-dir` | `ZEPPBRIDGE_DATA_DIR`, senão `~/.local/share/zeppbridge/data` (a pasta do desktop). Nunca cria pasta. |
| `--dist` | `<repo>/dist` |
| `--bind` | `127.0.0.1:43930`. Fora do loopback exige `--allow-remote` |

## O que funciona

Visão geral, recentes, corpo, treino, coração, atividade, sono (lista e detalhe), treinos (lista, detalhe, séries,
análise), dispositivos, verificação de saúde dos dados, configurações (leitura) — com a biblioteca real.

## Limitações (Plano A)

- **Não sincroniza.** Dados novos chegam pelo app desktop ou pelo `zeppbridge-cli sync` (que pode rodar num timer).
  O app tenta um sync ao abrir e mostra "Falha na sincronização" com a explicação — esperado neste modo.
- **Não escreve:** preferências, correções, eventos, tarefas de IA, backups e export ficam no desktop por enquanto.
- API local e sidecar MCP respondem "disponível só no app desktop".
- Abrir a biblioteca enquanto o desktop sincroniza não foi testado (o desktop não abre nesta máquina).

## Segurança

- Só loopback por padrão; token por sessão no link do terminal → cookie `HttpOnly; SameSite=Strict`.
- Header `Host` conferido (bloqueia DNS rebinding); `/api/*` exige o header `X-ZB-Request` do shim; sem CORS.
- Allowlist explícita de comandos; tudo é aberto com `Database::open_read_only`.

## Testes

```bash
cd web/server && cargo test && cargo clippy --all-targets
```
