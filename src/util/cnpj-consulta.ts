import { soDigitos } from './validar'

export type DadosCnpj = {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  endereco: string
  cep: string
  cidade: string
  uf: string
  telefone: string
  email: string
  situacao: string
  atividade: string
  fonte: string
}

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())
const juntar = (...partes: unknown[]): string => partes.map(txt).filter(Boolean).join(', ')

// Resposta da BrasilAPI (https://brasilapi.com.br/api/cnpj/v1/{cnpj})
export function dadosBrasilApi(j: Record<string, unknown>): DadosCnpj {
  const rua = [txt(j.descricao_tipo_de_logradouro), txt(j.logradouro)].filter(Boolean).join(' ')
  return {
    cnpj: soDigitos(txt(j.cnpj)),
    razao_social: txt(j.razao_social),
    nome_fantasia: txt(j.nome_fantasia),
    endereco: juntar(rua, j.numero, j.complemento, j.bairro),
    cep: soDigitos(txt(j.cep)),
    cidade: txt(j.municipio),
    uf: txt(j.uf).toUpperCase(),
    telefone: soDigitos(txt(j.ddd_telefone_1)),
    email: txt(j.email).toLowerCase(),
    situacao: txt(j.descricao_situacao_cadastral),
    atividade: txt(j.cnae_fiscal_descricao),
    fonte: 'BrasilAPI'
  }
}

// Resposta da ReceitaWS (https://receitaws.com.br/v1/cnpj/{cnpj}) — plano B
export function dadosReceitaWs(j: Record<string, unknown>): DadosCnpj {
  const atividades = Array.isArray(j.atividade_principal) ? (j.atividade_principal as Record<string, unknown>[]) : []
  return {
    cnpj: soDigitos(txt(j.cnpj)),
    razao_social: txt(j.nome),
    nome_fantasia: txt(j.fantasia),
    endereco: juntar(j.logradouro, j.numero, j.complemento, j.bairro),
    cep: soDigitos(txt(j.cep)),
    cidade: txt(j.municipio),
    uf: txt(j.uf).toUpperCase(),
    telefone: soDigitos(txt(j.telefone).split('/')[0]),
    email: txt(j.email).toLowerCase(),
    situacao: txt(j.situacao),
    atividade: txt(atividades[0]?.text),
    fonte: 'ReceitaWS'
  }
}

export type ResultadoConsulta = { ok: true; dados: DadosCnpj } | { ok: false; status: number; erro: string }

async function buscar(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'goiandy-orcamentos' }, signal: AbortSignal.timeout(8000) })
  } catch {
    return null
  }
}

export async function consultarCnpj(cnpj: string): Promise<ResultadoConsulta> {
  const a = await buscar(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
  if (a?.ok) {
    const j = (await a.json().catch(() => null)) as Record<string, unknown> | null
    if (j && txt(j.razao_social)) return { ok: true, dados: dadosBrasilApi(j) }
  }
  if (a && (a.status === 400 || a.status === 404)) return { ok: false, status: 404, erro: 'CNPJ não encontrado na Receita Federal.' }

  const b = await buscar(`https://receitaws.com.br/v1/cnpj/${cnpj}`)
  if (b?.ok) {
    const j = (await b.json().catch(() => null)) as Record<string, unknown> | null
    if (j && j.status === 'ERROR') return { ok: false, status: 404, erro: txt(j.message) || 'CNPJ não encontrado na Receita Federal.' }
    if (j && txt(j.nome)) return { ok: true, dados: dadosReceitaWs(j) }
  }
  return { ok: false, status: 502, erro: 'Não consegui consultar a Receita agora. Preencha manualmente ou tente de novo em instantes.' }
}
