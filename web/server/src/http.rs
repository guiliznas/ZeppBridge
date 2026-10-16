//! Rotas, autenticação e arquivos estáticos.

use crate::commands;
use axum::body::{Body, Bytes};
use axum::extract::{Path as AxPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const COOKIE_NAME: &str = "zb_token";
/// O shim manda este header em toda chamada. Um formulário de outro site não consegue mandar header
/// customizado sem CORS — segunda barreira além do cookie `SameSite=Strict`.
const REQUEST_HEADER: &str = "x-zb-request";
const SHIM_JS: &str = include_str!("../../shim/zb-shim.js");

#[derive(Clone)]
pub struct ServerState(Arc<Inner>);

struct Inner {
    data_dir: PathBuf,
    dist_dir: PathBuf,
    index_html: String,
    token: String,
    /// Hosts aceitos no header `Host`; vazio = não checa (só com `--allow-remote`, atrás de proxy).
    allowed_hosts: Vec<String>,
}

impl ServerState {
    pub fn new(
        data_dir: PathBuf,
        dist_dir: PathBuf,
        index_html: &str,
        token: String,
        bind: SocketAddr,
    ) -> Self {
        let allowed_hosts = if bind.ip().is_loopback() {
            let port = bind.port();
            vec![format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")]
        } else {
            Vec::new()
        };
        Self(Arc::new(Inner {
            data_dir,
            dist_dir,
            index_html: inject_shim(index_html),
            token,
            allowed_hosts,
        }))
    }

    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }
}

/// `<base href="/">`: o Vite gera caminhos relativos (`base: './'`) e o router usa history mode;
/// sem isso, recarregar `/workouts/123` pediria `/workouts/assets/…`.
/// O shim entra como script clássico no `<head>`, então roda antes dos `type="module"` do app.
fn inject_shim(index_html: &str) -> String {
    let tags = "<base href=\"/\"><script src=\"/zb-shim.js\"></script>";
    match index_html.find("<head>") {
        Some(at) => {
            let insert_at = at + "<head>".len();
            format!("{}{}{}", &index_html[..insert_at], tags, &index_html[insert_at..])
        }
        None => format!("{tags}{index_html}"),
    }
}

pub fn router(state: ServerState) -> Router {
    Router::new()
        .route("/api/ipc/:command", post(ipc))
        .fallback(static_or_index)
        .layer(axum::middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}

fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value)
}

fn query_token(uri: &Uri) -> Option<&str> {
    uri.query()?
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == "token")
        .map(|(_, value)| value)
}

/// Comparação em tempo constante: o token é a única credencial.
fn same_token(given: &str, expected: &str) -> bool {
    given.len() == expected.len()
        && given.bytes().zip(expected.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn plain(status: StatusCode, text: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text.to_string()).into_response()
}

async fn guard(State(state): State<ServerState>, request: Request, next: axum::middleware::Next) -> Response {
    let inner = &state.0;

    if !inner.allowed_hosts.is_empty() {
        let host = request.headers().get(header::HOST).and_then(|value| value.to_str().ok());
        if !host.is_some_and(|host| inner.allowed_hosts.iter().any(|allowed| allowed == host)) {
            return plain(StatusCode::MISDIRECTED_REQUEST, "Host não permitido.");
        }
    }

    // Link do terminal: troca o token da URL por um cookie e limpa a URL.
    if request.method() == Method::GET {
        if let Some(given) = query_token(request.uri()) {
            if !same_token(given, &inner.token) {
                return plain(StatusCode::UNAUTHORIZED, "Token inválido. Use o link impresso no terminal do zeppbridge-web.");
            }
            let cookie = format!("{COOKIE_NAME}={}; HttpOnly; SameSite=Strict; Path=/", inner.token);
            return Response::builder()
                .status(StatusCode::SEE_OTHER)
                .header(header::LOCATION, request.uri().path())
                .header(header::SET_COOKIE, cookie)
                .body(Body::empty())
                .expect("resposta de redirecionamento válida");
        }
    }

    let authorized = cookie_token(request.headers()).is_some_and(|given| same_token(given, &inner.token));
    if !authorized {
        return plain(
            StatusCode::UNAUTHORIZED,
            "Sem acesso. Abra o link com ?token=… impresso no terminal do zeppbridge-web.",
        );
    }
    if request.uri().path().starts_with("/api/") && !request.headers().contains_key(REQUEST_HEADER) {
        return plain(StatusCode::FORBIDDEN, "Chamada de API sem o header do shim.");
    }
    next.run(request).await
}

async fn ipc(State(state): State<ServerState>, AxPath(command): AxPath<String>, body: Bytes) -> Response {
    let args: serde_json::Value = if body.is_empty() {
        serde_json::Value::Object(Default::default())
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(error) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "err.web.bad_args",
                    &format!("argumentos de {command} não são JSON válido: {error}"),
                )
            }
        }
    };
    match commands::dispatch(state.data_dir(), &command, args).await {
        commands::Outcome::Ok(value) => (StatusCode::OK, axum::Json(value)).into_response(),
        commands::Outcome::Err(error) => (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(error)).into_response(),
        commands::Outcome::Unknown => json_error(
            StatusCode::NOT_FOUND,
            "err.web.unsupported",
            &format!("o modo web ainda não atende o comando {command}"),
        ),
    }
}

fn json_error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, axum::Json(serde_json::json!({ "code": code, "message": message }))).into_response()
}

async fn static_or_index(State(state): State<ServerState>, uri: Uri) -> Response {
    let path = uri.path();
    if path == "/zb-shim.js" {
        return ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], SHIM_JS).into_response();
    }
    if path.starts_with("/api/") {
        return plain(StatusCode::NOT_FOUND, "rota de API inexistente");
    }
    if let Some(file) = safe_dist_path(&state.0.dist_dir, path) {
        if file.is_file() && file.file_name().is_some_and(|name| name != "index.html") {
            if let Ok(bytes) = tokio::fs::read(&file).await {
                let mime = mime_guess::from_path(&file).first_or_octet_stream();
                let mut response = Response::new(Body::from(bytes));
                if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
                    response.headers_mut().insert(header::CONTENT_TYPE, value);
                }
                return response;
            }
        }
    }
    // SPA: qualquer outra rota é o app.
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-store")],
        state.0.index_html.clone(),
    )
        .into_response()
}

/// Caminho dentro de `dist/`, recusando `..` e caminhos absolutos.
fn safe_dist_path(dist: &Path, url_path: &str) -> Option<PathBuf> {
    let relative = Path::new(url_path.trim_start_matches('/'));
    if relative.components().any(|part| !matches!(part, Component::Normal(_))) {
        return None;
    }
    Some(dist.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_shim_goes_right_after_head() {
        let html = inject_shim("<html><head><script type=\"module\" src=\"./a.js\"></script></head></html>");
        assert!(html.starts_with("<html><head><base href=\"/\"><script src=\"/zb-shim.js\"></script><script type=\"module\""));
    }

    #[test]
    fn safe_dist_path_rejects_traversal() {
        let dist = Path::new("/srv/dist");
        assert_eq!(safe_dist_path(dist, "/assets/a.js"), Some(PathBuf::from("/srv/dist/assets/a.js")));
        assert_eq!(safe_dist_path(dist, "/../etc/passwd"), None);
        assert_eq!(safe_dist_path(dist, "/assets/../../x"), None);
    }

    mod routes {
        use super::super::*;
        use axum::http::Request;
        use tower::ServiceExt;

        const TOKEN: &str = "t0k3n";

        fn app() -> Router {
            let bind: SocketAddr = "127.0.0.1:43930".parse().unwrap();
            let state = ServerState::new(
                PathBuf::from("/nonexistent-library"),
                PathBuf::from("/nonexistent-dist"),
                "<html><head></head><body>app</body></html>",
                TOKEN.to_string(),
                bind,
            );
            router(state)
        }

        async fn send(request: Request<Body>) -> Response {
            app().oneshot(request).await.unwrap()
        }

        fn get(uri: &str) -> axum::http::request::Builder {
            Request::builder().uri(uri).header(header::HOST, "127.0.0.1:43930")
        }

        #[tokio::test]
        async fn without_cookie_is_401() {
            assert_eq!(send(get("/").body(Body::empty()).unwrap()).await.status(), StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn foreign_host_is_rejected_even_with_valid_token() {
            let request = Request::builder()
                .uri(format!("/?token={TOKEN}"))
                .header(header::HOST, "evil.example:43930")
                .body(Body::empty())
                .unwrap();
            assert_eq!(send(request).await.status(), StatusCode::MISDIRECTED_REQUEST);
        }

        #[tokio::test]
        async fn token_link_sets_strict_httponly_cookie_and_cleans_url() {
            let response = send(get(&format!("/workouts?token={TOKEN}")).body(Body::empty()).unwrap()).await;
            assert_eq!(response.status(), StatusCode::SEE_OTHER);
            assert_eq!(response.headers()[header::LOCATION], "/workouts");
            let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
            assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"), "{cookie}");
        }

        #[tokio::test]
        async fn wrong_token_link_is_401() {
            assert_eq!(send(get("/?token=nope").body(Body::empty()).unwrap()).await.status(), StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn api_without_shim_header_is_403() {
            let request = get("/api/ipc/get_app_status")
                .method(Method::POST)
                .header(header::COOKIE, format!("{COOKIE_NAME}={TOKEN}"))
                .body(Body::empty())
                .unwrap();
            assert_eq!(send(request).await.status(), StatusCode::FORBIDDEN);
        }

        #[tokio::test]
        async fn command_outside_allowlist_is_404_with_code() {
            let request = get("/api/ipc/clear_auth")
                .method(Method::POST)
                .header(header::COOKIE, format!("{COOKIE_NAME}={TOKEN}"))
                .header(REQUEST_HEADER, "1")
                .body(Body::empty())
                .unwrap();
            let response = send(request).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            let body = http_body_util::BodyExt::collect(response.into_body()).await.unwrap().to_bytes();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(json["code"], "err.web.unsupported");
        }

        #[tokio::test]
        async fn spa_route_serves_index_with_shim() {
            let request = get("/sleep/abc").header(header::COOKIE, format!("{COOKIE_NAME}={TOKEN}")).body(Body::empty()).unwrap();
            let response = send(request).await;
            assert_eq!(response.status(), StatusCode::OK);
            let body = http_body_util::BodyExt::collect(response.into_body()).await.unwrap().to_bytes();
            assert!(String::from_utf8_lossy(&body).contains("<script src=\"/zb-shim.js\"></script>"));
        }
    }

    #[test]
    fn token_comparison() {
        assert!(same_token("abc", "abc"));
        assert!(!same_token("abd", "abc"));
        assert!(!same_token("ab", "abc"));
    }
}
