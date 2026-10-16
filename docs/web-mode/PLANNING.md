# ZeppBridge — modo web (planejamento)

> Fork: `guiliznas/ZeppBridge` · branch `feat/web-mode` · base upstream `v3.0.1` (`7cb7650`)
> Escrito em 2026-10-16, revisado no mesmo dia.
> **Status (2026-10-16): Fases 0 e 1 do Plano A implementadas** em `web/` (ver `web/README.md`). Verificado:
> passeio no Chrome (Playwright, `pt-BR`) por 12 telas com a biblioteca real — nenhum comando sem atendimento;
> `zepp.db`/`zepp.db-wal` com hash idêntico antes/depois (só o índice `-shm` do SQLite muda, como em qualquer leitor);
> `git diff upstream/main -- src src-tauri` vazio; `cargo test` 11/11, clippy limpo.
> Pendente: comparação de fluidez Chrome × WebKitGTK; leitura concorrente com o desktop sincronizando (desktop não
> abre nesta máquina); Plano B.

## 1. Objetivo

Abrir no navegador o mesmo app Vue do desktop, consumindo a **mesma biblioteca local** (`zepp.db`) que o desktop usa —
**sem alterar uma linha do desktop (`src-tauri/src`) nem do front (`src/`)**. Tudo que é novo é aditivo e mora fora deles.

Promessa em uma frase (critério de pronto do MVP):
**"abro `http://127.0.0.1:43930` no Chrome e vejo meu dashboard, meus treinos e meu sono com os dados reais da minha biblioteca."**

Fora de escopo do MVP: escrita, sync e login (no Plano A ficam no desktop/CLI; o Plano B, seção 8, traz para o web),
envio para IA, update, tray, MCP.

## 2. Por que dá para fazer sem mexer no desktop

| Evidência no código | O que permite |
|---|---|
| `crates/core` não depende de Tauri; CLI e MCP já o usam headless | O servidor chama o core direto |
| Comandos de leitura são uma linha sobre o core: `spawn_independent_read(data_dir, \|db\| db.get_health_overview())` (`src-tauri/src/commands/data/mod.rs:68`) | Replicar os ~45 comandos de leitura é trivial e cada um abre conexão própria — igual ao desktop |
| `@tauri-apps/api` chama `window.__TAURI_INTERNALS__.invoke(...)`; o modo demo substitui esse objeto no navegador (`src/demo/runtime.ts:239`) e o app inteiro roda | Um script injetado antes do bundle troca o transporte por HTTP sem tocar no front |
| `isTauriRuntime()` (`src/lib/bridge/tauri.ts:67`) só checa a existência de `__TAURI_INTERNALS__` | Com o shim, o front escolhe o `tauriBackend` normal |

## 3. Arquitetura

```
                    ┌────────────── zeppbridge-web (NOVO: web/server, crate Rust) ──────────────┐
Navegador ──GET /──▶│ serve o dist/ do `vite build` NORMAL + injeta <script src="/zb-shim.js">   │
          ──POST /api/ipc/:cmd──▶ allowlist ──▶ handlers de leitura ──▶ zeppbridge-core ──▶ zepp.db
          ◀─GET /api/events (SSE, Fase 2)                                                  ▲
                    └───────────────────────────────────────────────────────────────────────┘ │
Desktop Tauri (INALTERADO) ───────────────────────────────────────────────────────────────────┘
```

### 3.1 `web/zb-shim.js` (novo, carregado antes do app)
- Define `window.__TAURI_INTERNALS__ = { invoke, transformCallback, convertFileSrc, metadata }` no formato que
  `@tauri-apps/api` espera (o mesmo contrato que o demo implementa).
- `invoke(cmd, args)` → `fetch('/api/ipc/' + cmd, {method:'POST', body: JSON.stringify(args), headers:{'X-ZB-Token': …}})`;
  erro HTTP → rejeita com o mesmo `{code, message}` que o Tauri devolve (o front já traduz via `toUserMessage`).
- Comandos de plugin: `plugin:opener|open_url` → `window.open`; `plugin:event|listen/unlisten` → no-op no MVP, SSE na Fase 2;
  `plugin:app|version` → valor do servidor; `plugin:dialog|*` → rejeita (escrita fica no desktop).
- Comando desconhecido / de escrita → rejeita com `err.web.read_only` (o front mostra a mensagem de erro que já existe).

### 3.2 `web/server` (novo crate, fora do workspace do desktop)
- Crate próprio em `web/server/Cargo.toml` com `zeppbridge-core = { path = "../../src-tauri/crates/core" }`.
  **Não** entra em `src-tauri/Cargo.toml` `members` → o build/CI do desktop não muda.
- Binário `zeppbridge-web --data-dir <biblioteca> [--bind 127.0.0.1:43930] [--dist ../../dist]`.
- `POST /api/ipc/:cmd` com **allowlist explícita** (match por nome → handler); fora da lista → 404.
- Handlers de leitura replicam a linha correspondente do desktop, chamando `zeppbridge_core::storage::Database`.
- Abre o banco **somente leitura** (`SQLITE_OPEN_READ_ONLY` se o core permitir; senão, nunca chamar método que escreve).
- Serve o `dist/` e injeta a tag do shim no `index.html` em tempo de resposta (sem rebuild do front).

### 3.3 Segurança (dados de saúde)
- Bind padrão `127.0.0.1`; recusa bind não-loopback sem flag explícita (mesma regra do `local_api` do core).
- Token gerado no start, mostrado no terminal, entregue ao shim via cookie `HttpOnly; SameSite=Strict`; `/api/*` exige o token.
- Checagem do header `Host` (`127.0.0.1:<porta>`/`localhost:<porta>`) contra DNS rebinding. Sem CORS.

### 3.4 Convivência com o desktop
- Leitura concorrente com o desktop aberto: o desktop já faz leituras com conexões independentes enquanto sincroniza;
  o servidor é só mais um leitor. Validar com o desktop sincronizando ao mesmo tempo (Fase 1).
- Dados novos aparecem no web depois que o desktop sincroniza (recarregar a página). Sync pelo web só na Fase 3, se quiser.

## 4. Comandos por fase

| Grupo | Exemplos | Fase |
|---|---|---|
| **Leitura** (~45) | `app_is_ready`, `get_app_status`, `get_capability_overview`, `get_health_overview`, `get_*_series`, `get_metric_baselines`, `get_hourly_steps`, `get_training_balance`, `get_heart_rate_zones`, `get_recent_sleep`, `get_recent_workouts`, `get_sleep_page`, `get_workout_page`, `get_sleep_detail`, `get_workout_detail`, `get_workout_series`, `get_daily_heart_rate_extremes`, `get_device_profile(s)`, `get_data_health`, `get_workout_insight`, `get_weekly_report`, `get_user_prefs`, `list_life_events`, `card_collection_get`, `ai_task_list/get`, `ai_template_list`, `training_plan_state`, `get_official_status`, `get_storage_estimate`, `get_coverage_ledger` | 1 |
| **Escrita local** | prefs, eventos de vida, overrides, tarefas/templates de IA, plano de treino (rascunho), export como download | 2 (opcional) |
| **Conta e sync** | login oficial, sync incremental/histórico, progresso via SSE | 3 (opcional) |
| **Nunca** | login legado por WebView, autopaste de IA, abrir pasta, update, tray, sidecar MCP, `local_api::*` | — |

A lista exata da Fase 1 sai de um script na Fase 0: comandos que o front chama nas telas do MVP × assinaturas em `src-tauri/src`.

## 5. Fases

### Fase 0 — Spike (½ dia)
1. `npm ci && npm run dev` → `?demo=1` no Chrome × desktop: responde se a lentidão (#133) é do WebKitGTK.
2. Spike: `web/server` com **um** comando (`get_app_status`) + shim mínimo, contra uma **cópia** da biblioteca real.
3. Listar quais comandos as telas do MVP chamam (instrumentar o shim para logar comandos não atendidos — o demo faz igual com `missing`).
- **Pronto quando:** o status do app aparece no Chrome com dados reais, vindos por HTTP.

### Fase 1 — MVP somente leitura (1–2 dias)
1. Handlers dos comandos de leitura levantados na Fase 0; allowlist; token; `Host`; servir `dist/` + shim.
2. Testes: Rust — teste de router por comando contra um `zepp.db` de fixture; **paridade** — mesmo JSON que o desktop
   devolve (comparar com a saída do handler original/CLI para a mesma biblioteca).
3. Confirmar com `git diff upstream/main --stat -- src src-tauri` que **nada** do desktop/front mudou.
- **Pronto quando:** a promessa da seção 1 foi **percorrida no navegador** (dashboard, lista + detalhe de treino, sono)
  com a biblioteca real, inclusive com o desktop aberto sincronizando.

### Fase 2 (opcional) — Escrita local + eventos
Handlers de escrita, SSE para `listen`, downloads. Exige decidir o lock de escrita com o desktop aberto.

### Fase 3 (opcional) — Conta e sync pelo navegador
Login oficial (já é "abre URL + polling") e sync com progresso por SSE.

### Fase 4 — Empacotamento
Binário único com `dist/` embutido; `web/Dockerfile`; unit systemd de usuário; `web/README.md`.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Upstream muda assinatura de comando ou da API do core | Mudança no core quebra a compilação do `web/server` (sinal claro); mudança no front aparece como comando não atendido no log do shim. Rebase periódico |
| Upstream muda o contrato de `__TAURI_INTERNALS__` ao atualizar `@tauri-apps/api` | O demo do próprio upstream depende do mesmo contrato — se quebrar, quebra lá também; fixar a versão testada |
| Front assume Tauri fora do `invoke` (`main.ts:25,39`, `UpdateNotice.vue:17`) | Com `__TAURI_INTERNALS__` presente, esses caminhos rodam: o shim responde aos comandos de plugin que eles chamam |
| Leitura concorrente durante sync do desktop | Conexão independente por leitura, como o desktop; teste explícito na Fase 1 |
| Exposição de dados de saúde | Loopback, token, `Host`, sem CORS; banco aberto só para leitura |

## 7. À parte: correção do AppImage

O passo "Let the AppImage use the host graphics stack" (`.github/workflows/ci.yml:727`) remove só `libwayland-*`/GL.
O AppImage segue com glib 2.80 e o núcleo do GStreamer 1.24 embutidos, **sem plugins**; o WebKit carrega os plugins
GStreamer e os módulos GIO do host (1.28 no Ubuntu 26.04) → `undefined symbol: g_variant_builder_init_static` + segfault.
Hipótese ainda **não verificada pelo fluxo** (falta testar a cópia com libs do sistema em `~/aawz-tmp/zeppbridge/run-system`).
Candidato a PR upstream independente.

## 8. Plano A × Plano B

**Plano A (seções 1–6): web lê, desktop sincroniza.** O desktop **não precisa estar aberto** para ver os dados — o web lê o
`zepp.db` direto. O desktop só é necessário para (1) conectar a conta e (2) trazer dados novos. Atalho que já existe:
depois de conectar uma vez pelo desktop, o **`zeppbridge-cli sync` num timer** (systemd/cron, ou o Docker oficial) mantém a
biblioteca atualizada sem abrir o desktop.

**Plano B: só web, nenhum desktop em momento algum.** Continua sem alterar `src/` nem `src-tauri/src`. O `web/server` passa a
fazer também o que o desktop faz para popular a biblioteca, usando só o core:

| Peça | Evidência de que dá sem Tauri | O que o `web/server` implementa |
|---|---|---|
| Login oficial (OAuth `api-open.zepp.com`) | Lógica toda em `zeppbridge_core::official` (`AuthorizationRequest`, `OfficialClient::claim`, `OfficialStore`, `fresh_tokens`); o Tauri só abre a URL e faz polling (`src-tauri/src/commands/official.rs:159-300`) | Comandos `start_official_login` / `cancel_official_login` / `get_official_status`: devolve a URL (o shim faz `window.open`) e roda o polling num `tokio::spawn` |
| Login do canal antigo (`api-mifit*`) | `manual_auth(app_token, user_id, region_host)` só salva via `AuthManager` | O formulário de token manual que o front já tem. O login por WebView (`start_web_login`) fica de fora |
| Sync | `zeppbridge-cli` sincroniza só com o core (`crates/cli/src/cmd_sync.rs:53,123`); canal oficial em `core::sync::official` | `start_incremental_sync` / `start_history_sync` / `cancel_sync` + progresso por SSE (`sync:*`) |
| Sync automático | O desktop sincroniza em segundo plano | Agendador interno (`tokio::time::interval`) ou timer do sistema chamando o CLI |
| Escrita | Rotinas de escrita do core (`Database::open_migrated`, prefs, overrides…) | Banco aberto em leitura-escrita; o servidor é o **único** escritor (sem desktop, sem conflito de lock) |

Dependências externas (iguais às do desktop, não novas): o login oficial passa pelo intermediário Cloudflare do upstream
(`zeppbridge.pages.dev`, que guarda o App Secret) — o callback do OAuth está registrado lá.
A verificar na Fase 0 do Plano B: (1) se o canal oficial sozinho traz todos os dados das telas do MVP ou se o canal antigo
cobre coisas que ele não cobre (o comentário em `commands/sync.rs:343` sugere que os dois se complementam);
(2) se o callback do intermediário aceita um cliente que não é o desktop sem nenhuma mudança.

Ordem sugerida: **Plano A (MVP leitura) → Plano B por cima** — o B reaproveita tudo do A (server, shim, segurança) e acrescenta
login + sync + escrita. Estimativa adicional do B: 2–3 dias.

## 9. Decisões em aberto

1. **Onde roda:** só `127.0.0.1` (default assumido) ou também na rede/NAS (exige auth de verdade + TLS)?
2. **Meta final:** Plano A + CLI no timer (desktop só para conectar a conta uma vez) ou Plano B completo (zero desktop)?
