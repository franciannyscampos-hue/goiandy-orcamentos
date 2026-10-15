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
