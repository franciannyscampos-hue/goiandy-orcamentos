import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { gerarHashSenha } from '../auth/crypto'
import { PERMISSOES } from '../db/preparar'
import { emailValido } from '../util/validar'

export const ROTULOS_PERMISSOES: Record<string, { grupo: string; rotulo: string }> = {
  'clientes.ver': { grupo: 'Clientes', rotulo: 'Ver clientes, vendedores e transportadoras' },
  'clientes.editar': { grupo: 'Clientes', rotulo: 'Cadastrar, editar e importar clientes, vendedores e transportadoras' },
  'industrias.ver': { grupo: 'Indústrias', rotulo: 'Ver indústrias' },
  'industrias.editar': { grupo: 'Indústrias', rotulo: 'Cadastrar, editar e importar indústrias' },
  'tabelas.ver': { grupo: 'Tabelas de preço', rotulo: 'Ver tabelas de preço' },
  'tabelas.editar': { grupo: 'Tabelas de preço', rotulo: 'Criar, editar e importar tabelas de preço' },
  'itens.ver': { grupo: 'Itens', rotulo: 'Ver itens' },
  'itens.editar': { grupo: 'Itens', rotulo: 'Cadastrar, editar e importar itens' },
  'fotos.enviar': { grupo: 'Itens', rotulo: 'Enviar fotos dos itens' },
  'orcamentos.ver_todos': { grupo: 'Orçamentos', rotulo: 'Ver os orçamentos de todos os clientes' },
  'orcamentos.ver_proprios': { grupo: 'Orçamentos', rotulo: 'Ver só os orçamentos dos clientes dele' },
  'orcamentos.atender': { grupo: 'Orçamentos', rotulo: 'Atualizar o status dos orçamentos' },
  'equipe.gerenciar': { grupo: 'Equipe', rotulo: 'Gerenciar usuários, perfis e permissões' }
}

const rotas = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()
rotas.use('*', exigirEquipe('equipe.gerenciar'))

// Senha provisória legível (sem 0/O, 1/l/I), mostrada uma única vez para quem cria o usuário.
function senhaProvisoria(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => letras[b % letras.length]).join('')
}

async function registrar(db: D1Database, usuarioId: number, acao: string, detalhe: string) {
  await db.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), usuarioId, acao, detalhe).run()
}

const SQL_USUARIO = `SELECT u.id, u.nome, u.email, u.perfil_id, p.nome AS perfil, u.vendedor_id, v.nome AS vendedor_nome, u.ativo,
       (u.bloqueado_ate > ?) AS bloqueado, u.deve_trocar_senha
  FROM usuarios u JOIN perfis p ON p.id = u.perfil_id LEFT JOIN vendedores v ON v.id = u.vendedor_id`

async function administradoresAtivos(db: D1Database, excetoId?: number): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.ativo = 1 AND p.permissoes LIKE '%"*"%' AND u.id != ?`)
    .bind(excetoId ?? 0)
    .first<{ n: number }>()
  return r?.n ?? 0
}

// ---------- Usuários ----------
rotas.get('/usuarios', async (c) => {
  const r = await c.env.DB.prepare(SQL_USUARIO + ' ORDER BY u.ativo DESC, u.nome COLLATE NOCASE').bind(Date.now()).all()
  return c.json({ itens: r.results })
})

async function validarUsuario(db: D1Database, corpo: Record<string, unknown>, parcial: boolean) {
  const erros: string[] = []
  const v: { nome?: string; email?: string; perfil_id?: number; vendedor_id?: number | null; ativo?: number } = {}
  if (!parcial || corpo.nome !== undefined) {
    const nome = String(corpo.nome ?? '').trim()
    if (!nome) erros.push('Nome é obrigatório.')
    else if (nome.length > 120) erros.push('Nome está muito longo.')
    else v.nome = nome
  }
  if (!parcial) {
    const email = String(corpo.email ?? '').trim().toLowerCase()
    if (!emailValido(email)) erros.push('E-mail não parece um e-mail válido.')
    else v.email = email
  }
  if (!parcial || corpo.perfil_id !== undefined) {
    const id = Number(corpo.perfil_id)
    const ok = Number.isInteger(id) && (await db.prepare('SELECT id FROM perfis WHERE id = ?').bind(id).first())
    if (!ok) erros.push('Escolha um perfil.')
    else v.perfil_id = id
  }
  if (corpo.vendedor_id !== undefined) {
    if (corpo.vendedor_id === null || corpo.vendedor_id === '' || corpo.vendedor_id === 0) v.vendedor_id = null
    else {
      const id = Number(corpo.vendedor_id)
      const ok = Number.isInteger(id) && (await db.prepare('SELECT id FROM vendedores WHERE id = ?').bind(id).first())
      if (!ok) erros.push('Vendedor não encontrado.')
      else v.vendedor_id = id
    }
  }
  if (corpo.ativo !== undefined) v.ativo = corpo.ativo === true || corpo.ativo === 1 ? 1 : 0
  return { v, erros }
}

rotas.post('/usuarios', async (c) => {
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const { v, erros } = await validarUsuario(c.env.DB, corpo, false)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  const senha = senhaProvisoria()
  const { hash, salt } = await gerarHashSenha(senha)
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO usuarios (nome, email, senha_hash, senha_salt, perfil_id, vendedor_id, ativo, deve_trocar_senha, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)'
    )
      .bind(v.nome, v.email, hash, salt, v.perfil_id, v.vendedor_id ?? null, Date.now())
      .run()
    await registrar(c.env.DB, c.get('usuario').id, 'usuario.criar', `${v.email} (perfil ${v.perfil_id})`)
    const item = await c.env.DB.prepare(SQL_USUARIO + ' WHERE u.id = ?').bind(Date.now(), r.meta.last_row_id).first()
    return c.json({ item, senha_provisoria: senha }, 201)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um usuário com esse e-mail.' }, 409)
    throw e
  }
})

rotas.put('/usuarios/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const atual = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id, ativo, perfil_id FROM usuarios WHERE id = ?').bind(id).first<{ id: number; ativo: number; perfil_id: number }>() : null
  if (!atual) return c.json({ erro: 'Usuário não encontrado.' }, 404)
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const { v, erros } = await validarUsuario(c.env.DB, corpo, true)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  const eu = c.get('usuario').id
  if (id === eu && (v.ativo === 0 || (v.perfil_id !== undefined && v.perfil_id !== atual.perfil_id))) {
    return c.json({ erro: 'Você não pode desativar nem trocar o perfil do seu próprio usuário.' }, 400)
  }
  // Sempre precisa sobrar pelo menos um administrador ativo.
  const mudaPerfil = v.perfil_id !== undefined && v.perfil_id !== atual.perfil_id
  if (v.ativo === 0 || mudaPerfil) {
    if ((await administradoresAtivos(c.env.DB, id)) < 1) return c.json({ erro: 'O sistema precisa ter pelo menos um administrador ativo.' }, 400)
  }
  const nomes = Object.keys(v)
  if (!nomes.length) return c.json({ erro: 'Nada para alterar.' }, 400)
  await c.env.DB.prepare(`UPDATE usuarios SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
    .bind(...nomes.map((n) => (v as Record<string, unknown>)[n]), id)
    .run()
  if (v.ativo === 0) await c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'equipe' AND usuario_id = ?").bind(id).run()
  await registrar(c.env.DB, eu, 'usuario.editar', `id ${id}: ${nomes.join(', ')}`)
  const item = await c.env.DB.prepare(SQL_USUARIO + ' WHERE u.id = ?').bind(Date.now(), id).first()
  return c.json({ item })
})

rotas.post('/usuarios/:id/redefinir-senha', async (c) => {
  const id = Number(c.req.param('id'))
  const u = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id, email FROM usuarios WHERE id = ?').bind(id).first<{ id: number; email: string }>() : null
  if (!u) return c.json({ erro: 'Usuário não encontrado.' }, 404)
  const senha = senhaProvisoria()
  const { hash, salt } = await gerarHashSenha(senha)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE usuarios SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = 0 WHERE id = ?').bind(hash, salt, id),
    c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'equipe' AND usuario_id = ?").bind(id)
  ])
  await registrar(c.env.DB, c.get('usuario').id, 'usuario.redefinir_senha', u.email)
  return c.json({ senha_provisoria: senha })
})

// ---------- Perfis ----------
rotas.get('/perfis', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT p.id, p.nome, p.descricao, p.permissoes, p.sistema, (SELECT COUNT(*) FROM usuarios u WHERE u.perfil_id = p.id AND u.ativo = 1) AS n_usuarios FROM perfis p ORDER BY p.sistema DESC, p.id'
  ).all<{ id: number; nome: string; descricao: string; permissoes: string; sistema: number; n_usuarios: number }>()
  const itens = (r.results ?? []).map((p) => ({ ...p, permissoes: JSON.parse(p.permissoes) as string[] }))
  return c.json({ itens, permissoes: PERMISSOES.map((chave) => ({ chave, ...ROTULOS_PERMISSOES[chave] })) })
})

function validarPerfil(corpo: Record<string, unknown>, parcial: boolean) {
  const erros: string[] = []
  const v: { nome?: string; descricao?: string; permissoes?: string } = {}
  if (!parcial || corpo.nome !== undefined) {
    const nome = String(corpo.nome ?? '').trim()
    if (!nome) erros.push('Nome do perfil é obrigatório.')
    else if (nome.length > 60) erros.push('Nome do perfil está muito longo.')
    else v.nome = nome
  }
  if (corpo.descricao !== undefined) v.descricao = String(corpo.descricao).trim().slice(0, 300)
  if (!parcial || corpo.permissoes !== undefined) {
    const lista = Array.isArray(corpo.permissoes) ? corpo.permissoes.map(String) : []
    const validas = (PERMISSOES as readonly string[])
    if (lista.some((p) => !validas.includes(p))) erros.push('Há uma permissão que não existe.')
    else v.permissoes = JSON.stringify([...new Set(lista)])
  }
  return { v, erros }
}

rotas.post('/perfis', async (c) => {
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const { v, erros } = validarPerfil(corpo, false)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  try {
    const r = await c.env.DB.prepare('INSERT INTO perfis (nome, descricao, permissoes, sistema) VALUES (?, ?, ?, 0)').bind(v.nome, v.descricao ?? '', v.permissoes).run()
    await registrar(c.env.DB, c.get('usuario').id, 'perfil.criar', v.nome!)
    return c.json({ item: { id: r.meta.last_row_id, nome: v.nome, descricao: v.descricao ?? '', permissoes: JSON.parse(v.permissoes!), sistema: 0, n_usuarios: 0 } }, 201)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um perfil com esse nome.' }, 409)
    throw e
  }
})

rotas.put('/perfis/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const atual = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id, nome, sistema, permissoes FROM perfis WHERE id = ?').bind(id).first<{ id: number; nome: string; sistema: number; permissoes: string }>() : null
  if (!atual) return c.json({ erro: 'Perfil não encontrado.' }, 404)
  if (atual.permissoes.includes('"*"')) return c.json({ erro: 'O perfil Administrador tem acesso total e não pode ser alterado.' }, 400)
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const { v, erros } = validarPerfil(corpo, true)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  if (atual.sistema === 1) delete v.nome // perfis iniciais mantêm o nome
  const nomes = Object.keys(v)
  if (!nomes.length) return c.json({ erro: 'Nada para alterar.' }, 400)
  try {
    await c.env.DB.prepare(`UPDATE perfis SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`).bind(...nomes.map((n) => (v as Record<string, unknown>)[n]), id).run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um perfil com esse nome.' }, 409)
    throw e
  }
  await registrar(c.env.DB, c.get('usuario').id, 'perfil.editar', `${atual.nome}: ${nomes.join(', ')}`)
  const p = await c.env.DB.prepare('SELECT id, nome, descricao, permissoes, sistema FROM perfis WHERE id = ?').bind(id).first<{ permissoes: string }>()
  return c.json({ item: { ...p, permissoes: JSON.parse(p!.permissoes) } })
})

export const rotasEquipe = rotas
