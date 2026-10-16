// Tela de tabelas de preço: escolher a indústria, ver/criar tabelas, importar a planilha e conferir os itens.
import { el, api, pode, brl } from './util.js'

const TIPOS = { vista: 'À vista', prazo: 'A prazo' }
const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const normalizar = (t) =>
  String(t ?? '').split('(')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function telaTabelasPreco(usuario) {
  const podeEditar = pode(usuario, 'tabelas.editar')
  let industrias = []
  let industriaId = null
  const conteudo = el('div')
  const seletor = el('select', { 'aria-label': 'Indústria' })
  seletor.addEventListener('change', () => {
    industriaId = Number(seletor.value) || null
    try { sessionStorage.setItem('industriaTabelas', String(industriaId ?? '')) } catch {}
    listar()
  })
  const botaoNova = podeEditar ? el('button', { type: 'button', class: 'botao-pequeno', onclick: () => formularioTabela(null) }, '+ Nova tabela') : null
  const barra = el('div', { class: 'barra' }, el('h2', {}, 'Tabelas de preço'), el('div', { class: 'barra-acoes' }, seletor, botaoNova))
  const pagina = el('section', { class: 'pagina' }, barra, conteudo)

  async function iniciar() {
    const r = await api('/tabelas/industrias')
    if (!r.ok) return conteudo.replaceChildren(el('p', { class: 'mudo' }, r.dados.erro || 'Não foi possível carregar.'))
    industrias = r.dados.itens
    if (!industrias.length) return conteudo.replaceChildren(el('p', { class: 'mudo' }, 'Cadastre uma indústria primeiro (menu Indústrias).'))
    seletor.replaceChildren(el('option', { value: '' }, 'Escolha a indústria'), ...industrias.map((i) => el('option', { value: String(i.id) }, i.nome + (i.ativo ? '' : ' (inativa)'))))
    let salvo = ''
    try { salvo = sessionStorage.getItem('industriaTabelas') || '' } catch {}
    industriaId = industrias.find((i) => String(i.id) === salvo)?.id ?? (industrias.length === 1 ? industrias[0].id : null)
    seletor.value = industriaId ? String(industriaId) : ''
    listar()
  }

  async function listar() {
    barra.style.display = ''
    if (!industriaId) return conteudo.replaceChildren(el('p', { class: 'mudo' }, 'Escolha a indústria para ver as tabelas de preço dela.'))
    const r = await api('/tabelas?industria_id=' + industriaId)
    if (!r.ok) return conteudo.replaceChildren(el('p', { class: 'mudo' }, r.dados.erro || 'Não foi possível carregar.'))
    if (!r.dados.itens.length) return conteudo.replaceChildren(el('p', { class: 'mudo' }, 'Esta indústria ainda não tem tabela de preço. Clique em "+ Nova tabela".'))
    conteudo.replaceChildren(el('div', { class: 'grade-perfis' }, ...r.dados.itens.map(cartao)))
  }

  function cartao(t) {
    const info = [TIPOS[t.tipo] + (t.tipo === 'prazo' && t.prazo ? ' ' + t.prazo : '')]
    const selos = []
    if (t.padrao) selos.push(el('span', { class: 'selo selo-ok' }, '★ Padrão'))
    if (t.vencida) selos.push(el('span', { class: 'selo selo-alerta' }, 'Vencida'))
    if (!t.ativo) selos.push(el('span', { class: 'selo' }, 'Inativa'))
    return el(
      'div',
      { class: 'cartao-perfil' + (t.ativo ? '' : ' inativo') },
      el('div', {}, el('strong', {}, t.nome), ' ', ...selos),
      el('p', { class: 'mudo pequeno' }, info.join(' · ')),
      el('p', { class: 'mudo pequeno' }, t.vencimento ? `Vencimento: ${dataBr(t.vencimento)}` : 'Sem data de vencimento'),
      el('p', {}, el('strong', {}, String(t.n_itens)), ` iten${t.n_itens === 1 ? '' : 's'} com preço`),
      el(
        'div',
        { class: 'acoes-cartao' },
        el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => verItens(t) }, 'Ver itens'),
        podeEditar ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => abrirImportacao(t) }, '⬆ Importar planilha') : '',
        pode(usuario, 'clientes.ver') ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => clientesLiberados(t) }, 'Clientes liberados') : '',
        podeEditar ? el('button', { type: 'button', class: 'link', onclick: () => formularioTabela(t) }, 'Editar') : ''
      )
    )
  }

  // ---------- criar / editar ----------
  function formularioTabela(t) {
    const novo = !t
    const dialogo = el('dialog', { class: 'janela' }, el('h3', {}, novo ? 'Nova tabela de preço' : 'Editar tabela'))
    dialogo.addEventListener('close', () => dialogo.remove())
    const nome = el('input', { name: 'nome', required: true, maxlength: '100', placeholder: 'Ex.: Tabela a prazo 30/45/55' })
    nome.value = t?.nome ?? ''
    const tipo = el('select', { name: 'tipo' }, el('option', { value: 'prazo' }, 'A prazo'), el('option', { value: 'vista' }, 'À vista'))
    tipo.value = t?.tipo ?? 'prazo'
    const prazo = el('input', { name: 'prazo', maxlength: '60', placeholder: 'Ex.: 30/45/55' })
    prazo.value = t?.prazo ?? ''
    const venc = el('input', { name: 'vencimento', type: 'date' })
    venc.value = t?.vencimento ?? ''
    const ativo = el('input', { type: 'checkbox' })
    ativo.checked = t ? !!t.ativo : true
    const padrao = el('input', { type: 'checkbox' })
    padrao.checked = !!t?.padrao
    if (t?.padrao) padrao.disabled = true
    const campoPrazo = el('div', { class: 'campo' }, el('label', {}, 'Prazo (dias)'), prazo, el('div', { class: 'dica' }, 'Aparece no orçamento como condição de pagamento. Separe com barra.'))
    const ajustarPrazo = () => { campoPrazo.style.display = tipo.value === 'prazo' ? '' : 'none' }
    tipo.addEventListener('change', ajustarPrazo)
    ajustarPrazo()
    const erro = el('div')
    const salvar = el('button', { type: 'submit' }, 'Salvar')
    const cancelar = el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Cancelar')
    const acoes = el('div', { class: 'botoes' })
    if (t && podeEditar && t.n_itens > 0) {
      const esvaziar = el('button', { type: 'button', class: 'secundario', style: 'margin-right:auto' }, 'Remover todos os preços')
      esvaziar.addEventListener('click', async () => {
        if (!confirm(`Remover os preços dos ${t.n_itens} itens desta tabela? Os itens continuam cadastrados; depois você pode importar a planilha de novo.`)) return
        const r = await api(`/tabelas/${t.id}/precos`, { metodo: 'DELETE', corpo: {} })
        if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro' }, r.dados.erro || 'Não foi possível remover.'))
        dialogo.close()
        listar()
      })
      acoes.append(esvaziar)
    }
    acoes.append(cancelar, salvar)
    const form = el(
      'form',
      { class: 'formulario' },
      el('div', { class: 'campo' }, el('label', {}, 'Nome da tabela'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'Tipo'), tipo),
      campoPrazo,
      el('div', { class: 'campo' }, el('label', {}, 'Vencimento da tabela'), venc, el('div', { class: 'dica' }, 'Tabela vencida não bloqueia o orçamento: só avisa o cliente e a equipe.')),
      el('div', { class: 'caixas' }, el('label', { class: 'campo-check-linha' }, padrao, ' Tabela padrão desta indústria (usada quando o cliente não tem outra definida)'), el('label', { class: 'campo-check-linha' }, ativo, ' Tabela ativa')),
      erro,
      acoes
    )
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      erro.replaceChildren()
      salvar.disabled = true
      const corpo = { nome: nome.value, tipo: tipo.value, prazo: tipo.value === 'prazo' ? prazo.value : '', vencimento: venc.value, ativo: ativo.checked, padrao: padrao.checked }
      if (novo) corpo.industria_id = industriaId
      const r = novo ? await api('/tabelas', { metodo: 'POST', corpo }) : await api('/tabelas/' + t.id, { metodo: 'PUT', corpo })
      salvar.disabled = false
      if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
      dialogo.close()
      listar()
    })
    dialogo.append(form)
    document.body.append(dialogo)
    dialogo.showModal()
    nome.focus()
  }

  // ---------- clientes com a tabela liberada ----------
  async function clientesLiberados(t) {
    const podeLiberar = pode(usuario, 'clientes.editar')
    const [lc, ls] = await Promise.all([api('/liberacoes/clientes'), api('/liberacoes/tabela/' + t.id)])
    if (!lc.ok || !ls.ok) return alert((lc.ok ? ls : lc).dados.erro || 'Não foi possível abrir.')
    const clientes = lc.dados.itens
    const original = new Set(ls.dados.clientes)
    const marcados = new Set(original)
    const semAcento = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const dialogo = el('dialog', { class: 'janela larga' }, el('h3', {}, `Clientes liberados — ${t.nome}`))
    dialogo.addEventListener('close', () => { dialogo.remove(); listar() })
    const filtro = el('input', { type: 'search', placeholder: 'Buscar cliente por nome, CNPJ ou cidade...' })
    const lista = el('div', { class: 'lista-liberacao alta' })
    const resumo = el('span', { class: 'mudo pequeno' })
    const msg = el('div')
    let visiveis = []
    const atualizar = () => (resumo.textContent = `${marcados.size} de ${clientes.length} cliente${clientes.length === 1 ? '' : 's'} com esta tabela liberada`)
    function desenhar() {
      const q = semAcento(filtro.value)
      const dig = q.replace(/\D/g, '')
      visiveis = clientes.filter((c) => !q || semAcento(`${c.razao_social} ${c.nome_fantasia} ${c.cidade}`).includes(q) || (dig.length >= 3 && c.cnpj.includes(dig)))
      lista.replaceChildren(
        ...visiveis.slice(0, 300).map((c) => {
          const cx = el('input', { type: 'checkbox', disabled: !podeLiberar })
          cx.checked = marcados.has(c.id)
          cx.addEventListener('change', () => { cx.checked ? marcados.add(c.id) : marcados.delete(c.id); atualizar() })
          return el('label', { class: 'campo-check-linha' }, cx, ` ${c.nome_fantasia || c.razao_social}`, el('span', { class: 'mudo pequeno' }, ` · ${[c.cidade, c.uf].filter(Boolean).join('/')}${c.ativo ? '' : ' · inativo'}`))
        }),
        visiveis.length > 300 ? el('p', { class: 'mudo pequeno' }, `Mostrando 300 de ${visiveis.length}. Refine a busca.`) : '',
        visiveis.length ? '' : el('p', { class: 'mudo' }, 'Nenhum cliente encontrado.')
      )
    }
    filtro.addEventListener('input', desenhar)
    const salvar = el('button', { type: 'button', onclick: async () => {
      const add = [...marcados].filter((x) => !original.has(x))
      const rem = [...original].filter((x) => !marcados.has(x))
      const r = await api('/liberacoes/tabela/' + t.id, { metodo: 'PUT', corpo: { adicionar: add, remover: rem } })
      if (!r.ok) return msg.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
      dialogo.close()
    } }, 'Salvar')
    dialogo.append(
      el('p', { class: 'mudo pequeno' }, 'Marque os clientes (CNPJs) que podem enxergar esta tabela no portal.'),
      filtro,
      podeLiberar ? el('div', { class: 'linha-consulta' },
        el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => { for (const c of visiveis) marcados.add(c.id); desenhar(); atualizar() } }, 'Marcar todos da busca'),
        el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => { for (const c of visiveis) marcados.delete(c.id); desenhar(); atualizar() } }, 'Desmarcar todos da busca')) : '',
      el('div', { style: 'margin:6px 0' }, resumo),
      lista,
      msg,
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, podeLiberar ? 'Cancelar' : 'Fechar'), podeLiberar ? salvar : '')
    )
    document.body.append(dialogo)
    dialogo.showModal()
    atualizar()
    desenhar()
  }

  // ---------- itens da tabela ----------
  async function verItens(t) {
    let busca = ''
    let pag = 1
    const corpo = el('tbody')
    const rodape = el('div', { class: 'barra' })
    const campo = el('input', { type: 'search', placeholder: 'Buscar por referência, descrição ou código de barras...' })
    let temporizador
    campo.addEventListener('input', () => {
      clearTimeout(temporizador)
      temporizador = setTimeout(() => { busca = campo.value.trim(); pag = 1; carregar() }, 300)
    })
    const voltar = el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => { barra.style.display = ''; listar() } }, '← Voltar')
    barra.style.display = 'none'
    conteudo.replaceChildren(
      el('div', { class: 'barra' }, el('div', {}, voltar, ' ', el('strong', {}, t.nome)), el('div', { class: 'barra-acoes' }, campo)),
      el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ...['Ref.', 'Descrição', 'Preço', 'Promoção', 'IPI %', 'Cx / Mín.', 'Fotos'].map((x) => el('th', {}, x)))), corpo)),
      rodape
    )
    async function carregar() {
      const r = await api(`/tabelas/${t.id}/itens?pagina=${pag}&busca=${encodeURIComponent(busca)}`)
      if (!r.ok) return rodape.replaceChildren(el('p', { class: 'mudo' }, r.dados.erro || 'Não foi possível carregar.'))
      corpo.replaceChildren(
        ...r.dados.itens.map((i) => {
          const desc = el('td', {}, i.descricao)
          if (i.novo) desc.append(' ', el('span', { class: 'selo selo-ok' }, 'Novo'))
          if (i.nao_abre_caixa) desc.append(' ', el('span', { class: 'selo' }, 'Não abre caixa'))
          if (i.observacao) desc.append(el('div', { class: 'mudo pequeno' }, i.observacao))
          return el('tr', {}, el('td', {}, i.referencia), desc, el('td', {}, i.preco ? brl(i.preco) : '—'), el('td', {}, i.preco_promocional ? brl(i.preco_promocional) : '—'), el('td', {}, String(i.ipi).replace('.', ',')), el('td', {}, `${i.qtd_caixa || '—'} / ${i.qtd_minima || '—'}`), el('td', {}, String(i.n_fotos)))
        })
      )
      const total = r.dados.total
      const paginas = Math.max(1, Math.ceil(total / r.dados.por_pagina))
      const anterior = el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag <= 1, onclick: () => { pag--; carregar() } }, '← Anterior')
      const proxima = el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag >= paginas, onclick: () => { pag++; carregar() } }, 'Próxima →')
      rodape.replaceChildren(el('span', { class: 'mudo pequeno' }, total ? `${total} iten${total === 1 ? '' : 's'} · página ${pag} de ${paginas}` : 'Nenhum item encontrado.'), el('div', { class: 'barra-acoes' }, anterior, proxima))
    }
    carregar()
  }

  // ---------- importação da planilha ----------
  async function abrirImportacao(t) {
    const dialogo = el('dialog', { class: 'janela larga' }, el('h3', {}, `Importar planilha — ${t.nome}`))
    const area = el('div')
    dialogo.append(area)
    dialogo.addEventListener('close', () => dialogo.remove())
    document.body.append(dialogo)
    dialogo.showModal()
    const fechar = (texto = 'Fechar') => el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, texto)

    const mod = await api('/tabelas/importacao/modelo')
    if (!mod.ok) return area.replaceChildren(el('div', { class: 'erro' }, mod.dados.erro || 'Não foi possível abrir a importação.'), el('div', { class: 'botoes' }, fechar()))
    const colunas = mod.dados.colunas
    const lote = mod.dados.lote
    const porTitulo = new Map()
    for (const c of colunas) for (const n of [c.titulo, ...c.sinonimos]) porTitulo.set(normalizar(n), c)

    async function baixarModelo() {
      const { gerarModelo } = await import('/js/vendor/excel.js')
      const blob = await gerarModelo(colunas.map((c) => ({ titulo: c.titulo, obrigatorio: c.obrigatorio, largura: Math.max(14, c.titulo.length + 4) })), colunas.map((c) => c.exemplo))
      const a = el('a', { href: URL.createObjectURL(blob), download: 'modelo-tabela-de-precos.xlsx' })
      document.body.append(a)
      a.click()
      a.remove()
    }

    function passoArquivo(mensagem) {
      const entrada = el('input', { type: 'file', accept: '.xlsx' })
      const aviso = el('div', {}, mensagem ? el('div', { class: 'erro', role: 'alert' }, mensagem) : '')
      entrada.addEventListener('change', async () => {
        if (!entrada.files[0]) return
        aviso.replaceChildren(el('p', { class: 'mudo' }, 'Lendo a planilha...'))
        try { await conferir(entrada.files[0]) } catch (e) { passoArquivo('Não consegui ler esse arquivo. Use um Excel (.xlsx) sem senha.') }
      })
      area.replaceChildren(
        el('p', {}, 'Escolha a planilha de preços. As colunas do modelo da KE Home já são reconhecidas (REF, DESCRIÇÃO, PREÇO, QTD CAIXA, QTD MÍNIMA, PREÇO PROMOCIONAL, NOVO, NÃO ABRE CAIXA, IPI %, CÓD. BARRAS, NCM, CATEGORIA, MARCA, MEDIDA, COR, OBSERVAÇÃO).'),
        el('ul', { class: 'lista-perm' },
          el('li', {}, 'Item novo é criado; item que já existe só é completado onde estiver em branco (nada é sobrescrito).'),
          el('li', {}, 'Preço, promoção, IPI, "Novo" e observação valem para esta tabela e são atualizados pela planilha.'),
          el('li', {}, 'Preço sempre com 2 casas (arredonda). Se o preço promocional estiver preenchido, ele é o que vale.'),
          el('li', {}, 'Item sem preço e sem promoção fica cadastrado, mas não aparece para o cliente.')
        ),
        el('div', { class: 'linha-consulta' }, el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: baixarModelo }, '⬇ Baixar modelo (Excel)'), entrada),
        aviso,
        el('div', { class: 'botoes' }, fechar('Cancelar'))
      )
    }

    async function conferir(arquivo) {
      const { lerPlanilha } = await import('/js/vendor/excel.js')
      const matriz = await lerPlanilha(arquivo)
      let cab = -1
      for (let i = 0; i < Math.min(matriz.length, 10); i++) if (matriz[i].some((x) => porTitulo.has(normalizar(x)))) { cab = i; break }
      if (cab < 0) return passoArquivo('Não achei as colunas do modelo. Baixe o modelo e copie seus dados para ele.')
      const mapa = matriz[cab].map((x) => porTitulo.get(normalizar(x)) || null)
      const faltando = colunas.filter((c) => c.obrigatorio && !mapa.includes(c))
      if (faltando.length) return passoArquivo(`Faltam colunas obrigatórias: ${faltando.map((c) => c.titulo).join(', ')}.`)
      if (!mapa.some((c) => c && (c.campo === 'preco' || c.campo === 'preco_promocional'))) return passoArquivo('A planilha precisa ter a coluna PREÇO (ou PREÇO PROMOCIONAL).')
      const ignoradas = matriz[cab].filter((x, i) => x && !mapa[i])
      const linhas = []
      const repetidas = []
      const vistas = new Map()
      for (let i = cab + 1; i < matriz.length; i++) {
        const obj = {}
        mapa.forEach((c, j) => { if (c) obj[c.campo] = matriz[i][j] ?? '' })
        if (Object.values(obj).every((v) => v === '')) continue
        obj.__linha = i + 1
        const ref = String(obj.referencia || '').trim().toLowerCase()
        if (ref && vistas.has(ref)) { repetidas.push({ linha: i + 1, referencia: obj.referencia, mensagem: `Referência repetida (já aparece na linha ${vistas.get(ref)}).` }); continue }
        if (ref) vistas.set(ref, i + 1)
        linhas.push(obj)
      }
      if (!linhas.length) return passoArquivo('A planilha não tem linhas preenchidas.')

      const resumo = { itens_novos: 0, itens_existentes: 0, precos_novos: 0, precos_atualizados: 0, sem_preco: 0, erros: 0 }
      const avisos = {}
      const problemas = [...repetidas]
      const barra = el('progress', { max: String(linhas.length), value: '0' })
      area.replaceChildren(el('p', { class: 'mudo' }, 'Conferindo a planilha (nada foi gravado ainda)...'), barra)
      async function enviar(aplicar) {
        const somaResumo = {}
        const somaAvisos = {}
        const prob = []
        for (let i = 0; i < linhas.length; i += lote) {
          const r = await api(`/tabelas/${t.id}/importar`, { metodo: 'POST', corpo: { linhas: linhas.slice(i, i + lote), aplicar } })
          if (!r.ok) throw new Error(r.dados.erro || 'Falha ao enviar')
          for (const [k, v] of Object.entries(r.dados.resumo)) somaResumo[k] = (somaResumo[k] || 0) + v
          for (const [k, v] of Object.entries(r.dados.avisos)) somaAvisos[k] = (somaAvisos[k] || 0) + v
          prob.push(...r.dados.problemas)
          barra.value = Math.min(linhas.length, i + lote)
        }
        return { somaResumo, somaAvisos, prob }
      }
      let previa
      try { previa = await enviar(false) } catch (e) { return passoArquivo(String(e.message || e)) }
      Object.assign(resumo, previa.somaResumo)
      resumo.erros += repetidas.length
      Object.assign(avisos, previa.somaAvisos)
      problemas.push(...previa.prob)

      const textosAviso = {
        nao_multiplo: (n) => `${n} iten${n === 1 ? '' : 's'} com a caixa que não é múltiplo da quantidade mínima (quem emite o pedido ajusta).`,
        min_maior: (n) => `${n} iten${n === 1 ? '' : 's'} com quantidade mínima maior que a da caixa.`,
        ncm: (n) => `${n} iten${n === 1 ? '' : 's'} com NCM que não tem 8 números.`,
        barras: (n) => `${n} iten${n === 1 ? '' : 's'} com código de barras de tamanho incomum.`,
        sem_preco: (n) => `${n} iten${n === 1 ? '' : 's'} sem preço e sem promoção: ficam cadastrados, mas não aparecem para o cliente.`
      }
      const validas = linhas.length - (resumo.erros - repetidas.length)
      const confirmar = el('button', { type: 'button', disabled: validas <= 0 }, `Importar ${validas} linha${validas === 1 ? '' : 's'}`)
      confirmar.addEventListener('click', async () => {
        const nova = el('progress', { max: String(linhas.length), value: '0' })
        area.replaceChildren(el('p', { class: 'mudo' }, 'Gravando... não feche esta janela.'), nova)
        try {
          for (let i = 0; i < linhas.length; i += lote) {
            const r = await api(`/tabelas/${t.id}/importar`, { metodo: 'POST', corpo: { linhas: linhas.slice(i, i + lote), aplicar: true } })
            if (!r.ok) throw new Error(r.dados.erro || 'Falha ao gravar')
            nova.value = Math.min(linhas.length, i + lote)
          }
        } catch (e) {
          return area.replaceChildren(el('div', { class: 'erro' }, 'A gravação parou no meio: ' + String(e.message || e) + ' Você pode importar a mesma planilha de novo, sem duplicar nada.'), el('div', { class: 'botoes' }, fechar()))
        }
        listar()
        area.replaceChildren(
          el('div', { class: 'ok' }, `Pronto: ${resumo.itens_novos} iten${resumo.itens_novos === 1 ? '' : 's'} novo${resumo.itens_novos === 1 ? '' : 's'} criado${resumo.itens_novos === 1 ? '' : 's'}, ${resumo.itens_existentes} já existia${resumo.itens_existentes === 1 ? '' : 'm'}, e ${resumo.precos_novos + resumo.precos_atualizados} preço${resumo.precos_novos + resumo.precos_atualizados === 1 ? '' : 's'} gravado${resumo.precos_novos + resumo.precos_atualizados === 1 ? '' : 's'} na tabela.` + (resumo.erros ? ` ${resumo.erros} linha${resumo.erros === 1 ? '' : 's'} com problema não ${resumo.erros === 1 ? 'foi importada' : 'foram importadas'}.` : '')),
          tabelaProblemas(problemas),
          el('div', { class: 'botoes' }, fechar())
        )
      })

      area.replaceChildren(
        el('div', { class: 'resumo-import' },
          el('div', {}, el('strong', {}, String(resumo.itens_novos)), ' itens novos'),
          el('div', {}, el('strong', {}, String(resumo.itens_existentes)), ' já cadastrados'),
          el('div', {}, el('strong', {}, String(resumo.precos_novos + resumo.precos_atualizados)), ' preços na tabela'),
          el('div', { class: resumo.erros ? 'erro-texto' : '' }, el('strong', {}, String(resumo.erros)), ' com problema')
        ),
        resumo.precos_atualizados ? el('p', { class: 'pequeno' }, `${resumo.precos_atualizados} preço${resumo.precos_atualizados === 1 ? '' : 's'} já existia${resumo.precos_atualizados === 1 ? '' : 'm'} nesta tabela e ${resumo.precos_atualizados === 1 ? 'será atualizado' : 'serão atualizados'} pela planilha.`) : '',
        ...Object.entries(avisos).map(([k, n]) => el('p', { class: 'pequeno aviso-import' }, '⚠ ' + (textosAviso[k]?.(n) ?? k))),
        ignoradas.length ? el('p', { class: 'mudo pequeno' }, 'Colunas ignoradas (não fazem parte do modelo): ' + ignoradas.join(', ')) : '',
        tabelaProblemas(problemas),
        el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => passoArquivo() }, 'Escolher outro arquivo'), confirmar)
      )
    }

    function tabelaProblemas(lista) {
      if (!lista.length) return ''
      const ordenada = [...lista].sort((a, b) => a.linha - b.linha)
      return el(
        'div',
        { class: 'tabela-caixa erros-import' },
        el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ...['Linha', 'Ref.', 'Problema'].map((x) => el('th', {}, x)))), el('tbody', {}, ...ordenada.slice(0, 100).map((p) => el('tr', {}, el('td', {}, String(p.linha)), el('td', {}, p.referencia), el('td', {}, p.mensagem))))),
        ordenada.length > 100 ? el('p', { class: 'mudo pequeno' }, `Mostrando 100 de ${ordenada.length} problemas.`) : ''
      )
    }

    passoArquivo()
  }

  iniciar()
  return pagina
}
