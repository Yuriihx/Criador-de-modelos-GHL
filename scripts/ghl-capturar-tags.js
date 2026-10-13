/*
 * Capturador sanitizado para descobrir a requisicao do filtro de Tags
 * na pagina Contatos do GHL.
 *
 * Uso no Console do DevTools da pagina Contatos:
 * 1. Cole e execute todo este arquivo.
 * 2. Abra Filtros > Informacoes de contato > Tag.
 * 3. Escolha UMA tag da campanha e clique em Aplicar.
 * 4. Espere a lista e o total de contatos carregarem.
 * 5. Execute: __GHL_TAGS_CAPTURE__.download()
 * 6. Envie o JSON baixado.
 *
 * Listas de contatos e campos pessoais conhecidos sao removidos da exportacao.
 */
(() => {
  const NOME = "__GHL_TAGS_CAPTURE__";
  if (window[NOME]?.installed) {
    window[NOME].clear();
    console.info("[GHL Tags Capture] Ja estava instalado. O historico foi limpo.");
    return;
  }

  const MAX_TEXT = 500_000;
  const records = [];
  const startedAt = new Date().toISOString();
  const sensitiveKey = /(^|[-_])(authorization|cookie|token|jwt|secret|password|session|refresh|access|api[-_]?key)([-_]|$)/i;
  const personalKey = /^(firstName|lastName|fullName|contactName|email|phone|phoneNumber|address|city|postalCode|dateOfBirth|dndSettings)$/i;
  const contactListKey = /^(contacts|contactList|records|results)$/i;
  const interestingUrl = /(contact|smart.?list|filter|search|tag)/i;

  function sanitize(value, seen = new WeakSet(), keyAtual = "") {
    if (value === null || value === undefined) return value;
    if (personalKey.test(keyAtual)) return "[REDACTED]";
    if (typeof value === "string") {
      return value
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/(["']?(?:access|refresh|id)?_?token["']?\s*[:=]\s*["'])[^"']+/gi, "$1[REDACTED]");
    }
    if (typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      if (contactListKey.test(keyAtual) && value.some((item) => item && typeof item === "object")) {
        return `[${value.length} registros removidos]`;
      }
      return value.map((item) => sanitize(item, seen, keyAtual));
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKey.test(key)) out[key] = "[REDACTED]";
      else out[key] = sanitize(item, seen, key);
    }
    return out;
  }

  function parseBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === "string") {
      const clipped = body.slice(0, MAX_TEXT);
      try { return sanitize(JSON.parse(clipped)); } catch { return sanitize(clipped); }
    }
    if (body instanceof URLSearchParams) return sanitize(Object.fromEntries(body.entries()));
    if (body instanceof FormData) {
      const obj = {};
      for (const [key, value] of body.entries()) {
        obj[key] = value instanceof File
          ? `[File name=${value.name} type=${value.type} size=${value.size}]`
          : value;
      }
      return sanitize(obj);
    }
    if (body instanceof Blob) return `[Blob type=${body.type} size=${body.size}]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer bytes=${body.byteLength}]`;
    return sanitize(body);
  }

  function parseResponse(text) {
    const clipped = String(text || "").slice(0, MAX_TEXT);
    try { return sanitize(JSON.parse(clipped)); } catch { return sanitize(clipped); }
  }

  function push(record) {
    if (!interestingUrl.test(record.url || "")) return;
    records.push(sanitize({ at: new Date().toISOString(), ...record }));
    console.info(`[GHL Tags Capture] ${record.method} ${record.status ?? ""} ${record.url}`);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function capturedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = String(init.method || request?.method || "GET").toUpperCase();
    let requestBody = init.body ?? null;
    if (requestBody === null && request && !["GET", "HEAD"].includes(method)) {
      try { requestBody = await request.clone().text(); } catch { requestBody = "[unavailable]"; }
    }
    const start = performance.now();
    try {
      const response = await originalFetch(input, init);
      let responseText = "";
      try { responseText = await response.clone().text(); } catch { responseText = "[unavailable]"; }
      push({
        transport: "fetch", url, method, status: response.status,
        durationMs: Math.round(performance.now() - start),
        requestBody: parseBody(requestBody), responseBody: parseResponse(responseText)
      });
      return response;
    } catch (error) {
      push({ transport: "fetch", url, method, status: "NETWORK_ERROR", requestBody: parseBody(requestBody), error: String(error) });
      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function capturedOpen(method, url, ...rest) {
    this.__ghlTagsCapture = { method: String(method || "GET").toUpperCase(), url: String(url) };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function capturedSend(body) {
    const meta = this.__ghlTagsCapture || { method: "GET", url: "" };
    const start = performance.now();
    this.addEventListener("loadend", () => {
      let responseText = "";
      try {
        responseText = this.responseType === "" || this.responseType === "text"
          ? this.responseText
          : JSON.stringify(this.response);
      } catch { responseText = "[unavailable]"; }
      push({
        transport: "xhr", url: meta.url, method: meta.method, status: this.status,
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
      console.info("[GHL Tags Capture] Historico limpo.");
    },
    show() {
      console.table(records.map((r, i) => ({ i, method: r.method, status: r.status, url: r.url })));
      return records;
    },
    export() {
      return {
        version: 1, startedAt, exportedAt: new Date().toISOString(),
        page: location.href, records: sanitize(records)
      };
    },
    download() {
      const blob = new Blob([JSON.stringify(this.export(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ghl-tags-captura-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      console.info(`[GHL Tags Capture] Arquivo baixado com ${records.length} requisicoes sanitizadas.`);
    }
  };

  console.info("[GHL Tags Capture] Instalado. Aplique UMA tag no filtro de Contatos e rode __GHL_TAGS_CAPTURE__.download()");
})();
