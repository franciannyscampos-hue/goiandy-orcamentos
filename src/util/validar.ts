export function soDigitos(texto: string): string {
  return texto.replace(/\D/g, '')
}

// Confere os dois dígitos verificadores do CNPJ.
export function cnpjValido(entrada: string): boolean {
  const d = soDigitos(entrada)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calcular = (tamanho: number): number => {
    const pesos = tamanho === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calcular(12) === Number(d[12]) && calcular(13) === Number(d[13])
}

export function emailValido(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)
}
