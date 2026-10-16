import { Hono } from 'hono'
import type { Bindings, UsuarioSessao, Variaveis } from '../types'
import { exigirEquipe, temPermissao } from '../auth/sessao'

// Orçamentos recebidos, vistos pela equipe. Quem só tem "ver próprios" enxerga apenas os clientes do seu vendedor.
export const rotasOrcamentos = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

const STATUS = ['Novo', 'Em atendimento', 'Pedido gerado', 'Cancelado']

function escopo(u: UsuarioSessao): { sql: string; args: unknown[] } | null {
  if (temPermissao(u, 'orcamentos.ver_todos')) return { sql: '', args: [] }
  if (temPermissao(u, 'orcamentos.ver_proprios')) return u.vendedor_id ? { sql: ' AND cl.vendedor_id = ?', args: [u.vendedor_id] } : { sql: ' AND 1 = 0', args: [] }
  return null
}

rotasOrcamentos.get('/', exigirEquipe(), async (c) => {
  const e = escopo(c.get('usuario'))
  if (!e) return c.json({ erro: 'Você não tem permissão para isso.' }, 403)
  const status = c.req.query('status') ?? ''
  const q = (c.req.query('q') ?? '').trim()
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const filtros = ["o.status <> 'carrinho'"]
  const args: unknown[] = []
  if (STATUS.includes(status)) { filtros.push('o.status = ?'); args.push(status) }
  if (q) {
    filtros.push('(cl.razao_social LIKE ? OR cl.nome_fantasia LIKE ? OR cl.cnpj LIKE ? OR CAST(o.id AS TEXT) = ?)')
    args.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`, q.replace(/\D/g, ''))
  }
  const onde = filtros.join(' AND ') + e.sql
  const todos = [...args, ...e.args]
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id WHERE ${onde}`).bind(...todos).first<{ n: number }>()
  const r = await c.env.DB.prepare(
    `SELECT o.id, o.status, o.enviado_em, o.total, o.qtd_total, o.tabela_nome, i.nome AS industria, cl.razao_social, cl.nome_fantasia, v.nome AS vendedor, b.nome AS comprador
       FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id JOIN industrias i ON i.id = o.industria_id
       LEFT JOIN vendedores v ON v.id = cl.vendedor_id LEFT JOIN compradores b ON b.id = o.comprador_id
      WHERE ${onde} ORDER BY o.enviado_em DESC LIMIT 50 OFFSET ?`
  ).bind(...todos, (pagina - 1) * 50).all()
  const cont = await c.env.DB.prepare(`SELECT o.status, COUNT(*) AS n FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id WHERE o.status <> 'carrinho'${e.sql} GROUP BY o.status`).bind(...e.args).all<{ status: string; n: number }>()
  return c.json({ itens: r.results, total: total?.n ?? 0, pagina, por_pagina: 50, contagem: Object.fromEntries(cont.results.map((x) => [x.status, x.n])) })
})

rotasOrcamentos.get('/:id', exigirEquipe(), async (c) => {
  const e = escopo(c.get('usuario'))
  if (!e) return c.json({ erro: 'Você não tem permissão para isso.' }, 403)
  const id = Number(c.req.param('id'))
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare(
        `SELECT o.*, i.nome AS industria, cl.razao_social, cl.nome_fantasia, cl.cnpj, cl.inscricao_estadual, cl.endereco, cl.cep, cl.cidade, cl.uf, cl.telefone, cl.whatsapp, cl.email_nfe AS cliente_email,
                v.nome AS vendedor, b.nome AS comprador, b.email AS comprador_email, b.telefone AS comprador_telefone
           FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id JOIN industrias i ON i.id = o.industria_id
           LEFT JOIN vendedores v ON v.id = cl.vendedor_id LEFT JOIN compradores b ON b.id = o.comprador_id
          WHERE o.id = ? AND o.status <> 'carrinho'${e.sql}`
      ).bind(id, ...e.args).first()
    : null
  if (!o) return c.json({ erro: 'Orçamento não encontrado.' }, 404)
  const itens = await c.env.DB.prepare('SELECT item_id AS id, referencia, descricao, codigo_barras, ncm, qtd, preco_unit, ipi, promocao, total_linha FROM orcamento_itens WHERE orcamento_id = ? ORDER BY id').bind(id).all()
  return c.json({ orcamento: o, itens: itens.results })
})

rotasOrcamentos.put('/:id/status', exigirEquipe('orcamentos.atender'), async (c) => {
  const e = escopo(c.get('usuario'))
  if (!e) return c.json({ erro: 'Você não tem permissão para isso.' }, 403)
  const id = Number(c.req.param('id'))
  const { status } = (await c.req.json().catch(() => ({}))) as { status?: string }
  if (!status || !STATUS.includes(status)) return c.json({ erro: 'Situação inválida.' }, 400)
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare(`SELECT o.id, o.status FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id WHERE o.id = ? AND o.status <> 'carrinho'${e.sql}`).bind(id, ...e.args).first<{ id: number; status: string }>()
    : null
  if (!o) return c.json({ erro: 'Orçamento não encontrado.' }, 404)
  await c.env.DB.prepare('UPDATE orcamentos SET status = ?, atualizado_em = ? WHERE id = ?').bind(status, Date.now(), id).run()
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), c.get('usuario').id, 'orcamento.status', `orçamento ${id}: ${o.status} → ${status}`).run()
  return c.json({ ok: true })
})
