// Tela de clientes (CNPJ): lista, ficha completa e compradores de cada CNPJ.
import { el, api, pode, formatarCnpj } from './util.js'
import { abrirImportacao } from './importar.js'

const SECOES = [
  {
    titulo: 'Identificação',
    campos: [
      { nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true },
      { nome: 'razao_social', rotulo: 'Razão social', obrigatorio: true },
      { nome: 'nome_fantasia', rotulo: 'Nome fantasia' },
      { nome: 'inscricao_estadual', rotulo: 'Inscrição estadual' },
      { nome: 'suframa', rotulo: 'Suframa' },
      { nome: 'codigo_suasvendas', rotulo: 'Código SuasVendas' }
    ]
  },
  {
    titulo: 'Endereço e contato',
    campos: [
      { nome: 'endereco', rotulo: 'Endereço' },
      { nome: 'cep', rotulo: 'CEP' },
      { nome: 'uf', rotulo: 'UF', tipo: 'uf' },
      { nome: 'cidade', rotulo: 'Cidade', tipo: 'cidade' },
      { nome: 'telefone', rotulo: 'Telefone' },
      { nome: 'whatsapp', rotulo: 'WhatsApp' },
      { nome: 'email_nfe', rotulo: 'E-mail NF-e', tipo: 'email' },
      { nome: 'email_financeiro', rotulo: 'E-mail financeiro', tipo: 'email' }
    ]
  },
  {
    titulo: 'Classificação',
    campos: [
      { nome: 'segmento', rotulo: 'Segmento', ajuda: 'Ramo de atividade do cliente (ex.: papelaria, utilidades domésticas, farmácia, material de construção). Ajuda a saber o que oferecer a ele.' },
      { nome: 'categoria', rotulo: 'Categoria', ajuda: 'Classificação interna da Goiandy para esse cliente (ex.: A, B, C, ou ouro, prata), usada para priorizar atendimento.' },
      { nome: 'rede', rotulo: 'Rede', ajuda: 'Se a loja faz parte de uma rede ou grupo de lojas, escreva o nome da rede (ex.: Rede Bom Preço). Lojas independentes ficam em branco.' }
    ]
  }
]

function linhaCampo(rotulo, entrada, ajuda) {
  return el('div', { class: 'campo' }, el('label', {}, ajuda ? rotulo + ' *' : rotulo), entrada, ajuda ? el('div', { class: 'dica' }, '* ' + ajuda) : '')
}

function entradaTexto(c, valor) {
  const e = el('input', { type: c.tipo === 'email' ? 'email' : 'text', name: c.nome, maxlength: c.max })
  e.value = valor ?? ''
  if (c.obrigatorio) e.required = true
  return e
}

function seletor(nome, opcoes, valor, vazio) {
  const s = el('select', { name: nome }, el('option', { value: '' }, vazio), ...opcoes.map((o) => el('option', { value: String(o.id) }, o.nome)))
  s.value = valor ? String(valor) : ''
  return s
}

function caixa(nome, rotulo, marcado) {
  const i = el('input', { type: 'checkbox', name: nome })
  i.checked = !!marcado
  return el('label', { class: 'campo-check-linha' }, i, ' ', rotulo)
}

// Lista de UFs e cidades (arquivo local, carregado uma vez).
let promessaLocais = null
function carregarLocais() {
  if (!promessaLocais) promessaLocais = fetch('/dados/municipios.json').then((r) => r.json()).catch(() => null)
  return promessaLocais
}
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export function telaClientes(usuario) {
  const podeEditar = pode(usuario, 'clientes.editar')
  let itens = []
  let busca = ''
  const corpo = el('tbody')
  const vazio = el('p', { class: 'mudo vazio' })
  const campoBusca = el('input', { type: 'search', placeholder: 'Buscar por nome, CNPJ, cidade...', 'aria-label': 'Buscar' })
  campoBusca.addEventListener('input', () => {
    busca = campoBusca.value.trim().toLowerCase()
    desenhar()
  })
  const botaoNovo = podeEditar ? el('button', { type: 'button', class: 'botao-pequeno', onclick: () => abrirFicha(null) }, '+ Novo cliente') : null

  const botaoImportar = podeEditar
    ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => abrirImportacao({ rotulo: 'Clientes', apiBase: '/clientes', aoTerminar: () => carregar() }) }, '⬆ Importar planilha')
    : null

  const pagina = el(
    'section',
    { class: 'pagina' },
    el('div', { class: 'barra' }, el('h2', {}, 'Clientes'), el('div', { class: 'barra-acoes' }, campoBusca, botaoImportar, botaoNovo)),
    el(
      'div',
      { class: 'tabela-caixa' },
      el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ...['Cliente', 'CNPJ', 'Cidade', 'Vendedor', 'Compradores', 'Preços', ''].map((x) => el('th', {}, x)))), corpo)
    ),
    vazio
  )

  function desenhar() {
    const sem = (s) => String(s ?? '').toLowerCase()
    const filtrados = itens.filter((i) => !busca || [i.razao_social, i.nome_fantasia, i.cnpj, i.cidade, i.vendedor_nome].some((v) => sem(v).includes(busca) || sem(v).replace(/\D/g, '').includes(busca.replace(/\D/g, '') || '§')))
    corpo.replaceChildren(
      ...filtrados.map((i) => {
        const nome = el('td', {}, i.nome_fantasia || i.razao_social)
        if (i.nome_fantasia) nome.append(el('div', { class: 'mudo pequeno' }, i.razao_social))
        if (!i.ativo) nome.append(' ', el('span', { class: 'selo' }, 'Inativo'))
        return el(
          'tr',
          { class: i.ativo ? '' : 'inativo' },
          nome,
          el('td', {}, formatarCnpj(i.cnpj)),
          el('td', {}, [i.cidade, i.uf].filter(Boolean).join('/') || '—'),
          el('td', {}, i.vendedor_nome || '—'),
          el('td', {}, String(i.n_compradores)),
          el('td', {}, i.ver_precos ? 'Vê' : 'Vitrine'),
          el('td', { class: 'acao' }, el('button', { type: 'button', class: 'link', onclick: () => abrirFicha(i.id) }, podeEditar ? 'Abrir' : 'Ver'))
        )
      })
    )
    vazio.textContent = filtrados.length ? '' : itens.length ? 'Nada encontrado.' : 'Nenhum cliente cadastrado ainda.'
  }

  async function carregar() {
    const r = await api('/clientes')
    if (!r.ok) {
      vazio.textContent = r.dados.erro || 'Não foi possível carregar.'
      return
    }
    itens = r.dados.itens
    desenhar()
  }

  async function abrirFicha(id) {
    const [vend, transp, det, locais] = await Promise.all([api('/vendedores'), api('/transportadoras'), id ? api('/clientes/' + id) : Promise.resolve(null), carregarLocais()])
    if (det && !det.ok) return alert(det.dados.erro || 'Não foi possível abrir o cliente.')
    const cliente = det ? det.dados.cliente : { ver_precos: 1, ativo: 1 }
    let compradores = det ? det.dados.compradores : []
    const limite = det ? det.dados.limite_compradores : 5
    const vendedores = (vend.dados.itens || []).filter((v) => v.ativo || v.id === cliente.vendedor_id)
    const transportadoras = (transp.dados.itens || []).filter((t) => t.ativo || t.id === cliente.transportadora_id)

    let idAtual = id
    const form = el('form', { class: 'formulario' })
    for (const s of SECOES) {
      form.append(el('h4', {}, s.titulo))
      const grade = el('div', { class: 'grade-2' })
      for (const c of s.campos) {
        let entrada
        if (c.tipo === 'uf' && locais) {
          entrada = el('select', { name: 'uf' }, el('option', { value: '' }, 'UF'), ...locais.estados.map((e) => el('option', { value: e.uf, title: e.nome }, e.uf)))
          entrada.value = cliente.uf || ''
        } else if (c.tipo === 'cidade' && locais) {
          entrada = el('select', { name: 'cidade' })
        } else entrada = entradaTexto(c, c.nome === 'cnpj' ? formatarCnpj(cliente.cnpj) : cliente[c.nome])
        grade.append(linhaCampo(c.rotulo, entrada, c.ajuda))
      }
      form.append(grade)
    }
    // UF e cidade: ao escolher a UF, a lista de cidades mostra só as dela.
    const campoUf = form.elements.uf
    const campoCidade = form.elements.cidade
    function preencherCidades(uf, escolhida) {
      if (!locais || campoCidade.tagName !== 'SELECT') return
      const lista = locais.cidades[uf] || []
      campoCidade.replaceChildren(el('option', { value: '' }, uf ? 'Escolha a cidade' : 'Escolha a UF primeiro'), ...lista.map((n) => el('option', { value: n }, n)))
      campoCidade.disabled = !uf
      if (escolhida) {
        const achada = lista.find((n) => semAcento(n) === semAcento(escolhida))
        if (achada) campoCidade.value = achada
        else {
          campoCidade.append(el('option', { value: escolhida }, escolhida)) // nome fora da lista oficial: mantém o que veio
          campoCidade.value = escolhida
        }
      }
    }
    function definirLocal(uf, cidade) {
      if (!locais || campoUf.tagName !== 'SELECT') {
        if (campoUf.value === '' && uf) campoUf.value = uf
        if (campoCidade.value === '' && cidade) campoCidade.value = cidade
        return
      }
      campoUf.value = uf || ''
      preencherCidades(campoUf.value, cidade)
    }
    if (locais) {
      preencherCidades(campoUf.value, cliente.cidade)
      campoUf.addEventListener('change', () => preencherCidades(campoUf.value))
    }

    // CEP: ao completar os 8 números, puxa endereço, bairro, cidade e UF.
    const campoCep = form.elements.cep
    const avisoCep = el('div', { class: 'dica' })
    campoCep.closest('.campo').append(avisoCep)
    let ultimoCep = ''
    campoCep.addEventListener('input', async () => {
      const d = campoCep.value.replace(/\D/g, '').slice(0, 8)
      campoCep.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d
      if (d.length !== 8 || d === ultimoCep) return
      ultimoCep = d
      avisoCep.className = 'dica'
      avisoCep.textContent = 'Buscando CEP...'
      const r = await api('/clientes/consulta-cep/' + d)
      if (!r.ok) {
        ultimoCep = ''
        avisoCep.className = 'dica erro-texto'
        avisoCep.textContent = r.dados.erro || 'Não foi possível consultar o CEP.'
        return
      }
      const x = r.dados.dados
      definirLocal(x.uf, x.cidade)
      const campoEnd = form.elements.endereco
      if (!campoEnd.value.trim()) campoEnd.value = [x.logradouro, x.bairro].filter(Boolean).join(', ')
      avisoCep.className = 'dica ok-texto'
      avisoCep.textContent = 'Endereço preenchido pelo CEP. Falta só o número.'
      campoEnd.focus()
      campoEnd.setSelectionRange(campoEnd.value.length, campoEnd.value.length)
    })

    // Consulta do CNPJ na Receita: preenche só os campos que ainda estão vazios.
    const campoCnpj = form.elements.cnpj
    const aviso = el('div', { class: 'aviso-cnpj mudo pequeno' })
    const botaoConsulta = el('button', { type: 'button', class: 'secundario botao-pequeno' }, 'Consultar CNPJ')
    campoCnpj.closest('.campo').append(el('div', { class: 'linha-consulta' }, botaoConsulta, aviso))
    const mapa = { razao_social: 'razao_social', nome_fantasia: 'nome_fantasia', endereco: 'endereco', cep: 'cep', telefone: 'telefone' }
    let ultimaConsulta = ''
    async function consultar() {
      const digitos = campoCnpj.value.replace(/\D/g, '')
      if (digitos.length !== 14 || digitos === ultimaConsulta) return
      ultimaConsulta = digitos
      botaoConsulta.disabled = true
      aviso.className = 'aviso-cnpj mudo pequeno'
      aviso.textContent = 'Consultando a Receita...'
      const r = await api('/clientes/consulta-cnpj/' + digitos)
      botaoConsulta.disabled = false
      if (!r.ok) {
        ultimaConsulta = ''
        aviso.className = 'aviso-cnpj erro-texto pequeno'
        aviso.textContent = r.dados.erro || 'Não foi possível consultar.'
        return
      }
      const d = r.dados.dados
      for (const [campo, chave] of Object.entries(mapa)) {
        const e = form.elements[campo]
        if (e && !e.value.trim() && d[chave]) e.value = d[chave]
      }
      if (!campoUf.value && d.uf) definirLocal(d.uf, d.cidade)
      campoCnpj.value = formatarCnpj(digitos)
      const partes = [`Dados da Receita (${d.fonte}).`, d.situacao ? `Situação: ${d.situacao}.` : '']
      const atencao = d.situacao && d.situacao.toUpperCase() !== 'ATIVA'
      const existente = r.dados.ja_cadastrado && r.dados.ja_cadastrado.id !== idAtual
      if (existente) partes.push(`Atenção: este CNPJ já está cadastrado (${r.dados.ja_cadastrado.razao_social}).`)
      aviso.className = 'aviso-cnpj pequeno ' + (atencao || existente ? 'erro-texto' : 'ok-texto')
      aviso.textContent = partes.filter(Boolean).join(' ')
    }
    botaoConsulta.addEventListener('click', () => { ultimaConsulta = ''; consultar() })
    campoCnpj.addEventListener('input', () => { if (!idAtual && campoCnpj.value.replace(/\D/g, '').length === 14) consultar() })

    form.append(el('h4', {}, 'Atendimento'))
    form.append(
      el(
        'div',
        { class: 'grade-2' },
        linhaCampo('Vendedor responsável', seletor('vendedor_id', vendedores, cliente.vendedor_id, '— sem vendedor —')),
        linhaCampo('Transportadora padrão', seletor('transportadora_id', transportadoras, cliente.transportadora_id, '— nenhuma —'))
      )
    )
    form.append(
      el(
        'div',
        { class: 'caixas' },
        caixa('ver_precos', 'Pode ver preços (desmarcado = só vitrine, o preço é passado pela equipe)', cliente.ver_precos),
        caixa('ativo', 'Cliente ativo', cliente.ativo)
      )
    )
    const erro = el('div')
    const salvar = el('button', { type: 'submit' }, 'Salvar')
    const fechar = el('button', { type: 'button', class: 'secundario' }, 'Fechar')
    form.append(erro, el('div', { class: 'botoes' }, fechar, podeEditar ? salvar : null))
    if (!podeEditar) for (const e of form.elements) e.disabled = true
    fechar.disabled = false

    const dialogo = el('dialog', { class: 'janela larga' }, el('h3', {}, id ? cliente.nome_fantasia || cliente.razao_social : 'Novo cliente'), form)

    // Compradores: só depois que o cliente existe
    const areaCompradores = el('div', { class: 'compradores' })
    function desenharCompradores() {
      areaCompradores.replaceChildren(
        el('h4', {}, `Compradores (${compradores.filter((c) => c.ativo).length} de ${limite})`),
        el('p', { class: 'mudo pequeno' }, 'Cada comprador entra no portal com o próprio e-mail.'),
        ...compradores.map((b) =>
          el(
            'div',
            { class: 'linha-comprador' + (b.ativo ? '' : ' inativo') },
            el('div', {}, el('strong', {}, b.nome), b.ativo ? '' : el('span', { class: 'selo' }, 'Inativo'), el('div', { class: 'mudo pequeno' }, [b.email, b.telefone].filter(Boolean).join(' · '))),
            podeEditar ? el('button', { type: 'button', class: 'link', onclick: () => formularioComprador(b) }, 'Editar') : ''
          )
        ),
        podeEditar ? el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => formularioComprador(null) }, '+ Comprador') : ''
      )
    }
    function formularioComprador(b) {
      const f = el('form', { class: 'sub-form' })
      const nome = entradaTexto({ nome: 'nome', obrigatorio: true, max: 120 }, b?.nome)
      const email = entradaTexto({ nome: 'email', tipo: 'email', obrigatorio: true, max: 160 }, b?.email)
      const tel = entradaTexto({ nome: 'telefone', max: 30 }, b?.telefone)
      const ativo = caixa('ativo', 'Ativo', b ? b.ativo : 1)
      const msg = el('div')
      const ok = el('button', { type: 'submit', class: 'botao-pequeno' }, 'Salvar comprador')
      const cancelar = el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: desenharCompradores }, 'Cancelar')
      f.append(el('div', { class: 'grade-2' }, linhaCampo('Nome', nome), linhaCampo('E-mail', email), linhaCampo('Telefone', tel)), ativo, msg, el('div', { class: 'botoes' }, cancelar, ok))
      f.addEventListener('submit', async (e) => {
        e.preventDefault()
        msg.replaceChildren()
        ok.disabled = true
        const dados = { nome: nome.value, email: email.value, telefone: tel.value, ativo: ativo.querySelector('input').checked }
        const r = b ? await api('/clientes/compradores/' + b.id, { metodo: 'PUT', corpo: dados }) : await api(`/clientes/${idAtual}/compradores`, { metodo: 'POST', corpo: dados })
        ok.disabled = false
        if (!r.ok) return msg.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
        const novo = await api('/clientes/' + idAtual)
        compradores = novo.dados.compradores
        desenharCompradores()
        carregar()
      })
      areaCompradores.replaceChildren(el('h4', {}, b ? 'Editar comprador' : 'Novo comprador'), f)
      nome.focus()
    }
    function mostrarCompradores() {
      areaCompradores.remove()
      if (idAtual) {
        desenharCompradores()
        form.after(areaCompradores)
      }
    }
    mostrarCompradores()

    fechar.addEventListener('click', () => dialogo.close())
    dialogo.addEventListener('close', () => dialogo.remove())
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      erro.replaceChildren()
      salvar.disabled = true
      const dados = {}
      for (const s of SECOES) for (const c of s.campos) dados[c.nome] = form.elements[c.nome].value
      dados.vendedor_id = form.elements.vendedor_id.value || null
      dados.transportadora_id = form.elements.transportadora_id.value || null
      dados.ver_precos = form.elements.ver_precos.checked
      dados.ativo = form.elements.ativo.checked
      const r = idAtual ? await api('/clientes/' + idAtual, { metodo: 'PUT', corpo: dados }) : await api('/clientes', { metodo: 'POST', corpo: dados })
      salvar.disabled = false
      if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
      carregar()
      if (!idAtual) {
        // Cliente novo: continua aberto para já cadastrar os compradores
        idAtual = r.dados.item.id
        dialogo.querySelector('h3').textContent = r.dados.item.nome_fantasia || r.dados.item.razao_social
        erro.replaceChildren(el('div', { class: 'ok' }, 'Cliente salvo. Agora cadastre os compradores abaixo.'))
        mostrarCompradores()
      } else {
        dialogo.close()
      }
    })

    document.body.append(dialogo)
    dialogo.showModal()
    form.elements.cnpj.focus()
  }

  carregar()
  return pagina
}
