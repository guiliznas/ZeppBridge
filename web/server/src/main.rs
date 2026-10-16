//! `zeppbridge-web`: o app do ZeppBridge num navegador comum.
//!
//! Serve o `dist/` do `vite build` normal e injeta `zb-shim.js`, que cria um `window.__TAURI_INTERNALS__`
//! encaminhando cada `invoke` para `POST /api/ipc/:comando`. O front acha que está no desktop e não muda
//! uma linha; o desktop também não muda: este crate lê a mesma biblioteca pelo `zeppbridge-core`.
//!
//! Segurança (são dados de saúde): só loopback por padrão, token no estilo Jupyter (link impresso no
//! terminal → cookie `HttpOnly; SameSite=Strict`), checagem do header `Host` contra DNS rebinding, sem CORS.

mod commands;
mod devices;
mod http;
mod status;

// Arquivos do desktop reaproveitados sem cópia: só dependem do core e do serde.
// `ipc_types.rs` usa `crate::{models, storage, sync}`, por isso as reexportações abaixo.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/ipc_types.rs"]
mod ipc_types;
#[allow(dead_code)]
#[path = "../../../src-tauri/src/ipc_error.rs"]
mod ipc_error;

pub use zeppbridge_core::{models, storage, sync};

use std::net::SocketAddr;
use std::path::PathBuf;

const DEFAULT_BIND: &str = "127.0.0.1:43930";

struct Args {
    data_dir: PathBuf,
    dist_dir: PathBuf,
    bind: SocketAddr,
    allow_remote: bool,
}

fn usage() -> ! {
    eprintln!(
        "uso: zeppbridge-web [--data-dir <biblioteca>] [--dist <pasta dist do vite>] [--bind {DEFAULT_BIND}] [--allow-remote]\n\
         \n\
         --data-dir   padrão: ZEPPBRIDGE_DATA_DIR ou a pasta que o desktop usa (~/.local/share/zeppbridge/data)\n\
         --dist       padrão: <repo>/dist (gere com `npm run build`)\n\
         --bind       padrão: {DEFAULT_BIND}; endereço fora do loopback exige --allow-remote"
    );
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut data_dir = None;
    let mut dist_dir = None;
    let mut bind = DEFAULT_BIND.to_string();
    let mut allow_remote = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => data_dir = Some(PathBuf::from(args.next().unwrap_or_else(|| usage()))),
            "--dist" => dist_dir = Some(PathBuf::from(args.next().unwrap_or_else(|| usage()))),
            "--bind" => bind = args.next().unwrap_or_else(|| usage()),
            "--allow-remote" => allow_remote = true,
            "-h" | "--help" => usage(),
            other => {
                eprintln!("argumento desconhecido: {other}");
                usage();
            }
        }
    }
    let data_dir = data_dir.or_else(default_data_dir).unwrap_or_else(|| {
        eprintln!("não consegui achar a biblioteca do ZeppBridge. Use --data-dir.");
        std::process::exit(2);
    });
    let dist_dir = dist_dir
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist"));
    let bind: SocketAddr = bind.parse().unwrap_or_else(|_| {
        eprintln!("--bind inválido: {bind} (esperado host:porta, ex. {DEFAULT_BIND})");
        std::process::exit(2);
    });
    Args { data_dir, dist_dir, bind, allow_remote }
}

/// Biblioteca padrão SEM criar nada: `ZEPPBRIDGE_DATA_DIR`, senão a pasta XDG que o desktop empacotado usa
/// (`~/.local/share/zeppbridge/data`). Não usa `paths::resolve_data_dir()` do core de propósito: ela cria a
/// pasta e grava um arquivo de teste de escrita, e para um binário dentro de `target/` aponta para `<repo>/data`.
fn default_data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(zeppbridge_core::paths::DATA_DIR_ENV).filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    // Mesma regra de `user_data_dir()` em `src-tauri/crates/core/src/paths.rs`.
    directories::ProjectDirs::from("com", "zeppbridge", "ZeppBridge").map(|project| project.data_dir().join("data"))
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).expect("gerador aleatório do sistema indisponível");
    hex::encode(bytes)
}

#[tokio::main]
async fn main() {
    let args = parse_args();

    if !args.bind.ip().is_loopback() && !args.allow_remote {
        eprintln!(
            "recusado: {} não é loopback. Seus dados de saúde ficariam acessíveis na rede.\n\
             Se é isso mesmo, repita com --allow-remote (e ponha um proxy com TLS na frente).",
            args.bind
        );
        std::process::exit(2);
    }
    if !args.data_dir.join("zepp.db").is_file() {
        eprintln!(
            "não há zepp.db em {}. Conecte a conta no desktop (ou rode o zeppbridge-cli sync) primeiro.",
            args.data_dir.display()
        );
        std::process::exit(2);
    }
    let index_html = match std::fs::read_to_string(args.dist_dir.join("index.html")) {
        Ok(html) => html,
        Err(error) => {
            eprintln!(
                "não li {}/index.html ({error}). Gere o front com `npm run build` ou passe --dist.",
                args.dist_dir.display()
            );
            std::process::exit(2);
        }
    };

    let token = random_token();
    let state = http::ServerState::new(
        args.data_dir.clone(),
        args.dist_dir.clone(),
        &index_html,
        token.clone(),
        args.bind,
    );
    let listener = tokio::net::TcpListener::bind(args.bind).await.unwrap_or_else(|error| {
        eprintln!("não consegui escutar em {}: {error}", args.bind);
        std::process::exit(1);
    });

    println!("ZeppBridge web — biblioteca: {}", args.data_dir.display());
    println!("Abra este link (contém o token de acesso desta sessão):");
    println!("  http://{}/?token={token}", args.bind);

    axum::serve(listener, http::router(state)).await.unwrap_or_else(|error| {
        eprintln!("servidor parou: {error}");
        std::process::exit(1);
    });
}
