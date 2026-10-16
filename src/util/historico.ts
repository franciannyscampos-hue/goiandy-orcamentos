import type { Bindings } from '../types'

export type Ator = { tipo: 'equipe' | 'comprador'; id: number; nome: string }
type LinhaSnap = { item_id: number; referencia: string; descricao: string; qtd: number; preco_unit: number | null }
export type Snapshot = { itens: LinhaSnap[]; subtotal: number; ipi_total: number; total: number; transportadora: string; observacao: string }

// Foto do conteúdo do orçamento neste momento (itens, quantidades, preços e totais)
export async function fotografar(c: { env: Bindings }, orcId: number): Promise<Snapshot> {
  const o = await c.env.DB.prepare('SELECT subtotal, ipi_total, total, transportadora_texto, observacao_cliente FROM orcamentos WHERE id = ?').bind(orcId).first<{ subtotal: number; ipi_total: number; total: number; transportadora_texto: string; observacao_cliente: string }>()
  const l = await c.env.DB.prepare('SELECT item_id, referencia, descricao, qtd, preco_unit FROM orcamento_itens WHERE orcamento_id = ? ORDER BY id').bind(orcId).all<LinhaSnap>()
  return { itens: l.results, subtotal: o?.subtotal ?? 0, ipi_total: o?.ipi_total ?? 0, total: o?.total ?? 0, transportadora: o?.transportadora_texto ?? '', observacao: o?.observacao_cliente ?? '' }
}

export async function registrarHistorico(c: { env: Bindings }, orcId: number, ator: Ator, acao: string, detalhe = '', snapshot?: Snapshot) {
  await c.env.DB.prepare('INSERT INTO orcamento_historico (orcamento_id, quando, ator_tipo, ator_id, ator_nome, acao, detalhe, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(orcId, Date.now(), ator.tipo, ator.id, ator.nome, acao, detalhe, snapshot ? JSON.stringify(snapshot) : '').run()
}

// Diferença entre duas fotos: o que entrou, saiu ou mudou de quantidade
export function diferenca(antes: Snapshot | null, depois: Snapshot) {
  const mudancas: string[] = []
  if (!antes) return mudancas
  const a = new Map(antes.itens.map((i) => [i.item_id, i]))
  const d = new Map(depois.itens.map((i) => [i.item_id, i]))
  for (const [id, i] of d) {
    const x = a.get(id)
    if (!x) mudancas.push(`Item acrescentado: ${i.referencia} — ${i.descricao} (${i.qtd} un.)`)
    else if (x.qtd !== i.qtd) mudancas.push(`Quantidade alterada: ${i.referencia} — ${i.descricao}: ${x.qtd} → ${i.qtd} un.`)
  }
  for (const [id, i] of a) if (!d.has(id)) mudancas.push(`Item removido: ${i.referencia} — ${i.descricao} (${i.qtd} un.)`)
  if (antes.transportadora !== depois.transportadora) mudancas.push(`Transportadora: "${antes.transportadora}" → "${depois.transportadora}"`)
  if (antes.observacao !== depois.observacao) mudancas.push('Observação do cliente alterada')
  return mudancas
}
