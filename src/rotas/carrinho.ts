import { Hono } from 'hono'
import type { Bindings, CompradorSessao, Variaveis } from '../types'
import { exigirComprador } from '../auth/sessao'
import { arredondar2, lerNumero } from '../util/numeros'
import { calcularLinha, mensagemQtd, passoQtd, precoUnitario, qtdValida } from '../util/calculo'
import { ITEM_VISIVEL, tabelaLiberada } from './portal-comum'
import { enviarEmailsOrcamento } from '../util/email-orcamento'
import { fotografar, registrarHistorico, type Ator } from '../util/historico'

const atorDe = (eu: CompradorSessao): Ator => ({ tipo: 'comprador', id: eu.id, nome: `${eu.nome} (${eu.cliente_nome})` })

const reais = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Carrinho e orçamentos do comprador. O carrinho é sempre de UMA tabela de preço (nunca mistura indústrias).
export const rotasCarrinho = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

type Tabela = NonNullable<Awaited<ReturnType<typeof tabelaLiberada>>>

async function acharCarrinho(c: { env: Bindings }, compradorId: number, tabelaId: number): Promise<number | null> {
  const r = await c.env.DB.prepare("SELECT id FROM orcamentos WHERE comprador_id = ? AND tabela_id = ? AND status = 'carrinho'").bind(compradorId, tabelaId).first<{ id: number }>()
  return r?.id ?? null
}

async function garantirCarrinho(c: { env: Bindings }, eu: CompradorSessao, t: Tabela): Promise<number> {
  const existente = await acharCarrinho(c, eu.id, t.id)
  if (existente) return existente
  const agora = Date.now()
  await c.env.DB.prepare("INSERT OR IGNORE INTO orcamentos (cliente_id, comprador_id, industria_id, tabela_id, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'carrinho', ?, ?)")
    .bind(eu.cliente_id, eu.id, t.industria_id, t.id, agora, agora).run()
  return (await acharCarrinho(c, eu.id, t.id))!
}

type LinhaCarrinho = {
  item_id: number; qtd: number; referencia: string; descricao: string; codigo_barras: string; ncm: string
  qtd_caixa: number; qtd_minima: number; nao_abre_caixa: number; ativo: number
  preco: number | null; preco_promocional: number | null; ipi: number | null; foto_id: number | null
}

// Monta o carrinho com os preços de agora. Item que saiu da tabela aparece como indisponível e fica fora da conta.
async function visaoCarrinho(c: { env: Bindings }, cartId: number | null, t: Tabela, verPrecos: boolean) {
  const linhas = cartId
    ? (await c.env.DB.prepare(
        `SELECT oi.item_id, oi.qtd, it.referencia, it.descricao, it.codigo_barras, it.ncm, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa, it.ativo,
                p.preco, p.preco_promocional, p.ipi,
                (SELECT f.id FROM fotos f WHERE f.item_id = it.id ORDER BY f.posicao LIMIT 1) AS foto_id
           FROM orcamento_itens oi JOIN itens it ON it.id = oi.item_id
           LEFT JOIN precos p ON p.tabela_id = ? AND p.item_id = oi.item_id
          WHERE oi.orcamento_id = ? ORDER BY oi.id`
      ).bind(t.id, cartId).all<LinhaCarrinho>()).results
    : []
  let subtotal = 0
  let ipiTotal = 0
  let qtdTotal = 0
  let disponiveis = 0
  const itens = linhas.map((l) => {
    const unit = l.ativo ? precoUnitario(l) : null
    const disponivel = unit !== null
    const ipiPerc = t.calcular_ipi ? l.ipi ?? 0 : 0
    const calc = disponivel ? calcularLinha(l.qtd, unit!, ipiPerc) : { total: 0, ipi: 0 }
    if (disponivel) { subtotal += calc.total; ipiTotal += calc.ipi; qtdTotal += l.qtd; disponiveis++ }
    const promocao = !!l.preco_promocional && l.preco_promocional > 0
    const item: Record<string, unknown> = {
      id: l.item_id, referencia: l.referencia, descricao: l.descricao, qtd: l.qtd, qtd_caixa: l.qtd_caixa, qtd_minima: l.qtd_minima,
      nao_abre_caixa: !!l.nao_abre_caixa, passo: passoQtd(l), disponivel, promocao, foto_id: l.foto_id
    }
    if (verPrecos && disponivel) { item.preco = unit; item.ipi = ipiPerc; item.total = calc.total }
    return item
  })
  const resumo: Record<string, unknown> = { n_linhas: itens.length, n_disponiveis: disponiveis, qtd_total: qtdTotal }
  if (verPrecos) {
    resumo.subtotal = arredondar2(subtotal); resumo.ipi_total = arredondar2(ipiTotal); resumo.total = arredondar2(subtotal + ipiTotal)
    resumo.pedido_minimo = t.pedido_minimo
    resumo.faltam = t.pedido_minimo > 0 && subtotal < t.pedido_minimo ? arredondar2(t.pedido_minimo - subtotal) : 0
  }
  return { itens, resumo, _numeros: { subtotal: arredondar2(subtotal), ipiTotal: arredondar2(ipiTotal), qtdTotal, disponiveis } }
}

const publico = <T extends { _numeros?: unknown }>(v: T) => { const { _numeros, ...resto } = v; void _numeros; return resto }

function dadosTabela(t: Tabela) {
  return { id: t.id, nome: t.nome, tipo: t.tipo, prazo: t.prazo, vencimento: t.vencimento, industria_id: t.industria_id, industria: t.industria, tipo_frete: t.tipo_frete }
}

// Lista de carrinhos abertos (um por tabela) com o total aproximado de cada um
rotasCarrinho.get('/carrinhos', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const r = await c.env.DB.prepare(
    `SELECT o.id, o.tabela_id, t.nome AS tabela, t.tipo, t.prazo, i.id AS industria_id, i.nome AS industria, (i.logo_chave <> '') AS tem_logo,
            COUNT(oi.id) AS n_linhas,
            COALESCE(SUM(oi.qtd * CASE WHEN p.preco_promocional > 0 THEN p.preco_promocional ELSE p.preco END), 0) AS subtotal
       FROM orcamentos o
       JOIN tabelas_preco t ON t.id = o.tabela_id
       JOIN industrias i ON i.id = o.industria_id
       JOIN liberacoes l ON l.cliente_id = o.cliente_id AND l.tabela_id = o.tabela_id
       JOIN orcamento_itens oi ON oi.orcamento_id = o.id
       LEFT JOIN precos p ON p.tabela_id = o.tabela_id AND p.item_id = oi.item_id
      WHERE o.comprador_id = ? AND o.status = 'carrinho' AND t.ativo = 1 AND i.ativo = 1
      GROUP BY o.id ORDER BY MAX(o.atualizado_em) DESC`
  ).bind(eu.id).all<Record<string, unknown>>()
  return c.json({ carrinhos: r.results.map((x) => ({ ...x, subtotal: eu.ver_precos ? arredondar2(Number(x.subtotal)) : undefined })) })
})

rotasCarrinho.get('/carrinho/:tabelaId', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('tabelaId')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const cartId = await acharCarrinho(c, eu.id, t.id)
  const v = publico(await visaoCarrinho(c, cartId, t, eu.ver_precos))
  const env = cartId ? await c.env.DB.prepare('SELECT enviado_em FROM orcamentos WHERE id = ?').bind(cartId).first<{ enviado_em: number }>() : null
  return c.json({ tabela: dadosTabela(t), ver_precos: eu.ver_precos, reaberto: env && env.enviado_em > 0 ? cartId : null, ...v })
})

// Define a quantidade de um item (0 tira do carrinho)
rotasCarrinho.put('/carrinho/:tabelaId/itens/:itemId', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('tabelaId')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const corpo = (await c.req.json().catch(() => ({}))) as { qtd?: unknown }
  const qtd = lerNumero(corpo.qtd)
  if (qtd === null || Number.isNaN(qtd) || qtd < 0) return c.json({ erro: 'Quantidade inválida.' }, 400)
  const itemId = Number(c.req.param('itemId'))
  const item = await c.env.DB.prepare(
    `SELECT it.id, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? AND it.id = ? AND ${ITEM_VISIVEL}`
  ).bind(t.id, itemId).first<{ id: number; qtd_caixa: number; qtd_minima: number; nao_abre_caixa: number }>()
  if (!item) return c.json({ erro: 'Este produto não está disponível nesta tabela.' }, 404)
  if (qtd === 0) {
    const cartId = await acharCarrinho(c, eu.id, t.id)
    if (cartId) {
      await c.env.DB.prepare('DELETE FROM orcamento_itens WHERE orcamento_id = ? AND item_id = ?').bind(cartId, itemId).run()
      await c.env.DB.prepare('UPDATE orcamentos SET atualizado_em = ? WHERE id = ?').bind(Date.now(), cartId).run()
    }
  } else {
    if (!qtdValida(item, qtd)) return c.json({ erro: mensagemQtd(item), passo: passoQtd(item) }, 400)
    const cartId = await garantirCarrinho(c, eu, t)
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO orcamento_itens (orcamento_id, item_id, qtd) VALUES (?, ?, ?) ON CONFLICT(orcamento_id, item_id) DO UPDATE SET qtd = excluded.qtd').bind(cartId, itemId, qtd),
      c.env.DB.prepare('UPDATE orcamentos SET atualizado_em = ? WHERE id = ?').bind(Date.now(), cartId)
    ])
  }
  const cartId = await acharCarrinho(c, eu.id, t.id)
  const v = publico(await visaoCarrinho(c, cartId, t, eu.ver_precos))
  return c.json({ ok: true, qtd, resumo: v.resumo })
})

rotasCarrinho.delete('/carrinho/:tabelaId', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const tabelaId = Number(c.req.param('tabelaId'))
  const cartId = Number.isInteger(tabelaId) ? await acharCarrinho(c, eu.id, tabelaId) : null
  if (cartId) await c.env.DB.batch([c.env.DB.prepare('DELETE FROM orcamento_itens WHERE orcamento_id = ?').bind(cartId), c.env.DB.prepare('DELETE FROM orcamentos WHERE id = ?').bind(cartId)])
  return c.json({ ok: true })
})

// Envia o carrinho: vira orçamento "Novo", com os preços congelados como estavam neste momento
rotasCarrinho.post('/carrinho/:tabelaId/enviar', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const t = await tabelaLiberada(c, eu.cliente_id, Number(c.req.param('tabelaId')))
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const corpo = (await c.req.json().catch(() => ({}))) as { transportadora?: unknown; observacao?: unknown }
  const transportadora = String(corpo.transportadora ?? '').trim().slice(0, 200)
  const observacao = String(corpo.observacao ?? '').trim().slice(0, 1500)
  const cartId = await acharCarrinho(c, eu.id, t.id)
  if (!cartId) return c.json({ erro: 'O carrinho está vazio.' }, 400)
  const v = await visaoCarrinho(c, cartId, t, true)
  if (!v._numeros.disponiveis) return c.json({ erro: 'O carrinho está vazio ou os produtos saíram da tabela.' }, 400)
  if (v.itens.some((i) => !i.disponivel)) return c.json({ erro: 'Alguns produtos do carrinho não estão mais disponíveis nesta tabela. Remova os marcados e tente de novo.' }, 400)
  for (const i of v.itens) {
    if (!qtdValida({ qtd_caixa: Number(i.qtd_caixa), qtd_minima: Number(i.qtd_minima), nao_abre_caixa: i.nao_abre_caixa as boolean }, Number(i.qtd))) {
      return c.json({ erro: `${i.referencia}: ${mensagemQtd({ qtd_caixa: Number(i.qtd_caixa), qtd_minima: Number(i.qtd_minima), nao_abre_caixa: i.nao_abre_caixa as boolean })}` }, 400)
    }
  }
  // O pedido mínimo só é cobrado de quem enxerga os preços (cliente de vitrine é atendido pela equipe)
  if (eu.ver_precos && t.pedido_minimo > 0 && v._numeros.subtotal < t.pedido_minimo) {
    return c.json({ erro: `O pedido mínimo desta indústria é R$ ${reais(t.pedido_minimo)}. Faltam R$ ${reais(arredondar2(t.pedido_minimo - v._numeros.subtotal))}.` }, 400)
  }
  const agora = Date.now()
  const jaEnviado = ((await c.env.DB.prepare('SELECT enviado_em FROM orcamentos WHERE id = ?').bind(cartId).first<{ enviado_em: number }>())?.enviado_em ?? 0) > 0
  // Congela dados dos itens (códigos, NCM, preço, IPI) no momento do envio
  const dados = await c.env.DB.prepare(
    `SELECT it.id, it.referencia, it.descricao, it.codigo_barras, it.ncm, p.preco, p.preco_promocional, p.ipi
       FROM orcamento_itens oi JOIN itens it ON it.id = oi.item_id JOIN precos p ON p.tabela_id = ? AND p.item_id = it.id WHERE oi.orcamento_id = ?`
  ).bind(t.id, cartId).all<{ id: number; referencia: string; descricao: string; codigo_barras: string; ncm: string; preco: number | null; preco_promocional: number | null; ipi: number | null }>()
  const comandos = dados.results.map((d) => {
    const unit = precoUnitario(d)!
    const qtd = Number(v.itens.find((i) => i.id === d.id)!.qtd)
    const ipi = t.calcular_ipi ? d.ipi ?? 0 : 0
    return c.env.DB.prepare('UPDATE orcamento_itens SET referencia = ?, descricao = ?, codigo_barras = ?, ncm = ?, preco_unit = ?, ipi = ?, promocao = ?, total_linha = ? WHERE orcamento_id = ? AND item_id = ?')
      .bind(d.referencia, d.descricao, d.codigo_barras, d.ncm, unit, ipi, d.preco_promocional && d.preco_promocional > 0 ? 1 : 0, calcularLinha(qtd, unit, ipi).total, cartId, d.id)
  })
  const n = v._numeros
  comandos.push(
    c.env.DB.prepare(
      `UPDATE orcamentos SET status = 'Novo', tabela_nome = ?, tabela_tipo = ?, tabela_prazo = ?, tipo_frete = ?, calcular_ipi = ?, ver_precos = ?, transportadora_texto = ?, observacao_cliente = ?,
              subtotal = ?, ipi_total = ?, total = ?, qtd_total = ?, enviado_em = ?, atualizado_em = ? WHERE id = ? AND status = 'carrinho'`
    ).bind(t.nome, t.tipo, t.prazo, t.tipo_frete ?? '', t.calcular_ipi ? 1 : 0, eu.ver_precos ? 1 : 0, transportadora, observacao, n.subtotal, n.ipiTotal, arredondar2(n.subtotal + n.ipiTotal), n.qtdTotal, agora, agora, cartId)
  )
  for (let i = 0; i < comandos.length; i += 100) await c.env.DB.batch(comandos.slice(i, i + 100))
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(agora, null, 'orcamento.enviar', `orçamento ${cartId} do comprador ${eu.email}`).run()
  await registrarHistorico(c, cartId, atorDe(eu), jaEnviado ? 'reenviado' : 'enviado', jaEnviado ? 'Cliente reenviou o orçamento após editar' : 'Cliente enviou o orçamento', await fotografar(c, cartId))
  return c.json({ ok: true, numero: cartId })
})

// Orçamentos já enviados pelo comprador
rotasCarrinho.get('/orcamentos', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const r = await c.env.DB.prepare(
    `SELECT o.id, o.status, o.enviado_em, o.total, o.qtd_total, o.tabela_nome, i.nome AS industria
       FROM orcamentos o JOIN industrias i ON i.id = o.industria_id WHERE o.comprador_id = ? AND o.status <> 'carrinho' ORDER BY o.enviado_em DESC LIMIT 200`
  ).bind(eu.id).all<Record<string, unknown>>()
  return c.json({ ver_precos: eu.ver_precos, itens: r.results.map((x) => (eu.ver_precos ? x : { ...x, total: undefined })) })
})

rotasCarrinho.get('/orcamentos/:id', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const id = Number(c.req.param('id'))
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare(
        `SELECT o.*, i.nome AS industria FROM orcamentos o JOIN industrias i ON i.id = o.industria_id WHERE o.id = ? AND o.comprador_id = ? AND o.status <> 'carrinho'`
      ).bind(id, eu.id).first<Record<string, unknown>>()
    : null
  if (!o) return c.json({ erro: 'Orçamento não encontrado.' }, 404)
  const itens = await c.env.DB.prepare('SELECT oi.item_id AS id, oi.referencia, oi.descricao, oi.codigo_barras, oi.ncm, oi.qtd, oi.preco_unit, oi.ipi, oi.promocao, oi.total_linha, (SELECT f.id FROM fotos f WHERE f.item_id = oi.item_id ORDER BY f.posicao LIMIT 1) AS foto_id FROM orcamento_itens oi WHERE oi.orcamento_id = ? ORDER BY oi.id').bind(id).all<Record<string, unknown>>()
  const ver = eu.ver_precos
  const ind = await c.env.DB.prepare("SELECT (logo_chave <> '') AS tem_logo FROM industrias WHERE id = ?").bind(o.industria_id).first<{ tem_logo: number }>()
  const cli = await c.env.DB.prepare('SELECT razao_social, nome_fantasia, cnpj, inscricao_estadual, endereco, cep, cidade, uf, telefone, whatsapp, email_nfe, suframa, segmento FROM clientes WHERE id = ?').bind(eu.cliente_id).first()
  const orc = { industria_id: o.industria_id, tem_logo: !!ind?.tem_logo, tipo_frete: o.tipo_frete, id: o.id, status: o.status, industria: o.industria, tabela_nome: o.tabela_nome, tabela_tipo: o.tabela_tipo, tabela_prazo: o.tabela_prazo, transportadora_texto: o.transportadora_texto, observacao_cliente: o.observacao_cliente, enviado_em: o.enviado_em, qtd_total: o.qtd_total, edicao_liberada: !!o.edicao_liberada && (o.status === 'Novo' || o.status === 'Em atendimento'), ...(ver ? { subtotal: o.subtotal, ipi_total: o.ipi_total, total: o.total } : {}) }
  return c.json({ ver_precos: ver, cliente: cli, comprador: { nome: eu.nome, email: eu.email }, orcamento: orc, itens: itens.results.map((x) => (ver ? x : { id: x.id, referencia: x.referencia, descricao: x.descricao, codigo_barras: x.codigo_barras, ncm: x.ncm, qtd: x.qtd, foto_id: x.foto_id })) })
})

// Copia um orçamento já enviado para um carrinho novo (soma ao carrinho da mesma tabela, se já existir)
rotasCarrinho.post('/orcamentos/:id/copiar', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const id = Number(c.req.param('id'))
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare("SELECT id, tabela_id FROM orcamentos WHERE id = ? AND comprador_id = ? AND status <> 'carrinho'").bind(id, eu.id).first<{ id: number; tabela_id: number }>()
    : null
  if (!o) return c.json({ erro: 'Orçamento não encontrado.' }, 404)
  const t = await tabelaLiberada(c, eu.cliente_id, o.tabela_id)
  if (!t) return c.json({ erro: 'Esta tabela não está mais disponível para você.' }, 404)
  const linhas = await c.env.DB.prepare('SELECT item_id, qtd FROM orcamento_itens WHERE orcamento_id = ?').bind(id).all<{ item_id: number; qtd: number }>()
  const cartId = await garantirCarrinho(c, eu, t)
  const stmts: D1PreparedStatement[] = []
  let copiados = 0
  for (const l of linhas.results) {
    const item = await c.env.DB.prepare(
      `SELECT it.id, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? AND it.id = ? AND ${ITEM_VISIVEL}`
    ).bind(t.id, l.item_id).first<{ id: number; qtd_caixa: number; qtd_minima: number; nao_abre_caixa: number }>()
    if (!item) continue
    const passo = passoQtd(item)
    const qtd = Math.ceil(l.qtd / passo) * passo
    stmts.push(c.env.DB.prepare('INSERT INTO orcamento_itens (orcamento_id, item_id, qtd) VALUES (?, ?, ?) ON CONFLICT(orcamento_id, item_id) DO UPDATE SET qtd = qtd + excluded.qtd').bind(cartId, item.id, qtd))
    copiados++
  }
  for (let k = 0; k < stmts.length; k += 90) await c.env.DB.batch(stmts.slice(k, k + 90))
  await c.env.DB.prepare('UPDATE orcamentos SET atualizado_em = ? WHERE id = ?').bind(Date.now(), cartId).run()
  return c.json({ ok: true, tabela_id: t.id, copiados, ignorados: linhas.results.length - copiados })
})

// O comprador reabre para edição um orçamento que a equipe liberou. Vira carrinho de novo e mantém o mesmo número ao reenviar.
rotasCarrinho.post('/orcamentos/:id/reabrir', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const id = Number(c.req.param('id'))
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare("SELECT id, tabela_id, status, edicao_liberada FROM orcamentos WHERE id = ? AND comprador_id = ? AND status IN ('Novo','Em atendimento')").bind(id, eu.id).first<{ id: number; tabela_id: number; edicao_liberada: number }>()
    : null
  if (!o || !o.edicao_liberada) return c.json({ erro: 'Este orçamento não está liberado para edição. Peça à Goiandy para liberar.' }, 403)
  if (await acharCarrinho(c, eu.id, o.tabela_id)) return c.json({ erro: 'Você já tem um carrinho aberto desta tabela. Envie ou esvazie esse carrinho antes de editar o orçamento.' }, 409)
  const t = await tabelaLiberada(c, eu.cliente_id, o.tabela_id)
  if (!t) return c.json({ erro: 'Esta tabela não está mais disponível para você.' }, 404)
  await c.env.DB.prepare("UPDATE orcamentos SET status = 'carrinho', edicao_liberada = 0, atualizado_em = ? WHERE id = ? AND status IN ('Novo','Em atendimento')").bind(Date.now(), id).run()
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), null, 'orcamento.reabrir', `orçamento ${id} reaberto pelo comprador ${eu.email}`).run()
  await registrarHistorico(c, id, atorDe(eu), 'reaberto', 'Cliente reabriu o orçamento para edição (liberado pela equipe)')
  return c.json({ ok: true, tabela_id: o.tabela_id })
})

// Depois do envio, o navegador do cliente manda o PDF do orçamento e o servidor dispara o e-mail (uma vez por envio)
rotasCarrinho.post('/orcamentos/:id/pdf', exigirComprador(), async (c) => {
  const eu = c.get('comprador')
  const id = Number(c.req.param('id'))
  const o = Number.isInteger(id)
    ? await c.env.DB.prepare("SELECT id FROM orcamentos WHERE id = ? AND comprador_id = ? AND status <> 'carrinho'").bind(id, eu.id).first<{ id: number }>()
    : null
  if (!o) return c.json({ erro: 'Orçamento não encontrado.' }, 404)
  // Se o PDF não pôde ser gerado, o navegador manda um JSON vazio e o e-mail sai sem anexo
  const semPdf = (c.req.header('content-type') ?? '').includes('application/json')
  const bytes = semPdf ? null : new Uint8Array(await c.req.arrayBuffer())
  if (bytes && (bytes.length < 100 || bytes.length > 5 * 1024 * 1024 || String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF')) return c.json({ erro: 'PDF inválido.' }, 400)
  const ult = await c.env.DB.prepare("SELECT MAX(id) AS m FROM orcamento_historico WHERE orcamento_id = ? AND acao IN ('enviado','reenviado')").bind(id).first<{ m: number | null }>()
  const jaEmail = await c.env.DB.prepare("SELECT 1 AS x FROM orcamento_historico WHERE orcamento_id = ? AND acao = 'email' AND id > ?").bind(id, ult?.m ?? 0).first()
  if (jaEmail) return c.json({ ok: true, email: { enviado: false, erro: 'E-mail deste envio já foi disparado.' } })
  const reenvio = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orcamento_historico WHERE orcamento_id = ? AND acao = 'reenviado'").bind(id).first<{ n: number }>())?.n ?? 0
  const r = await enviarEmailsOrcamento(c.env, id, bytes, atorDe(eu), reenvio > 0)
  return c.json({ ok: true, email: r })
})
