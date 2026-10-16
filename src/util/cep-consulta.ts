import { soDigitos } from './validar'

export type DadosCep = { cep: string; logradouro: string; bairro: string; cidade: string; uf: string; fonte: string }
export type ResultadoCep = { ok: true; dados: DadosCep } | { ok: false; status: number; erro: string }

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

export function dadosViaCep(j: Record<string, unknown>): DadosCep {
  return { cep: soDigitos(txt(j.cep)), logradouro: txt(j.logradouro), bairro: txt(j.bairro), cidade: txt(j.localidade), uf: txt(j.uf).toUpperCase(), fonte: 'ViaCEP' }
}

export function dadosBrasilApiCep(j: Record<string, unknown>): DadosCep {
  return { cep: soDigitos(txt(j.cep)), logradouro: txt(j.street), bairro: txt(j.neighborhood), cidade: txt(j.city), uf: txt(j.state).toUpperCase(), fonte: 'BrasilAPI' }
}

async function buscar(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'goiandy-orcamentos' }, signal: AbortSignal.timeout(6000) })
  } catch {
    return null
  }
}

export async function consultarCep(cep: string): Promise<ResultadoCep> {
  const a = await buscar(`https://viacep.com.br/ws/${cep}/json/`)
  if (a?.ok) {
    const j = (await a.json().catch(() => null)) as Record<string, unknown> | null
    if (j?.erro) return { ok: false, status: 404, erro: 'CEP não encontrado.' }
    if (j && txt(j.localidade)) return { ok: true, dados: dadosViaCep(j) }
  }
  const b = await buscar(`https://brasilapi.com.br/api/cep/v2/${cep}`)
  if (b?.ok) {
    const j = (await b.json().catch(() => null)) as Record<string, unknown> | null
    if (j && txt(j.city)) return { ok: true, dados: dadosBrasilApiCep(j) }
  }
  if (b?.status === 404) return { ok: false, status: 404, erro: 'CEP não encontrado.' }
  return { ok: false, status: 502, erro: 'Não consegui consultar o CEP agora. Preencha o endereço manualmente.' }
}
