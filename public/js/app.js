// Entrada do painel da equipe: login, troca de senha provisória, menu e navegação.
import { el, api, pode } from './util.js'
import { telaCadastro } from './cadastro.js'
import { telas } from './telas.js'
import { telaClientes } from './clientes.js'
import { telaEquipe } from './equipe.js'
import { telaTabelasPreco } from './tabelas-preco.js'
import { telaItens } from './itens.js'
import { telaOrcamentos } from './orcamentos.js'

const raiz = document.getElementById('app')

function campo(rotulo, id, tipo, extra = {}) {
  return [el('label', { for: id }, rotulo), el('input', { id, name: id, type: tipo, required: true, ...extra })]
}

function mostrarErro(form, texto) {
  form.querySelector('.erro')?.remove()
  if (texto) form.append(el('div', { class: 'erro', role: 'alert' }, texto))
}

function telaLogin() {
  const form = el(
    'form',
    { class: 'cartao' },
    el('img', { class: 'logo-login', src: '/portal/logo-goiandy.png', alt: 'Goiandy' }),
    el('h1', { style: 'text-align:center' }, 'Goiandy Orçamentos'),
    el('p', { class: 'sub', style: 'text-align:center' }, 'Acesso da equipe'),
    ...campo('E-mail', 'email', 'email', { autocomplete: 'username' }),
    ...campo('Senha', 'senha', 'password', { autocomplete: 'current-password' }),
    el('button', { type: 'submit' }, 'Entrar')
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const botao = form.querySelector('button')
    botao.disabled = true
    mostrarErro(form, '')
    const r = await api('/auth/login', { metodo: 'POST', corpo: { email: form.email.value, senha: form.senha.value } })
    botao.disabled = false
    if (!r.ok) return mostrarErro(form, r.dados.erro || 'Não foi possível entrar.')
    iniciar()
  })
  raiz.className = 'centro'
  raiz.replaceChildren(form)
  form.email.focus()
}

function telaTrocarSenha() {
  const form = el(
    'form',
    { class: 'cartao' },
    el('h1', {}, 'Crie sua senha'),
    el('p', { class: 'sub' }, 'A senha provisória precisa ser trocada antes de continuar. Use pelo menos 10 caracteres.'),
    ...campo('Senha provisória', 'atual', 'password', { autocomplete: 'current-password' }),
    ...campo('Senha nova', 'nova', 'password', { autocomplete: 'new-password', minlength: '10' }),
    ...campo('Repita a senha nova', 'repetir', 'password', { autocomplete: 'new-password', minlength: '10' }),
    el('button', { type: 'submit' }, 'Salvar senha')
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    mostrarErro(form, '')
    if (form.nova.value !== form.repetir.value) return mostrarErro(form, 'As senhas novas não são iguais.')
    const botao = form.querySelector('button')
    botao.disabled = true
    const r = await api('/auth/trocar-senha', { metodo: 'POST', corpo: { senha_atual: form.atual.value, senha_nova: form.nova.value } })
    botao.disabled = false
    if (!r.ok) return mostrarErro(form, r.dados.erro || 'Não foi possível trocar a senha.')
    iniciar()
  })
  raiz.className = 'centro'
  raiz.replaceChildren(form)
  form.atual.focus()
}

function telaInicio(usuario) {
  return el(
    'section',
    { class: 'pagina' },
    el('h2', {}, 'Olá, ' + usuario.nome),
    el('p', { class: 'mudo' }, 'Perfil: ' + usuario.perfil + '. Use o menu acima para abrir os cadastros. Clientes, tabelas e itens chegam nas próximas etapas.')
  )
}

function painel(usuario) {
  const menu = el('nav', { class: 'menu', 'aria-label': 'Principal' })
  const conteudo = el('div', { class: 'conteudo' })
  const itensMenu = [{ id: 'inicio', rotulo: 'Início' }]
  if (pode(usuario, 'clientes.ver')) itensMenu.push({ id: 'clientes', rotulo: 'Clientes' })
  for (const [id, t] of Object.entries(telas)) if (pode(usuario, t.permVer)) itensMenu.push({ id, rotulo: t.titulo })
  if (pode(usuario, 'orcamentos.ver_todos') || pode(usuario, 'orcamentos.ver_proprios')) itensMenu.push({ id: 'orcamentos', rotulo: 'Orçamentos' })
  if (pode(usuario, 'tabelas.ver')) itensMenu.push({ id: 'tabelas', rotulo: 'Tabelas de preço' })
  if (pode(usuario, 'itens.ver')) itensMenu.push({ id: 'itens', rotulo: 'Itens e fotos' })
  if (pode(usuario, 'equipe.gerenciar')) itensMenu.push({ id: 'equipe', rotulo: 'Equipe' })
  for (const i of itensMenu) menu.append(el('a', { href: '#/' + i.id, 'data-id': i.id }, i.rotulo))

  const sair = el('button', { type: 'button', class: 'link' }, 'Sair')
  sair.addEventListener('click', async () => {
    await api('/auth/logout', { metodo: 'POST', corpo: {} })
    window.location.hash = ''
    iniciar()
  })

  function rotear() {
    const id = window.location.hash.replace('#/', '') || 'inicio'
    const valido = itensMenu.some((i) => i.id === id) ? id : 'inicio'
    for (const a of menu.querySelectorAll('a')) a.classList.toggle('ativo', a.dataset.id === valido)
    conteudo.replaceChildren(valido === 'inicio' ? telaInicio(usuario) : valido === 'clientes' ? telaClientes(usuario) : valido === 'equipe' ? telaEquipe(usuario) : valido === 'tabelas' ? telaTabelasPreco(usuario) : valido === 'itens' ? telaItens(usuario) : valido === 'orcamentos' ? telaOrcamentos(usuario) : telaCadastro(telas[valido], usuario))
  }

  window.onhashchange = rotear
  raiz.className = 'painel'
  raiz.replaceChildren(
    el('header', { class: 'topo' }, el('span', { class: 'marca-goiandy' }, el('img', { src: '/portal/logo-goiandy.png', alt: '' }), el('strong', {}, 'Orçamentos')), menu, el('span', { class: 'usuario' }, usuario.nome, ' · ', sair)),
    conteudo
  )
  rotear()
}

async function iniciar() {
  window.onhashchange = null
  const r = await api('/auth/me')
  if (!r.ok) return telaLogin()
  if (r.dados.usuario.deve_trocar_senha) return telaTrocarSenha()
  painel(r.dados.usuario)
}

iniciar()
