// Tela da equipe: orçamentos enviados pelos clientes (lista, detalhe e mudança de situação).
import { el, api, brl, pode } from './util.js'

const STATUS = ['Novo', 'Em atendimento', 'Pedido gerado', 'Cancelado']
const dh = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' }) : '')
const selo = (s) => el('span', { class: 'selo' }, s)

export function telaOrcamentos(usuario) {
  let status = '', q = '', pag = 1
  const lista = el('div')
  const resumo = el('div', { class: 'mudo pequeno' })
  const selStatus = el('select', { 'aria-label': 'Situação' }, el('option', { value: '' }, 'Todas as situações'), ...STATUS.map((s) => el('option', { value: s }, s)))
  const busca = el('input', { style: 'flex:1;min-width:240px', type: 'search', placeholder: 'Buscar por cliente, CNPJ ou nº do orçamento...' })
  let temp
  busca.addEventListener('input', () => { clearTimeout(temp); temp = setTimeout(() => { q = busca.value.trim(); pag = 1; carregar() }, 300) })
  selStatus.addEventListener('change', () => { status = selStatus.value; pag = 1; carregar() })

  async function carregar() {
    const r = await api(`/orcamentos?pagina=${pag}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`)
    if (!r.ok) return lista.replaceChildren(el('p', { class: 'erro' }, r.dados.erro || 'Não foi possível carregar.'))
    const c = r.dados.contagem || {}
    resumo.textContent = STATUS.map((s) => `${s}: ${c[s] || 0}`).join('  ·  ')
    const paginas = Math.max(1, Math.ceil(r.dados.total / r.dados.por_pagina))
    lista.replaceChildren(
      r.dados.itens.length
        ? el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ...['Nº', 'Enviado em', 'Cliente', 'Indústria', 'Vendedor', 'Unid.', 'Total', 'Situação', ''].map((x) => el('th', {}, x)))),
            el('tbody', {}, ...r.dados.itens.map((o) => el('tr', {},
              el('td', {}, '#' + o.id), el('td', {}, dh(o.enviado_em)), el('td', {}, o.nome_fantasia || o.razao_social), el('td', {}, o.industria), el('td', {}, o.vendedor || '—'),
              el('td', {}, String(o.qtd_total)), el('td', {}, o.total ? brl(o.total) : '—'), el('td', {}, selo(o.status)),
              el('td', { class: 'acao' }, el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => detalhe(o.id) }, 'Abrir')))))))
        : el('p', { class: 'mudo' }, 'Nenhum orçamento encontrado.'),
      el('div', { class: 'barra' }, el('span', { class: 'mudo pequeno' }, `Página ${pag} de ${paginas}`),
        el('div', { class: 'barra-acoes' },
          el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag <= 1, onclick: () => { pag--; carregar() } }, '← Anterior'),
          el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag >= paginas, onclick: () => { pag++; carregar() } }, 'Próxima →'))))
  }

  async function detalhe(id) {
    const r = await api('/orcamentos/' + id)
    if (!r.ok) return alert(r.dados.erro || 'Não foi possível abrir.')
    const { orcamento: o, itens } = r.dados
    const dialogo = el('dialog', { class: 'janela larga' })
    dialogo.addEventListener('close', () => dialogo.remove())
    const sel = el('select', {}, ...STATUS.map((s) => el('option', { value: s, selected: s === o.status }, s)))
    const msg = el('div')
    const podeAtender = pode(usuario, 'orcamentos.atender')
    const aberto = o.status === 'Novo' || o.status === 'Em atendimento'
    const editavel = podeAtender && aberto
    // linhas em edição: item_id -> {referencia, descricao, qtd, passo?}
    const linhas = itens.map((i) => ({ item_id: i.id, referencia: i.referencia, descricao: i.descricao, qtd: i.qtd, preco_unit: i.preco_unit, ipi: i.ipi, total_linha: i.total_linha }))
    let alterado = false
    const corpoTab = el('tbody')
    const totais = el('p')
    function pintar() {
      corpoTab.replaceChildren(...linhas.map((l) => el('tr', {},
        el('td', {}, l.referencia), el('td', {}, l.descricao),
        el('td', {}, editavel ? el('input', { type: 'number', min: '0', value: String(l.qtd), style: 'width:80px', onchange: (e) => { l.qtd = Math.max(0, Math.round(Number(e.target.value) || 0)); alterado = true; pintar() } }) : String(l.qtd)),
        ...(o.ver_precos ? [el('td', {}, l.preco_unit != null ? brl(l.preco_unit) : '—'), el('td', {}, String(l.ipi || 0).replace('.', ',')), el('td', {}, l.preco_unit != null ? brl(l.qtd * l.preco_unit) : '—')] : []),
        editavel ? el('td', {}, el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => { l.qtd = 0; alterado = true; pintar() } }, 'Remover')) : '')))
      for (const tr of [...corpoTab.children]) { const q = tr.querySelector('input'); if (q && q.value === '0') tr.classList.add('inativo') }
      totais.replaceChildren(...(o.ver_precos ? [alterado ? 'Total estimado (será recalculado ao salvar)' : `Subtotal ${brl(o.subtotal)}` + (o.ipi_total > 0 ? ` · IPI ${brl(o.ipi_total)}` : '') + ' · ', alterado ? '' : el('strong', {}, 'Total ' + brl(o.total))] : [el('span', { class: 'mudo' }, 'Cliente sem permissão de ver preços.')]))
    }
    pintar()

    // acrescentar item
    const campoBuscaItem = el('input', { type: 'search', placeholder: 'Acrescentar item: digite referência ou nome...' })
    const resultados = el('div')
    let tb
    campoBuscaItem.addEventListener('input', () => {
      clearTimeout(tb)
      const q = campoBuscaItem.value.trim()
      if (q.length < 2) return resultados.replaceChildren()
      tb = setTimeout(async () => {
        const x = await api(`/orcamentos/${id}/buscar-item?q=${encodeURIComponent(q)}`)
        if (!x.ok) return
        resultados.replaceChildren(...x.dados.itens.map((it) => el('button', { type: 'button', class: 'secundario botao-pequeno', style: 'display:block;margin:4px 0;text-align:left', onclick: () => {
          const ex = linhas.find((l) => l.item_id === it.id)
          if (ex) ex.qtd += it.passo
          else linhas.push({ item_id: it.id, referencia: it.referencia, descricao: it.descricao, qtd: it.passo, preco_unit: null, ipi: 0 })
          alterado = true; pintar(); resultados.replaceChildren(); campoBuscaItem.value = ''
        } }, `${it.referencia} — ${it.descricao} (+${it.passo})`)))
      }, 300)
    })
    const salvarItens = el('button', { type: 'button', onclick: async () => {
      const x = await api(`/orcamentos/${id}/itens`, { metodo: 'PUT', corpo: { itens: linhas.map((l) => ({ item_id: l.item_id, qtd: l.qtd })) } })
      if (!x.ok) return msg.replaceChildren(el('div', { class: 'erro' }, x.dados.erro || 'Erro ao salvar itens.'))
      dialogo.close(); carregar(); detalhe(id)
    } }, 'Salvar alterações nos itens')
    const liberar = el('button', { type: 'button', class: 'secundario', onclick: async () => {
      const x = await api(`/orcamentos/${id}/liberar-edicao`, { metodo: 'PUT', corpo: { liberar: !o.edicao_liberada } })
      if (!x.ok) return msg.replaceChildren(el('div', { class: 'erro' }, x.dados.erro || 'Erro.'))
      dialogo.close(); detalhe(id)
    } }, o.edicao_liberada ? 'Bloquear edição pelo cliente' : 'Liberar edição para o cliente')
    const salvar = el('button', { type: 'button', onclick: async () => {
      const x = await api(`/orcamentos/${id}/status`, { metodo: 'PUT', corpo: { status: sel.value } })
      if (!x.ok) return msg.replaceChildren(el('div', { class: 'erro' }, x.dados.erro || 'Erro ao salvar.'))
      dialogo.close(); carregar()
    } }, 'Salvar situação')
    const par = (r1, v) => (v ? el('div', {}, el('span', { class: 'mudo' }, r1 + ': '), String(v)) : '')
    dialogo.append(
      el('h3', {}, `Orçamento nº ${o.id} · ${o.industria}`),
      el('div', { class: 'mudo pequeno' }, `${o.tabela_nome} · enviado em ${dh(o.enviado_em)}`),
      o.edicao_liberada ? el('div', { class: 'p-aviso' }, 'Edição liberada: o cliente pode reabrir este orçamento e alterar os itens.') : '',
      el('div', { class: 'grade-info' },
        par('Cliente', o.razao_social), par('Fantasia', o.nome_fantasia), par('CNPJ', o.cnpj), par('IE', o.inscricao_estadual),
        par('Cidade', [o.cidade, o.uf].filter(Boolean).join(' / ')), par('Telefone', o.telefone), par('Comprador', o.comprador), par('E-mail', o.comprador_email), par('Vendedor', o.vendedor),
        par('Transportadora', o.transportadora_texto), par('Frete', o.tipo_frete)),
      o.observacao_cliente ? el('p', {}, el('strong', {}, 'Observação do cliente: '), o.observacao_cliente) : '',
      el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ...['Ref.', 'Produto', 'Qtde', ...(o.ver_precos ? ['Unitário', 'IPI %', 'Total'] : []), ...(editavel ? [''] : [])].map((x) => el('th', {}, x)))),
        corpoTab)),
      editavel ? el('div', {}, campoBuscaItem, resultados) : '',
      totais,
      editavel ? el('div', { class: 'botoes', style: 'justify-content:flex-start' }, salvarItens, liberar) : '',
      podeAtender ? el('div', { class: 'campo' }, el('label', {}, 'Situação'), sel) : el('p', {}, 'Situação: ', selo(o.status)),
      msg,
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Fechar'), podeAtender ? salvar : ''))
    document.body.append(dialogo)
    dialogo.showModal()
  }

  carregar()
  return el('div', {}, el('h2', {}, 'Orçamentos'), el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:10px 0' }, busca, selStatus), resumo, lista)
}
