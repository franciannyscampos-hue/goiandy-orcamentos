import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'

// Liberação por cliente: quais tabelas de preço (e, por consequência, quais indústrias) cada CNPJ enxerga.
export const rotasLiberacoes = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [])
const pedacos = <T,>(lista: T[], n: number) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n))

async function registrar(db: D1Database, usuarioId: number, acao: string, detalhe: string) {
  await db.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), usuarioId, acao, detalhe).run()
}

// Lista enxuta de clientes para a tela de liberação por tabela
rotasLiberacoes.get('/clientes', exigirEquipe('clientes.ver'), async (c) => {
  const r = await c.env.DB.prepare('SELECT id, cnpj, razao_social, nome_fantasia, cidade, uf, ativo FROM clientes ORDER BY ativo DESC, razao_social COLLATE NOCASE').all()
  return c.json({ itens: r.results })
})

// Tudo que o cliente pode ter liberado: indústrias ativas com suas tabelas ativas, marcando as liberadas
rotasLiberacoes.get('/cliente/:id', exigirEquipe('clientes.ver'), async (c) => {
  const id = Number(c.req.param('id'))
  const cli = await c.env.DB.prepare('SELECT id, ver_precos FROM clientes WHERE id = ?').bind(id).first<{ id: number; ver_precos: number }>()
  if (!cli) return c.json({ erro: 'Cliente não encontrado.' }, 404)
  const r = await c.env.DB.prepare(
    `SELECT i.id AS industria_id, i.nome AS industria, t.id AS tabela_id, t.nome, t.tipo, t.prazo, t.vencimento, t.ativo,
            (i.tabela_padrao_id = t.id) AS padrao,
            EXISTS (SELECT 1 FROM liberacoes l WHERE l.cliente_id = ? AND l.tabela_id = t.id) AS liberada
       FROM tabelas_preco t JOIN industrias i ON i.id = t.industria_id
      WHERE i.ativo = 1 AND (t.ativo = 1 OR EXISTS (SELECT 1 FROM liberacoes l WHERE l.cliente_id = ? AND l.tabela_id = t.id))
      ORDER BY i.nome COLLATE NOCASE, t.nome COLLATE NOCASE`
  ).bind(id, id).all<Record<string, unknown>>()
  const mapa = new Map<number, { id: number; nome: string; tabelas: unknown[] }>()
  for (const l of r.results) {
    const iid = l.industria_id as number
    if (!mapa.has(iid)) mapa.set(iid, { id: iid, nome: l.industria as string, tabelas: [] })
    mapa.get(iid)!.tabelas.push({ id: l.tabela_id, nome: l.nome, tipo: l.tipo, prazo: l.prazo, vencimento: l.vencimento, ativo: !!l.ativo, padrao: !!l.padrao, liberada: !!l.liberada })
  }
  return c.json({ ver_precos: !!cli.ver_precos, industrias: [...mapa.values()] })
})

// Define de uma vez as tabelas liberadas do cliente
rotasLiberacoes.put('/cliente/:id', exigirEquipe('clientes.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await c.env.DB.prepare('SELECT id FROM clientes WHERE id = ?').bind(id).first())) return c.json({ erro: 'Cliente não encontrado.' }, 404)
  const b = (await c.req.json().catch(() => ({}))) as { tabelas?: unknown }
  const tabelas = ids(b.tabelas)
  if (tabelas.length > 2000) return c.json({ erro: 'Tabelas demais de uma vez.' }, 400)
  const agora = Date.now()
  const comandos = [c.env.DB.prepare('DELETE FROM liberacoes WHERE cliente_id = ?').bind(id)]
  for (const grupo of pedacos(tabelas, 90)) {
    comandos.push(
      c.env.DB.prepare(`INSERT OR IGNORE INTO liberacoes (cliente_id, tabela_id, criado_em) SELECT ?, id, ? FROM tabelas_preco WHERE id IN (${grupo.map(() => '?').join(',')})`).bind(id, agora, ...grupo)
    )
  }
  for (const lote of pedacos(comandos, 100)) await c.env.DB.batch(lote)
  await registrar(c.env.DB, c.get('usuario').id, 'liberacao.cliente', `cliente ${id}: ${tabelas.length} tabela(s)`)
  return c.json({ ok: true, total: tabelas.length })
})

// Visão por tabela: quais clientes têm esta tabela liberada
rotasLiberacoes.get('/tabela/:id', exigirEquipe('clientes.ver'), async (c) => {
  const id = Number(c.req.param('id'))
  const t = await c.env.DB.prepare('SELECT t.id, t.nome, i.nome AS industria FROM tabelas_preco t JOIN industrias i ON i.id = t.industria_id WHERE t.id = ?').bind(id).first()
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const r = await c.env.DB.prepare('SELECT cliente_id FROM liberacoes WHERE tabela_id = ?').bind(id).all<{ cliente_id: number }>()
  return c.json({ tabela: t, clientes: r.results.map((x) => x.cliente_id) })
})

// Libera/retira a tabela para vários clientes de uma vez
rotasLiberacoes.put('/tabela/:id', exigirEquipe('clientes.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await c.env.DB.prepare('SELECT id FROM tabelas_preco WHERE id = ?').bind(id).first())) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const b = (await c.req.json().catch(() => ({}))) as { adicionar?: unknown; remover?: unknown }
  const add = ids(b.adicionar)
  const rem = ids(b.remover)
  if (add.length + rem.length > 9000) return c.json({ erro: 'Clientes demais de uma vez.' }, 400)
  const agora = Date.now()
  const comandos = []
  for (const g of pedacos(add, 90)) comandos.push(c.env.DB.prepare(`INSERT OR IGNORE INTO liberacoes (cliente_id, tabela_id, criado_em) SELECT id, ?, ? FROM clientes WHERE id IN (${g.map(() => '?').join(',')})`).bind(id, agora, ...g))
  for (const g of pedacos(rem, 90)) comandos.push(c.env.DB.prepare(`DELETE FROM liberacoes WHERE tabela_id = ? AND cliente_id IN (${g.map(() => '?').join(',')})`).bind(id, ...g))
  for (const lote of pedacos(comandos, 100)) await c.env.DB.batch(lote)
  await registrar(c.env.DB, c.get('usuario').id, 'liberacao.tabela', `tabela ${id}: +${add.length} -${rem.length}`)
  return c.json({ ok: true })
})
