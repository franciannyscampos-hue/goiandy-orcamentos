// Funções de apoio usadas por todas as telas.

export function el(tag, atributos = {}, ...filhos) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(atributos)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const f of filhos) if (f !== undefined && f !== null) e.append(f)
  return e
}

export async function api(caminho, opcoes = {}) {
  const resposta = await fetch('/api' + caminho, {
    method: opcoes.metodo || 'GET',
    headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    credentials: 'same-origin'
  })
  const dados = await resposta.json().catch(() => ({}))
  return { ok: resposta.ok, status: resposta.status, dados }
}

export function pode(usuario, permissao) {
  return usuario.permissoes.includes('*') || usuario.permissoes.includes(permissao)
}

export function brl(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatarCnpj(digitos) {
  const d = String(digitos || '').replace(/\D/g, '')
  if (d.length !== 14) return d
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

// ---- Máscaras (formatam enquanto a pessoa digita) ----
export const soDigitos = (t) => String(t ?? '').replace(/\D/g, '')

export function formatarTelefone(valor) {
  const d = soDigitos(valor)
  if (d.length < 10) return String(valor ?? '')
  const n = d.length > 11 ? d.slice(-11) : d // tira +55 que sobrar na frente
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6, 10)}`
}

export function mascaraTelefone(valor) {
  let d = soDigitos(valor)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function mascaraCep(valor) {
  const d = soDigitos(valor).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export function mascaraCnpj(valor) {
  const d = soDigitos(valor).slice(0, 14)
  let s = d.slice(0, 2)
  if (d.length > 2) s += '.' + d.slice(2, 5)
  if (d.length > 5) s += '.' + d.slice(5, 8)
  if (d.length > 8) s += '/' + d.slice(8, 12)
  if (d.length > 12) s += '-' + d.slice(12)
  return s
}

const MASCARAS = {
  telefone: { fn: mascaraTelefone, max: 15, placeholder: '(65) 99999-0000', dica: 'Telefone com DDD, ex.: (65) 99999-0000 ou (65) 3333-4444.' },
  cep: { fn: mascaraCep, max: 9, placeholder: '00000-000', dica: 'CEP com 8 números.' },
  cnpj: { fn: mascaraCnpj, max: 18, placeholder: '00.000.000/0000-00', dica: 'CNPJ com 14 números.' }
}
const PADRAO_EMAIL = '[^\\s@.]+(\\.[^\\s@.]+)*@[^\\s@.]+(\\.[^\\s@.]+)*\\.[A-Za-z]{2,}'

// Ajusta um <input> conforme o tipo do campo: telefone, cep, cnpj ou email.
export function aplicarTipo(entrada, tipo) {
  const m = MASCARAS[tipo]
  if (m) {
    entrada.setAttribute('maxlength', String(m.max))
    entrada.setAttribute('inputmode', 'numeric')
    entrada.setAttribute('placeholder', m.placeholder)
    entrada.setAttribute('title', m.dica)
    if (tipo === 'telefone') entrada.setAttribute('pattern', '\\(\\d{2}\\) \\d{4,5}-\\d{4}')
    if (tipo === 'cep') entrada.setAttribute('pattern', '\\d{5}-\\d{3}')
    if (tipo === 'cnpj') entrada.setAttribute('pattern', '\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}')
    entrada.addEventListener('input', () => {
      const novo = m.fn(entrada.value)
      if (novo !== entrada.value) entrada.value = novo
    })
    if (entrada.value) entrada.value = m.fn(entrada.value)
  } else if (tipo === 'email') {
    entrada.setAttribute('type', 'email')
    entrada.setAttribute('pattern', PADRAO_EMAIL)
    entrada.setAttribute('placeholder', 'nome@empresa.com.br')
    entrada.setAttribute('title', 'E-mail no formato nome@empresa.com.br')
    entrada.setAttribute('autocapitalize', 'off')
  }
  return entrada
}
