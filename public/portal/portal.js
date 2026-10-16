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

function parseHash() {
  const h = window.location.hash.replace(/^#/, '')
  const [caminho, consulta = ''] = h.split('?')
  const partes = caminho.split('/').filter(Boolean)
  return { rota: partes[0] || 'inicio', id: Number(partes[1]) || 0, params: Object.fromEntries(new URLSearchParams(consulta)) }
}

function painel(eu) {
  const conteudo = el('div', { class: 'p-conteudo' })
  const sair = el('button', { type: 'button', class: 'link' }, 'Sair')
  sair.addEventListener('click', async () => {
    await api('/portal/logout', { metodo: 'POST', corpo: {} })
    window.location.hash = ''
    iniciar()
  })
  let catalogo = null
  let timerBanner = null

  // ---------- busca global (todas as indústrias liberadas) ----------
  const campoBuscaGlobal = el('input', { type: 'search', placeholder: 'O que você está buscando? Ex.: jarra', 'aria-label': 'Buscar produto', autocomplete: 'off' })
  const sugestoes = el('div', { class: 'p-sugestoes', hidden: true })
  let tempoBusca, buscaN = 0
  const fecharSugestoes = () => { sugestoes.hidden = true }
  function irParaItem(i) { fecharSugestoes(); window.location.hash = `#/t/${i.tabela_id}?busca=${encodeURIComponent(i.referencia)}&item=${i.id}` }
  campoBuscaGlobal.addEventListener('input', () => {
    clearTimeout(tempoBusca)
    const q = campoBuscaGlobal.value.trim()
    if (q.length < 2) return fecharSugestoes()
    tempoBusca = setTimeout(async () => {
      const n = ++buscaN
      const r = await api('/portal/busca?limite=8&q=' + encodeURIComponent(q))
      if (n !== buscaN || !r.ok) return
      const itens = r.dados.itens
      sugestoes.replaceChildren(
        ...itens.map((i) => el('button', { type: 'button', class: 'p-sug', onmousedown: (e) => { e.preventDefault(); irParaItem(i) } },
          i.foto_id ? el('img', { src: '/api/portal/foto/' + i.foto_id, alt: '', loading: 'lazy' }) : el('span', { class: 'p-sug-sem' }),
          el('span', { class: 'p-sug-txt' }, el('span', {}, i.descricao), el('small', {}, `${i.referencia} · ${i.industria}`)))),
        itens.length ? el('button', { type: 'button', class: 'p-sug p-sug-todos', onmousedown: (e) => { e.preventDefault(); fecharSugestoes(); window.location.hash = '#/buscar?q=' + encodeURIComponent(q) } }, 'Ver todos os resultados') : el('div', { class: 'p-sug-vazio' }, 'Nada encontrado nas suas indústrias.')
      )
      sugestoes.hidden = false
    }, 250)
  })
  campoBuscaGlobal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && campoBuscaGlobal.value.trim().length >= 2) { e.preventDefault(); fecharSugestoes(); window.location.hash = '#/buscar?q=' + encodeURIComponent(campoBuscaGlobal.value.trim()) }
    if (e.key === 'Escape') fecharSugestoes()
  })
  campoBuscaGlobal.addEventListener('blur', () => setTimeout(fecharSugestoes, 120))

  raiz.className = ''
  raiz.replaceChildren(
    el('header', { class: 'p-topo' },
      el('a', { class: 'marca', href: '#/' }, 'Goiandy Representações'),
      el('div', { class: 'p-busca' }, campoBuscaGlobal, sugestoes),
      el('div', { class: 'quem' }, el('span', {}, `${eu.cliente_nome} · ${eu.nome}`), sair)),
    conteudo)

  async function carregarCatalogo() {
    if (catalogo) return catalogo
    const r = await api('/portal/catalogo')
    if (!r.ok) throw new Error(r.dados.erro || 'Não foi possível carregar o catálogo.')
    catalogo = r.dados
    return catalogo
  }

  async function rotear() {
    clearInterval(timerBanner)
    const h = parseHash()
    conteudo.replaceChildren(el('p', { class: 'mudo' }, 'Carregando...'))
    try {
      const cat = await carregarCatalogo()
      if (h.rota === 't' && h.id) conteudo.replaceChildren(telaTabela(cat, h.id, h.params))
      else if (h.rota === 'i' && h.id) conteudo.replaceChildren(telaIndustria(cat, h.id))
      else if (h.rota === 'buscar') conteudo.replaceChildren(await telaBusca(h.params.q || ''))
      else conteudo.replaceChildren(telaInicio(cat))
    } catch (e) {
      conteudo.replaceChildren(el('p', { class: 'erro' }, String(e.message || e)))
    }
    if (!h.params.item) window.scrollTo(0, 0)
  }

  const irIndustria = (ind) => { window.location.hash = ind.tabelas.length === 1 ? '#/t/' + ind.tabelas[0].id : '#/i/' + ind.id }

  // ---------- banners que passam ----------
  function carrossel(cat) {
    const lista = cat.banners.filter((b) => cat.industrias.some((i) => i.id === b.industria_id))
    if (!lista.length) return ''
    let atual = 0
    const slides = el('div', { class: 'p-slides' }, ...lista.map((b) => {
      const ind = cat.industrias.find((i) => i.id === b.industria_id)
      return el('button', { type: 'button', class: 'p-slide', 'aria-label': 'Abrir ' + ind.nome, onclick: () => irIndustria(ind) }, el('img', { src: '/api/portal/banner/' + b.id, alt: ind.nome, draggable: 'false' }))
    }))
    const pontos = el('div', { class: 'p-pontos' }, ...lista.map((_, k) => el('button', { type: 'button', 'aria-label': 'Banner ' + (k + 1), onclick: () => ir(k, true) })))
    function ir(k, manual) {
      atual = (k + lista.length) % lista.length
      slides.style.transform = `translateX(-${atual * 100}%)`
      pontos.querySelectorAll('button').forEach((p, n) => p.classList.toggle('ativo', n === atual))
      if (manual) reiniciar()
    }
    function reiniciar() { clearInterval(timerBanner); if (lista.length > 1) timerBanner = setInterval(() => ir(atual + 1), 5000) }
    const caixa = el('div', { class: 'p-carrossel' }, el('div', { class: 'p-janela' }, slides),
      lista.length > 1 ? el('button', { type: 'button', class: 'p-seta esq', 'aria-label': 'Anterior', onclick: () => ir(atual - 1, true) }, '‹') : '',
      lista.length > 1 ? el('button', { type: 'button', class: 'p-seta dir', 'aria-label': 'Próximo', onclick: () => ir(atual + 1, true) }, '›') : '',
      lista.length > 1 ? pontos : '')
    let x0 = null
    caixa.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX }, { passive: true })
    caixa.addEventListener('touchend', (e) => { if (x0 !== null) { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) ir(atual + (dx < 0 ? 1 : -1), true); x0 = null } })
    ir(0)
    reiniciar()
    return caixa
  }

  function cartaoIndustria(i) {
    return el('button', { type: 'button', class: 'p-logo-card', onclick: () => irIndustria(i) },
      el('div', { class: 'p-logo-img' }, i.tem_logo ? el('img', { src: '/api/portal/logo/' + i.id, alt: i.nome, loading: 'lazy' }) : el('span', { class: 'p-logo-texto' }, i.nome)),
      el('div', { class: 'p-logo-nome' }, i.nome))
  }

  function telaInicio(cat) {
    if (!cat.industrias.length) {
      return el('div', {}, el('h2', {}, 'Olá, ' + eu.nome.split(' ')[0]), el('p', { class: 'mudo' }, 'Ainda não há catálogos liberados para a sua empresa. Fale com seu vendedor da Goiandy.'))
    }
    const compra = cat.industrias.filter((i) => i.compra)
    const sugestao = cat.industrias.filter((i) => !i.compra)
    const secao = (titulo, sub, lista) => (lista.length ? el('section', {}, el('h2', { class: 'p-titulo' }, titulo), sub ? el('p', { class: 'mudo pequeno', style: 'margin:-4px 0 12px' }, sub) : '', el('div', { class: 'p-grade-logos' }, ...lista.map(cartaoIndustria))) : '')
    return el('div', { class: 'p-pagina' },
      carrossel(cat),
      ...(compra.length
        ? [secao('Suas indústrias', 'As indústrias que você já compra com a Goiandy.', compra), secao('Você ainda não compra, mas pode gostar', 'Também liberadas para você. Vale dar uma olhada!', sugestao)]
        : [secao('Escolha a indústria', '', cat.industrias)]))
  }

  function telaIndustria(cat, id) {
    const ind = cat.industrias.find((i) => i.id === id)
    if (!ind) return el('div', {}, el('p', { class: 'erro' }, 'Esta indústria não está disponível para você.'), el('a', { href: '#/' }, '← Voltar'))
    return el('div', { class: 'p-pagina' },
      el('a', { href: '#/' }, '← Início'),
      el('h2', { class: 'p-titulo' }, ind.nome),
      ind.informacoes ? el('div', { class: 'p-aviso', style: 'white-space:pre-line' }, ind.informacoes) : '',
      el('p', { class: 'mudo' }, 'Escolha a tabela de preço para montar o seu orçamento:'),
      el('div', { class: 'p-grade-ind' }, ...ind.tabelas.map((t) =>
        el('div', { class: 'p-ind' }, el('h3', {}, t.nome), el('div', { class: 'mudo pequeno' }, prazoTxt(t) + (t.vencimento ? ' · válida até ' + dataBr(t.vencimento) : '')),
          t.vencida ? el('span', { class: 'selo selo-alerta', style: 'margin:0;width:fit-content' }, 'tabela vencida') : '',
          el('button', { type: 'button', onclick: () => { window.location.hash = '#/t/' + t.id } }, 'Ver catálogo')))))
  }

  async function telaBusca(q) {
    campoBuscaGlobal.value = q
    const r = await api('/portal/busca?limite=60&q=' + encodeURIComponent(q))
    const itens = r.ok ? r.dados.itens : []
    const grupos = new Map()
    for (const i of itens) { if (!grupos.has(i.industria)) grupos.set(i.industria, []); grupos.get(i.industria).push(i) }
    return el('div', { class: 'p-pagina' },
      el('a', { href: '#/' }, '← Início'),
      el('h2', { class: 'p-titulo' }, `Resultados para "${q}"`),
      itens.length ? el('p', { class: 'mudo pequeno' }, 'O orçamento é sempre de uma indústria só. Escolha o produto para abrir o catálogo da indústria dele.') : el('p', { class: 'mudo' }, 'Nenhum produto encontrado nas suas indústrias.'),
      ...[...grupos].map(([nome, lista]) => el('section', {}, el('h3', { style: 'margin:14px 0 8px' }, nome),
        el('div', { class: 'p-grade' }, ...lista.map((i) =>
          el('button', { type: 'button', class: 'p-card', onclick: () => irParaItem(i) },
            el('div', { class: 'p-foto' }, i.foto_id ? el('img', { src: '/api/portal/foto/' + i.foto_id, loading: 'lazy', alt: i.descricao }) : el('span', { class: 'sem' }, 'sem foto')),
            el('div', { class: 'p-corpo' }, el('div', { class: 'p-ref' }, i.referencia), el('div', { class: 'p-desc' }, i.descricao))))))))
  }

  function telaTabela(cat, id, params = {}) {
    const ind = cat.industrias.find((i) => i.tabelas.some((t) => t.id === id))
    const tab = ind?.tabelas.find((t) => t.id === id)
    if (!tab) return el('div', {}, el('p', { class: 'erro' }, 'Esta tabela não está disponível para você.'), el('a', { href: '#/' }, '← Voltar'))
    let pag = 1, busca = params.busca || '', categoria = '', novos = false, promo = false
    let abrirItem = Number(params.item) || 0
    const grade = el('div', { class: 'p-grade' })
    const rodape = el('div', { class: 'barra' })
    const campoBusca = el('input', { type: 'search', placeholder: 'Buscar nesta indústria por referência, nome ou código de barras...', 'aria-label': 'Buscar' })
    campoBusca.value = busca
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
      if (abrirItem) { const k = abrirItem; abrirItem = 0; detalhe(k) }
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
