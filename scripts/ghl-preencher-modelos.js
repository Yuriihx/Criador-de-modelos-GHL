/*
 * GHL — preenchimento assistido de modelos de WhatsApp no workflow
 *
 * Uso no Console do DevTools, com o workflow já aberto:
 *   1) Cole este arquivo inteiro e pressione Enter.
 *   2) Confira sem alterar nada:
 *      await GHLModelos.plano({ base: "polishopc_210926", inicio: 1, templateInicio: 6, quantidade: 20 })
 *   3) Teste somente um modelo:
 *      await GHLModelos.executar({ base: "polishopc_210926", inicio: 1, templateInicio: 6, quantidade: 1 })
 *
 * O script não altera ENABLE BRANCHES nem o conteúdo/variáveis da mensagem.
 */

(() => {
  "use strict";

  const VERSAO = "0.5.1";
  const ESPERA_PADRAO = 30000;

  const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizar = (valor) =>
    String(valor ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("pt-BR");

  const texto = (elemento) => normalizar(elemento?.innerText || elemento?.textContent);

  const visivel = (elemento) => {
    if (!(elemento instanceof Element)) return false;
    const estilo = getComputedStyle(elemento);
    const caixa = elemento.getBoundingClientRect();
    return (
      estilo.display !== "none" &&
      estilo.visibility !== "hidden" &&
      Number(estilo.opacity || 1) !== 0 &&
      caixa.width > 0 &&
      caixa.height > 0
    );
  };

  async function esperar(teste, descricao, limite = ESPERA_PADRAO) {
    const inicio = Date.now();
    let ultimoErro;
    while (Date.now() - inicio < limite) {
      try {
        const resultado = teste();
        if (resultado) return resultado;
      } catch (erro) {
        ultimoErro = erro;
      }
      await dormir(150);
    }
    throw new Error(
      `Tempo esgotado esperando: ${descricao}${ultimoErro ? ` (${ultimoErro.message})` : ""}`
    );
  }

  function clicar(elemento) {
    if (!elemento) throw new Error("Elemento para clique não encontrado.");
    elemento.scrollIntoView?.({ block: "center", inline: "center" });
    const caixa = elemento.getBoundingClientRect();
    const clientX = caixa.left + caixa.width / 2;
    const clientY = caixa.top + caixa.height / 2;
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      elemento.dispatchEvent(
        tipo.startsWith("pointer")
          ? new PointerEvent(tipo, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
              button: 0,
              buttons: tipo.includes("down") ? 1 : 0,
            })
          : new MouseEvent(tipo, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
              button: 0,
              buttons: tipo.includes("down") ? 1 : 0,
            })
      );
    }
  }

  function encontrarNos(numero) {
    // O GHL pode quebrar "Modelo 11" em duas linhas visuais. Normalize o
    // texto completo antes de procurar, mantendo limite para não confundir 1 com 10.
    const padrao = new RegExp(`\\bmodelo\\s+${numero}\\b`);
    return [...document.querySelectorAll(".vue-flow__node, .react-flow__node")].filter((no) =>
      padrao.test(texto(no))
    );
  }

  function descreverNo(no) {
    return {
      id: no.getAttribute("data-id") || no.id || null,
      texto: String(no.innerText || "").replace(/\s+/g, " ").trim().slice(0, 180),
    };
  }

  function validarConfig(config = {}) {
    const base = String(config.base || "").trim();
    const inicio = Number(config.inicio ?? 1);
    const templateInicio = Number(config.templateInicio ?? inicio);
    const templates = Array.isArray(config.templates)
      ? config.templates.map(Number)
      : null;
    const quantidade = templates ? templates.length : Number(config.quantidade);

    if (!base) throw new Error('Informe a base. Exemplo: base: "polishopc_210926".');
    if (!Number.isInteger(inicio) || inicio < 1 || inicio > 25) {
      throw new Error("inicio precisa ser um número inteiro entre 1 e 25.");
    }
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 25) {
      throw new Error("quantidade precisa ser um número inteiro entre 1 e 25.");
    }
    if (inicio + quantidade - 1 > 25) {
      throw new Error("O último modelo não pode passar de 25.");
    }
    if (!Number.isInteger(templateInicio) || templateInicio < 1) {
      throw new Error("templateInicio precisa ser um número inteiro maior que zero.");
    }
    if (templates && templates.some((numero) => !Number.isInteger(numero) || numero < 1)) {
      throw new Error("Todos os números de templates precisam ser inteiros maiores que zero.");
    }

    return { base, inicio, templateInicio, templates, quantidade };
  }

  function folhaComTexto(predicado, raiz = document) {
    const seletores = [
      '[role="option"]',
      '[role="menuitem"]',
      "li",
      "button",
      "span",
      "div",
    ];
    const candidatos = [...raiz.querySelectorAll(seletores.join(","))].filter(visivel);
    return candidatos
      .filter((el) => predicado(texto(el), el))
      .sort((a, b) => {
        const aOpcao = a.matches('[role="option"],[role="menuitem"],li') ? 0 : 1;
        const bOpcao = b.matches('[role="option"],[role="menuitem"],li') ? 0 : 1;
        if (aOpcao !== bOpcao) return aOpcao - bOpcao;
        return a.children.length - b.children.length || texto(a).length - texto(b).length;
      })[0];
  }

  function acharRotulo(nome) {
    const alvo = normalizar(nome);
    return [...document.querySelectorAll("label,span,div,p")]
      .filter(visivel)
      .filter((el) => texto(el).replace(/\s*\*$/, "") === alvo)
      .sort((a, b) => a.children.length - b.children.length)[0];
  }

  function acharControle(nome, tipo = "selecao") {
    const idsConhecidos = {
      "SELECT WHATSAPP TEMPLATE": "#input-field-template_id",
      "SELECT FROM PHONE NUMBER": "#input-field-from_phone_number",
      "TIMEOUT UNIT": "#input-field-timeout_unit",
      "TIMEOUT VALUE": "#input-field-timeout_value",
    };
    const direto = document.querySelector(idsConhecidos[nome]);
    if (direto && visivel(direto)) {
      if (tipo === "entrada") {
        if (direto.matches('input:not([type="hidden"]),textarea,[contenteditable="true"]')) return direto;
        const entradaInterna = [...direto.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"]')]
          .find(visivel);
        if (entradaInterna) return entradaInterna;
      } else {
        return direto;
      }
    }

    const rotulo = acharRotulo(nome);
    if (!rotulo) throw new Error(`Rótulo não encontrado: ${nome}`);

    let atual = rotulo;
    for (let nivel = 0; nivel < 7 && atual; nivel += 1, atual = atual.parentElement) {
      const seletores =
        tipo === "entrada"
          ? 'input:not([type="hidden"]),textarea,[contenteditable="true"]'
          : '[role="combobox"],button[aria-haspopup],input[aria-haspopup],input:not([type="hidden"])';
      const controles = [...atual.querySelectorAll(seletores)].filter(visivel);
      if (controles.length === 1) return controles[0];
    }

    if (tipo === "entrada") {
      const caixaRotulo = rotulo.getBoundingClientRect();
      const candidatos = [...document.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"]')]
        .filter(visivel)
        .map((el) => ({ el, caixa: el.getBoundingClientRect() }))
        .filter(({ caixa }) => {
          const sobrepoeHorizontalmente =
            caixa.right >= caixaRotulo.left && caixa.left <= caixaRotulo.right + 450;
          const abaixo = caixa.top >= caixaRotulo.top - 4 && caixa.top - caixaRotulo.bottom < 140;
          return sobrepoeHorizontalmente && abaixo;
        })
        .sort((a, b) =>
          Math.abs(a.caixa.top - caixaRotulo.bottom) - Math.abs(b.caixa.top - caixaRotulo.bottom)
        );
      if (candidatos[0]) return candidatos[0].el;
    }

    throw new Error(`Controle não encontrado para: ${nome}`);
  }

  function pesquisarNoSeletor(controle, valor) {
    if (!(controle instanceof HTMLInputElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return;
    controle.focus();
    setter.call(controle, valor);
    controle.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: valor,
      })
    );
    controle.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function escolher(nomeCampo, aceita, descricaoOpcao, termoBusca = "") {
    const controle = await esperar(() => {
      try {
        return acharControle(nomeCampo);
      } catch {
        return null;
      }
    }, `campo ${nomeCampo}`);
    const gatilho =
      controle.closest(".hr-base-selection") ||
      controle.closest('[role="combobox"],button[aria-haspopup]') ||
      controle;
    clicar(gatilho);

    await dormir(350);
    if (termoBusca) {
      pesquisarNoSeletor(controle, termoBusca);
      await dormir(900);
    }

    const opcao = await esperar(
      () => folhaComTexto((valor, el) => aceita(valor, el)),
      `opção ${descricaoOpcao} em ${nomeCampo}`
    );
    clicar(opcao);
    await dormir(500);
  }

  function definirValor(campo, valor) {
    if (
      !(campo instanceof HTMLInputElement) &&
      !(campo instanceof HTMLTextAreaElement) &&
      campo.getAttribute?.("contenteditable") !== "true"
    ) {
      campo = [...campo.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"]')]
        .find(visivel);
    }
    if (!campo) throw new Error("Input interno do campo de valor não encontrado.");

    if (campo.getAttribute?.("contenteditable") === "true") {
      campo.focus();
      const selecao = window.getSelection();
      const intervalo = document.createRange();
      intervalo.selectNodeContents(campo);
      selecao.removeAllRanges();
      selecao.addRange(intervalo);

      const inseriu = document.execCommand?.("insertText", false, String(valor));
      if (!inseriu) campo.textContent = String(valor);

      campo.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: String(valor),
        })
      );
      campo.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      campo.blur();
      return;
    }

    const prototipo =
      campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    if (!setter) throw new Error("Não foi possível preencher o campo de valor.");
    campo.focus();
    setter.call(campo, String(valor));
    campo.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(valor) }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    campo.blur();
  }

  function acharBotaoSalvar() {
    const nomes = new Set(["salvar ação", "save action"]);
    return [...document.querySelectorAll("button")]
      .filter(visivel)
      .find((botao) => nomes.has(texto(botao)));
  }

  async function abrirNo(numero, no) {
    clicar(no);
    await esperar(
      () => acharRotulo("SELECT WHATSAPP TEMPLATE") && acharBotaoSalvar(),
      `abrir a configuração do Modelo ${numero}`
    );
    await dormir(350);
  }

  async function configurarModelo(numero, templateNumero, base, no) {
    const prefixo = normalizar(`v${templateNumero}_${base}`);
    console.log(`[GHL Modelos] Modelo ${numero}: abrindo...`);
    await abrirNo(numero, no);

    await escolher(
      "SELECT WHATSAPP TEMPLATE",
      (valor) =>
        valor.startsWith(prefixo) &&
        (valor.length === prefixo.length || /[ (\-]/.test(valor[prefixo.length])) &&
        /\butility\b/.test(valor),
      `iniciada por v${templateNumero}_${base}`,
      `v${templateNumero}_${base}`
    );

    // A troca de template recarrega os campos dinâmicos do painel.
    await esperar(
      () =>
        acharRotulo("SELECT FROM PHONE NUMBER") &&
        acharRotulo("TIMEOUT UNIT") &&
        acharRotulo("TIMEOUT VALUE"),
      "recarregar os campos após a troca do template"
    );
    await dormir(500);

    await escolher(
      "SELECT FROM PHONE NUMBER",
      (valor) => /(^|\s|-)default($|\s|\))/.test(valor),
      "que contém default",
      "default"
    );

    await escolher("TIMEOUT UNIT", (valor) => valor === "hours", "Hours");

    const timeout = acharControle("TIMEOUT VALUE", "entrada");
    definirValor(timeout, 48);

    const salvar = acharBotaoSalvar();
    if (!salvar || salvar.disabled) {
      throw new Error(`O botão Salvar ação não está disponível no Modelo ${numero}.`);
    }
    clicar(salvar);

    await dormir(1800);
    console.log(`[GHL Modelos] Modelo ${numero}: salvo.`);
    return { modelo: numero, template: `v${templateNumero}_${base}`, status: "salvo" };
  }

  function plano(config = {}) {
    const cfg = validarConfig(config);
    const itens = [];

    for (let numero = cfg.inicio; numero < cfg.inicio + cfg.quantidade; numero += 1) {
      const indice = numero - cfg.inicio;
      const templateNumero = cfg.templates
        ? cfg.templates[indice]
        : cfg.templateInicio + indice;
      const nos = encontrarNos(numero);
      itens.push({
        modelo: numero,
        template: `v${templateNumero}_${cfg.base}`,
        encontrados: nos.length,
        nos: nos.map(descreverNo),
        pronto: nos.length === 1,
      });
    }

    console.table(
      itens.map(({ modelo, template, encontrados, pronto }) => ({
        modelo,
        template,
        encontrados,
        pronto,
      }))
    );

    const ambiguos = itens.filter((item) => !item.pronto);
    if (ambiguos.length) {
      console.warn(
        "[GHL Modelos] Plano bloqueado: cada Modelo precisa aparecer exatamente uma vez.",
        ambiguos
      );
    } else {
      console.log("[GHL Modelos] Plano conferido. Nenhuma alteração foi feita.");
    }
    return itens;
  }

  async function executar(config = {}) {
    if (window.__GHL_MODELOS_EXECUTANDO__) {
      throw new Error("Já existe uma execução em andamento. Aguarde ela terminar.");
    }
    window.__GHL_MODELOS_EXECUTANDO__ = true;
    try {
    const cfg = validarConfig(config);
    const itens = plano(cfg);
    const ambiguos = itens.filter((item) => !item.pronto);
    if (ambiguos.length) {
      throw new Error(
        `Execução cancelada: Modelo(s) ${ambiguos.map((item) => item.modelo).join(", ")} ausente(s) ou duplicado(s).`
      );
    }

    const fim = cfg.inicio + cfg.quantidade - 1;
    const templateFim = cfg.templateInicio + cfg.quantidade - 1;
    const descricaoTemplates = cfg.templates
      ? cfg.templates.map((numero) => `v${numero}`).join(", ")
      : `v${cfg.templateInicio} a v${templateFim}`;
    const resumo = `${cfg.quantidade} modelo(s), do Modelo ${cfg.inicio} ao Modelo ${fim}, usando ${descricaoTemplates}_${cfg.base}.`;
    if (!confirm(`Confirmar alteração no workflow atual?\n\n${resumo}`)) {
      console.log("[GHL Modelos] Cancelado pelo usuário. Nenhuma alteração foi feita.");
      return [];
    }

    const resultados = [];
    for (let numero = cfg.inicio; numero <= fim; numero += 1) {
      const indice = numero - cfg.inicio;
      const templateNumero = cfg.templates
        ? cfg.templates[indice]
        : cfg.templateInicio + indice;
      const no = encontrarNos(numero)[0];
      try {
        resultados.push(await configurarModelo(numero, templateNumero, cfg.base, no));
      } catch (erro) {
        console.error(`[GHL Modelos] Parado no Modelo ${numero}.`, erro);
        throw new Error(
          `A automação parou no Modelo ${numero}; os anteriores já podem ter sido salvos. Motivo: ${erro.message}`
        );
      }
    }

    console.table(resultados);
    console.log("[GHL Modelos] Concluído.");
    return resultados;
    } finally {
      window.__GHL_MODELOS_EXECUTANDO__ = false;
    }
  }

  window.GHLModelos = Object.freeze({
    versao: VERSAO,
    plano,
    executar,
  });

  console.log(
    `[GHL Modelos ${VERSAO}] Carregado. Primeiro rode GHLModelos.plano(...); depois GHLModelos.executar(...).`
  );
})();
