// Importação em massa: baixa o modelo, lê a planilha, mostra a prévia e só grava depois de confirmar.
import { el, api } from './util.js'

const normalizar = (t) =>
  String(t ?? '')
    .split('(')[0]
    .replace(/\*/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export async function abrirImportacao({ rotulo, apiBase, aoTerminar }) {
  const dialogo = el('dialog', { class: 'janela larga' })
  const corpo = el('div')
  dialogo.append(el('h3', {}, `Importar ${rotulo} em massa`), corpo)
  dialogo.addEventListener('close', () => dialogo.remove())
  document.body.append(dialogo)
  dialogo.showModal()

  const mod = await api(apiBase + '/importacao/modelo')
  if (!mod.ok) {
    corpo.append(el('div', { class: 'erro' }, mod.dados.erro || 'Não foi possível abrir a importação.'), el('div', { class: 'botoes' }, fecharBotao()))
    return
  }
  const colunas = mod.dados.colunas
  const limite = mod.dados.limite_linhas

  function fecharBotao(texto = 'Fechar') {
    return el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, texto)
  }

  async function baixarModelo() {
    const { gerarModelo } = await import('/js/vendor/excel.js')
    const blob = await gerarModelo(colunas, colunas.map((c) => c.exemplo))
    const a = el('a', { href: URL.createObjectURL(blob), download: `modelo-${rotulo.toLowerCase()}.xlsx` })
    document.body.append(a)
    a.click()
    a.remove()
  }

  function passoArquivo(mensagemErro) {
    const entrada = el('input', { type: 'file', accept: '.xlsx' })
    const aviso = el('div', {}, mensagemErro ? el('div', { class: 'erro', role: 'alert' }, mensagemErro) : '')
    entrada.addEventListener('change', async () => {
      const arquivo = entrada.files[0]
      if (!arquivo) return
      aviso.replaceChildren(el('p', { class: 'mudo' }, 'Lendo a planilha...'))
      try {
        await lerEMostrarPrevia(arquivo)
      } catch (e) {
        passoArquivo('Não consegui ler esse arquivo. Use o modelo em Excel (.xlsx) e salve sem senha.')
      }
    })
    corpo.replaceChildren(
      el('p', {}, 'Para cadastrar vários de uma vez: baixe o modelo, preencha no Excel (uma linha por cadastro), e envie de volta. Nada é gravado antes de você ver a prévia e confirmar.'),
      el('ol', { class: 'passos' }, el('li', {}, 'Baixe o modelo e preencha. As colunas com * são obrigatórias.'), el('li', {}, 'Escolha o arquivo preenchido (.xlsx).'), el('li', {}, 'Confira a prévia e confirme.')),
      el('p', { class: 'mudo pequeno' }, `Quem já existe é atualizado: só as células preenchidas mudam, as vazias ficam como estão. Até ${limite} linhas por vez.`),
      el('div', { class: 'linha-consulta' }, el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: baixarModelo }, '⬇ Baixar modelo (Excel)'), entrada),
      aviso,
      el('div', { class: 'botoes' }, fecharBotao('Cancelar'))
    )
  }

  async function lerEMostrarPrevia(arquivo) {
    const { lerPlanilha } = await import('/js/vendor/excel.js')
    const matriz = await lerPlanilha(arquivo)
    // acha a linha de cabeçalho: a primeira que reconhece pelo menos uma coluna
    const porTitulo = new Map(colunas.map((c) => [normalizar(c.titulo), c]))
    let cab = -1
    for (let i = 0; i < Math.min(matriz.length, 10); i++) if (matriz[i].some((x) => porTitulo.has(normalizar(x)))) { cab = i; break }
    if (cab < 0) return passoArquivo('Não achei as colunas do modelo. Baixe o modelo de novo e copie seus dados para ele.')
    const mapa = matriz[cab].map((x) => porTitulo.get(normalizar(x)) || null)
    const faltando = colunas.filter((c) => c.obrigatorio && !mapa.includes(c))
    if (faltando.length) return passoArquivo(`Faltam colunas obrigatórias: ${faltando.map((c) => c.titulo).join(', ')}.`)
    const ignoradas = matriz[cab].filter((x, i) => x && !mapa[i])
    const linhas = []
    const numeros = []
    for (let i = cab + 1; i < matriz.length; i++) {
      const obj = {}
      mapa.forEach((c, j) => { if (c) obj[c.campo] = matriz[i][j] ?? '' })
      if (Object.values(obj).every((v) => v === '')) continue
      linhas.push(obj)
      numeros.push(i + 1)
    }
    if (!linhas.length) return passoArquivo('A planilha não tem linhas preenchidas.')
    if (linhas.length > limite) return passoArquivo(`A planilha tem ${linhas.length} linhas; o limite é ${limite} por vez. Divida em partes.`)

    // a API numera como "linha do cabeçalho = 1"; ajustamos para o número real na planilha
    const ajuste = (n) => numeros[n - 2] ?? n
    corpo.replaceChildren(el('p', { class: 'mudo' }, 'Conferindo...'))
    const r = await api(apiBase + '/importar', { metodo: 'POST', corpo: { linhas, aplicar: false } })
    if (!r.ok) return passoArquivo(r.dados.erro || 'Não foi possível conferir a planilha.')
    mostrarPrevia(linhas, r.dados, ajuste, ignoradas)
  }

  function tabelaErros(lista, ajuste) {
    if (!lista.length) return ''
    return el(
      'div',
      { class: 'tabela-caixa erros-import' },
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ...['Linha', 'Identificação', 'Problema'].map((x) => el('th', {}, x)))),
        el('tbody', {}, ...lista.slice(0, 100).map((l) => el('tr', {}, el('td', {}, String(ajuste(l.linha))), el('td', {}, l.chave), el('td', {}, l.mensagem))))
      ),
      lista.length > 100 ? el('p', { class: 'mudo pequeno' }, `Mostrando 100 de ${lista.length} problemas.`) : ''
    )
  }

  function mostrarPrevia(linhas, dados, ajuste, ignoradas) {
    const { criar, atualizar, erros } = dados.resumo
    const validos = criar + atualizar
    const confirmar = el('button', { type: 'button', disabled: validos === 0 }, validos ? `Importar ${validos} linha${validos > 1 ? 's' : ''}` : 'Nada para importar')
    confirmar.addEventListener('click', async () => {
      confirmar.disabled = true
      confirmar.textContent = 'Gravando...'
      const g = await api(apiBase + '/importar', { metodo: 'POST', corpo: { linhas, aplicar: true } })
      if (!g.ok) return passoArquivo(g.dados.erro || 'Não foi possível gravar.')
      aoTerminar()
      const res = g.dados.resumo
      corpo.replaceChildren(
        el('div', { class: 'ok' }, `Pronto: ${res.criar} criado${res.criar === 1 ? '' : 's'} e ${res.atualizar} atualizado${res.atualizar === 1 ? '' : 's'}.` + (res.erros ? ` ${res.erros} linha${res.erros > 1 ? 's' : ''} com problema não ${res.erros > 1 ? 'foram importadas' : 'foi importada'}.` : '')),
        tabelaErros(g.dados.linhas, ajuste),
        el('div', { class: 'botoes' }, fecharBotao('Fechar'))
      )
    })
    corpo.replaceChildren(
      el('div', { class: 'resumo-import' },
        el('div', {}, el('strong', {}, String(criar)), ' novo' + (criar === 1 ? '' : 's')),
        el('div', {}, el('strong', {}, String(atualizar)), ' para atualizar'),
        el('div', { class: erros ? 'erro-texto' : '' }, el('strong', {}, String(erros)), ' com problema')
      ),
      ignoradas.length ? el('p', { class: 'mudo pequeno' }, 'Colunas ignoradas (não fazem parte do modelo): ' + ignoradas.join(', ')) : '',
      erros ? el('p', { class: 'pequeno' }, 'As linhas com problema não serão importadas. Corrija na planilha e importe de novo, ou siga só com as válidas.') : '',
      tabelaErros(dados.linhas.filter((l) => l.acao === 'erro'), ajuste),
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => passoArquivo() }, 'Escolher outro arquivo'), confirmar)
    )
  }

  passoArquivo()
}
