import { arredondar2 } from './numeros'

export type LinhaPreco = {
  qtd_caixa: number
  qtd_minima: number
  nao_abre_caixa: number | boolean
  preco: number | null
  preco_promocional: number | null
  ipi: number | null
}

// De quanto em quanto o item pode ser pedido: caixa fechada (múltiplos da caixa) ou caixa aberta (múltiplos do mínimo).
export function passoQtd(l: Pick<LinhaPreco, 'qtd_caixa' | 'qtd_minima' | 'nao_abre_caixa'>): number {
  if (l.nao_abre_caixa && l.qtd_caixa > 0) return l.qtd_caixa
  if (l.qtd_minima > 0) return l.qtd_minima
  return 1
}

export function qtdValida(l: Pick<LinhaPreco, 'qtd_caixa' | 'qtd_minima' | 'nao_abre_caixa'>, qtd: number): boolean {
  return Number.isInteger(qtd) && qtd > 0 && qtd <= 1_000_000 && qtd % passoQtd(l) === 0
}

export function mensagemQtd(l: Pick<LinhaPreco, 'qtd_caixa' | 'qtd_minima' | 'nao_abre_caixa'>): string {
  const p = passoQtd(l)
  if (l.nao_abre_caixa && l.qtd_caixa > 0) return `Este item só sai em caixa fechada: use múltiplos de ${p}.`
  if (p > 1) return `Use múltiplos de ${p} unidades.`
  return 'Quantidade inválida.'
}

// Preço de venda: promocional preenchido sempre vence.
export function precoUnitario(l: Pick<LinhaPreco, 'preco' | 'preco_promocional'>): number | null {
  if (l.preco_promocional && l.preco_promocional > 0) return l.preco_promocional
  if (l.preco && l.preco > 0) return l.preco
  return null
}

export function calcularLinha(qtd: number, unit: number, ipiPercentual: number) {
  const total = arredondar2(qtd * unit)
  const ipi = arredondar2((total * ipiPercentual) / 100)
  return { total, ipi }
}
