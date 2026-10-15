import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Bindings, UsuarioSessao, Variaveis } from '../types'
import { sha256Hex, tokenAleatorio } from './crypto'

const NOME_COOKIE = 'sid'
const DURACAO_EQUIPE_MS = 12 * 60 * 60 * 1000 // 12 horas

type Ctx = Context<{ Bindings: Bindings; Variables: Variaveis }>

export async function criarSessaoEquipe(c: Ctx, usuarioId: number): Promise<void> {
  const token = tokenAleatorio()
  const id = await sha256Hex(token)
  const agora = Date.now()
  await c.env.DB.prepare('INSERT INTO sessoes (id, tipo, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?, ?)')
    .bind(id, 'equipe', usuarioId, agora + DURACAO_EQUIPE_MS, agora)
    .run()
  setCookie(c, NOME_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: DURACAO_EQUIPE_MS / 1000
  })
}

export async function encerrarSessao(c: Ctx): Promise<void> {
  const token = getCookie(c, NOME_COOKIE)
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessoes WHERE id = ?').bind(await sha256Hex(token)).run()
  }
  deleteCookie(c, NOME_COOKIE, { path: '/' })
}

export async function lerUsuarioDaSessao(c: Ctx): Promise<UsuarioSessao | null> {
  const token = getCookie(c, NOME_COOKIE)
  if (!token) return null
  const linha = await c.env.DB.prepare(
    `SELECT u.id, u.nome, u.email, u.vendedor_id, u.deve_trocar_senha, p.nome AS perfil, p.permissoes
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       JOIN perfis p ON p.id = u.perfil_id
      WHERE s.id = ? AND s.tipo = 'equipe' AND s.expira_em > ? AND u.ativo = 1`
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: number; nome: string; email: string; vendedor_id: number | null; deve_trocar_senha: number; perfil: string; permissoes: string }>()
  if (!linha) return null
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    perfil: linha.perfil,
    permissoes: JSON.parse(linha.permissoes) as string[],
    vendedor_id: linha.vendedor_id,
    deve_trocar_senha: linha.deve_trocar_senha === 1
  }
}

export function temPermissao(usuario: UsuarioSessao, permissao: string): boolean {
  return usuario.permissoes.includes('*') || usuario.permissoes.includes(permissao)
}

// Use nas rotas da equipe. Sem permissão informada, basta estar logado.
export function exigirEquipe(permissao?: string): MiddlewareHandler<{ Bindings: Bindings; Variables: Variaveis }> {
  return async (c, next) => {
    const usuario = await lerUsuarioDaSessao(c)
    if (!usuario) return c.json({ erro: 'Faça login para continuar.' }, 401)
    if (usuario.deve_trocar_senha && !c.req.path.endsWith('/trocar-senha')) {
      return c.json({ erro: 'Troque a senha provisória antes de continuar.', trocar_senha: true }, 403)
    }
    if (permissao && !temPermissao(usuario, permissao)) {
      return c.json({ erro: 'Você não tem permissão para isso.' }, 403)
    }
    c.set('usuario', usuario)
    await next()
  }
}
