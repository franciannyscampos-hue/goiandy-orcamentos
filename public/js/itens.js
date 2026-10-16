// Tela de itens: lista por indústria, edição do item e fotos (até 5 por item).
import { el, api, pode } from './util.js'

const MAX_LADO = 1600

// Reduz fotos grandes antes de enviar (economiza espaço e deixa o portal mais rápido).
async function prepararImagem(arquivo) {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) throw new Error('Use JPG, PNG ou WebP.')
  let bmp
  try { bmp = await createImageBitmap(arquivo) } catch { return arquivo }
  const maior = Math.max(bmp.width, bmp.height)
  if (maior <= MAX_LADO && arquivo.size <= 1.5 * 1024 * 1024) return arquivo
  const f = Math.min(1, MAX_LADO / maior)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * f)
  canvas.height = Math.round(bmp.height * f)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  return blob || arquivo
}

async function enviarBinario(caminho, blob) {
  const r = await fetch('/api' + caminho, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob, credentials: 'same-origin' })
  const dados = await r.json().catch(() => ({}))
  return { ok: r.ok, dados }
}

export function telaItens(usuario) {
  const podeEditar = pode(usuario, 'itens.editar')
  const podeFoto = pode(usuario, 'fotos.enviar')
  let industriaId = null
  let busca = ''
  let filtroFoto = ''
  let pag = 1

  const seletor = el('select', { 'aria-label': 'Indústria' })
  const campoBusca = el('input', { type: 'search', placeholder: 'Referência, descrição ou código de barras...' })
  const filtroFotoSel = el('select', { 'aria-label': 'Fotos' }, el('option', { value: '' }, 'Com e sem foto'), el('option', { value: 'sem' }, 'Só sem foto'), el('option', { value: 'com' }, 'Só com foto'))
  const botaoExcel = el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => exportar() }, '⬇ Exportar Excel')
  const corpo = el('tbody')
  const rodape = el('div', { class: 'barra' })
  const lista = el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ...['', 'Ref.', 'Descrição', 'Indústria', 'Categoria', 'Fotos', ''].map((x) => el('th', {}, x)))), corpo))
  const aviso = el('p', { class: 'mudo' })
  const botaoLote = podeFoto ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => envioEmMassa() }, '⬆ Enviar fotos em massa') : null
  const pagina = el(
    'section',
    { class: 'pagina' },
    el('div', { class: 'barra' }, el('h2', {}, 'Itens'), el('div', { class: 'barra-acoes' }, seletor, botaoLote)),
    el('div', { class: 'barra' }, el('div', { class: 'barra-acoes' }, campoBusca, filtroFotoSel), botaoExcel),
    aviso,
    lista,
    rodape
  )
  lista.style.display = 'none'

  seletor.addEventListener('change', () => {
    industriaId = Number(seletor.value) || null
    try { sessionStorage.setItem('industriaItens', String(industriaId ?? '')) } catch {}
    pag = 1
    carregar()
  })
  let t
  campoBusca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { busca = campoBusca.value.trim(); pag = 1; carregar() }, 300) })
  filtroFotoSel.addEventListener('change', () => { filtroFoto = filtroFotoSel.value; pag = 1; carregar() })

  const parametros = () => `industria_id=${industriaId ?? ''}&busca=${encodeURIComponent(busca)}&foto=${filtroFoto}`

  // Relatório em Excel com os filtros da tela (indústria, busca e com/sem foto)
  async function exportar() {
    botaoExcel.disabled = true
    const texto = botaoExcel.textContent
    try {
      const linhas = []
      let depois = 0
      do {
        botaoExcel.textContent = `Gerando... ${linhas.length}`
        const r = await api(`/itens/exportar?${parametros()}&depois_id=${depois}`)
        if (!r.ok) throw new Error(r.dados.erro || 'Não foi possível gerar o relatório.')
        for (const i of r.dados.itens) linhas.push([i.industria, i.referencia, i.descricao, i.categoria, i.marca, i.codigo_barras, i.qtd_caixa, i.qtd_minima, i.n_fotos ? 'Com foto' : 'Sem foto', i.n_fotos, i.ativo ? 'Sim' : 'Não'])
        depois = r.dados.proximo
      } while (depois)
      if (!linhas.length) return alert('Nenhum item para exportar com esses filtros.')
      const { gerarPlanilha } = await import('/js/vendor/excel.js')
      const blob = await gerarPlanilha(['Indústria', 'Referência', 'Descrição', 'Categoria', 'Marca', 'Código de barras', 'Qtd caixa', 'Qtd mínima', 'Situação da foto', 'Nº de fotos', 'Ativo'], linhas, [28, 16, 50, 20, 16, 18, 10, 10, 16, 10, 8])
      baixar(blob, `itens-${filtroFoto === 'sem' ? 'sem-foto' : filtroFoto === 'com' ? 'com-foto' : 'todos'}.xlsx`)
    } catch (e) {
      alert(String(e.message || e))
    } finally {
      botaoExcel.disabled = false
      botaoExcel.textContent = texto
    }
  }

  function baixar(blob, nome) {
    const a = el('a', { href: URL.createObjectURL(blob), download: nome })
    document.body.append(a)
    a.click()
    a.remove()
  }

  async function iniciar() {
    const r = await api('/itens/industrias')
    if (!r.ok) return (aviso.textContent = r.dados.erro || 'Não foi possível carregar.')
    const inds = r.dados.itens
    if (!inds.length) return (aviso.textContent = 'Cadastre uma indústria primeiro.')
    seletor.replaceChildren(el('option', { value: '' }, 'Todas as indústrias'), ...inds.map((i) => el('option', { value: String(i.id) }, i.nome)))
    let salvo = ''
    try { salvo = sessionStorage.getItem('industriaItens') || '' } catch {}
    industriaId = inds.find((i) => String(i.id) === salvo)?.id ?? null
    seletor.value = industriaId ? String(industriaId) : ''
    carregar()
  }

  async function carregar() {
    const r = await api(`/itens?${parametros()}&pagina=${pag}`)
    if (!r.ok) return (aviso.textContent = r.dados.erro || 'Não foi possível carregar.')
    aviso.textContent = r.dados.total ? '' : 'Nenhum item encontrado. Os itens são criados pela importação da tabela de preços.'
    lista.style.display = r.dados.total ? '' : 'none'
    corpo.replaceChildren(
      ...r.dados.itens.map((i) =>
        el('tr', { class: i.ativo ? '' : 'inativo' },
          el('td', { style: 'width:56px' }, i.foto_id ? el('img', { class: 'miniatura', src: '/api/itens/foto/' + i.foto_id, loading: 'lazy', alt: '' }) : el('div', { class: 'miniatura vazia' })),
          el('td', {}, i.referencia),
          el('td', {}, i.descricao),
          el('td', {}, i.industria),
          el('td', {}, i.categoria || '—'),
          el('td', {}, el('span', { class: 'selo ' + (i.n_fotos ? 'selo-ok' : '') }, `${i.n_fotos}/5`)),
          el('td', { class: 'acao' }, el('button', { type: 'button', class: 'link', onclick: () => abrirItem(i.id) }, podeEditar || podeFoto ? 'Editar' : 'Ver'))
        )
      )
    )
    const paginas = Math.max(1, Math.ceil(r.dados.total / r.dados.por_pagina))
    rodape.replaceChildren(
      el('span', { class: 'mudo pequeno' }, r.dados.total ? `${r.dados.total} iten${r.dados.total === 1 ? '' : 's'} · página ${pag} de ${paginas}` : ''),
      el('div', { class: 'barra-acoes' },
        el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag <= 1, onclick: () => { pag--; carregar() } }, '← Anterior'),
        el('button', { type: 'button', class: 'secundario botao-pequeno', disabled: pag >= paginas, onclick: () => { pag++; carregar() } }, 'Próxima →'))
    )
  }

  // ---------- item ----------
  async function abrirItem(id) {
    const r = await api('/itens/' + id)
    if (!r.ok) return alert(r.dados.erro || 'Não foi possível abrir o item.')
    const { item, fotos: fotosIni } = r.dados
    const dialogo = el('dialog', { class: 'janela larga' }, el('h3', {}, `${item.referencia} — ${item.industria}`))
    dialogo.addEventListener('close', () => { dialogo.remove(); carregar() })

    // fotos
    const slots = el('div', { class: 'slots-foto' })
    const erroFoto = el('div')
    async function desenharFotos() {
      const f = (await api('/itens/' + id)).dados.fotos || []
      slots.replaceChildren(
        ...[1, 2, 3, 4, 5].map((pos) => {
          const foto = f.find((x) => x.posicao === pos)
          const entrada = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', style: 'display:none' })
          entrada.addEventListener('change', async () => {
            if (!entrada.files[0]) return
            erroFoto.replaceChildren()
            try {
              const blob = await prepararImagem(entrada.files[0])
              const e = await enviarBinario(`/itens/${id}/fotos/${pos}`, blob)
              if (!e.ok) throw new Error(e.dados.erro || 'Não foi possível enviar.')
            } catch (e) { erroFoto.replaceChildren(el('div', { class: 'erro', role: 'alert' }, String(e.message || e))) }
            desenharFotos()
          })
          return el('div', { class: 'slot-foto' },
            foto ? el('img', { src: `/api/itens/foto/${foto.id}?v=${foto.id}-${Date.now()}`, alt: `Foto ${pos}` }) : el('div', { class: 'sem-foto' }, 'sem foto'),
            el('div', { class: 'pequeno mudo' }, `Foto ${pos}`),
            podeFoto ? el('div', { class: 'acoes-cartao' }, entrada,
              el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => entrada.click() }, foto ? 'Trocar' : 'Enviar'),
              foto ? el('button', { type: 'button', class: 'link', onclick: async () => { if (!confirm('Remover esta foto?')) return; await api(`/itens/${id}/fotos/${pos}`, { metodo: 'DELETE', corpo: {} }); desenharFotos() } }, 'Remover') : '') : ''
          )
        })
      )
    }

    // campos
    const campos = {}
    const mk = (nome, rotulo, tipo = 'text', dica) => {
      const i = el('input', { type: tipo, name: nome, disabled: !podeEditar })
      i.value = item[nome] ?? ''
      campos[nome] = i
      return el('div', { class: 'campo' }, el('label', {}, rotulo), i, dica ? el('div', { class: 'dica' }, dica) : '')
    }
    const nao = el('input', { type: 'checkbox', disabled: !podeEditar }); nao.checked = !!item.nao_abre_caixa
    const ativo = el('input', { type: 'checkbox', disabled: !podeEditar }); ativo.checked = !!item.ativo
    const erro = el('div')
    const salvar = podeEditar ? el('button', { type: 'submit' }, 'Salvar') : ''
    const form = el('form', { class: 'formulario' },
      mk('descricao', 'Descrição'),
      el('div', { class: 'grade-2' }, mk('categoria', 'Categoria'), mk('marca', 'Marca'), mk('medida', 'Medida'), mk('cor', 'Cor'), mk('codigo_barras', 'Código de barras'), mk('ncm', 'NCM'), mk('qtd_caixa', 'Quantidade na caixa', 'number'), mk('qtd_minima', 'Quantidade mínima', 'number')),
      el('div', { class: 'caixas' }, el('label', { class: 'campo-check-linha' }, nao, ' Não abre caixa (vende só caixa fechada)'), el('label', { class: 'campo-check-linha' }, ativo, ' Item ativo')),
      el('p', { class: 'mudo pequeno' }, 'Preço, promoção, IPI, "Novo" e observação são por tabela e mudam pela importação da planilha.'),
      erro,
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Fechar'), salvar)
    )
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      erro.replaceChildren()
      const corpoEnvio = { nao_abre_caixa: nao.checked, ativo: ativo.checked }
      for (const [k, i] of Object.entries(campos)) corpoEnvio[k] = i.value
      const s = await api('/itens/' + id, { metodo: 'PUT', corpo: corpoEnvio })
      if (!s.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, s.dados.erro || 'Não foi possível salvar.'))
      dialogo.close()
    })
    dialogo.append(el('h4', {}, 'Fotos (até 5)'), slots, erroFoto, el('h4', {}, 'Dados do item'), form)
    document.body.append(dialogo)
    dialogo.showModal()
    desenharFotos()
  }

  // ---------- envio em massa ----------
  function envioEmMassa() {
    if (!industriaId) return alert('Escolha uma indústria específica para enviar fotos em massa (as fotos são ligadas pela referência dentro da indústria).')
    const nomeInd = seletor.selectedOptions[0]?.textContent
    const dialogo = el('dialog', { class: 'janela larga' }, el('h3', {}, `Enviar fotos em massa — ${nomeInd}`))
    dialogo.addEventListener('close', () => { dialogo.remove(); carregar() })
    const entrada = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true })
    const area = el('div')
    area.append(
      el('p', {}, 'Escolha as fotos de uma vez (pode selecionar a pasta inteira com Ctrl+A). O sistema acha o item pelo nome do arquivo, dentro desta indústria.'),
      el('ul', { class: 'lista-perm' }, el('li', {}, '1234.jpg → primeira foto da referência 1234'), el('li', {}, '1234(1).jpg … 1234(5).jpg → fotos de 1 a 5 (também vale "1234 (2).jpg")'), el('li', {}, 'Se a foto já existir naquela posição, ela é trocada.'), el('li', {}, 'Fotos grandes são reduzidas automaticamente.')),
      entrada
    )
    entrada.addEventListener('change', async () => {
      const arquivos = [...entrada.files]
      if (!arquivos.length) return
      const barra = el('progress', { max: String(arquivos.length), value: '0' })
      const status = el('p', { class: 'mudo pequeno' }, 'Enviando... não feche esta janela.')
      area.replaceChildren(status, barra)
      let ok = 0
      let feito = 0
      const falhas = []
      let indice = 0
      async function trabalhador() {
        while (indice < arquivos.length) {
          const arq = arquivos[indice++]
          try {
            const blob = await prepararImagem(arq)
            const e = await enviarBinario(`/itens/fotos-lote?industria_id=${industriaId}&nome=${encodeURIComponent(arq.name)}`, blob)
            if (e.ok) ok++
            else falhas.push({ arquivo: arq.name, mensagem: e.dados.erro || 'Falha no envio.' })
          } catch (e) { falhas.push({ arquivo: arq.name, mensagem: String(e.message || e) }) }
          barra.value = ++feito
        }
      }
      await Promise.all([trabalhador(), trabalhador(), trabalhador()])
      area.replaceChildren(
        el('div', { class: falhas.length ? 'aviso-import' : 'ok' }, `${ok} foto${ok === 1 ? '' : 's'} enviada${ok === 1 ? '' : 's'}` + (falhas.length ? `, ${falhas.length} com problema.` : '.')),
        falhas.length ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: async () => { const { gerarPlanilha } = await import('/js/vendor/excel.js'); baixar(await gerarPlanilha(['Arquivo', 'Problema'], falhas.map((f) => [f.arquivo, f.mensagem]), [40, 70]), 'fotos-com-problema.xlsx') } }, '⬇ Baixar problemas (Excel)') : '',
        falhas.length ? el('div', { class: 'tabela-caixa erros-import' }, el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, el('th', {}, 'Arquivo'), el('th', {}, 'Problema'))), el('tbody', {}, ...falhas.slice(0, 200).map((f) => el('tr', {}, el('td', {}, f.arquivo), el('td', {}, f.mensagem)))))) : '',
        el('div', { class: 'botoes' }, el('button', { type: 'button', onclick: () => dialogo.close() }, 'Fechar'))
      )
    })
    area.append(el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Cancelar')))
    dialogo.append(area)
    document.body.append(dialogo)
    dialogo.showModal()
  }

  iniciar()
  return pagina
}
