/*
 * Capturador sanitizado das requisicoes usadas pela aba Estatisticas
 * de uma acao WhatsApp no construtor de workflows do GHL.
 *
 * Uso no Console do DevTools (contexto workflow-builder...):
 * 1. Cole e execute todo este arquivo.
 * 2. Abra apenas um bloco, por exemplo "Modelo 1".
 * 3. Clique na aba "Estatisticas" e espere os numeros aparecerem.
 * 4. Execute: __GHL_STATS_CAPTURE__.download()
 * 5. Envie o JSON baixado.
 *
 * O arquivo remove chaves, tokens, cookies e credenciais conhecidas.
 */
(() => {
  const NOME = '__GHL_STATS_CAPTURE__';
  if (window[NOME]?.installed) {
    console.info('[GHL Stats Capture] Ja estava instalado. O historico foi limpo.');
    window[NOME].clear();
    return;
  }

  const MAX_TEXT = 500_000;
  const records = [];
  const startedAt = new Date().toISOString();
  const sensitiveKey = /(^|[-_])(authorization|cookie|token|jwt|secret|password|session|refresh|access|api[-_]?key)([-_]|$)/i;
  const interestingUrl = /(stat|analytic|report|workflow|automation|execution|action|whatsapp)/i;

  function redact(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return value
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/(["']?(?:access|refresh|id)?_?token["']?\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]');
    }
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => redact(item, seen));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sensitiveKey.test(key) ? '[REDACTED]' : redact(item, seen);
    }
    return out;
  }

  function parseBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') {
      const clipped = body.slice(0, MAX_TEXT);
      try { return redact(JSON.parse(clipped)); } catch { return redact(clipped); }
    }
    if (body instanceof URLSearchParams) return redact(Object.fromEntries(body.entries()));
    if (body instanceof FormData) {
      const obj = {};
      for (const [key, value] of body.entries()) {
        obj[key] = value instanceof File
          ? `[File name=${value.name} type=${value.type} size=${value.size}]`
          : value;
      }
      return redact(obj);
    }
    if (body instanceof Blob) return `[Blob type=${body.type} size=${body.size}]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer bytes=${body.byteLength}]`;
    return redact(body);
  }

  function parseResponse(text) {
    const clipped = String(text || '').slice(0, MAX_TEXT);
    try { return redact(JSON.parse(clipped)); } catch { return redact(clipped); }
  }

  function push(record) {
    if (!interestingUrl.test(record.url || '')) return;
    records.push(redact({ at: new Date().toISOString(), ...record }));
    console.info(`[GHL Stats Capture] ${record.method} ${record.status ?? ''} ${record.url}`);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function capturedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    let requestBody = init.body ?? null;
    if (requestBody === null && request && !['GET', 'HEAD'].includes(method)) {
      try { requestBody = await request.clone().text(); } catch { requestBody = '[unavailable]'; }
    }
    const start = performance.now();
    try {
      const response = await originalFetch(input, init);
      let responseText = '';
      try { responseText = await response.clone().text(); } catch { responseText = '[unavailable]'; }
      push({
        transport: 'fetch', url, method, status: response.status,
        durationMs: Math.round(performance.now() - start),
        requestBody: parseBody(requestBody), responseBody: parseResponse(responseText)
      });
      return response;
    } catch (error) {
      push({ transport: 'fetch', url, method, status: 'NETWORK_ERROR', requestBody: parseBody(requestBody), error: String(error) });
      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function capturedOpen(method, url, ...rest) {
    this.__ghlStatsCapture = { method: String(method || 'GET').toUpperCase(), url: String(url) };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function capturedSend(body) {
    const meta = this.__ghlStatsCapture || { method: 'GET', url: '' };
    const start = performance.now();
    this.addEventListener('loadend', () => {
      let responseText = '';
      try {
        responseText = this.responseType === '' || this.responseType === 'text'
          ? this.responseText
          : JSON.stringify(this.response);
      } catch { responseText = '[unavailable]'; }
      push({
        transport: 'xhr', url: meta.url, method: meta.method, status: this.status,
        durationMs: Math.round(performance.now() - start),
        requestBody: parseBody(body), responseBody: parseResponse(responseText)
      });
    }, { once: true });
    return originalSend.call(this, body);
  };

  window[NOME] = {
    installed: true,
    records,
    clear() {
      records.splice(0, records.length);
      console.info('[GHL Stats Capture] Historico limpo.');
    },
    show() {
      console.table(records.map((r, i) => ({ i, method: r.method, status: r.status, url: r.url })));
      return records;
    },
    export() {
      return {
        version: 1,
        startedAt,
        exportedAt: new Date().toISOString(),
        page: location.href,
        records: redact(records)
      };
    },
    download() {
      const json = JSON.stringify(this.export(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghl-estatisticas-captura-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      console.info(`[GHL Stats Capture] Arquivo baixado com ${records.length} requisicoes sanitizadas.`);
    }
  };

  console.info('[GHL Stats Capture] Instalado. Abra UM Modelo, clique em Estatisticas, espere carregar e rode __GHL_STATS_CAPTURE__.download()');
})();
