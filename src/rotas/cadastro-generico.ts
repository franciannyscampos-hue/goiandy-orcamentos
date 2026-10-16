import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { cnpjValido, emailValido, soDigitos } from '../util/validar'

export type Campo = {
  nome: string
  rotulo: string
  tipo: 'texto' | 'email' | 'cnpj' | 'numero' | 'bool' | 'enum'
  obrigatorio?: boolean
  max?: number
  opcoes?: string[]
  padrao?: string | number | boolean // usado na criação quando o campo não vem
}

type Resultado = { valores: Record<string, string | number>; erros: string[] }

// Confere e limpa o que veio do navegador. Só passam os campos declarados na configuração.
export function limpar(corpo: Record<string, unknown>, campos: Campo[], parcial: boolean): Resultado {
  const valores: Record<string, string | number> = {}
  const erros: string[] = []
  for (const c of campos) {
    let bruto = corpo[c.nome]
    if (!parcial && bruto === undefined) bruto = c.padrao
    if (parcial && bruto === undefined) continue
    switch (c.tipo) {
      case 'texto':
      case 'email':
      case 'cnpj': {
        let v = String(bruto ?? '').trim()
        if (c.tipo === 'email') v = v.toLowerCase()
        if (c.tipo === 'cnpj') v = soDigitos(v)
        if (!v && c.obrigatorio) {
          erros.push(`${c.rotulo} é obrigatório.`)
          break
        }
        if (v && c.tipo === 'email' && !emailValido(v)) erros.push(`${c.rotulo} não parece um e-mail válido.`)
        if (v && c.tipo === 'cnpj' && !cnpjValido(v)) erros.push(`${c.rotulo} não é um CNPJ válido.`)
        if (v.length > (c.max ?? 500)) erros.push(`${c.rotulo} está muito longo.`)
        valores[c.nome] = v
        break
      }
      case 'numero': {
        const n = Number(bruto ?? 0)
        if (!Number.isFinite(n) || n < 0) {
          erros.push(`${c.rotulo} precisa ser um número maior ou igual a zero.`)
          break
        }
        valores[c.nome] = Math.round(n * 100) / 100
        break
      }
      case 'bool':
        valores[c.nome] = bruto === true || bruto === 1 || bruto === '1' ? 1 : 0
        break
      case 'enum': {
        const v = String(bruto ?? '')
        if (!c.opcoes?.includes(v)) erros.push(`${c.rotulo} tem um valor inválido.`)
        else valores[c.nome] = v
        break
      }
    }
  }
  return { valores, erros }
}

// Cria as rotas de listar, criar e editar de uma tabela simples. Não há exclusão: o cadastro é inativado.
export function criarCadastro(tabela: string, campos: Campo[], permissoes: { ver: string; editar: string }) {
  const rotas = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()
  const colunas = campos.map((c) => c.nome)

  rotas.get('/', exigirEquipe(permissoes.ver), async (c) => {
    const r = await c.env.DB.prepare(`SELECT * FROM ${tabela} ORDER BY ativo DESC, nome COLLATE NOCASE`).all()
    return c.json({ itens: r.results })
  })

  rotas.post('/', exigirEquipe(permissoes.editar), async (c) => {
    const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
    const { valores, erros } = limpar(corpo, campos, false)
    if (erros.length) return c.json({ erro: erros[0], erros }, 400)
    try {
      const r = await c.env.DB.prepare(
        `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`
      )
        .bind(...colunas.map((n) => valores[n]))
        .run()
      const item = await c.env.DB.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).bind(r.meta.last_row_id).first()
      return c.json({ item }, 201)
    } catch (e) {
      if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um cadastro com esse valor.' }, 409)
      throw e
    }
  })

  rotas.put('/:id', exigirEquipe(permissoes.editar), async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.json({ erro: 'Cadastro não encontrado.' }, 404)
    const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
    const { valores, erros } = limpar(corpo, campos, true)
    if (erros.length) return c.json({ erro: erros[0], erros }, 400)
    const nomes = Object.keys(valores)
    if (!nomes.length) return c.json({ erro: 'Nada para alterar.' }, 400)
    try {
      const r = await c.env.DB.prepare(`UPDATE ${tabela} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
        .bind(...nomes.map((n) => valores[n]), id)
        .run()
      if (!r.meta.changes) return c.json({ erro: 'Cadastro não encontrado.' }, 404)
      const item = await c.env.DB.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).bind(id).first()
      return c.json({ item })
    } catch (e) {
      if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um cadastro com esse valor.' }, 409)
      throw e
    }
  })

  return rotas
}
