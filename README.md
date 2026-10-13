# Automação GHL — comandos rápidos

## Aplicativo AXEL

O aplicativo local para administrar modelos e pastas do GHL está em `axel/app.py`.

Para instalar e abrir:

```powershell
cd axel
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Depois acesse `http://localhost:5000`. Consulte `axel/README.md` antes de informar credenciais.

## Preparação comum

1. Abra o workflow no GHL.
2. Pressione `F12` e abra a aba **Console**.
3. No seletor do Console, escolha o contexto `workflow-builder...`.
4. Abra o script necessário na pasta `scripts`, copie o arquivo inteiro, cole no Console e pressione `Enter`.
5. Primeiro execute o `plano`. Só execute a alteração depois de conferir a tabela.

Se o GHL atualizar a página ou o iframe, carregue o script novamente.

---

## 1. Colocar modelos

Script: `scripts/ghl-preencher-modelos.js`

O `plano()` procura os blocos `Modelo 1`, `Modelo 2` etc. no canvas do
workflow. A lista de templates oficiais é outro dado; os nomes disponíveis
aparecem no seletor de template de cada bloco.

### Verificar se o script está carregado

```javascript
window.GHLModelos
```

### Sequência contínua — conferir

```javascript
await window.GHLModelos.plano({
  base: "polishopc_210926",
  inicio: 1,
  templateInicio: 6,
  quantidade: 20
})
```

O exemplo associa `Modelo 1` ao `v6_polishopc_210926`, `Modelo 2` ao `v7...` e assim por diante.

### Sequência contínua — executar

```javascript
await window.GHLModelos.executar({
  base: "polishopc_210926",
  inicio: 1,
  templateInicio: 6,
  quantidade: 20
})
```

### Lista de templates aprovados — conferir

```javascript
await window.GHLModelos.plano({
  base: "polishopc_210926",
  inicio: 8,
  templates: [14, 18, 24, 30, 36]
})
```

### Lista de templates aprovados — executar

```javascript
await window.GHLModelos.executar({
  base: "polishopc_210926",
  inicio: 8,
  templates: [14, 18, 24, 30, 36]
})
```

No plano, cada modelo deve aparecer uma vez, com `encontrados: 1` e `pronto: true`.

---

## 2. Colocar copy e imagens

O script foi atualizado para a regra de mensagem inteira: cada secao de vendas
vai para uma acao B... | INTERATIVA / FUP... | INTERATIVA, em um unico
Visit Website Button. O cabecalho usa uma imagem. O timeout e as demais acoes
do workflow ficam como estao.

Neste workflow, o plano deve mostrar a secao 2 em B1 | INTERATIVA e a secao 3
em FUP1 | INTERATIVA. A ordem das secoes precisa coincidir com a ordem dos nos.

Antes de executar:

- Informe a URL de compra em urlCompra (ou como link dentro de LINK COMPRA).
- Quando a secao tiver mais de uma imagem, escolha uma imagem por secao.
  O numero comeca em 1. A secao 2 do documento enviado tem duas imagens.
- O exemplo imagemPorSecao: { 2: 2 } seleciona a segunda imagem da secao 2.
- Se a ordem dos nos for diferente, use acoesPorSecao para indicar os nomes.
- Rode plano e confira a tabela, os alvos e as pendencias.
- executar salva D1/D2 e cada acao interativa separadamente. Se houver erro
  no meio, as acoes anteriores podem ja estar salvas. O script nao publica.

Script: `scripts/ghl-colocar-copy.js`

O script ghl-preencher-modelos.js continua selecionando o template oficial do
bloco Modelo 1. Este script coloca a copy nos blocos interativos B1/FUP1.

### Verificar se o script está carregado

```javascript
window.GHLCopy
```

### Conferir

```javascript
await window.GHLCopy.plano({
  documento: "LINK_DO_GOOGLE_DOCS",
  urlCompra: "URL_DA_COMPRA",
  imagemPorSecao: { 2: 2 }
})
```

### Executar

```javascript
await window.GHLCopy.executar({
  documento: "LINK_DO_GOOGLE_DOCS",
  urlCompra: "URL_DA_COMPRA",
  imagemPorSecao: { 2: 2 }
})
```

Exemplo de link:

```javascript
await window.GHLCopy.plano({
  documento: "https://docs.google.com/document/d/ID_DO_DOCUMENTO/edit",
  urlCompra: "URL_DA_COMPRA",
  imagemPorSecao: { 2: 2 }
})
```

Depois da conclusão, pressione `F5` na página principal do GHL para sincronizar a tela.

---

## 3. Gerar dados do relatório

Script: `scripts/ghl-gerar-relatorio.js`

Antes de executar, feche o painel lateral de edição da ação.

### Verificar se o script está carregado

```javascript
window.GHLRelatorio
```

### Conferir modelos e tags

```javascript
window.GHLRelatorio.plano({
  prefixoTags: "21/09/2026 - polishop - ecom"
})
```

### Coletar e baixar o JSON

```javascript
await window.GHLRelatorio.executar({
  cliente: "Polishop",
  campanha: "NOME DA CAMPANHA",
  copies: "LINK_DO_DOCUMENTO_DE_COPIES",
  custo: 0.24,
  base: "entregues",
  prefixoTags: "21/09/2026 - polishop - ecom"
})
```

O script baixa um arquivo como `Dados_Polishop.json`, que deve ser aberto no gerador de relatório.

### Regra do prefixo das tags

Com `prefixoTags`, o relatório consulta `clicou botão 1`, `clicou botão 2` e
`cancelar avisos`. Também tenta `abriu link` e `abriu formulário`; se essas
consultas retornarem zero contatos ou falharem, os campos ficam vazios. Para
usar um nome de tag diferente, passe `tags`, por exemplo:

```javascript
tags: { forms: "NOME EXATO DA TAG" }
```

Não coloque ` -` no final do prefixo. O script adiciona o separador automaticamente.

Correto:

```javascript
prefixoTags: "25/09/2026- disparo"
```

Errado:

```javascript
prefixoTags: "25/09/2026- disparo -"
```

O formato errado faria o script procurar tags com `- -` e retornar zero.

---

## Cuidados durante a execução

- Não clique nem navegue no workflow enquanto um script estiver rodando.
- Não deixe o computador suspender ou desligar a tela.
- Se aparecer `GHLModelos`, `GHLCopy` ou `GHLRelatorio is not defined`, selecione novamente `workflow-builder...` e cole o script correspondente outra vez.
- O comando `plano()` somente confere. O comando `executar()` realiza a alteração ou coleta.
- Não rode o mesmo `executar()` duas vezes simultaneamente.

