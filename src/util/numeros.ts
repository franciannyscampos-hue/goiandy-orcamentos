// "1.234,56" / "1234.56" / "R$ 12,3" -> número. Vazio -> null. Texto que não é número -> NaN.
export function lerNumero(entrada: unknown): number | null {
  if (entrada === null || entrada === undefined) return null
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? entrada : Number.NaN
  const t = String(entrada).replace(/R\$|\s/g, '')
  if (t === '') return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return Number.NaN
  return Number(normal)
}

// Preço sempre com 2 casas (arredonda).
export function arredondar2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function hojeCuiaba(): string {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
}
