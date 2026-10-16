// Portal do cliente: login do comprador, indústrias liberadas e catálogo (com preços só se o cliente puder ver).
import { el, api, brl } from '/js/util.js'

const raiz = document.getElementById('app')
const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const num = (n) => String(n).replace('.', ',')
const prazoTxt = (t) => (t.tipo === 'vista' ? 'À vista' : 'A prazo' + (t.prazo ? ' ' + t.prazo : ''))

function campo(rotulo, id, tipo, extra = {}) {
  return [el('label', { for: id }, rotulo), el('input', { id, name: id, type: tipo, required: true, ...extra })]
}
function mostrarErro(form, texto) {
  form.querySelector('.erro')?.remove()
  if (texto) form.append(el('div', { class: 'erro', role: 'alert' }, texto))
}

function telaLogin() {
  const form = el('form', { class: 'cartao' },
    el('h1', {}, 'Goiandy Representações'),
    el('p', { class: 'sub' }, 'Catálogo e orçamentos para clientes'),
    ...campo('E-mail', 'email', 'email', { autocomplete: 'username' }),
    ...campo('Senha', 'senha', 'password', { autocomplete: 'current-password' }),
    el('button', { type: 'submit' }, 'Entrar'))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const botao = form.querySelector('button')
    botao.disabled = true
    mostrarErro(form, '')
    const r = await api('/portal/login', { metodo: 'POST', corpo: { email: form.email.value, senha: form.senha.value } })
    botao.disabled = false
    if (!r.ok) return mostrarErro(form, r.dados.erro || 'Não foi possível entrar.')
    iniciar()
  })
  raiz.className = 'centro'
  raiz.replaceChildren(form)
  form.email.focus()
}

function telaTrocarSenha() {
  const form = el('form', { class: 'cartao' },
    el('h1', {}, 'Crie sua senha'),
    el('p', { class: 'sub' }, 'Troque a senha provisória por uma só sua, com pelo menos 10 caracteres.'),
    ...campo('Senha provisória', 'atual', 'password', { autocomplete: 'current-password' }),
    ...campo('Senha nova', 'nova', 'password', { autocomplete: 'new-password', minlength: '10' }),
    ...campo('Repita a senha nova', 'repetir', 'password', { autocomplete: 'new-password', minlength: '10' }),
    el('button', { type: 'submit' }, 'Salvar senha'))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    mostrarErro(form, '')
    if (form.nova.value !== form.repetir.value) return mostrarErro(form, 'As senhas novas não são iguais.')
    const botao = form.querySelector('button')
    botao.disabled = true
    const r = await api('/portal/trocar-senha', { metodo: 'POST', corpo: { senha_atual: form.atual.value, senha_nova: form.nova.value } })
    botao.disabled = false
    if (!r.ok) return mostrarErro(form, r.dados.erro || 'Não foi possível trocar a senha.')
    iniciar()
  })
  raiz.className = 'centro'
  raiz.replaceChildren(form)
  form.atual.focus()
}

function textoCaixa(i) {
  const partes = []
  if (i.nao_abre_caixa && i.qtd_caixa) partes.push(`Só caixa fechada (${i.qtd_caixa} un.)`)
  else {
    if (i.qtd_minima) partes.push(`Mín. ${i.qtd_minima} un.`)
    if (i.qtd_caixa) partes.push(`caixa com ${i.qtd_caixa}`)
  }
  return partes.join(' · ')
}

function blocoPreco(i, verPrecos) {
  if (!verPrecos) return el('div', { class: 'p-vitrine' }, 'Consulte os valores com seu vendedor')
  const p = el('div', { class: 'p-preco' }, brl(i.preco))
  if (i.preco_original) p.append(el('small', {}, brl(i.preco_original)))
  if (i.ipi > 0) p.append(el('span', { class: 'ipi' }, `+ IPI ${num(i.ipi)}%`))
  if (i.promocao) p.append(el('span', { class: 'ipi' }, 'Promoção · sem desconto adicional'))
  return p
}

function painel(eu) {
  const conteudo = el('div', { class: 'p-conteudo' })
  const sair = el('button', { type: 'button', class: 'link' }, 'Sair')
  sair.addEventListener('click', async () => {
    await api('/portal/logout', { metodo: 'POST', corpo: {} })
    window.location.hash = ''
    iniciar()
  })
  raiz.className = ''
  raiz.replaceChildren(
    el('header', { class: 'p-topo' },
      el('a', { class: 'marca', href: '#/' }, 'Goiandy Representações'),
      el('div', { class: 'quem' }, el('span', {}, `${eu.cliente_nome} · ${eu.nome}`), sair)),
    conteudo)

  let catalogo = null

  async function carregarCatalogo() {
    if (catalogo) return catalogo
    const r = await api('/portal/catalogo')
    if (!r.ok) throw new Error(r.dados.erro || 'Não foi possível carregar o catálogo.')
    catalogo = r.dados
    return catalogo
  }

  async function rotear() {
    const m = window.location.hash.match(/^#\/t\/(\d+)$/)
    conteudo.replaceChildren(el('p', { class: 'mudo' }, 'Carregando...'))
    try {
      const cat = await carregarCatalogo()
      if (m) conteudo.replaceChildren(telaTabela(cat, Number(m[1])))
      else conteudo.replaceChildren(telaInicio(cat))
    } catch (e) {
      conteudo.replaceChildren(el('p', { class: 'erro' }, String(e.message || e)))
    }
    window.scrollTo(0, 0)
  }

  function telaInicio(cat) {
    if (!cat.industrias.length) {
      return el('div', {}, el('h2', {}, 'Olá, ' + eu.nome.split(' ')[0]), el('p', { class: 'mudo' }, 'Ainda não há catálogos liberados para a sua empresa. Fale com seu vendedor da Goiandy.'))
    }
    return el('div', { class: 'p-conteudo', style: 'padding:0' },
      el('h2', {}, 'Escolha a indústria'),
      el('div', { class: 'p-grade-ind' }, ...cat.industrias.map((i) =>
        el('div', { class: 'p-ind' },
          el('h3', {}, i.nome),
          el('div', { class: 'mudo pequeno' }, [i.tipo_frete ? 'Frete ' + i.tipo_frete : '', cat.ver_precos && i.pedido_minimo > 0 ? 'Pedido mínimo ' + brl(i.pedido_minimo) : ''].filter(Boolean).join(' · ')),
          i.informacoes ? el('div', { class: 'info' }, i.informacoes) : '',
          el('div', { class: 'tabs' }, ...i.tabelas.map((t) =>
            el('button', { type: 'button', class: i.tabelas.length > 1 ? 'secundario' : '', onclick: () => { window.location.hash = '#/t/' + t.id } },
              i.tabelas.length > 1 ? `${t.nome} — ${prazoTxt(t)}` : 'Ver catálogo' + (t.tipo === 'prazo' || t.tipo === 'vista' ? ' · ' + prazoTxt(t) : ''),
              t.vencida ? el('span', { class: 'selo selo-alerta' }, 'vencida') : '')))))))
  }

  function telaTabela(cat, id) {
    const ind = cat.industrias.find((i) => i.tabelas.some((t) => t.id === id))
    const tab = ind?.tabelas.find((t) => t.id === id)
    if (!tab) return el('div', {}, el('p', { class: 'erro' }, 'Esta tabela não está disponível para você.'), el('a', { href: '#/' }, '← Voltar'))
    let pag = 1, busca = '', categoria = '', novos = false, promo = false
    const grade = el('div', { class: 'p-grade' })
    const rodape = el('div', { class: 'barra' })
    const campoBusca = el('input', { type: 'search', placeholder: 'Buscar por referência, nome ou código de barras...', 'aria-label': 'Buscar' })
    const selCat = el('select', { 'aria-label': 'Categoria' }, el('option', { value: '' }, 'Todas as categorias'))
    let temp
    campoBusca.addEventListener('input', () => { clearTimeout(temp); temp = setTimeout(() => { busca = campoBusca.value.trim(); pag = 1; carregar() }, 300) })
    selCat.addEventListener('change', () => { categoria = selCat.value; pag = 1; carregar() })
    const chipNovos = el('button', { type: 'button', class: 'chip', onclick: () => { novos = !novos; chipNovos.classList.toggle('ativo', novos); pag = 1; carregar() } }, 'Novidades')
    const chipPromo = el('button', { type: 'button', class: 'chip', onclick: () => { promo = !promo; chipPromo.classList.toggle('ativo', promo); pag = 1; carregar() } }, 'Promoções')
    api(`/portal/tabelas/${id}/categorias`).then((r) => { if (r.ok) for (const c of r.dados.categorias) selCat.append(el('option', { value: c }, c)) })

    async function carregar() {
      const q = `pagina=${pag}&busca=${encodeURIComponent(busca)}&categoria=${encodeURIComponent(categoria)}${novos ? '&novos=1' : ''}${promo ? '&promocao=1' : ''}`
      const r = await api(`/portal/tabelas/${id}/itens?${q}`)
      if (!r.ok) return grade.replaceChildren(el('p', { class: 'erro' }, r.dados.erro || 'Não foi possível carregar.'))
      grade.replaceChildren(...r.dados.itens.map(cartao))
      if (!r.dados.itens.length) grade.replaceChildren(el('p', { class: 'mudo' }, 'Nenhum produto encontrado.'))
      const paginas = Math.max(1, Math.ceil(r.dados.total / r.dados.por_pagina))
      rodape.replaceChildren(
        el('span', { class: 'mudo pequeno' }, r.dados.total ? `${r.dados.total} produto${r.dados.total === 1 ? '' : 's'} · página ${pag} de ${paginas}` : ''),
        el('div', { class: 'barra-acoes' },
          el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag <= 1, onclick: () => { pag--; carregar(); window.scrollTo(0, 0) } }, '← Anterior'),
          el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag >= paginas, onclick: () => { pag++; carregar(); window.scrollTo(0, 0) } }, 'Próxima →')))
    }

    function cartao(i) {
      const selos = el('div', { class: 'p-selos' })
      if (i.novo) selos.append(el('span', { class: 'selo selo-ok' }, 'Novo'))
      if (i.promocao) selos.append(el('span', { class: 'selo selo-promo' }, 'Promoção'))
      return el('button', { type: 'button', class: 'p-card', onclick: () => detalhe(i.id) },
        el('div', { class: 'p-foto' }, i.foto_id ? el('img', { src: '/api/portal/foto/' + i.foto_id, loading: 'lazy', alt: i.descricao }) : el('span', { class: 'sem' }, 'sem foto'), selos),
        el('div', { class: 'p-corpo' }, el('div', { class: 'p-ref' }, i.referencia), el('div', { class: 'p-desc' }, i.descricao), blocoPreco(i, cat.ver_precos), el('div', { class: 'p-caixa' }, textoCaixa(i))))
    }

    async function detalhe(itemId) {
      const r = await api(`/portal/tabelas/${id}/itens/${itemId}`)
      if (!r.ok) return alert(r.dados.erro || 'Não foi possível abrir o produto.')
      const i = r.dados.item
      const fotos = r.dados.fotos
      const dialogo = el('dialog', { class: 'janela larga' })
      dialogo.addEventListener('close', () => dialogo.remove())
      const principal = el('div', { class: 'principal' })
      const thumbs = el('div', { class: 'p-thumbs' })
      function mostrar(k) {
        principal.replaceChildren(fotos.length ? el('img', { src: '/api/portal/foto/' + fotos[k].id, alt: i.descricao }) : el('span', { class: 'mudo pequeno' }, 'sem foto'))
        thumbs.querySelectorAll('button').forEach((b, n) => b.classList.toggle('ativo', n === k))
      }
      if (fotos.length > 1) fotos.forEach((f, k) => thumbs.append(el('button', { type: 'button', onclick: () => mostrar(k), 'aria-label': 'Foto ' + (k + 1) }, el('img', { src: '/api/portal/foto/' + f.id, alt: '' }))))
      const linha = (rot, v) => (v ? el('div', {}, el('span', {}, rot), String(v)) : '')
      dialogo.append(
        el('div', { class: 'p-detalhe' },
          el('div', {}, principal, thumbs),
          el('div', {},
            el('div', { class: 'p-ref' }, i.referencia, i.novo ? el('span', { class: 'selo selo-ok' }, 'Novo') : '', i.promocao ? el('span', { class: 'selo selo-promo' }, 'Promoção') : ''),
            el('h3', { style: 'margin-top:6px' }, i.descricao),
            blocoPreco(i, cat.ver_precos),
            el('div', { class: 'p-lista' }, linha('Categoria', i.categoria), linha('Marca', i.marca), linha('Medida', i.medida), linha('Cor', i.cor), linha('Embalagem', textoCaixa(i)), linha('Observação', i.observacao)),
            i.nao_abre_caixa ? el('p', { class: 'mudo pequeno' }, 'Este item não abre caixa: o pedido é feito em múltiplos da caixa fechada.') : '')),
        el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Fechar')))
      document.body.append(dialogo)
      dialogo.showModal()
      mostrar(0)
    }

    carregar()
    return el('div', { class: 'p-conteudo', style: 'padding:0' },
      el('div', {}, el('a', { href: '#/' }, '← Indústrias'), el('h2', { style: 'margin-top:6px' }, ind.nome), el('div', { class: 'mudo pequeno' }, `${tab.nome} · ${prazoTxt(tab)}${tab.vencimento ? ' · válida até ' + dataBr(tab.vencimento) : ''}`)),
      tab.vencida ? el('div', { class: 'p-aviso' }, `Esta tabela venceu em ${dataBr(tab.vencimento)}. Os preços podem ter mudado: confirme com a Goiandy antes de fechar o pedido.`) : '',
      ind.informacoes ? el('div', { class: 'p-aviso', style: 'white-space:pre-line;background:#f2f4f7;color:var(--texto);border-color:var(--borda)' }, ind.informacoes) : '',
      el('div', { class: 'p-barra' }, campoBusca, selCat, chipNovos, chipPromo),
      grade, rodape)
  }

  window.onhashchange = rotear
  rotear()
}

async function iniciar() {
  window.onhashchange = null
  const r = await api('/portal/me')
  if (!r.ok) return telaLogin()
  if (r.dados.comprador.deve_trocar_senha) return telaTrocarSenha()
  painel(r.dados.comprador)
}

iniciar()
