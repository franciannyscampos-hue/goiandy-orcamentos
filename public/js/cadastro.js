// Tela genérica de cadastro: lista com busca, botão Novo e formulário em janela.
import { el, api, pode } from './util.js'

function criarCampo(c, valor) {
  const id = 'f_' + c.nome
  if (c.tipo === 'bool') {
    const caixa = el('input', { type: 'checkbox', id, name: c.nome })
    caixa.checked = !!valor
    return el('div', { class: 'campo campo-check' }, caixa, el('label', { for: id }, c.rotulo))
  }
  let entrada
  if (c.tipo === 'area') {
    entrada = el('textarea', { id, name: c.nome, rows: '3' })
    entrada.value = valor ?? ''
  } else if (c.tipo === 'enum') {
    entrada = el('select', { id, name: c.nome }, ...c.opcoes.map((o) => el('option', { value: o }, o)))
    entrada.value = valor ?? c.opcoes[0]
  } else {
    const tipoHtml = c.tipo === 'numero' ? 'number' : c.tipo === 'email' ? 'email' : 'text'
    entrada = el('input', {
      id,
      name: c.nome,
      type: tipoHtml,
      step: c.tipo === 'numero' ? '0.01' : undefined,
      min: c.tipo === 'numero' ? '0' : undefined
    })
    entrada.value = valor ?? ''
  }
  if (c.obrigatorio) entrada.required = true
  return el('div', { class: 'campo' }, el('label', { for: id }, c.rotulo), entrada)
}

function lerValores(form, campos) {
  const v = {}
  for (const c of campos) {
    const e = form.elements[c.nome]
    if (c.tipo === 'bool') v[c.nome] = e.checked
    else if (c.tipo === 'numero') v[c.nome] = e.value === '' ? 0 : Number(e.value)
    else v[c.nome] = e.value
  }
  return v
}

export function telaCadastro(config, usuario) {
  const podeEditar = pode(usuario, config.permEditar)
  let itens = []
  let busca = ''

  const corpoTabela = el('tbody')
  const vazio = el('p', { class: 'mudo vazio' })
  const campoBusca = el('input', { type: 'search', placeholder: 'Buscar...', 'aria-label': 'Buscar' })
  campoBusca.addEventListener('input', () => {
    busca = campoBusca.value.trim().toLowerCase()
    desenharLista()
  })

  const botaoNovo = podeEditar ? el('button', { type: 'button', class: 'botao-pequeno' }, '+ Novo') : null
  botaoNovo?.addEventListener('click', () => abrirFormulario(null))

  const cabecalho = el('div', { class: 'barra' }, el('h2', {}, config.titulo), el('div', { class: 'barra-acoes' }, campoBusca, botaoNovo))
  const tabela = el(
    'table',
    { class: 'tabela' },
    el('thead', {}, el('tr', {}, ...config.colunas.map((c) => el('th', {}, c.rotulo)), el('th', {}, ''))),
    corpoTabela
  )
  const pagina = el('section', { class: 'pagina' }, cabecalho, el('div', { class: 'tabela-caixa' }, tabela), vazio)

  function desenharLista() {
    const filtrados = itens.filter((i) => !busca || JSON.stringify(Object.values(i)).toLowerCase().includes(busca))
    corpoTabela.replaceChildren(
      ...filtrados.map((item) => {
        const linha = el(
          'tr',
          { class: item.ativo ? '' : 'inativo' },
          ...config.colunas.map((c, i) => {
            const valor = c.formato ? c.formato(item[c.campo], item) : item[c.campo]
            const td = el('td', {}, valor === '' || valor === null || valor === undefined ? '—' : String(valor))
            if (i === 0 && !item.ativo) td.append(' ', el('span', { class: 'selo' }, 'Inativo'))
            return td
          }),
          el('td', { class: 'acao' }, podeEditar ? el('button', { type: 'button', class: 'link', onclick: () => abrirFormulario(item) }, 'Editar') : '')
        )
        return linha
      })
    )
    vazio.textContent = filtrados.length ? '' : itens.length ? 'Nada encontrado.' : 'Nenhum cadastro ainda.'
  }

  async function carregar() {
    const r = await api(config.api)
    if (!r.ok) {
      vazio.textContent = r.dados.erro || 'Não foi possível carregar.'
      return
    }
    itens = r.dados.itens
    desenharLista()
  }

  function abrirFormulario(item) {
    const novo = !item
    const form = el('form', { class: 'formulario', method: 'dialog' })
    const grade = el('div', { class: 'grade' })
    for (const c of config.campos) {
      const valor = novo ? (c.nome === 'ativo' ? true : c.padrao) : item[c.nome]
      grade.append(criarCampo(c, c.nome === 'ativo' && novo ? true : valor))
    }
    const botaoSalvar = el('button', { type: 'submit' }, 'Salvar')
    const botaoCancelar = el('button', { type: 'button', class: 'secundario' }, 'Cancelar')
    const dialogo = el('dialog', { class: 'janela' }, el('h3', {}, novo ? 'Novo cadastro' : 'Editar cadastro'), form)
    form.append(grade, el('div', { class: 'botoes' }, botaoCancelar, botaoSalvar))

    botaoCancelar.addEventListener('click', () => dialogo.close())
    dialogo.addEventListener('close', () => dialogo.remove())
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      form.querySelector('.erro')?.remove()
      botaoSalvar.disabled = true
      const corpo = lerValores(form, config.campos)
      const r = novo
        ? await api(config.api, { metodo: 'POST', corpo })
        : await api(`${config.api}/${item.id}`, { metodo: 'PUT', corpo })
      botaoSalvar.disabled = false
      if (!r.ok) {
        form.append(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
        return
      }
      dialogo.close()
      carregar()
    })

    document.body.append(dialogo)
    dialogo.showModal()
    form.querySelector('input, select, textarea')?.focus()
  }

  carregar()
  return pagina
}
