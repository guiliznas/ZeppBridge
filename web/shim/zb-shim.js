/*
 * zb-shim.js — faz o app do ZeppBridge rodar num navegador comum, sem alterar o código do front.
 *
 * O `@tauri-apps/api` fala com o back-end por `window.__TAURI_INTERNALS__`. O modo demo do próprio
 * projeto troca esse objeto no navegador (src/demo/runtime.ts) e o app inteiro roda; aqui fazemos o
 * mesmo, mas cada `invoke` vira `POST /api/ipc/:comando` no zeppbridge-web, que lê a biblioteca real.
 *
 * Carregado como script clássico no <head> (o servidor injeta), então roda antes do bundle do app.
 * Comandos que o servidor ainda não atende ficam em `window.__ZB_WEB__.missing` e no console.
 */
(function () {
  'use strict';

  var callbacks = new Map();
  var nextCallbackId = 1;
  var nextEventId = 1;
  var missing = new Set();

  function reject(code, message) {
    return Promise.reject({ code: code, message: message });
  }

  function readOnly(command) {
    return reject('err.web.read_only', 'O modo web é somente leitura por enquanto (' + command + ').');
  }

  /* Comandos de plugin do Tauri: resolvidos aqui mesmo, sem ir ao servidor. */
  var plugins = {
    'plugin:event|listen': function () { return nextEventId++; }, // eventos do back chegam na Fase 2 (SSE)
    'plugin:event|unlisten': function () { return null; },
    'plugin:event|emit': function () { return null; },
    'plugin:event|emit_to': function () { return null; },
    'plugin:opener|open_url': function (args) {
      if (args && typeof args.url === 'string' && /^https?:\/\//i.test(args.url)) {
        window.open(args.url, '_blank', 'noopener');
      }
      return null;
    },
    'plugin:opener|open_path': function () { return readOnly('abrir arquivo local'); },
    'plugin:opener|reveal_item_in_dir': function () { return readOnly('mostrar na pasta'); },
    'plugin:app|name': function () { return 'ZeppBridge'; },
    'plugin:app|tauri_version': function () { return '2'; },
    'plugin:dialog|message': function (args) { window.alert((args && args.message) || ''); return true; },
    'plugin:dialog|ask': function (args) { return window.confirm((args && args.message) || ''); },
    'plugin:dialog|confirm': function (args) { return window.confirm((args && args.message) || ''); },
    'plugin:dialog|open': function () { return readOnly('escolher arquivo'); },
    'plugin:dialog|save': function () { return readOnly('salvar arquivo'); },
    'plugin:process|restart': function () { window.location.reload(); return null; },
    'plugin:window|is_maximized': function () { return false; },
    'plugin:window|is_focused': function () { return document.hasFocus(); },
    'plugin:window|is_visible': function () { return true; },
    'plugin:window|is_minimized': function () { return false; },
    'plugin:window|is_fullscreen': function () { return !!document.fullscreenElement; },
    'plugin:window|scale_factor': function () { return window.devicePixelRatio || 1; },
  };

  function callServer(command, args) {
    return fetch('/api/ipc/' + encodeURIComponent(command), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-ZB-Request': '1' },
      // O IPC nativo serializa os proxies do Vue; JSON.stringify mantém a mesma fronteira.
      body: JSON.stringify(args || {}),
    }).then(
      function (response) {
        return response.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (e) { body = { code: 'err.web.bad_response', message: text }; }
          if (response.ok) return body;
          if (response.status === 404 && body && body.code === 'err.web.unsupported' && !missing.has(command)) {
            missing.add(command);
            console.warn('[zeppbridge-web] comando ainda não atendido:', command, args);
          }
          if (response.status === 401) {
            body = { code: 'err.web.unauthorized', message: 'Sessão sem acesso: abra de novo o link do terminal.' };
          }
          // O Tauri rejeita com o erro serializado ({code, message, params}); o front já sabe traduzir.
          throw body || { code: 'err.web.http', message: 'HTTP ' + response.status };
        });
      },
      function (error) {
        throw { code: 'err.web.offline', message: 'zeppbridge-web inacessível: ' + error };
      }
    );
  }

  function invoke(command, args) {
    var local = plugins[command];
    if (local) {
      try { return Promise.resolve(local(args || {})); } catch (error) { return Promise.reject(error); }
    }
    if (command.indexOf('plugin:window|') === 0 || command.indexOf('plugin:webview|') === 0) {
      return Promise.resolve(null); // mover/redimensionar/focar janela não existe no navegador
    }
    return callServer(command, args);
  }

  var internals = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },
    plugins: {},
    callbacks: callbacks,
    transformCallback: function (callback, once) {
      var id = nextCallbackId++;
      callbacks.set(id, function (data) {
        if (once) callbacks.delete(id);
        return callback && callback(data);
      });
      return id;
    },
    unregisterCallback: function (id) { callbacks.delete(id); },
    runCallback: function (id, data) {
      var callback = callbacks.get(id);
      if (callback) callback(data);
    },
    convertFileSrc: function (path) { return path; },
    invoke: invoke,
  };

  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: false, writable: false, value: internals });
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
  window.__ZB_WEB__ = { missing: missing };
})();
