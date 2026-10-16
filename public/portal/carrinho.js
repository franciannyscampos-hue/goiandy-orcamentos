// Carrinho e orçamentos do portal. O carrinho é sempre de uma tabela de preço (uma indústria só).
import { el, api, brl } from '/js/util.js'
import { condicao, dataBr, dataHoraBr, num, textoCaixa, seloSituacao } from './comum.js'

// Controle de quantidade: botão Adicionar, depois − [qtd] + andando de "passo" em "passo" (caixa ou mínimo).
export function controleQtd({ tabelaId, itemId, passo, qtd, aoMudar }) {
  let atual = qtd || 0
  const caixa = el('div', { class: 'qtd' })
  const msg = el('div', { class: 'qtd-msg', hidden: true })
  let temp
  let seq = 0
  function desenhar() {
    if (!atual) {
      caixa.replaceChildren(el('button', { type: 'button', class: 'qtd-add', onclick: (e) => { e.stopPropagation(); definir(passo) } }, 'Adicionar'))
      return
    }
    const campo = el('input', { type: 'number', min: '0', step: String(passo), value: String(atual), inputmode: 'numeric', 'aria-label': 'Quantidade' })
    campo.addEventListener('click', (e) => e.stopPropagation())
    campo.addEventListener('change', () => {
      let v = Math.round(Number(campo.value) || 0)
      if (v < 0) v = 0
      if (v % passo) v = Math.ceil(v / passo) * passo
      setTimeout(() => definir(v), 0)
    })
    caixa.replaceChildren(
      el('button', { type: 'button', class: 'qtd-btn', 'aria-label': 'Diminuir', onclick: (e) => { e.stopPropagation(); definir(atual - passo) } }, '−'),
      campo,
      el('button', { type: 'button', class: 'qtd-btn', 'aria-label': 'Aumentar', onclick: (e) => { e.stopPropagation(); definir(atual + passo) } }, '+')
    )
  }
  function definir(v) {
    atual = Math.max(0, v)
    desenhar()
    msg.hidden = true
    clearTimeout(temp)
    const n = ++seq
    temp = setTimeout(async () => {
      const r = await api(`/portal/carrinho/${tabelaId}/itens/${itemId}`, { metodo: 'PUT', corpo: { qtd: atual } })
      if (n !== seq) return
      if (!r.ok) { msg.textContent = r.dados.erro || 'Não foi possível atualizar.'; msg.hidden = false; return }
      aoMudar?.(r.dados.resumo, atual)
    }, 350)
  }
  desenhar()
  return el('div', { class: 'qtd-area', onclick: (e) => e.stopPropagation() }, caixa, msg)
}

const miniFoto = (id) => (id ? el('img', { class: 'cart-foto', src: '/api/portal/foto/' + id, alt: '', loading: 'lazy' }) : el('div', { class: 'cart-foto vazia' }))

// ---------- lista de carrinhos abertos ----------
export async function telaCarrinhos() {
  const r = await api('/portal/carrinhos')
  const lista = r.ok ? r.dados.carrinhos : []
  return el('div', { class: 'p-pagina' },
    el('a', { href: '#/' }, '← Início'),
    el('h2', { class: 'p-titulo' }, 'Meu carrinho'),
    lista.length ? el('p', { class: 'mudo pequeno' }, 'Cada orçamento é de uma indústria e de uma tabela de preço. Abra o carrinho para revisar e enviar.') : el('p', { class: 'mudo' }, 'Você ainda não adicionou nenhum produto. Escolha uma indústria e clique em "Adicionar" nos produtos.'),
    el('div', { class: 'p-grade-ind' }, ...lista.map((c) =>
      el('div', { class: 'p-ind' },
        el('div', { class: 'cart-ind' }, c.tem_logo ? el('img', { src: '/api/portal/logo/' + c.industria_id, alt: '' }) : '', el('h3', {}, c.industria)),
        el('div', { class: 'mudo pequeno' }, c.tabela + ' · ' + condicao({ tipo: c.tipo, prazo: c.prazo })),
        el('div', {}, el('strong', {}, String(c.n_linhas)), ` produto${c.n_linhas === 1 ? '' : 's'}`, c.subtotal !== undefined ? el('span', {}, ' · ', el('strong', {}, brl(c.subtotal))) : ''),
        el('button', { type: 'button', onclick: () => { window.location.hash = '#/carrinho/' + c.tabela_id } }, 'Abrir carrinho')))))
}

// ---------- um carrinho ----------
export async function telaCarrinho(tabelaId, aoAtualizar) {
  const pagina = el('div', { class: 'p-pagina' })
  const erroEnvio = el('div')
  let transportadora = ''
  let observacao = ''

  async function carregar() {
    const r = await api('/portal/carrinho/' + tabelaId)
    if (!r.ok) return pagina.replaceChildren(el('a', { href: '#/carrinho' }, '← Carrinhos'), el('p', { class: 'erro' }, r.dados.erro || 'Não foi possível abrir o carrinho.'))
    desenhar(r.dados)
    aoAtualizar?.()
  }

  function desenhar(d) {
    const t = d.tabela
    const ver = d.ver_precos
    const rs = d.resumo
    if (!d.itens.length) {
      return pagina.replaceChildren(el('a', { href: '#/carrinho' }, '← Carrinhos'), el('h2', { class: 'p-titulo' }, 'Carrinho vazio'),
        el('p', { class: 'mudo' }, 'Adicione produtos pelo catálogo.'), el('a', { href: '#/t/' + t.id }, `Ir para o catálogo da ${t.industria}`))
    }
    const linhas = d.itens.map((i) => {
      const preco = ver && i.disponivel ? el('div', { class: 'cart-valores' }, el('div', {}, `${brl(i.preco)} × ${i.qtd}`, i.ipi > 0 ? el('small', { class: 'mudo' }, ` + IPI ${num(i.ipi)}%`) : ''), el('strong', {}, brl(i.total))) : ''
      return el('div', { class: 'cart-linha' + (i.disponivel ? '' : ' indisp') },
        miniFoto(i.foto_id),
        el('div', { class: 'cart-info' }, el('div', { class: 'p-ref' }, i.referencia, i.promocao ? el('span', { class: 'selo selo-promo' }, 'Promoção') : ''), el('div', {}, i.descricao),
          i.disponivel ? el('div', { class: 'p-caixa' }, textoCaixa(i)) : el('div', { class: 'erro-texto pequeno' }, 'Este produto saiu da tabela. Remova do carrinho para continuar.')),
        i.disponivel
          ? controleQtd({ tabelaId: t.id, itemId: i.id, passo: i.passo, qtd: i.qtd, aoMudar: () => carregar() })
          : el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: async () => { await api(`/portal/carrinho/${t.id}/itens/${i.id}`, { metodo: 'PUT', corpo: { qtd: 0 } }); carregar() } }, 'Remover'),
        preco)
    })

    const campoTransp = el('input', { type: 'text', maxlength: '200', placeholder: 'Ex.: Rodonaves, Jamef... (se não souber, deixe em branco)' })
    campoTransp.value = transportadora
    campoTransp.addEventListener('input', () => { transportadora = campoTransp.value })
    const campoObs = el('textarea', { rows: '3', maxlength: '1500', placeholder: 'Alguma observação para a Goiandy?' })
    campoObs.value = observacao
    campoObs.addEventListener('input', () => { observacao = campoObs.value })
    const bloqueado = ver && rs.faltam > 0
    const enviar = el('button', { type: 'button', disabled: bloqueado || rs.n_disponiveis === 0 }, 'Enviar orçamento')
    enviar.addEventListener('click', async () => {
      erroEnvio.replaceChildren()
      enviar.disabled = true
      const r = await api(`/portal/carrinho/${t.id}/enviar`, { metodo: 'POST', corpo: { transportadora, observacao } })
      if (!r.ok) { enviar.disabled = false; return erroEnvio.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível enviar.')) }
      aoAtualizar?.()
      window.location.hash = `#/orcamentos/${r.dados.numero}?novo=1`
    })
    const esvaziar = el('button', { type: 'button', class: 'secundario', onclick: async () => { if (!confirm('Esvaziar este carrinho?')) return; await api('/portal/carrinho/' + t.id, { metodo: 'DELETE', corpo: {} }); aoAtualizar?.(); window.location.hash = '#/carrinho' } }, 'Esvaziar carrinho')

    pagina.replaceChildren(
      el('a', { href: '#/carrinho' }, '← Carrinhos'),
      el('h2', { class: 'p-titulo' }, `Orçamento — ${t.industria}`),
      el('section', { class: 'p-pagto' },
        el('div', { class: 'p-pagto-atual' }, el('div', { class: 'p-pagto-tab' }, t.nome), el('div', { class: 'p-pagto-cond' }, el('span', {}, 'Condição de pagamento'), el('strong', {}, condicao(t))), t.tipo_frete ? el('div', { class: 'p-pagto-val' }, 'Frete ' + t.tipo_frete) : '')),
      el('div', { class: 'cart-lista' }, ...linhas),
      el('a', { href: '#/t/' + t.id }, '+ Adicionar mais produtos desta indústria'),
      el('section', { class: 'cart-total' },
        ver
          ? el('div', { class: 'cart-resumo' },
              el('div', {}, el('span', {}, `${rs.qtd_total} unidades · ${rs.n_disponiveis} produto${rs.n_disponiveis === 1 ? '' : 's'}`)),
              el('div', {}, el('span', {}, 'Total sem impostos'), el('strong', {}, brl(rs.subtotal))),
              rs.ipi_total > 0 ? el('div', {}, el('span', {}, 'IPI'), el('strong', {}, brl(rs.ipi_total))) : '',
              el('div', { class: 'cart-final' }, el('span', {}, 'Total final'), el('strong', {}, brl(rs.total))),
              rs.pedido_minimo > 0 ? (bloqueado ? el('div', { class: 'p-aviso' }, `Pedido mínimo da indústria: ${brl(rs.pedido_minimo)}. Faltam ${brl(rs.faltam)} (sem impostos) para poder enviar.`) : el('div', { class: 'ok' }, 'Pedido mínimo atingido.')) : '')
          : el('div', { class: 'cart-resumo' }, el('div', {}, el('span', {}, `${rs.qtd_total} unidades · ${rs.n_disponiveis} produto${rs.n_disponiveis === 1 ? '' : 's'}`)), el('div', { class: 'p-aviso' }, 'Os valores serão informados pela equipe da Goiandy junto com o seu orçamento.')),
        el('div', { class: 'campo' }, el('label', {}, 'Preferência de transportadora'), campoTransp),
        el('div', { class: 'campo' }, el('label', {}, 'Observação'), campoObs),
        erroEnvio,
        el('div', { class: 'botoes' }, esvaziar, enviar)))
  }

  carregar()
  return pagina
}

// ---------- orçamentos enviados ----------
export async function telaOrcamentos() {
  const r = await api('/portal/orcamentos')
  const lista = r.ok ? r.dados.itens : []
  const ver = r.ok ? r.dados.ver_precos : false
  return el('div', { class: 'p-pagina' },
    el('a', { href: '#/' }, '← Início'),
    el('h2', { class: 'p-titulo' }, 'Meus orçamentos'),
    lista.length ? '' : el('p', { class: 'mudo' }, 'Você ainda não enviou nenhum orçamento.'),
    lista.length ? el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ...['Nº', 'Data', 'Indústria', 'Tabela', 'Unid.', ...(ver ? ['Total'] : []), 'Situação'].map((x) => el('th', {}, x)))),
      el('tbody', {}, ...lista.map((o) => el('tr', { class: 'clicavel', onclick: () => { window.location.hash = '#/orcamentos/' + o.id } },
        el('td', {}, '#' + o.id), el('td', {}, dataHoraBr(o.enviado_em)), el('td', {}, o.industria), el('td', {}, o.tabela_nome), el('td', {}, String(o.qtd_total)),
        ...(ver ? [el('td', {}, brl(o.total))] : []), el('td', {}, seloSituacao(o.status))))))) : '')
}

export async function telaOrcamento(id, params = {}) {
  const r = await api('/portal/orcamentos/' + id)
  if (!r.ok) return el('div', { class: 'p-pagina' }, el('a', { href: '#/orcamentos' }, '← Meus orçamentos'), el('p', { class: 'erro' }, r.dados.erro || 'Não foi possível abrir.'))
  const { orcamento: o, itens, ver_precos: ver } = r.dados
  return el('div', { class: 'p-pagina' },
    el('a', { href: '#/orcamentos' }, '← Meus orçamentos'),
    params.novo ? el('div', { class: 'ok', style: 'font-size:1.05rem' }, `Orçamento nº ${o.id} enviado! A equipe da Goiandy vai analisar e entrar em contato.`) : '',
    el('h2', { class: 'p-titulo' }, `Orçamento nº ${o.id} `, seloSituacao(o.status)),
    el('div', { class: 'mudo' }, `${o.industria} · ${o.tabela_nome} · ${condicao({ tipo: o.tabela_tipo, prazo: o.tabela_prazo })} · enviado em ${dataHoraBr(o.enviado_em)}`),
    el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ...['Ref.', 'Produto', 'Qtde', ...(ver ? ['Unitário', 'IPI %', 'Total'] : [])].map((x) => el('th', {}, x)))),
      el('tbody', {}, ...itens.map((i) => el('tr', {}, el('td', {}, i.referencia), el('td', {}, i.descricao), el('td', {}, String(i.qtd)), ...(ver ? [el('td', {}, brl(i.preco_unit)), el('td', {}, num(i.ipi || 0)), el('td', {}, brl(i.total_linha))] : [])))))),
    ver ? el('div', { class: 'cart-resumo' }, el('div', {}, el('span', {}, 'Total sem impostos'), el('strong', {}, brl(o.subtotal))), o.ipi_total > 0 ? el('div', {}, el('span', {}, 'IPI'), el('strong', {}, brl(o.ipi_total))) : '', el('div', { class: 'cart-final' }, el('span', {}, 'Total final'), el('strong', {}, brl(o.total)))) : '',
    o.transportadora_texto ? el('p', {}, el('strong', {}, 'Transportadora: '), o.transportadora_texto) : '',
    o.observacao_cliente ? el('p', {}, el('strong', {}, 'Observação: '), o.observacao_cliente) : '')
}
