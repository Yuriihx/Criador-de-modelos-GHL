/*
 * GHL - aplica a copy de um Google Docs em acoes interativas do workflow.
 *
 * Nova regra: cada secao de vendas inteira ocupa um unico bloco
 * "WhatsApp interactive messages" (Visit Website Button). O script nao
 * divide o texto em acoes whatsapp_media/M1/M2/M3.
 * O texto do botao e mantido quando tem ate 20 caracteres; se faltar ou
 * exceder o limite, e inferido pelo direcionamento no final da copy.
 *
 * O plano e somente leitura. Executar altera o workflow em rascunho, mas nao
 * publica o fluxo.
 */

(() => {
  "use strict";

  const VERSAO = "0.5.3";
  const LIMITE_TEXTO_BOTAO = 20;
  const ESPERA_PADRAO = 30000;

  const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizar = (valor) =>
    String(valor ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  const simplificar = (valor) =>
    normalizar(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const texto = (elemento) => simplificar(elemento?.innerText || elemento?.textContent);

  function visivel(elemento) {
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
  }

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
      "Tempo esgotado esperando: " + descricao +
      (ultimoErro ? " (" + ultimoErro.message + ")" : "")
    );
  }

  function clicar(elemento) {
    if (!elemento) throw new Error("Elemento para clique nao encontrado.");
    elemento.scrollIntoView?.({ block: "center", inline: "center" });
    const caixa = elemento.getBoundingClientRect();
    const clientX = caixa.left + caixa.width / 2;
    const clientY = caixa.top + caixa.height / 2;
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      elemento.dispatchEvent(
        tipo.startsWith("pointer")
          ? new PointerEvent(tipo, {
              bubbles: true, cancelable: true, composed: true, view: window,
              clientX, clientY, button: 0, buttons: tipo.includes("down") ? 1 : 0,
            })
          : new MouseEvent(tipo, {
              bubbles: true, cancelable: true, composed: true, view: window,
              clientX, clientY, button: 0, buttons: tipo.includes("down") ? 1 : 0,
            })
      );
    }
  }

  function limparLinhas(valor) {
    return String(valor ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\u000b/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function idDocumento(url) {
    const match = String(url || "").trim().match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error("Link do Google Docs invalido.");
    return match[1];
  }

  const SEPARADOR = "\n<<<GHL_HR>>>\n";

  function textoEstruturado(elemento) {
    const blocos = new Set([
      "P", "DIV", "TR", "TD", "TABLE", "SECTION", "ARTICLE", "LI",
      "H1", "H2", "H3", "H4", "H5", "H6",
    ]);
    let saida = "";
    function visitar(no) {
      if (no.nodeType === Node.TEXT_NODE) {
        saida += no.nodeValue || "";
        return;
      }
      if (!(no instanceof Element)) return;
      if (no.tagName === "BR") {
        saida += "\n";
        return;
      }
      if (no.tagName === "HR") {
        saida += SEPARADOR;
        return;
      }
      const bloco = blocos.has(no.tagName);
      if (bloco && saida && !saida.endsWith("\n")) saida += "\n";
      for (const filho of no.childNodes) visitar(filho);
      if (bloco && !saida.endsWith("\n")) saida += "\n";
    }
    visitar(elemento);
    return limparLinhas(saida);
  }

  function informacaoDoTitulo(elemento) {
    const bruto = String(elemento?.textContent || "").replace(/\s+/g, " ").trim();
    const semAcento = bruto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const achou = semAcento.match(
      /^\s*(\d+)\s*[_\-–”:]\s*(?:MENSAGEM|FOLLOW[\s_-]*UP)(?=$|[\s_\-–”:])/i
    );
    return achou ? { numero: Number(achou[1]), titulo: bruto } : null;
  }

  function elementosDaSecao(titulo) {
    const itens = [];
    for (let atual = titulo.nextElementSibling; atual; atual = atual.nextElementSibling) {
      if (/^H[1-6]$/.test(atual.tagName) && informacaoDoTitulo(atual)) break;
      itens.push(atual);
    }
    return itens;
  }

  function tabelaDisparo(itens) {
    return itens.find((el) => {
      if (el.tagName !== "TABLE") return false;
      const primeira = el.querySelector("tr");
      return /^\s*DISPARO\s*$/i.test(primeira?.textContent || "");
    });
  }

  function celulaDaCopy(tabela) {
    const linhas = tabela ? [...tabela.querySelectorAll("tr")] : [];
    return linhas.slice(1).flatMap((linha) => [...linha.querySelectorAll("td")])[0] || null;
  }

  function paragrafosDaCelula(celula) {
    if (!celula) return [];
    return [...celula.querySelectorAll(":scope > p")]
      .map((p) => limparLinhas(textoEstruturado(p)))
      .filter(Boolean);
  }

  function substituirNome(valor) {
    return limparLinhas(
      String(valor || "").replace(/\[\s*NOME(?:\s+DO\s+LEAD)?\s*\]/gi, "{{contact.first_name}}")
    );
  }

  function linkExternoDoElemento(elemento) {
    for (const link of [...(elemento?.querySelectorAll("a[href]") || [])]) {
      try {
        const href = new URL(link.href);
        const destino = href.searchParams.get("q");
        if (destino && /^https?:\/\//i.test(destino)) return destino;
        if (/^https?:$/.test(href.protocol) && !/(^|\.)google\./i.test(href.hostname)) {
          return href.href;
        }
      } catch {}
    }
    const textoBruto = textoEstruturado(elemento);
    return textoBruto.match(/https?:\/\/[^\s<>]+/i)?.[0] || "";
  }

  function extrairCopyEControles(celula) {
    const paragrafos = paragrafosDaCelula(celula);
    const corpo = [];
    let url = linkExternoDoElemento(celula);
    let botao = "";
    const partes = paragrafos.length
      ? paragrafos
      : textoEstruturado(celula).replaceAll(SEPARADOR, "\n").split(/\n{2,}/);

    for (const paragrafo of partes) {
      const mantidas = [];
      for (const linhaOriginal of String(paragrafo || "").split(/\r?\n/)) {
        let linha = limparLinhas(linhaOriginal);
        if (!linha) continue;

        const linhaLink = linha.match(/^\s*link\s+(?:compra|do\s+bot[aã]o)\s*:\s*(.*)$/i);
        if (linhaLink) {
          if (/^https?:\/\//i.test(linhaLink[1])) url ||= linhaLink[1].trim();
          continue;
        }
        const linhaBotao = linha.match(/^\s*(?:bot[aã]o|cta)\s*:\s*(.+)$/i);
        if (linhaBotao) {
          botao ||= linhaBotao[1].trim().replace(/^['“”"]|['“”"]$/g, "");
          continue;
        }
        if (/^\s*https?:\/\//i.test(linha)) {
          url ||= linha.trim();
          continue;
        }
        if (/^\s*\[\s*link\b/i.test(linha)) continue;

        linha = linha.replace(/^\s*(?:M\s*\d+|INTERATIVA|CTA)\s*(?:[:|\-]\s*|\s+)/i, "");
        if (linha) mantidas.push(linha);
      }
      if (mantidas.length) corpo.push(mantidas.join("\n"));
    }

    return { body: substituirNome(corpo.join("\n\n")), url, botao };
  }

  function tamanhoDataUrl(src) {
    const base64 = String(src || "").split(",")[1] || "";
    return Math.max(
      0,
      Math.floor((base64.length * 3) / 4) -
        (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0)
    );
  }

  function imagensDaSecao(itens, numero) {
    const encontradas = itens
      .flatMap((el) => [...el.querySelectorAll("img")])
      .filter((img, indice, lista) => lista.findIndex((outra) => outra.src === img.src) === indice)
      .filter((img) => img.src?.startsWith("data:image/"));
    return encontradas.map((imagem, indice) => ({
      nome: numero + "_IMAGEM_" + (indice + 1) + "." +
        (imagem.src.startsWith("data:image/jpeg") ? "jpg" : "png"),
      tipo: imagem.src.slice(5, imagem.src.indexOf(";")),
      bytes: tamanhoDataUrl(imagem.src),
      dataUrl: imagem.src,
    }));
  }

  function indiceImagemConfigurado(config, numero, quantidade) {
    const porSecao = config.imagemPorSecao || config.imagensPorSecao || {};
    const escolhido = porSecao[numero] ?? config.imagemIndice;
    const indice = escolhido === undefined ? null : Number(escolhido);
    if (Number.isInteger(indice) && indice >= 1 && indice <= quantidade) return indice - 1;
    if (escolhido === undefined && quantidade === 1) return 0;
    return null;
  }

  function limparRotuloBotao(valor) {
    return String(valor || "")
      .trim()
      .replace(/^(?:\*\*|__|\*|_)+|(?:\*\*|__|\*|_)+$/g, "")
      .replace(/^[\s'\u201c"]+|[\s'\u201d"]+$/g, "")
      .trim();
  }

  function intencaoDoBotao(valor) {
    const cta = simplificar(valor);
    if (/\b(?:chame|chamar|fale|falar|converse|conversar|atendente|atendimento|whatsapp|zap|wp|equipe|consultor)\b/.test(cta)) {
      return "contato";
    }
    if (/\b(?:garanta|garantir|compre|comprar|adquira|adquirir|reserve|reservar|reserva|ingresso|ingressos|passaporte|pedido)\b/.test(cta)) {
      return "compra";
    }
    if (/\b(?:acesse|acessar|acesso|visite|visitar|clique|site|saiba mais|confira|conheca)\b/.test(cta)) {
      return "site";
    }
    return "";
  }

  function botaoDaSecao(itens, controlesCopy, config, numero, body, url) {
    const porSecao = config.botaoPorSecao || {};
    const textoSecao = itens.map((el) => textoEstruturado(el)).join("\n");
    const marcador = textoSecao.match(/(?:inserir\s+o\s+cta|cta)\s*[:\-]?\s*([^\r\n.!?]+)/i);
    const candidatos = [
      { valor: porSecao[numero], origem: "botaoPorSecao" },
      { valor: config.textoBotao, origem: "textoBotao" },
      { valor: controlesCopy.botao, origem: "CTA/Botao da copy" },
      { valor: marcador?.[1], origem: "marcador CTA da secao" },
    ].map((item) => ({ ...item, valor: limparRotuloBotao(item.valor) }))
      .filter((item) => item.valor);

    const explicito = candidatos[0];
    if (explicito && explicito.valor.length <= LIMITE_TEXTO_BOTAO) {
      return { texto: explicito.valor, origem: explicito.origem };
    }

    const paragrafosFinais = limparLinhas(body)
      .split(/\n\s*\n/)
      .map((paragrafo) => paragrafo.trim())
      .filter(Boolean);
    const direcionamentoFinal = paragrafosFinais[paragrafosFinais.length - 1] || "";
    const fontes = [explicito?.valor, direcionamentoFinal];
    const intencao = fontes.map(intencaoDoBotao).find(Boolean);
    if (intencao === "contato") {
      return { texto: "FALAR COM ATENDENTE!", origem: "inferido pelo direcionamento final" };
    }
    if (intencao === "compra") {
      return { texto: "GARANTIR AGORA!", origem: "inferido pelo direcionamento final" };
    }
    if (intencao === "site" || url) {
      return { texto: "ACESSAR AGORA!", origem: "inferido pelo direcionamento final" };
    }
    return { texto: "GARANTIR AGORA!", origem: "padrao para copy de vendas" };
  }

  async function ler(config = {}) {
    const id = idDocumento(config.documento);
    const exportUrl = "https://docs.google.com/document/d/" + id + "/export?format=html";
    let resposta;
    try {
      resposta = await fetch(exportUrl, { credentials: "omit" });
    } catch (erro) {
      throw new Error(
        "Nao consegui ler o Google Docs. O documento precisa permitir leitura pelo link. Motivo: " +
        erro.message
      );
    }
    if (!resposta.ok) {
      throw new Error(
        "O Google Docs respondeu HTTP " + resposta.status +
        ". Verifique se o documento permite leitura pelo link."
      );
    }

    const html = await resposta.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titulos = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter((el) => informacaoDoTitulo(el));
    if (titulos.length < 2) {
      throw new Error("Preciso encontrar a abertura e pelo menos uma secao de vendas numerada.");
    }

    const secoes = titulos.map((titulo) => {
      const info = informacaoDoTitulo(titulo);
      const itens = elementosDaSecao(titulo);
      const tabela = tabelaDisparo(itens);
      return {
        numero: info.numero,
        titulo: limparLinhas(info.titulo),
        itens,
        celula: celulaDaCopy(tabela),
      };
    });

    const abertura = secoes.find((secao) => secao.numero === 1);
    const blocosAbertura = paragrafosDaCelula(abertura?.celula);
    if (blocosAbertura.length < 3) {
      throw new Error("A abertura precisa ter saudacao e os paragrafos usados como D1 e D2.");
    }

    const vendas = secoes
      .filter((secao) => secao.numero > 1)
      .map((secao) => {
        if (!secao.celula) {
          throw new Error(secao.titulo + ": tabela DISPARO ou celula da copy nao encontrada.");
        }
        const controlesCopy = extrairCopyEControles(secao.celula);
        if (!controlesCopy.body) throw new Error(secao.titulo + ": a copy esta vazia.");

        const urlConfigurada = (config.urlCompraPorSecao || config.urlsPorSecao || {})[secao.numero];
        const url = String(urlConfigurada || config.urlCompra || controlesCopy.url || "").trim();
        const imagens = imagensDaSecao(secao.itens, secao.numero);
        const botao = botaoDaSecao(
          secao.itens, controlesCopy, config, secao.numero, controlesCopy.body, url
        );
        return {
          numero: secao.numero,
          titulo: secao.titulo,
          body: controlesCopy.body,
          url,
          textoBotao: botao.texto,
          origemBotao: botao.origem,
          imagens,
          imagemIndice: indiceImagemConfigurado(config, secao.numero, imagens.length),
        };
      });

    const avisos = [];
    for (const venda of vendas) {
      if (!venda.url) {
        avisos.push("Secao " + venda.numero + ": informe urlCompra ou preencha LINK COMPRA.");
      }
      if (!venda.imagens.length) {
        avisos.push("Secao " + venda.numero + ": nenhuma imagem incorporada foi encontrada.");
      } else if (venda.imagemIndice === null) {
        avisos.push(
          "Secao " + venda.numero + ": escolha uma imagem com imagemPorSecao[" +
          venda.numero + "] (numero da imagem comeca em 1)."
        );
      }
      if (!venda.textoBotao) {
        avisos.push(
          "Secao " + venda.numero + ": nao foi possivel definir o texto do botao."
        );
      } else if (venda.textoBotao.length > LIMITE_TEXTO_BOTAO) {
        avisos.push("Secao " + venda.numero + ": o texto do botao excede " + LIMITE_TEXTO_BOTAO + " caracteres.");
      }
    }

    return {
      versao: VERSAO,
      documentoId: id,
      avisos,
      abertura: {
        d1: blocosAbertura[1].replace(/^\s*\(?D1\)?\s*(?:[:|\-]\s*)?/i, ""),
        d2: blocosAbertura[2].replace(/^\s*\(?D2\)?\s*(?:[:|\-]\s*)?/i, ""),
      },
      vendas,
    };
  }

  function linhas(elemento) {
    return String(elemento?.innerText || "")
      .split(/\r?\n/)
      .map(simplificar)
      .filter(Boolean);
  }

  function encontrarNo(nome) {
    const alvo = simplificar(nome);
    const encontrados = [...document.querySelectorAll(".vue-flow__node, .react-flow__node")]
      .filter((no) => linhas(no).includes(alvo));
    if (encontrados.length !== 1) {
      throw new Error(
        "O modulo '" + nome + "' precisa aparecer uma vez; encontrei " + encontrados.length + "."
      );
    }
    return encontrados[0];
  }

  function listarNosInterativos() {
    return [...document.querySelectorAll(".vue-flow__node, .react-flow__node")]
      .map((no) => ({
        no,
        nome: linhas(no).find((linha) => /^(?:b\d+|fup\d+)\s*\|\s*interativa$/i.test(linha)) || "",
      }))
      .filter((item) => item.nome);
  }

  function resolverAcoes(dados, config = {}) {
    const disponiveis = listarNosInterativos();
    const porSecao = config.acoesPorSecao || {};
    const vinculos = [];
    const erros = [];

    if (Object.keys(porSecao).length) {
      for (const venda of dados.vendas) {
        const nome = String(porSecao[venda.numero] || "").trim();
        if (!nome) {
          erros.push("Falta acoesPorSecao[" + venda.numero + "].");
          continue;
        }
        const encontrados = disponiveis.filter((item) => item.nome === simplificar(nome));
        if (encontrados.length !== 1) {
          erros.push("O modulo '" + nome + "' foi encontrado " + encontrados.length + " vezes.");
          continue;
        }
        vinculos.push({ secao: venda.numero, nome: encontrados[0].nome });
      }
    } else if (disponiveis.length !== dados.vendas.length) {
      erros.push(
        "O documento tem " + dados.vendas.length + " secoes de vendas e o workflow tem " +
        disponiveis.length + " modulos B/FUP | INTERATIVA. Informe acoesPorSecao."
      );
    } else {
      dados.vendas.forEach((venda, indice) => {
        vinculos.push({ secao: venda.numero, nome: disponiveis[indice].nome });
      });
    }

    const nomes = vinculos.map((item) => item.nome);
    if (new Set(nomes).size !== nomes.length) erros.push("Uma acao interativa foi mapeada para mais de uma secao.");
    return { vinculos, erros, disponiveis: disponiveis.map((item) => item.nome) };
  }

  function plano(config = {}) {
    return ler(config).then((dados) => {
      const acoes = resolverAcoes(dados, config);
      const resumo = dados.vendas.map((venda) => {
        const imagem = venda.imagemIndice === null ? "" : venda.imagens[venda.imagemIndice]?.nome || "";
        const acao = acoes.vinculos.find((item) => item.secao === venda.numero)?.nome || "(sem mapeamento)";
        return {
          secao: venda.numero,
          acao,
          caracteres: venda.body.length,
          copy: venda.body.slice(0, 110),
          url: venda.url || "(faltando)",
          botao: venda.textoBotao || "(faltando)",
          origemBotao: venda.origemBotao,
          imagensNoDoc: venda.imagens.length,
          imagem: imagem || "(escolha necessaria)",
        };
      });

      console.log("[GHL Copy] Plano somente leitura. Nenhuma alteracao foi feita.");
      console.table([
        { campo: "D1", valor: dados.abertura.d1 },
        { campo: "D2", valor: dados.abertura.d2 },
      ]);
      console.table(resumo);
      const pendencias = [...dados.avisos, ...acoes.erros];
      if (pendencias.length) console.warn("[GHL Copy] Pendencias:", pendencias);
      else console.log("[GHL Copy] Conteudo e mapeamento prontos para conferir.");
      return {
        versao: dados.versao,
        documentoId: dados.documentoId,
        abertura: dados.abertura,
        vendas: dados.vendas.map((venda) => ({
          numero: venda.numero,
          titulo: venda.titulo,
          body: venda.body,
          url: venda.url,
          textoBotao: venda.textoBotao,
          origemBotao: venda.origemBotao,
          imagens: venda.imagens.map((imagem, indice) => ({
            ordem: indice + 1,
            nome: imagem.nome,
            kb: Math.round(imagem.bytes / 1024),
          })),
          imagemSelecionada: venda.imagemIndice === null ? null : venda.imagemIndice + 1,
        })),
        mapeamento: acoes.vinculos,
        pendencias,
      };
    });
  }

  function acharRotulo(nome) {
    const alvo = simplificar(nome);
    return [...document.querySelectorAll("label,span,div,p")]
      .filter(visivel)
      .filter((elemento) => simplificar(texto(elemento).replace(/\s*\*$/, "")) === alvo)
      .sort((a, b) => a.children.length - b.children.length)[0];
  }

  function acharControle(nome, tipo = "selecao") {
    const rotulo = acharRotulo(nome);
    if (!rotulo) throw new Error("Rotulo nao encontrado: " + nome);

    let atual = rotulo;
    for (let nivel = 0; nivel < 7 && atual; nivel += 1, atual = atual.parentElement) {
      const seletor = tipo === "entrada"
        ? 'input:not([type="hidden"]),textarea,[contenteditable="true"]'
        : '[role="combobox"],button[aria-haspopup],input[aria-haspopup],input:not([type="hidden"])';
      const controles = [...atual.querySelectorAll(seletor)].filter(visivel);
      if (controles.length === 1) return controles[0];
    }
    throw new Error("Controle nao encontrado para: " + nome);
  }

  function folhaComTexto(predicado, raiz = document) {
    const seletores = ['[role="option"]', '[role="menuitem"]', "li", "button", "span", "div"];
    return [...raiz.querySelectorAll(seletores.join(","))]
      .filter(visivel)
      .filter((elemento) => predicado(texto(elemento), elemento))
      .sort((a, b) => {
        const aOpcao = a.matches('[role="option"],[role="menuitem"],li') ? 0 : 1;
        const bOpcao = b.matches('[role="option"],[role="menuitem"],li') ? 0 : 1;
        if (aOpcao !== bOpcao) return aOpcao - bOpcao;
        return a.children.length - b.children.length || texto(a).length - texto(b).length;
      })[0];
  }

  async function escolher(nomeCampo, aceita, descricaoOpcao) {
    const controle = acharControle(nomeCampo);
    const gatilho =
      controle.closest(".hr-base-selection") ||
      controle.closest('[role="combobox"],button[aria-haspopup]') ||
      controle;
    clicar(gatilho);
    await dormir(250);
    const opcao = await esperar(
      () => folhaComTexto((valor) => aceita(valor)),
      "opcao " + descricaoOpcao + " em " + nomeCampo
    );
    clicar(opcao);
    await dormir(350);
    // O seletor fecha com o input focado dentro de um elemento aria-hidden.
    // Tirar o foco evita o aviso de acessibilidade emitido pelo GHL.
    document.activeElement?.blur?.();
  }

  function campoEditavel(campo) {
    if (!campo) return null;
    if (
      !(campo instanceof HTMLInputElement) &&
      !(campo instanceof HTMLTextAreaElement) &&
      campo.getAttribute?.("contenteditable") !== "true"
    ) {
      campo = [...(campo?.querySelectorAll?.(
        'input:not([type="hidden"]),textarea,[contenteditable="true"]'
      ) || [])].find(visivel);
    }
    return campo || null;
  }

  function normalizarValorCampo(valor) {
    return String(valor ?? "").replace(/\r\n?/g, "\n");
  }

  function definirValor(campo, valor) {
    campo = campoEditavel(campo);
    if (!campo) throw new Error("Input interno do campo nao encontrado.");

    if (campo.getAttribute?.("contenteditable") === "true") {
      campo.focus();
      const selecao = window.getSelection();
      const intervalo = document.createRange();
      intervalo.selectNodeContents(campo);
      selecao.removeAllRanges();
      selecao.addRange(intervalo);
      const inseriu = document.execCommand?.("insertText", false, String(valor));
      if (!inseriu) campo.textContent = String(valor);
      campo.dispatchEvent(new InputEvent("input", {
        bubbles: true, composed: true, inputType: "insertText", data: String(valor),
      }));
      campo.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      campo.blur();
      return campo;
    }

    const prototipo = campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    if (!setter) throw new Error("Nao foi possivel preencher o campo.");
    campo.focus();
    setter.call(campo, String(valor));
    campo.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertText", data: String(valor),
    }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    campo.blur();
    return campo;
  }

  function acharBotaoSalvar() {
    return [...document.querySelectorAll("button")]
      .filter(visivel)
      .find((botao) => simplificar(texto(botao)) === "salvar acao");
  }

  function campoPorId(id) {
    const campo = document.getElementById(id);
    if (!campo || !visivel(campo)) throw new Error("Campo nao encontrado: #" + id);
    return campo;
  }

  function valorDoCampo(campo) {
    const interno = campoEditavel(campo);
    if (interno?.getAttribute?.("contenteditable") === "true") {
      return String(interno.innerText ?? interno.textContent ?? "").replace(/\n+$/, "");
    }
    return interno
      ? (interno.value ?? interno.textContent ?? "")
      : (campo.textContent || "");
  }

  async function preencherEVerificarCampo(id, valor, descricao) {
    const esperado = normalizarValorCampo(valor);
    const elemento = campoEditavel(campoPorId(id));
    if (!elemento) throw new Error("Input interno do campo nao encontrado: #" + id);

    const limite = Number(elemento.maxLength);
    if (Number.isInteger(limite) && limite >= 0 && esperado.length > limite) {
      throw new Error(
        descricao + " excede o limite do campo (" + esperado.length + "/" + limite + " caracteres)."
      );
    }

    definirValor(elemento, valor);
    const corresponde = () =>
      normalizarValorCampo(valorDoCampo(campoPorId(id))) === esperado;
    try {
      await esperar(corresponde, descricao + " refletir o valor no GHL", 5000);
      await dormir(200);
      if (!corresponde()) throw new Error("O valor mudou depois da atualizacao inicial.");
    } catch (erro) {
      let atual = "";
      try { atual = valorDoCampo(campoPorId(id)); } catch {}
      throw new Error(
        descricao + " nao foi confirmado pelo GHL. Esperado: " + esperado.length +
        " caracteres; lido no campo: " + normalizarValorCampo(atual).length + "."
      );
    }
  }

  function salvarAcao(descricao) {
    const botao = acharBotaoSalvar();
    if (!botao || botao.disabled) throw new Error("Salvar acao nao esta disponivel: " + descricao);
    clicar(botao);
    return dormir(1500);
  }

  function capturarProximoAutosave(limite = ESPERA_PADRAO) {
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
        reject(new Error("O GHL nao enviou o autosave esperado."));
      }, limite);

      proto.open = function (metodo, url, ...resto) {
        this.__ghlCopyReq = { metodo: String(metodo || "GET").toUpperCase(), url: String(url), cabecalhos: {} };
        return abrirOriginal.call(this, metodo, url, ...resto);
      };
      proto.setRequestHeader = function (nome, valor) {
        if (this.__ghlCopyReq) this.__ghlCopyReq.cabecalhos[nome] = valor;
        return cabecalhoOriginal.call(this, nome, valor);
      };
      proto.send = function (corpo) {
        const req = this.__ghlCopyReq;
        if (!terminou && req?.metodo === "PUT" && /\/auto-save(?:\?|$)/.test(req.url)) {
          try {
            const objeto = typeof corpo === "string" ? JSON.parse(corpo) : corpo;
            terminou = true;
            clearTimeout(timer);
            restaurar();
            this.addEventListener("loadend", () => {
              if (this.status >= 200 && this.status < 300) {
                try {
                  const resposta = JSON.parse(this.responseText || "{}");
                  if (Number.isInteger(resposta.version)) objeto.version = resposta.version;
                } catch {}
                resolve({ url: req.url, cabecalhos: req.cabecalhos, corpo: objeto });
              } else {
                reject(new Error("O autosave preparatorio respondeu HTTP " + this.status + "."));
              }
            }, { once: true });
          } catch (erro) {
            terminou = true;
            clearTimeout(timer);
            restaurar();
            reject(new Error("Nao consegui interpretar o autosave: " + erro.message));
          }
        }
        return enviarOriginal.call(this, corpo);
      };
    });
  }

  async function obterWorkflowAtual() {
    let no;
    for (const nome of ["D1 E D2", "Atualizar variaveis D1"]) {
      const encontrados = [...document.querySelectorAll(".vue-flow__node, .react-flow__node")]
        .filter((item) => linhas(item).includes(simplificar(nome)));
      if (encontrados.length === 1) {
        no = encontrados[0];
        break;
      }
    }
    if (!no) throw new Error('Modulo "D1 E D2" nao encontrado no workflow aberto.');

    clicar(no);
    await esperar(
      () => campoPorId("field-0-value") && campoPorId("field-1-value") && acharBotaoSalvar(),
      "campos D1/D2 para capturar o endpoint de upload"
    );
    const captura = capturarProximoAutosave();
    clicar(acharBotaoSalvar());
    return captura;
  }

  function requisicaoXhr({ metodo, url, cabecalhos, corpo }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, url, true);
      for (const [nome, valor] of Object.entries(cabecalhos || {})) {
        if (corpo instanceof FormData && /^content-type$/i.test(nome)) continue;
        if (/^(content-length|host)$/i.test(nome)) continue;
        try { xhr.setRequestHeader(nome, valor); } catch {}
      }
      xhr.addEventListener("load", () => {
        let resposta = xhr.responseText;
        try { resposta = JSON.parse(resposta); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(resposta);
        else reject(new Error("HTTP " + xhr.status + " em " + url + ": " +
          String(xhr.responseText || "").slice(0, 300)));
      });
      xhr.addEventListener("error", () => reject(new Error("Falha de rede em " + url)));
      xhr.send(corpo);
    });
  }

  async function arquivoDaImagem(imagem) {
    const blob = await (await fetch(imagem.dataUrl)).blob();
    return new File([blob], imagem.nome, { type: imagem.tipo || blob.type || "image/png" });
  }

  async function enviarImagem(imagem, snapshot) {
    const formulario = new FormData();
    formulario.append("file", await arquivoDaImagem(imagem));
    const url = snapshot.url.replace(/\/auto-save(?:\?.*)?$/, "/upload");
    const resposta = await requisicaoXhr({
      metodo: "POST", url, cabecalhos: snapshot.cabecalhos, corpo: formulario,
    });
    const item = Array.isArray(resposta) ? resposta[0] : resposta;
    if (!item?.url) throw new Error("O upload de " + imagem.nome + " nao devolveu uma URL.");
    return item.url;
  }

  async function atualizarD1D2(dados) {
    const nome = document.querySelectorAll(".vue-flow__node, .react-flow__node");
    let no;
    for (const candidato of nome) {
      const ls = linhas(candidato);
      if (ls.includes("d1 e d2") || ls.includes("atualizar variaveis d1")) {
        no = candidato;
        break;
      }
    }
    if (!no) throw new Error('Modulo "D1 E D2" nao encontrado.');
    clicar(no);
    await esperar(
      () => campoPorId("field-0-value") && campoPorId("field-1-value") && acharBotaoSalvar(),
      "valores do modulo D1/D2"
    );
    await preencherEVerificarCampo("field-0-value", dados.abertura.d1, "Campo D1");
    await preencherEVerificarCampo("field-1-value", dados.abertura.d2, "Campo D2");
    await salvarAcao("D1 E D2");
  }

  async function abrirInterativa(nome) {
    clicar(encontrarNo(nome));
    await esperar(
      () => acharRotulo("INTERACTIVE MESSAGE TYPE") && acharBotaoSalvar(),
      "abrir " + nome
    );
  }

  async function configurarInterativa(nome, venda, urlImagem, config = {}) {
    await abrirInterativa(nome);
    await escolher(
      "INTERACTIVE MESSAGE TYPE",
      (valor) => simplificar(valor) === "visit website button",
      "Visit Website Button"
    );
    await esperar(
      () => acharRotulo("HEADER TYPE") && document.querySelector("#input-field-body"),
      "campos da mensagem interativa Visit Website Button"
    );
    await escolher(
      "HEADER TYPE",
      (valor) => simplificar(valor) === "image",
      "Image"
    );
    await esperar(
      () => ["input-field-header", "input-field-body", "input-field-footer",
        "input-field-url", "input-field-button_text"].every((id) => document.getElementById(id)),
      "campos de cabecalho, copy, URL e botao"
    );

    if (!venda.textoBotao || venda.textoBotao.length > LIMITE_TEXTO_BOTAO) {
      throw new Error("O texto do botao precisa ter de 1 a " + LIMITE_TEXTO_BOTAO + " caracteres.");
    }

    const valores = {
      "input-field-header": urlImagem,
      "input-field-body": venda.body,
      "input-field-footer": String((config.rodapePorSecao || {})[venda.numero] || ""),
      "input-field-url": venda.url,
      "input-field-button_text": venda.textoBotao,
    };
    for (const [id, valor] of Object.entries(valores)) {
      await preencherEVerificarCampo(id, valor, "Campo #" + id + " em " + nome);
    }

    await salvarAcao(nome);
    return { secao: venda.numero, acao: nome, caracteres: venda.body.length, imagem: urlImagem };
  }

  async function executar(config = {}) {
    if (window.__GHL_COPY_EXECUTANDO__) throw new Error("GHLCopy ja esta executando.");
    window.__GHL_COPY_EXECUTANDO__ = true;
    try {
      const dados = await ler(config);
      const acoes = resolverAcoes(dados, config);
      const pendencias = [...dados.avisos, ...acoes.erros];
      if (pendencias.length) {
        throw new Error("Execucao bloqueada. Corrija antes: " + pendencias.join(" | "));
      }
      for (const venda of dados.vendas) {
        const url = new URL(venda.url);
        if (!/^https?:$/.test(url.protocol)) {
          throw new Error("URL de compra invalida na secao " + venda.numero + ".");
        }
      }

      const imagemPorSecao = {};
      for (const venda of dados.vendas) imagemPorSecao[venda.numero] = venda.imagens[venda.imagemIndice];
      const resumo = dados.vendas.map((venda) => {
        const acao = acoes.vinculos.find((item) => item.secao === venda.numero);
        const imagem = imagemPorSecao[venda.numero];
        return "Secao " + venda.numero + " -> " + acao.nome +
          "; " + venda.body.length + " caracteres; " + imagem.nome +
          "; botao: " + venda.textoBotao;
      }).join("\n");
      if (!confirm(
        "Aplicar D1/D2 e a copy completa de cada secao em uma acao Visit Website Button?\n\n" +
        resumo + "\n\nO workflow continuara em rascunho."
      )) {
        console.log("[GHL Copy] Cancelado. Nenhuma alteracao foi feita.");
        return [];
      }

      console.log("[GHL Copy] Obtendo os dados de upload do workflow...");
      const snapshot = await obterWorkflowAtual();
      const imagensEnviadas = {};
      for (const venda of dados.vendas) {
        console.log("[GHL Copy] Enviando " + imagemPorSecao[venda.numero].nome + "...");
        imagensEnviadas[venda.numero] = await enviarImagem(imagemPorSecao[venda.numero], snapshot);
      }

      const resultados = [];
      try {
        console.log("[GHL Copy] Atualizando D1 e D2...");
        await atualizarD1D2(dados);
        for (const venda of dados.vendas) {
          const vinculo = acoes.vinculos.find((item) => item.secao === venda.numero);
          console.log("[GHL Copy] Aplicando a secao " + venda.numero + " em " + vinculo.nome + "...");
          resultados.push(await configurarInterativa(
            vinculo.nome, venda, imagensEnviadas[venda.numero], config
          ));
        }
      } catch (erro) {
        throw new Error(
          "A execucao parou. D1/D2 ou as acoes anteriores podem ja estar salvas. Motivo: " +
          erro.message
        );
      }

      console.table(resultados);
      console.log("[GHL Copy] Concluido. Confira as acoes no workflow; ele nao foi publicado.");
      return resultados;
    } finally {
      window.__GHL_COPY_EXECUTANDO__ = false;
    }
  }

  window.GHLCopy = Object.freeze({ versao: VERSAO, ler, plano, executar });
  console.log(
    "[GHL Copy " + VERSAO +
    "] Carregado. Rode GHLCopy.plano(...) antes de GHLCopy.executar(...)."
  );
})();
