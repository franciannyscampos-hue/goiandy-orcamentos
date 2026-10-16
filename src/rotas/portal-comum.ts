import type { Bindings } from '../types'

// Confere se a tabela está liberada para o CNPJ e devolve dados da tabela e da indústria
export async function tabelaLiberada(c: { env: Bindings }, clienteId: number, tabelaId: number) {
  if (!Number.isInteger(tabelaId) || tabelaId <= 0) return null
  return c.env.DB.prepare(
    `SELECT t.id, t.nome, t.tipo, t.prazo, t.vencimento, i.id AS industria_id, i.nome AS industria, i.calcular_ipi, i.tipo_frete, i.pedido_minimo
       FROM liberacoes l JOIN tabelas_preco t ON t.id = l.tabela_id AND t.ativo = 1 JOIN industrias i ON i.id = t.industria_id AND i.ativo = 1
      WHERE l.cliente_id = ? AND l.tabela_id = ?`
  ).bind(clienteId, tabelaId).first<{ id: number; nome: string; tipo: string; prazo: string; vencimento: string; industria_id: number; industria: string; calcular_ipi: number; tipo_frete: string; pedido_minimo: number }>()
}

// Só aparece item ativo que tenha preço ou promoção na tabela
export const ITEM_VISIVEL = `it.ativo = 1 AND ((p.preco IS NOT NULL AND p.preco > 0) OR (p.preco_promocional IS NOT NULL AND p.preco_promocional > 0))`

