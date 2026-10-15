// Tela inicial da equipe: login, troca de senha provisória e um painel provisório.
const raiz = document.getElementById('app')

async function api(caminho, opcoes = {}) {
  const resposta = await fetch('/api' + caminho, {
    method: opcoes.metodo || 'GET',
    headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    credentials: 'same-origin'
  })
  const dados = await resposta.json().catch(() => ({}))
  return { ok: resposta.ok, status: resposta.status, dados }
}

function el(tag, atributos = {}, ...filhos) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(atributos)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v)
  }
  for (const f of filhos) e.append(f)
  return e
}

function campo(rotulo, id, tipo, extra = {}) {
  return [el('label', { for: id }, rotulo), el('input', { id, name: id, type: tipo, required: '', ...extra })]
}

function mostrarErro(form, texto) {
  form.querySelector('.erro')?.remove()
  if (texto) form.append(el('div', { class: 'erro', role: 'alert' }, texto))
}

function telaLogin() {
  const form = el('form', { class: 'cartao' },
    el('h1', {}, 'Goiandy Orçamentos'),
    el('p', { class: 'sub' }, 'Acesso da equipe'),
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
  raiz.replaceChildren(form)
  form.email.focus()
}

function telaTrocarSenha(usuario) {
  const form = el('form', { class: 'cartao' },
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
  raiz.replaceChildren(form)
  form.atual.focus()
}

function telaPainel(usuario) {
  const sair = el('button', { type: 'button', class: 'secundario' }, 'Sair')
  sair.addEventListener('click', async () => {
    await api('/auth/logout', { metodo: 'POST', corpo: {} })
    iniciar()
  })
  raiz.replaceChildren(
    el('div', { class: 'cartao' },
      el('h1', {}, 'Olá, ' + usuario.nome),
      el('p', { class: 'sub' }, 'Perfil: ' + usuario.perfil),
      el('p', { class: 'mudo' }, 'O painel está em construção. Os cadastros chegam nas próximas etapas.'),
      sair
    )
  )
}

async function iniciar() {
  const r = await api('/auth/me')
  if (!r.ok) return telaLogin()
  if (r.dados.usuario.deve_trocar_senha) return telaTrocarSenha(r.dados.usuario)
  telaPainel(r.dados.usuario)
}

iniciar()
