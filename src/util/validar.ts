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

// Formato: texto@dominio.com (precisa de ponto no domínio e final com 2+ letras; sem espaços nem pontos repetidos).
export function emailValido(texto: string): boolean {
  return /^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(texto)
}

// Telefone brasileiro com DDD: 10 dígitos (fixo) ou 11 (celular, começa com 9). Aceita +55 e 0 na frente.
export function telefoneNormalizado(entrada: string): string | null {
  let d = soDigitos(entrada)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10 && d.length !== 11) return null
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11 || ddd > 99 || d[1] === '0') return null
  if (d.length === 11 && d[2] !== '9') return null
  return d
}

export function formatarTelefone(d: string): string {
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
}

export function formatarCep(d: string): string {
  return `${d.slice(0, 5)}-${d.slice(5)}`
}
