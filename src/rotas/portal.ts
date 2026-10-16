import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { conferirSenha, gerarHashSenha } from '../auth/crypto'
import { criarSessaoComprador, encerrarSessaoComprador, exigirComprador, lerCompradorDaSessao } from '../auth/sessao'
import { hojeCuiaba } from '../util/numeros'

// Portal do cliente. Toda rota daqui confere, no servidor, o que o CNPJ da sessão pode ver.
export const rotasPortal = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

const MAX_TENTATIVAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000
const MENSAGEM_ERRO = 'E-mail ou senha incorretos.'
const SAL_FALSO = btoa('\0'.repeat(16))
const HASH_FALSO = btoa('\0'.repeat(32))
const POR_PAGINA = 40

rotasPortal.post('/login', async (c) => {
  const corpo = await c.req.json<{ email?: string; senha?: string }>().catch(() => ({}) as { email?: string; senha?: string })
  const email = (corpo.email ?? '').trim().toLowerCase()
  const senha = corpo.senha ?? ''
  if (!email || !senha) return c.json({ erro: 'Informe e-mail e senha.' }, 400)
  const agora = Date.now()
  const b = await c.env.DB.prepare('SELECT id, senha_hash, senha_salt, ativo, tentativas_falhas, bloqueado_ate FROM compradores WHERE email = ?')
    .bind(email)
    .first<{ id: number; senha_hash: string | null; senha_salt: string | null; ativo: number; tentativas_falhas: number; bloqueado_ate: number }>()
  if (b && b.bloqueado_ate > agora) return c.json({ erro: 'Muitas tentativas erradas. Tente de novo em alguns minutos.' }, 429)
  const confere = await conferirSenha(senha, b?.senha_hash ?? HASH_FALSO, b?.senha_salt ?? SAL_FALSO)
  const cliente = b ? await c.env.DB.prepare('SELECT ativo FROM clientes WHERE id = (SELECT cliente_id FROM compradores WHERE id = ?)').bind(b.id).first<{ ativo: number }>() : null
  if (!b || !b.senha_hash || !b.ativo || !cliente?.ativo || !confere) {
    if (b) {
      const falhas = b.tentativas_falhas + 1
      if (falhas >= MAX_TENTATIVAS) await c.env.DB.prepare('UPDATE compradores SET tentativas_falhas = 0, bloqueado_ate = ? WHERE id = ?').bind(agora + BLOQUEIO_MS, b.id).run()
      else await c.env.DB.prepare('UPDATE compradores SET tentativas_falhas = ? WHERE id = ?').bind(falhas, b.id).run()
    }
    return c.json({ erro: MENSAGEM_ERRO }, 401)
  }
  await c.env.DB.prepare('UPDATE compradores SET tentativas_falhas = 0, bloqueado_ate = 0 WHERE id = ?').bind(b.id).run()
  await criarSessaoComprador(c, b.id)
  const eu = await lerCompradorDaSessaoAposCriar(c, b.id)
  return c.json({ comprador: eu })
})

// Depois de criar a sessão o cookie ainda não está na requisição; lê os dados direto pelo id.
async function lerCompradorDaSessaoAposCriar(c: { env: Bindings }, id: number) {
  const l = await c.env.DB.prepare(
    `SELECT b.id, b.nome, b.email, b.deve_trocar_senha, cl.razao_social, cl.nome_fantasia, cl.ver_precos FROM compradores b JOIN clientes cl ON cl.id = b.cliente_id WHERE b.id = ?`
  ).bind(id).first<{ id: number; nome: string; email: string; deve_trocar_senha: number; razao_social: string; nome_fantasia: string; ver_precos: number }>()
  return l && { id: l.id, nome: l.nome, email: l.email, cliente_nome: l.nome_fantasia || l.razao_social, ver_precos: l.ver_precos === 1, deve_trocar_senha: l.deve_trocar_senha === 1 }
}

rotasPortal.post('/logout', async (c) => {
  await encerrarSessaoComprador(c)
  return c.json({ ok: true })
})

rotasPortal.get('/me', async (c) => {
  const eu = await lerCompradorDaSessao(c)
  if (!eu) return c.json({ erro: 'Sem sessão.' }, 401)
  return c.json({ comprador: eu })
})

rotasPortal.post('/trocar-senha', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const corpo = await c.req.json<{ senha_atual?: string; senha_nova?: string }>().catch(() => ({}) as { senha_atual?: string; senha_nova?: string })
  const atual = corpo.senha_atual ?? ''
  const nova = corpo.senha_nova ?? ''
  if (nova.length < 10) return c.json({ erro: 'A senha nova precisa ter pelo menos 10 caracteres.' }, 400)
  if (nova === atual) return c.json({ erro: 'A senha nova precisa ser diferente da atual.' }, 400)
  const b = await c.env.DB.prepare('SELECT senha_hash, senha_salt FROM compradores WHERE id = ?').bind(eu.id).first<{ senha_hash: string; senha_salt: string }>()
  if (!b || !(await conferirSenha(atual, b.senha_hash, b.senha_salt))) return c.json({ erro: 'A senha atual está incorreta.' }, 400)
  const { hash, salt } = await gerarHashSenha(nova)
  await c.env.DB.prepare('UPDATE compradores SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0 WHERE id = ?').bind(hash, salt, eu.id).run()
  await c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'comprador' AND usuario_id = ?").bind(eu.id).run()
  await criarSessaoComprador(c, eu.id)
  return c.json({ ok: true })
})

// Indústrias e tabelas liberadas para o CNPJ do comprador, com logo, banners e se o cliente já compra
rotasPortal.get('/catalogo', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const hoje = hojeCuiaba()
  const r = await c.env.DB.prepare(
    `SELECT i.id AS industria_id, i.nome AS industria, i.tipo_frete, i.pedido_minimo, i.informacoes, i.tabela_padrao_id, (i.logo_chave <> '') AS tem_logo,
            t.id AS tabela_id, t.nome, t.tipo, t.prazo, t.vencimento,
            EXISTS (SELECT 1 FROM cliente_industrias_compra k WHERE k.cliente_id = l.cliente_id AND k.industria_id = i.id) AS compra
       FROM liberacoes l
       JOIN tabelas_preco t ON t.id = l.tabela_id AND t.ativo = 1
       JOIN industrias i ON i.id = t.industria_id AND i.ativo = 1
      WHERE l.cliente_id = ?
      ORDER BY i.nome COLLATE NOCASE, t.nome COLLATE NOCASE`
  ).bind(eu.cliente_id).all<Record<string, unknown>>()
  const mapa = new Map<number, Record<string, unknown> & { tabelas: unknown[] }>()
  for (const l of r.results) {
    const id = l.industria_id as number
    if (!mapa.has(id)) mapa.set(id, { id, nome: l.industria, tipo_frete: l.tipo_frete, pedido_minimo: eu.ver_precos ? l.pedido_minimo : null, informacoes: l.informacoes, tem_logo: !!l.tem_logo, compra: !!l.compra, tabelas: [] })
    const venc = (l.vencimento as string) || ''
    mapa.get(id)!.tabelas.push({ id: l.tabela_id, nome: l.nome, tipo: l.tipo, prazo: l.prazo, vencimento: venc, vencida: !!venc && venc < hoje, padrao: l.tabela_padrao_id === l.tabela_id })
  }
  const ids = [...mapa.keys()]
  let banners: { id: number; industria_id: number }[] = []
  if (ids.length) {
    const b = await c.env.DB.prepare(`SELECT id, industria_id FROM banners WHERE industria_id IN (${ids.map(() => '?').join(',')}) ORDER BY industria_id, id`).bind(...ids).all<{ id: number; industria_id: number }>()
    banners = b.results
  }
  return c.json({ ver_precos: eu.ver_precos, industrias: [...mapa.values()], banners })
})

// A indústria só é entregue (logo/banner) se estiver liberada para o CNPJ
async function industriaLiberada(c: { env: Bindings }, clienteId: number, industriaId: number) {
  return c.env.DB.prepare(
    `SELECT 1 AS ok FROM liberacoes l JOIN tabelas_preco t ON t.id = l.tabela_id AND t.ativo = 1 JOIN industrias i ON i.id = t.industria_id AND i.ativo = 1 WHERE l.cliente_id = ? AND i.id = ? LIMIT 1`
  ).bind(clienteId, industriaId).first()
}

rotasPortal.get('/logo/:id', exigirComprador(), async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await industriaLiberada(c, c.get('comprador').cliente_id, id))) return c.json({ erro: 'Não encontrada.' }, 404)
  const i = await c.env.DB.prepare('SELECT logo_chave, logo_tipo FROM industrias WHERE id = ?').bind(id).first<{ logo_chave: string; logo_tipo: string }>()
  const o = i?.logo_chave ? await c.env.ARQUIVOS.get(i.logo_chave) : null
  if (!i || !o) return c.json({ erro: 'Não encontrada.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': i.logo_tipo, 'Cache-Control': 'private, max-age=600' } })
})

rotasPortal.get('/banner/:id', exigirComprador(), async (c) => {
  const b = await c.env.DB.prepare('SELECT industria_id, chave, tipo_conteudo FROM banners WHERE id = ?').bind(Number(c.req.param('id'))).first<{ industria_id: number; chave: string; tipo_conteudo: string }>()
  if (!b || !(await industriaLiberada(c, c.get('comprador').cliente_id, b.industria_id))) return c.json({ erro: 'Não encontrado.' }, 404)
  const o = await c.env.ARQUIVOS.get(b.chave)
  if (!o) return c.json({ erro: 'Não encontrado.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': b.tipo_conteudo, 'Cache-Control': 'private, max-age=600' } })
})

// Busca em todas as indústrias liberadas (cada item vem com a indústria e a tabela onde abrir)
rotasPortal.get('/busca', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const q = (c.req.query('q') ?? '').trim().slice(0, 60)
  const limite = Math.min(60, Math.max(1, Number(c.req.query('limite')) || 10))
  const palavras = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  if (!palavras.length || palavras.join('').length < 2) return c.json({ itens: [] })
  const match = palavras.slice(0, 6).map((p) => `"${p}"*`).join(' ')
  const r = await c.env.DB.prepare(
    `SELECT it.id, it.referencia, it.descricao, i.id AS industria_id, i.nome AS industria, MIN(p.tabela_id) AS tabela_id,
            (SELECT f.id FROM fotos f WHERE f.item_id = it.id ORDER BY f.posicao LIMIT 1) AS foto_id
       FROM itens_busca
       JOIN itens it ON it.id = itens_busca.rowid
       JOIN precos p ON p.item_id = it.id
       JOIN liberacoes l ON l.tabela_id = p.tabela_id AND l.cliente_id = ?
       JOIN tabelas_preco t ON t.id = p.tabela_id AND t.ativo = 1
       JOIN industrias i ON i.id = t.industria_id AND i.ativo = 1
      WHERE itens_busca MATCH ? AND ${ITEM_VISIVEL}
      GROUP BY it.id
      ORDER BY i.nome COLLATE NOCASE, it.descricao COLLATE NOCASE
      LIMIT ?`
  ).bind(eu.cliente_id, match, limite).all()
  return c.json({ itens: r.results })
})

// Confere se a tabela está liberada para o CNPJ e devolve dados da tabela e da indústria
async function tabelaLiberada(c: { env: Bindings }, clienteId: number, tabelaId: number) {
  if (!Number.isInteger(tabelaId) || tabelaId <= 0) return null
  return c.env.DB.prepare(
    `SELECT t.id, t.nome, t.tipo, t.prazo, t.vencimento, i.id AS industria_id, i.nome AS industria, i.calcular_ipi
       FROM liberacoes l JOIN tabelas_preco t ON t.id = l.tabela_id AND t.ativo = 1 JOIN industrias i ON i.id = t.industria_id AND i.ativo = 1
      WHERE l.cliente_id = ? AND l.tabela_id = ?`
  ).bind(clienteId, tabelaId).first<{ id: number; nome: string; tipo: string; prazo: string; vencimento: string; industria_id: number; industria: string; calcular_ipi: number }>()
}

// Só aparece item ativo que tenha preço ou promoção na tabela
const ITEM_VISIVEL = `it.ativo = 1 AND ((p.preco IS NOT NULL AND p.preco > 0) OR (p.preco_promocional IS NOT NULL AND p.preco_promocional > 0))`

rotasPortal.get('/tabelas/:id/categorias', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('id')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const r = await c.env.DB.prepare(`SELECT DISTINCT it.categoria FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? AND ${ITEM_VISIVEL} AND it.categoria <> '' ORDER BY it.categoria COLLATE NOCASE`).bind(t.id).all<{ categoria: string }>()
  return c.json({ categorias: r.results.map((x) => x.categoria) })
})

function montarItem(l: Record<string, unknown>, verPrecos: boolean, calcularIpi: boolean) {
  const item: Record<string, unknown> = {
    id: l.id, referencia: l.referencia, descricao: l.descricao, categoria: l.categoria, marca: l.marca, medida: l.medida, cor: l.cor,
    qtd_caixa: l.qtd_caixa, qtd_minima: l.qtd_minima, nao_abre_caixa: !!l.nao_abre_caixa, novo: !!l.novo, observacao: l.observacao,
    promocao: !!(l.preco_promocional as number | null) && (l.preco_promocional as number) > 0, n_fotos: l.n_fotos, foto_id: l.foto_id
  }
  if (verPrecos) {
    const promo = item.promocao as boolean
    item.preco = promo ? l.preco_promocional : l.preco
    item.preco_original = promo && l.preco && (l.preco as number) > 0 ? l.preco : null
    item.ipi = calcularIpi ? l.ipi : 0
  }
  return item
}

const CAMPOS_ITEM = `it.id, it.referencia, it.descricao, it.categoria, it.marca, it.medida, it.cor, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa,
       p.preco, p.preco_promocional, p.ipi, p.novo, p.observacao,
       (SELECT COUNT(*) FROM fotos f WHERE f.item_id = it.id) AS n_fotos,
       (SELECT f.id FROM fotos f WHERE f.item_id = it.id ORDER BY f.posicao LIMIT 1) AS foto_id`

rotasPortal.get('/tabelas/:id/itens', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('id')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const filtros = ['p.tabela_id = ?', ITEM_VISIVEL]
  const args: unknown[] = [t.id]
  const busca = (c.req.query('busca') ?? '').trim()
  if (busca) {
    filtros.push('(it.referencia LIKE ? OR it.descricao LIKE ? OR it.codigo_barras LIKE ?)')
    args.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
  }
  const categoria = (c.req.query('categoria') ?? '').trim()
  if (categoria) { filtros.push('it.categoria = ?'); args.push(categoria) }
  if (c.req.query('novos') === '1') filtros.push('p.novo = 1')
  if (c.req.query('promocao') === '1') filtros.push('p.preco_promocional IS NOT NULL AND p.preco_promocional > 0')
  const onde = filtros.join(' AND ')
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM precos p JOIN itens it ON it.id = p.item_id WHERE ${onde}`).bind(...args).first<{ n: number }>()
  const r = await c.env.DB.prepare(`SELECT ${CAMPOS_ITEM} FROM precos p JOIN itens it ON it.id = p.item_id WHERE ${onde} ORDER BY p.novo DESC, it.referencia COLLATE NOCASE LIMIT ? OFFSET ?`)
    .bind(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA).all<Record<string, unknown>>()
  return c.json({
    tabela: { id: t.id, nome: t.nome, tipo: t.tipo, prazo: t.prazo, vencimento: t.vencimento, industria: t.industria },
    itens: r.results.map((l) => montarItem(l, eu.ver_precos, !!t.calcular_ipi)),
    total: total?.n ?? 0, pagina, por_pagina: POR_PAGINA
  })
})

rotasPortal.get('/tabelas/:id/itens/:itemId', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('id')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const l = await c.env.DB.prepare(`SELECT ${CAMPOS_ITEM} FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? AND it.id = ? AND ${ITEM_VISIVEL}`).bind(t.id, Number(c.req.param('itemId'))).first<Record<string, unknown>>()
  if (!l) return c.json({ erro: 'Item não encontrado.' }, 404)
  const fotos = await c.env.DB.prepare('SELECT id, posicao FROM fotos WHERE item_id = ? ORDER BY posicao').bind(l.id).all()
  return c.json({ item: montarItem(l, eu.ver_precos, !!t.calcular_ipi), fotos: fotos.results })
})

// Foto: só entrega se o item estiver visível em alguma tabela liberada para este CNPJ
rotasPortal.get('/foto/:id', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const f = await c.env.DB.prepare(
    `SELECT f.chave, f.tipo_conteudo FROM fotos f
       JOIN itens it ON it.id = f.item_id
       JOIN precos p ON p.item_id = it.id
       JOIN liberacoes l ON l.tabela_id = p.tabela_id AND l.cliente_id = ?
       JOIN tabelas_preco t ON t.id = p.tabela_id AND t.ativo = 1
      WHERE f.id = ? AND ${ITEM_VISIVEL} LIMIT 1`
  ).bind(eu.cliente_id, Number(c.req.param('id'))).first<{ chave: string; tipo_conteudo: string }>()
  if (!f) return c.json({ erro: 'Foto não encontrada.' }, 404)
  const o = await c.env.ARQUIVOS.get(f.chave)
  if (!o) return c.json({ erro: 'Foto não encontrada.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': f.tipo_conteudo, 'Cache-Control': 'private, max-age=3600' } })
})
