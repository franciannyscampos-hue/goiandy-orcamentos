import { calcularLinha, passoQtd, precoUnitario } from '../util/calculo'
import { ITEM_VISIVEL } from './portal-comum'
import { arredondar2 } from '../util/numeros'
import { Hono, type Context } from 'hono'
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

type OrcBasico = { id: number; status: string; tabela_id: number; ver_precos: number; calcular_ipi: number }
async function orcamentoEditavel(c: Context<{ Bindings: Bindings; Variables: Variaveis }>, id: number): Promise<OrcBasico | null> {
  const e = escopo(c.get('usuario'))
  if (!e || !Number.isInteger(id)) return null
  return c.env.DB.prepare(
    `SELECT o.id, o.status, o.tabela_id, o.ver_precos, o.calcular_ipi FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id WHERE o.id = ? AND o.status IN ('Novo','Em atendimento')${e.sql}`
  ).bind(id, ...e.args).first<OrcBasico>()
}

// Libera (ou bloqueia) o cliente para editar o orçamento enviado
rotasOrcamentos.put('/:id/liberar-edicao', exigirEquipe('orcamentos.atender'), async (c) => {
  const o = await orcamentoEditavel(c, Number(c.req.param('id')))
  if (!o) return c.json({ erro: 'Orçamento não encontrado ou já fechado (só Novo ou Em atendimento podem ser editados).' }, 404)
  const { liberar } = (await c.req.json().catch(() => ({}))) as { liberar?: boolean }
  await c.env.DB.prepare('UPDATE orcamentos SET edicao_liberada = ?, atualizado_em = ? WHERE id = ?').bind(liberar ? 1 : 0, Date.now(), o.id).run()
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), c.get('usuario').id, 'orcamento.liberar_edicao', `orçamento ${o.id}: ${liberar ? 'liberada' : 'bloqueada'}`).run()
  return c.json({ ok: true })
})

// Busca produtos da tabela do orçamento (para acrescentar itens)
rotasOrcamentos.get('/:id/buscar-item', exigirEquipe('orcamentos.atender'), async (c) => {
  const o = await orcamentoEditavel(c, Number(c.req.param('id')))
  if (!o) return c.json({ erro: 'Orçamento não encontrado ou já fechado.' }, 404)
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ itens: [] })
  const r = await c.env.DB.prepare(
    `SELECT it.id, it.referencia, it.descricao, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa FROM precos p JOIN itens it ON it.id = p.item_id
      WHERE p.tabela_id = ? AND ${ITEM_VISIVEL} AND (it.referencia LIKE ? OR it.descricao LIKE ? OR it.codigo_barras LIKE ?) ORDER BY it.referencia LIMIT 10`
  ).bind(o.tabela_id, `%${q}%`, `%${q}%`, `%${q}%`).all<{ id: number; referencia: string; descricao: string; qtd_caixa: number; qtd_minima: number; nao_abre_caixa: number }>()
  return c.json({ itens: r.results.map((x) => ({ id: x.id, referencia: x.referencia, descricao: x.descricao, passo: passoQtd({ qtd_caixa: Number(x.qtd_caixa), qtd_minima: Number(x.qtd_minima), nao_abre_caixa: !!x.nao_abre_caixa }) })) })
})

// A equipe edita os itens do orçamento enviado. Linhas que já existiam mantêm o preço do envio; linhas novas entram com o preço atual da tabela.
rotasOrcamentos.put('/:id/itens', exigirEquipe('orcamentos.atender'), async (c) => {
  const o = await orcamentoEditavel(c, Number(c.req.param('id')))
  if (!o) return c.json({ erro: 'Orçamento não encontrado ou já fechado (só Novo ou Em atendimento podem ser editados).' }, 404)
  const corpo = (await c.req.json().catch(() => ({}))) as { itens?: { item_id?: number; qtd?: number }[]; transportadora_texto?: string; observacao_cliente?: string }
  const lista = Array.isArray(corpo.itens) ? corpo.itens : []
  const vistos = new Set<number>()
  const final: { item_id: number; qtd: number }[] = []
  for (const l of lista) {
    const item_id = Number(l.item_id), qtd = Number(l.qtd)
    if (!Number.isInteger(item_id) || vistos.has(item_id)) return c.json({ erro: 'Lista de itens inválida.' }, 400)
    if (!Number.isInteger(qtd) || qtd < 0) return c.json({ erro: 'Quantidade inválida.' }, 400)
    vistos.add(item_id)
    if (qtd > 0) final.push({ item_id, qtd })
  }
  if (!final.length) return c.json({ erro: 'O orçamento precisa ter pelo menos um item.' }, 400)
  const atuais = await c.env.DB.prepare('SELECT item_id, preco_unit, ipi FROM orcamento_itens WHERE orcamento_id = ?').bind(o.id).all<{ item_id: number; preco_unit: number | null; ipi: number }>()
  const mapa = new Map(atuais.results.map((x) => [x.item_id, x]))
  const cmds: D1PreparedStatement[] = []
  const manter = new Set(final.map((f) => f.item_id))
  for (const a of atuais.results) if (!manter.has(a.item_id)) cmds.push(c.env.DB.prepare('DELETE FROM orcamento_itens WHERE orcamento_id = ? AND item_id = ?').bind(o.id, a.item_id))
  let subtotal = 0, ipiTotal = 0, qtdTotal = 0
  for (const f of final) {
    const ex = mapa.get(f.item_id)
    if (ex) {
      const calc = calcularLinha(f.qtd, ex.preco_unit ?? 0, ex.ipi)
      cmds.push(c.env.DB.prepare('UPDATE orcamento_itens SET qtd = ?, total_linha = ? WHERE orcamento_id = ? AND item_id = ?').bind(f.qtd, calc.total, o.id, f.item_id))
      subtotal += calc.total; ipiTotal += calc.ipi
    } else {
      const d = await c.env.DB.prepare(
        `SELECT it.id, it.referencia, it.descricao, it.codigo_barras, it.ncm, p.preco, p.preco_promocional, p.ipi FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? AND it.id = ? AND ${ITEM_VISIVEL}`
      ).bind(o.tabela_id, f.item_id).first<{ id: number; referencia: string; descricao: string; codigo_barras: string; ncm: string; preco: number | null; preco_promocional: number | null; ipi: number | null }>()
      if (!d) return c.json({ erro: 'Um dos produtos não está disponível nesta tabela.' }, 400)
      const unit = precoUnitario(d)!
      const ipi = o.calcular_ipi ? d.ipi ?? 0 : 0
      const calc = calcularLinha(f.qtd, unit, ipi)
      cmds.push(c.env.DB.prepare('INSERT INTO orcamento_itens (orcamento_id, item_id, qtd, referencia, descricao, codigo_barras, ncm, preco_unit, ipi, promocao, total_linha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(o.id, d.id, f.qtd, d.referencia, d.descricao, d.codigo_barras, d.ncm, unit, ipi, d.preco_promocional && d.preco_promocional > 0 ? 1 : 0, calc.total))
      subtotal += calc.total; ipiTotal += calc.ipi
    }
    qtdTotal += f.qtd
  }
  const transp = corpo.transportadora_texto === undefined ? null : String(corpo.transportadora_texto).trim().slice(0, 200)
  const obs = corpo.observacao_cliente === undefined ? null : String(corpo.observacao_cliente).trim().slice(0, 1500)
  cmds.push(c.env.DB.prepare(
    `UPDATE orcamentos SET subtotal = ?, ipi_total = ?, total = ?, qtd_total = ?, transportadora_texto = COALESCE(?, transportadora_texto), observacao_cliente = COALESCE(?, observacao_cliente), atualizado_em = ? WHERE id = ?`
  ).bind(arredondar2(subtotal), arredondar2(ipiTotal), arredondar2(subtotal + ipiTotal), qtdTotal, transp, obs, Date.now(), o.id))
  for (let k = 0; k < cmds.length; k += 100) await c.env.DB.batch(cmds.slice(k, k + 100))
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), c.get('usuario').id, 'orcamento.editar', `orçamento ${o.id}: itens editados pela equipe`).run()
  return c.json({ ok: true })
})
