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
    const salvar = el('button', { type: 'button', onclick: async () => {
      const x = await api(`/orcamentos/${id}/status`, { metodo: 'PUT', corpo: { status: sel.value } })
      if (!x.ok) return msg.replaceChildren(el('div', { class: 'erro' }, x.dados.erro || 'Erro ao salvar.'))
      dialogo.close(); carregar()
    } }, 'Salvar situação')
    const par = (r1, v) => (v ? el('div', {}, el('span', { class: 'mudo' }, r1 + ': '), String(v)) : '')
    dialogo.append(
      el('h3', {}, `Orçamento nº ${o.id} · ${o.industria}`),
      el('div', { class: 'mudo pequeno' }, `${o.tabela_nome} · enviado em ${dh(o.enviado_em)}`),
      el('div', { class: 'grade-info' },
        par('Cliente', o.razao_social), par('Fantasia', o.nome_fantasia), par('CNPJ', o.cnpj), par('IE', o.inscricao_estadual),
        par('Cidade', [o.cidade, o.uf].filter(Boolean).join(' / ')), par('Telefone', o.telefone), par('Comprador', o.comprador), par('E-mail', o.comprador_email), par('Vendedor', o.vendedor),
        par('Transportadora', o.transportadora_texto), par('Frete', o.tipo_frete)),
      o.observacao_cliente ? el('p', {}, el('strong', {}, 'Observação do cliente: '), o.observacao_cliente) : '',
      el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ...['Ref.', 'Produto', 'Qtde', ...(o.ver_precos ? ['Unitário', 'IPI %', 'Total'] : [])].map((x) => el('th', {}, x)))),
        el('tbody', {}, ...itens.map((i) => el('tr', {}, el('td', {}, i.referencia), el('td', {}, i.descricao), el('td', {}, String(i.qtd)),
          ...(o.ver_precos ? [el('td', {}, brl(i.preco_unit)), el('td', {}, String(i.ipi || 0).replace('.', ',')), el('td', {}, brl(i.total_linha))] : [])))))),
      o.ver_precos ? el('p', {}, `Subtotal ${brl(o.subtotal)}` + (o.ipi_total > 0 ? ` · IPI ${brl(o.ipi_total)}` : ''), ' · ', el('strong', {}, 'Total ' + brl(o.total))) : el('p', { class: 'mudo' }, 'Cliente sem permissão de ver preços: valores não foram calculados no envio.'),
      podeAtender ? el('div', { class: 'campo' }, el('label', {}, 'Situação'), sel) : el('p', {}, 'Situação: ', selo(o.status)),
      msg,
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Fechar'), podeAtender ? salvar : ''))
    document.body.append(dialogo)
    dialogo.showModal()
  }

  carregar()
  return el('div', {}, el('h2', {}, 'Orçamentos'), el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:10px 0' }, busca, selStatus), resumo, lista)
}
