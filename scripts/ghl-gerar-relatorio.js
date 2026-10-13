/*
 * GHL Relatorio 0.2.3
 *
 * Le as estatisticas dos blocos "Modelo N" do workflow atual e baixa um JSON
 * compativel com o arquivo gerador-relatorio-waba.html.
 *
 * Uso:
 *   GHLRelatorio.plano()
 *
 *   await GHLRelatorio.executar({
 *     cliente: "Polishop",
 *     campanha: "Nome da campanha",
 *     copies: "https://docs.google.com/document/d/.../edit",
 *     custo: 0.24,
 *     base: "entregues",
 *     prefixoTags: "21/09/2026 - polishop - ecom"
 *   })
 *
 * Antes de executar, deixe fechado o painel lateral de edicao da acao.
 * Durante a coleta, nao clique nem navegue no workflow.
 */
(() => {
  const VERSAO = "0.2.3";
  const ESPERA = 30_000;
  const LINHAS_PADRAO = 25;
  const ROTULOS = ["Total", "Sent", "Delivered", "Read", "Failed"];
  const SUFIXOS_TAGS = Object.freeze({
    b1: "clicou botao 1",
    b2: "clicou botao 2",
    link: "abriu link",
    forms: "abriu formulario",
    out: "cancelar avisos"
  });
  const TAGS_OPCIONAIS = new Set(["link", "forms"]);

  const normalizar = (valor) => String(valor || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  const visivel = (el) => {
    if (!el || !el.isConnected) return false;
    const estilo = getComputedStyle(el);
    const caixa = el.getBoundingClientRect();
    return estilo.display !== "none" && estilo.visibility !== "hidden" && caixa.width > 0 && caixa.height > 0;
  };

  const esperar = (teste, descricao, limite = ESPERA) => new Promise((resolve, reject) => {
    const inicio = Date.now();
    const verificar = () => {
      let resultado;
      try { resultado = teste(); } catch {}
      if (resultado) return resolve(resultado);
      if (Date.now() - inicio >= limite) return reject(new Error(`Tempo esgotado esperando ${descricao}.`));
      setTimeout(verificar, 150);
    };
    verificar();
  });

  function clicar(el) {
    if (!el) throw new Error("Elemento para clique nao encontrado.");
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Evento = tipo.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Evento(tipo, {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: tipo.includes("down") ? 1 : 0
      }));
    }
  }

  function numeroModelo(no) {
    const linhas = String(no.innerText || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const linha of linhas) {
      const m = linha.match(/^Modelo\s+(\d+)\s*$/i);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function idDoNo(no) {
    const candidatos = [
      no.dataset?.id,
      no.getAttribute("data-id"),
      no.getAttribute("data-node-id"),
      String(no.id || "").replace(/^(?:vue-flow__node-|react-flow__node-)/, "")
    ].filter(Boolean);
    return candidatos.find((valor) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(valor)) || candidatos[0] || "";
  }

  function modelosVisiveis() {
    const encontrados = [...document.querySelectorAll(".vue-flow__node, .react-flow__node")]
      .map((no) => ({ modelo: numeroModelo(no), id: idDoNo(no), no }))
      .filter((item) => Number.isInteger(item.modelo));
    const porNumero = new Map();
    for (const item of encontrados) {
      if (!porNumero.has(item.modelo)) porNumero.set(item.modelo, []);
      porNumero.get(item.modelo).push(item);
    }
    const ambiguos = [...porNumero.entries()].filter(([, itens]) => itens.length !== 1);
    if (ambiguos.length) {
      throw new Error(`Modelo(s) duplicado(s): ${ambiguos.map(([n]) => n).join(", ")}.`);
    }
    return [...porNumero.values()].map(([item]) => item).sort((a, b) => a.modelo - b.modelo);
  }

  function filtrarModelos(config = {}) {
    let itens = modelosVisiveis();
    if (Array.isArray(config.modelos) && config.modelos.length) {
      const permitidos = new Set(config.modelos.map(Number));
      itens = itens.filter((item) => permitidos.has(item.modelo));
    } else {
      const inicio = Number.isInteger(config.inicio) ? config.inicio : null;
      const quantidade = Number.isInteger(config.quantidade) ? config.quantidade : null;
      if (inicio !== null) itens = itens.filter((item) => item.modelo >= inicio);
      if (inicio !== null && quantidade !== null) itens = itens.filter((item) => item.modelo < inicio + quantidade);
    }
    if (!itens.length) throw new Error('Nenhum bloco "Modelo N" foi encontrado para a coleta.');
    const semId = itens.filter((item) => !item.id);
    if (semId.length) throw new Error(`Nao encontrei o ID do(s) Modelo(s) ${semId.map((x) => x.modelo).join(", ")}.`);
    return itens;
  }

  function acharAba(texto) {
    const alvo = normalizar(texto);
    return [...document.querySelectorAll("button, [role='tab'], a, div, span")]
      .filter(visivel)
      .find((el) => normalizar(el.innerText) === alvo);
  }

  function capturarProximaEstatistica(limite = ESPERA) {
    const proto = XMLHttpRequest.prototype;
    const abrirOriginal = proto.open;
    const cabecalhoOriginal = proto.setRequestHeader;
    const enviarOriginal = proto.send;

    return new Promise((resolve, reject) => {
      let terminou = false;
      const restaurar = () => {
        proto.open = abrirOriginal;
        proto.setRequestHeader = cabecalhoOriginal;
        proto.send = enviarOriginal;
      };
      const timer = setTimeout(() => {
        if (terminou) return;
        terminou = true;
        restaurar();
        reject(new Error("O GHL nao enviou a requisicao de estatisticas esperada."));
      }, limite);

      proto.open = function (metodo, url, ...resto) {
        this.__ghlRelatorioReq = {
          metodo: String(metodo || "GET").toUpperCase(),
          url: String(url), cabecalhos: {}
        };
        return abrirOriginal.call(this, metodo, url, ...resto);
      };
      proto.setRequestHeader = function (nome, valor) {
        if (this.__ghlRelatorioReq) this.__ghlRelatorioReq.cabecalhos[nome] = valor;
        return cabecalhoOriginal.call(this, nome, valor);
      };
      proto.send = function (corpo) {
        const req = this.__ghlRelatorioReq;
        if (!terminou && req?.metodo === "GET" && /\/actions\/stats\/whatsapp_v2(?:\?|$)/.test(req.url)) {
          terminou = true;
          clearTimeout(timer);
          restaurar();
          const credenciais = this.withCredentials;
          this.addEventListener("loadend", () => {
            if (this.status >= 200 && this.status < 300) {
              let resposta;
              try { resposta = JSON.parse(this.responseText || "{}"); }
              catch { return reject(new Error("A primeira resposta de estatisticas nao era JSON.")); }
              resolve({ url: req.url, cabecalhos: req.cabecalhos, credenciais, resposta });
            } else {
              reject(new Error(`A primeira estatistica respondeu HTTP ${this.status}.`));
            }
          }, { once: true });
        }
        return enviarOriginal.call(this, corpo);
      };
    });
  }

  async function abrirPrimeiraEstatistica(item) {
    const captura = capturarProximaEstatistica();
    clicar(item.no);
    await esperar(
      () => acharAba("Estatisticas") || acharAba("Statistics"),
      `a aba Estatisticas do Modelo ${item.modelo}`
    );
    const editar = acharAba("Editar acao") || acharAba("Edit action");
    if (editar) clicar(editar);
    await new Promise((resolve) => setTimeout(resolve, 250));
    clicar(acharAba("Estatisticas") || acharAba("Statistics"));
    return captura;
  }

  function requisicaoXhr({ metodo = "GET", url, cabecalhos, credenciais, corpo = null }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, url, true);
      xhr.withCredentials = Boolean(credenciais);
      for (const [nome, valor] of Object.entries(cabecalhos || {})) {
        if (/^(content-length|host|cookie|content-type)$/i.test(nome)) continue;
        // A rota de estatisticas exige a mesma versao usada pelo proprio GHL.
        // Na busca de contatos, abaixo, usamos a versao especifica dessa API.
        if (corpo !== null && /^version$/i.test(nome)) continue;
        try { xhr.setRequestHeader(nome, valor); } catch {}
      }
      if (corpo !== null) {
        try { xhr.setRequestHeader("Content-Type", "application/json"); } catch {}
        try { xhr.setRequestHeader("Version", "2021-07-28"); } catch {}
      }
      xhr.addEventListener("load", () => {
        let resposta;
        try { resposta = JSON.parse(xhr.responseText || "{}"); }
        catch { return reject(new Error(`Resposta invalida em ${url}`)); }
        if (xhr.status >= 200 && xhr.status < 300) resolve(resposta);
        else reject(new Error(`HTTP ${xhr.status} ao consultar estatisticas.`));
      });
      xhr.addEventListener("error", () => reject(new Error("Falha de rede ao consultar estatisticas.")));
      xhr.send(corpo);
    });
  }

  function numerosDaResposta(resposta) {
    if (!Array.isArray(resposta?.stats)) throw new Error("A resposta nao contem a lista stats.");
    const mapa = new Map(resposta.stats.map((item) => [normalizar(item.label || item.active), Number(item.value) || 0]));
    const valores = ROTULOS.map((rotulo) => mapa.get(normalizar(rotulo)));
    if (valores.some((valor) => valor === undefined)) {
      throw new Error(`Estatisticas incompletas. Recebi: ${[...mapa.keys()].join(", ")}.`);
    }
    return valores;
  }

  function urlParaModelo(urlBase, id) {
    const url = new URL(urlBase);
    url.searchParams.set("workflowStepId", id);
    return url.toString();
  }

  function nomeComAcentos(prefixo, sufixo) {
    if (sufixo === "abriu formulario") {
      return `${String(prefixo || "").trim()} - abriu formul\u00e1rio`;
    }
    const finais = {
      "clicou botao 1": "clicou botão 1",
      "clicou botao 2": "clicou botão 2"
    };
    return `${String(prefixo || "").trim()} - ${finais[sufixo] || sufixo}`;
  }

  function tagsDaConfiguracao(config = {}) {
    const personalizadas = config.tags && typeof config.tags === "object" ? config.tags : {};
    const prefixo = String(config.prefixoTags || "").trim();
    if (!prefixo && !Object.keys(personalizadas).length) return {};
    const tags = {};
    for (const [campo, sufixo] of Object.entries(SUFIXOS_TAGS)) {
      const personalizada = campo === "out"
        ? (personalizadas.out || personalizadas.sair)
        : personalizadas[campo];
      const nome = String(personalizada || (prefixo ? nomeComAcentos(prefixo, sufixo) : "")).trim();
      if (nome) tags[campo] = nome;
    }
    return tags;
  }

  async function coletarTags(config, snapshot) {
    const tags = tagsDaConfiguracao(config);
    if (!Object.keys(tags).length) {
      console.warn("[GHL Relatorio] Tags nao configuradas; o engajamento ficara em branco.");
      return {};
    }
    const locationId = new URL(snapshot.url).searchParams.get("locationId");
    if (!locationId) throw new Error("Nao encontrei o locationId para consultar as tags.");
    const url = "https://services.leadconnectorhq.com/contacts/search";
    const resultado = {};
    for (const [campo, nome] of Object.entries(tags)) {
      console.log(`[GHL Relatorio] Tag ${campo}: ${nome}`);
      const corpo = JSON.stringify({
        filters: [{ field: "tags", operator: "eq", value: nome }],
        locationId,
        page: 1,
        pageLimit: 1,
        sort: []
      });
      let resposta;
      try {
        resposta = await requisicaoXhr({
          metodo: "POST",
          url,
          cabecalhos: snapshot.cabecalhos,
          credenciais: snapshot.credenciais,
          corpo
        });
      } catch (erro) {
        if (!TAGS_OPCIONAIS.has(campo)) throw erro;
        console.warn(`[GHL Relatorio] Tag opcional ${campo} indisponivel; campo ficara vazio.`, erro.message);
        resultado[campo] = "";
        continue;
      }
      if (!Number.isFinite(Number(resposta?.total))) {
        if (TAGS_OPCIONAIS.has(campo)) {
          console.warn(`[GHL Relatorio] Tag opcional ${campo} sem total; campo ficara vazio.`);
          resultado[campo] = "";
          continue;
        }
        throw new Error(`A consulta da tag "${nome}" nao devolveu o total.`);
      }
      const total = Number(resposta.total);
      resultado[campo] = TAGS_OPCIONAIS.has(campo) && total === 0 ? "" : String(total);
    }
    console.table(Object.entries(resultado).map(([campo, total]) => ({ campo, tag: tags[campo], total })));
    return resultado;
  }

  function dadosDoGerador(config, resultados, engajamento = {}) {
    const maiorModelo = Math.max(...resultados.map((item) => item.modelo));
    const linhas = Array.from({ length: Math.max(LINHAS_PADRAO, maiorModelo) }, () => ["", "", "", "", ""]);
    for (const item of resultados) linhas[item.modelo - 1] = item.valores.map(String);
    const total = resultados.reduce(
      (soma, item) => soma.map((valor, i) => valor + item.valores[i]),
      [0, 0, 0, 0, 0]
    ).map(String);
    return {
      versao: 1,
      cliente: String(config.cliente || ""),
      custo: String(config.custo ?? "0.24"),
      base: config.base === "disparados" ? "disparados" : "entregues",
      campanhas: [{
        nome: String(config.campanha || ""),
        copies: String(config.copies || ""),
        linhas,
        total,
        eng: {
          b1:"", b2:"", link:"", forms:"", out:"",
          ...engajamento
        }
      }]
    };
  }

  function baixarJson(dados, config) {
    const seguro = String(config.cliente || config.campanha || "WABA").trim().replace(/[^\w-]+/g, "_") || "WABA";
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Dados_${seguro}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function plano(config = {}) {
    const itens = filtrarModelos(config);
    const tabela = itens.map((item) => ({ modelo: item.modelo, workflowStepId: item.id }));
    console.table(tabela);
    const tags = tagsDaConfiguracao(config);
    if (Object.keys(tags).length) {
      console.table(Object.entries(tags).map(([campo, tag]) => ({ campo, tag })));
    }
    console.log(`[GHL Relatorio] ${itens.length} modelo(s) prontos para consulta. Nenhuma alteracao foi feita.`);
    return { modelos: tabela, tags };
  }

  async function executar(config = {}) {
    if (window.__GHL_RELATORIO_EXECUTANDO__) throw new Error("GHLRelatorio ja esta executando.");
    const itens = filtrarModelos(config);
    const resumo = `Coletar as estatisticas de ${itens.length} modelo(s) e baixar o JSON do relatorio?\n\n` +
      "Feche o painel lateral antes de confirmar e nao mexa no workflow durante a coleta.";
    if (!confirm(resumo)) {
      console.log("[GHL Relatorio] Cancelado. Nenhuma consulta foi feita.");
      return [];
    }

    window.__GHL_RELATORIO_EXECUTANDO__ = true;
    try {
      console.log(`[GHL Relatorio] Modelo ${itens[0].modelo}: abrindo a aba Estatisticas...`);
      const snapshot = await abrirPrimeiraEstatistica(itens[0]);
      const resultados = [{ modelo: itens[0].modelo, valores: numerosDaResposta(snapshot.resposta) }];
      console.log(`[GHL Relatorio] Modelo ${itens[0].modelo}: coletado.`);

      for (const item of itens.slice(1)) {
        console.log(`[GHL Relatorio] Modelo ${item.modelo}: consultando...`);
        const resposta = await requisicaoXhr({
          url: urlParaModelo(snapshot.url, item.id),
          cabecalhos: snapshot.cabecalhos,
          credenciais: snapshot.credenciais
        });
        resultados.push({ modelo: item.modelo, valores: numerosDaResposta(resposta) });
      }

      console.table(resultados.map((item) => ({
        modelo: item.modelo,
        disparados: item.valores[0],
        enviados: item.valores[1],
        entregues: item.valores[2],
        lidas: item.valores[3],
        falhadas: item.valores[4]
      })));
      console.log("[GHL Relatorio] Consultando as tags de engajamento...");
      const engajamento = await coletarTags(config, snapshot);
      const dados = dadosDoGerador(config, resultados, engajamento);
      baixarJson(dados, config);
      console.log(`[GHL Relatorio] Concluido. JSON gerado para ${resultados.length} modelo(s).`);
      return { resultados, engajamento, dados, periodo: new URL(snapshot.url).searchParams };
    } finally {
      window.__GHL_RELATORIO_EXECUTANDO__ = false;
    }
  }

  window.GHLRelatorio = Object.freeze({ versao: VERSAO, plano, executar });
  console.log(`[GHL Relatorio ${VERSAO}] Carregado. Rode GHLRelatorio.plano(); depois GHLRelatorio.executar({...}).`);
})();
