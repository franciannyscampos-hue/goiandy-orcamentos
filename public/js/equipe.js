// Tela de Equipe: usuários da Goiandy e perfis (o que cada perfil pode fazer).
import { el, api, aplicarTipo } from './util.js'

function mostrarSenha(titulo, email, senha) {
  const dialogo = el('dialog', { class: 'janela' })
  const caixa = el('code', { class: 'senha-caixa' }, senha)
  const copiar = el('button', { type: 'button', class: 'secundario botao-pequeno' }, 'Copiar')
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(senha)
      copiar.textContent = 'Copiado ✓'
    } catch {
      copiar.textContent = 'Selecione e copie'
    }
  })
  dialogo.append(
    el('h3', {}, titulo),
    el('p', {}, 'Passe esta senha provisória para ', el('strong', {}, email), '. Ela só aparece agora; depois que você fechar, não dá para ver de novo (mas dá para gerar outra).'),
    el('div', { class: 'linha-consulta' }, caixa, copiar),
    el('p', { class: 'mudo pequeno' }, 'No primeiro acesso o sistema pede para a pessoa criar a própria senha.'),
    el('div', { class: 'botoes' }, el('button', { type: 'button', onclick: () => dialogo.close() }, 'Já anotei'))
  )
  dialogo.addEventListener('close', () => dialogo.remove())
  document.body.append(dialogo)
  dialogo.showModal()
}

function dialogoBase(titulo) {
  const dialogo = el('dialog', { class: 'janela' }, el('h3', {}, titulo))
  dialogo.addEventListener('close', () => dialogo.remove())
  document.body.append(dialogo)
  return dialogo
}

export function telaEquipe(usuario) {
  let usuarios = []
  let perfis = []
  let permissoes = []
  let vendedores = []
  let aba = 'usuarios'

  const conteudo = el('div')
  const abaU = el('button', { type: 'button', class: 'aba ativa' }, 'Usuários')
  const abaP = el('button', { type: 'button', class: 'aba' }, 'Perfis e permissões')
  abaU.addEventListener('click', () => trocar('usuarios'))
  abaP.addEventListener('click', () => trocar('perfis'))
  const pagina = el('section', { class: 'pagina' }, el('div', { class: 'barra' }, el('h2', {}, 'Equipe'), el('div', { class: 'abas' }, abaU, abaP)), conteudo)

  function trocar(nova) {
    aba = nova
    abaU.classList.toggle('ativa', nova === 'usuarios')
    abaP.classList.toggle('ativa', nova === 'perfis')
    desenhar()
  }

  async function carregar() {
    const [u, p, v] = await Promise.all([api('/equipe/usuarios'), api('/equipe/perfis'), api('/vendedores')])
    if (!u.ok || !p.ok) {
      conteudo.replaceChildren(el('p', { class: 'mudo' }, u.dados.erro || p.dados.erro || 'Não foi possível carregar.'))
      return
    }
    usuarios = u.dados.itens
    perfis = p.dados.itens
    permissoes = p.dados.permissoes
    vendedores = v.ok ? v.dados.itens.filter((x) => x.ativo) : []
    desenhar()
  }

  function desenhar() {
    conteudo.replaceChildren(aba === 'usuarios' ? listaUsuarios() : listaPerfis())
  }

  // ---------- Usuários ----------
  function listaUsuarios() {
    const linhas = usuarios.map((u) => {
      const nome = el('td', {}, u.nome)
      if (!u.ativo) nome.append(' ', el('span', { class: 'selo' }, 'Inativo'))
      if (u.bloqueado) nome.append(' ', el('span', { class: 'selo selo-alerta' }, 'Bloqueado'))
      if (u.deve_trocar_senha) nome.append(' ', el('span', { class: 'selo' }, 'Senha provisória'))
      return el(
        'tr',
        { class: u.ativo ? '' : 'inativo' },
        nome,
        el('td', {}, u.email),
        el('td', {}, u.perfil),
        el('td', {}, u.vendedor_nome || '—'),
        el('td', { class: 'acao' }, el('button', { type: 'button', class: 'link', onclick: () => formularioUsuario(u) }, 'Editar'))
      )
    })
    return el(
      'div',
      { class: 'pagina' },
      el('div', { class: 'barra' }, el('p', { class: 'mudo pequeno' }, 'Quem trabalha na Goiandy e entra neste painel.'), el('button', { type: 'button', class: 'botao-pequeno', onclick: () => formularioUsuario(null) }, '+ Novo usuário')),
      el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ...['Nome', 'E-mail', 'Perfil', 'Vendedor ligado', ''].map((x) => el('th', {}, x)))), el('tbody', {}, ...linhas)))
    )
  }

  function formularioUsuario(u) {
    const novo = !u
    const dialogo = dialogoBase(novo ? 'Novo usuário' : 'Editar usuário')
    const nome = el('input', { name: 'nome', required: true, maxlength: '120' })
    nome.value = u?.nome ?? ''
    const email = el('input', { name: 'email', type: 'email' })
    email.value = u?.email ?? ''
    aplicarTipo(email, 'email')
    email.required = true
    if (!novo) email.disabled = true
    const perfil = el('select', { name: 'perfil_id' }, ...perfis.map((p) => el('option', { value: String(p.id) }, p.nome)))
    perfil.value = String(u?.perfil_id ?? perfis.find((p) => p.nome === 'Vendedor')?.id ?? perfis[0]?.id)
    const vendedor = el('select', { name: 'vendedor_id' }, el('option', { value: '' }, '— nenhum —'), ...vendedores.map((v) => el('option', { value: String(v.id) }, v.nome)))
    vendedor.value = u?.vendedor_id ? String(u.vendedor_id) : ''
    const ativo = el('input', { type: 'checkbox', name: 'ativo' })
    ativo.checked = u ? !!u.ativo : true
    const euMesmo = u && u.id === usuario.id
    if (euMesmo) {
      perfil.disabled = true
      ativo.disabled = true
    }
    const erro = el('div')
    const salvar = el('button', { type: 'submit' }, novo ? 'Criar usuário' : 'Salvar')
    const cancelar = el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Cancelar')
    const campo = (rotulo, entrada, dica) => el('div', { class: 'campo' }, el('label', {}, rotulo), entrada, dica ? el('div', { class: 'dica' }, dica) : '')
    const form = el(
      'form',
      { class: 'formulario' },
      campo('Nome', nome),
      campo('E-mail (é o login)', email),
      campo('Perfil', perfil, euMesmo ? 'Você não pode trocar o seu próprio perfil.' : 'Define o que a pessoa pode fazer. Veja em "Perfis e permissões".'),
      campo('Vendedor ligado', vendedor, 'Para quem é vendedor: liga o usuário ao cadastro de vendedor, para ver só os clientes e orçamentos dele.'),
      novo ? '' : el('div', { class: 'campo-check-linha', style: 'margin-top:14px' }, ativo, ' ', el('label', {}, 'Usuário ativo (desmarcado = não consegue entrar)')),
      erro
    )
    const acoes = el('div', { class: 'botoes' })
    if (!novo) {
      const redefinir = el('button', { type: 'button', class: 'secundario', style: 'margin-right:auto' }, 'Gerar nova senha')
      redefinir.addEventListener('click', async () => {
        if (!confirm(`Gerar uma nova senha provisória para ${u.nome}? A senha atual deixa de valer e ele(a) será desconectado(a).`)) return
        const r = await api(`/equipe/usuarios/${u.id}/redefinir-senha`, { metodo: 'POST', corpo: {} })
        if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível gerar a senha.'))
        dialogo.close()
        carregar()
        mostrarSenha('Nova senha provisória', u.email, r.dados.senha_provisoria)
      })
      acoes.append(redefinir)
    }
    acoes.append(cancelar, salvar)
    form.append(acoes)
    dialogo.append(form)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      erro.replaceChildren()
      salvar.disabled = true
      const corpo = { nome: nome.value, perfil_id: Number(perfil.value), vendedor_id: vendedor.value || null }
      if (novo) corpo.email = email.value
      else if (!euMesmo) corpo.ativo = ativo.checked
      if (euMesmo) delete corpo.perfil_id
      const r = novo ? await api('/equipe/usuarios', { metodo: 'POST', corpo }) : await api('/equipe/usuarios/' + u.id, { metodo: 'PUT', corpo })
      salvar.disabled = false
      if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
      dialogo.close()
      carregar()
      if (novo) mostrarSenha('Usuário criado', r.dados.item.email, r.dados.senha_provisoria)
    })
    dialogo.showModal()
    nome.focus()
  }

  // ---------- Perfis ----------
  function listaPerfis() {
    const cartoes = perfis.map((p) => {
      const tudo = p.permissoes.includes('*')
      const nomes = tudo ? ['Acesso total ao sistema'] : permissoes.filter((x) => p.permissoes.includes(x.chave)).map((x) => x.rotulo)
      return el(
        'div',
        { class: 'cartao-perfil' },
        el('div', { class: 'barra' }, el('div', {}, el('strong', {}, p.nome), p.sistema ? el('span', { class: 'selo' }, 'Padrão') : '', el('div', { class: 'mudo pequeno' }, `${p.n_usuarios} usuário${p.n_usuarios === 1 ? '' : 's'} ativo${p.n_usuarios === 1 ? '' : 's'}`)), tudo ? '' : el('button', { type: 'button', class: 'link', onclick: () => formularioPerfil(p) }, 'Editar')),
        p.descricao ? el('p', { class: 'mudo pequeno' }, p.descricao) : '',
        nomes.length ? el('ul', { class: 'lista-perm' }, ...nomes.map((n) => el('li', {}, n))) : el('p', { class: 'mudo pequeno' }, 'Nenhuma permissão marcada.')
      )
    })
    return el(
      'div',
      { class: 'pagina' },
      el('div', { class: 'barra' }, el('p', { class: 'mudo pequeno' }, 'Cada usuário tem um perfil. O perfil define o que ele pode ver e fazer. A mudança vale na hora.'), el('button', { type: 'button', class: 'botao-pequeno', onclick: () => formularioPerfil(null) }, '+ Novo perfil')),
      el('div', { class: 'grade-perfis' }, ...cartoes)
    )
  }

  function formularioPerfil(p) {
    const novo = !p
    const dialogo = dialogoBase(novo ? 'Novo perfil' : 'Editar perfil: ' + p.nome)
    const nome = el('input', { name: 'nome', required: true, maxlength: '60' })
    nome.value = p?.nome ?? ''
    if (p?.sistema) nome.disabled = true
    const descricao = el('input', { name: 'descricao', maxlength: '300' })
    descricao.value = p?.descricao ?? ''
    const caixas = new Map()
    const grupos = []
    for (const x of permissoes) {
      let g = grupos.find((y) => y.nome === x.grupo)
      if (!g) grupos.push((g = { nome: x.grupo, itens: [] }))
      const cx = el('input', { type: 'checkbox' })
      cx.checked = !!p?.permissoes.includes(x.chave)
      caixas.set(x.chave, cx)
      g.itens.push(el('label', { class: 'campo-check-linha' }, cx, ' ', x.rotulo))
    }
    const erro = el('div')
    const salvar = el('button', { type: 'submit' }, 'Salvar')
    const cancelar = el('button', { type: 'button', class: 'secundario', onclick: () => dialogo.close() }, 'Cancelar')
    const form = el(
      'form',
      { class: 'formulario' },
      el('div', { class: 'campo' }, el('label', {}, 'Nome do perfil'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'Descrição (opcional)'), descricao),
      el('h4', {}, 'O que este perfil pode fazer'),
      ...grupos.map((g) => el('div', { class: 'grupo-perm' }, el('strong', { class: 'pequeno' }, g.nome), ...g.itens)),
      erro,
      el('div', { class: 'botoes' }, cancelar, salvar)
    )
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      erro.replaceChildren()
      salvar.disabled = true
      const corpo = { nome: nome.value, descricao: descricao.value, permissoes: [...caixas].filter(([, c]) => c.checked).map(([k]) => k) }
      const r = novo ? await api('/equipe/perfis', { metodo: 'POST', corpo }) : await api('/equipe/perfis/' + p.id, { metodo: 'PUT', corpo })
      salvar.disabled = false
      if (!r.ok) return erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, r.dados.erro || 'Não foi possível salvar.'))
      dialogo.close()
      carregar()
    })
    dialogo.append(form)
    dialogo.showModal()
    if (novo) nome.focus()
  }

  carregar()
  return pagina
}
