import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { conferirSenha, gerarHashSenha } from '../auth/crypto'
import { criarSessaoEquipe, encerrarSessao, exigirEquipe, lerUsuarioDaSessao } from '../auth/sessao'

const MAX_TENTATIVAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000
const MENSAGEM_ERRO = 'E-mail ou senha incorretos.'
// Hash de mentira, usado pra gastar o mesmo tempo quando o e-mail não existe.
const SAL_FALSO = btoa('\0'.repeat(16))
const HASH_FALSO = btoa('\0'.repeat(32))

export const rotasAuth = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

type Linha = {
  id: number
  senha_hash: string
  senha_salt: string
  ativo: number
  tentativas_falhas: number
  bloqueado_ate: number
}

rotasAuth.post('/login', async (c) => {
  const corpo = await c.req.json<{ email?: string; senha?: string }>().catch(() => ({}) as { email?: string; senha?: string })
  const email = (corpo.email ?? '').trim().toLowerCase()
  const senha = corpo.senha ?? ''
  if (!email || !senha) return c.json({ erro: 'Informe e-mail e senha.' }, 400)

  const agora = Date.now()
  const u = await c.env.DB.prepare(
    'SELECT id, senha_hash, senha_salt, ativo, tentativas_falhas, bloqueado_ate FROM usuarios WHERE email = ?'
  )
    .bind(email)
    .first<Linha>()

  if (u && u.bloqueado_ate > agora) {
    return c.json({ erro: 'Muitas tentativas erradas. Tente de novo em alguns minutos.' }, 429)
  }

  const confere = await conferirSenha(senha, u?.senha_hash ?? HASH_FALSO, u?.senha_salt ?? SAL_FALSO)
  if (!u || !u.ativo || !confere) {
    if (u) {
      const falhas = u.tentativas_falhas + 1
      if (falhas >= MAX_TENTATIVAS) {
        await c.env.DB.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = ? WHERE id = ?').bind(agora + BLOQUEIO_MS, u.id).run()
      } else {
        await c.env.DB.prepare('UPDATE usuarios SET tentativas_falhas = ? WHERE id = ?').bind(falhas, u.id).run()
      }
    }
    return c.json({ erro: MENSAGEM_ERRO }, 401)
  }

  await c.env.DB.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = 0 WHERE id = ?').bind(u.id).run()
  await criarSessaoEquipe(c, u.id)
  const dados = await c.env.DB.prepare(
    `SELECT u.id, u.nome, u.email, u.deve_trocar_senha, p.nome AS perfil, p.permissoes
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = ?`
  )
    .bind(u.id)
    .first<{ id: number; nome: string; email: string; deve_trocar_senha: number; perfil: string; permissoes: string }>()
  return c.json({
    usuario: {
      id: dados!.id,
      nome: dados!.nome,
      email: dados!.email,
      perfil: dados!.perfil,
      permissoes: JSON.parse(dados!.permissoes),
      deve_trocar_senha: dados!.deve_trocar_senha === 1
    }
  })
})

rotasAuth.post('/logout', async (c) => {
  await encerrarSessao(c)
  return c.json({ ok: true })
})

rotasAuth.get('/me', async (c) => {
  const usuario = await lerUsuarioDaSessao(c)
  if (!usuario) return c.json({ erro: 'Sem sessão.' }, 401)
  return c.json({ usuario })
})

rotasAuth.post('/trocar-senha', exigirEquipe(), async (c) => {
  const usuario = c.get('usuario')
  const corpo = await c.req
    .json<{ senha_atual?: string; senha_nova?: string }>()
    .catch(() => ({}) as { senha_atual?: string; senha_nova?: string })
  const atual = corpo.senha_atual ?? ''
  const nova = corpo.senha_nova ?? ''
  if (nova.length < 10) return c.json({ erro: 'A senha nova precisa ter pelo menos 10 caracteres.' }, 400)
  if (nova === atual) return c.json({ erro: 'A senha nova precisa ser diferente da atual.' }, 400)

  const u = await c.env.DB.prepare('SELECT senha_hash, senha_salt FROM usuarios WHERE id = ?')
    .bind(usuario.id)
    .first<{ senha_hash: string; senha_salt: string }>()
  if (!u || !(await conferirSenha(atual, u.senha_hash, u.senha_salt))) {
    return c.json({ erro: 'A senha atual está incorreta.' }, 400)
  }

  const { hash, salt } = await gerarHashSenha(nova)
  await c.env.DB.prepare('UPDATE usuarios SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0 WHERE id = ?')
    .bind(hash, salt, usuario.id)
    .run()
  // Encerra todas as sessões antigas e abre uma nova só pra este acesso.
  await c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'equipe' AND usuario_id = ?").bind(usuario.id).run()
  await criarSessaoEquipe(c, usuario.id)
  return c.json({ ok: true })
})
