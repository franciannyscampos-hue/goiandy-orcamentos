import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { limpar, type Campo } from './cadastro-generico'

export type ColunaImport = { titulo: string; campo: string; exemplo: string; largura?: number; obrigatorio?: boolean }

// O que cada tipo de cadastro precisa informar para importar em massa.
export type ConfigImportacao = {
  tabela: string
  campos: Campo[]
  colunas: ColunaImport[]
  permissao: string
  comCriadoEm?: boolean
  // Carrega o que já existe (chave -> id) e devolve funções de apoio.
  preparar: (db: D1Database) => Promise<{
    chaveDe: (bruto: Record<string, string>) => string
    existentes: Map<string, number>
    extras?: (bruto: Record<string, string>) => { valores: Record<string, number | null>; erros: string[] }
  }>
}

type Linha = { linha: number; acao: 'criar' | 'atualizar' | 'erro'; chave: string; mensagem: string }
type Preparada = Linha & { id?: number; valores?: Record<string, string | number | null> }

const LIMITE_LINHAS = 2000
const SIM = ['sim', 's', '1', 'true', 'x', 'verdadeiro']
const NAO = ['nao', 'não', 'n', '0', 'false', 'falso']

// "3.000,50" ou "3000.5" -> 3000.5
function numeroBr(texto: string): number | string {
  const t = texto.replace(/[R$\s]/g, '')
  if (!t) return t
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) ? n : texto
}

function normalizar(bruto: Record<string, string>, campos: Campo[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of campos) {
    const v = (bruto[c.nome] ?? '').toString().trim()
    if (v === '') continue // célula vazia = não mexe
    if (c.tipo === 'bool') out[c.nome] = SIM.includes(v.toLowerCase()) ? true : NAO.includes(v.toLowerCase()) ? false : v
    else if (c.tipo === 'numero') out[c.nome] = numeroBr(v)
    else if (c.tipo === 'enum') out[c.nome] = v.toUpperCase()
    else out[c.nome] = v
  }
  return out
}

export function criarImportacao(cfg: ConfigImportacao) {
  const rotas = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

  rotas.get('/importacao/modelo', exigirEquipe(cfg.permissao), (c) => c.json({ colunas: cfg.colunas, limite_linhas: LIMITE_LINHAS }))

  rotas.post('/importar', exigirEquipe(cfg.permissao), async (c) => {
    const corpo = await c.req.json<{ linhas?: Record<string, string>[]; aplicar?: boolean }>().catch(() => ({}) as { linhas?: Record<string, string>[]; aplicar?: boolean })
    const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : []
    if (!linhas.length) return c.json({ erro: 'A planilha não tem linhas para importar.' }, 400)
    if (linhas.length > LIMITE_LINHAS) return c.json({ erro: `Importe até ${LIMITE_LINHAS} linhas por vez. A planilha tem ${linhas.length}.` }, 400)

    const db = c.env.DB
    const ap = await cfg.preparar(db)
    const vistas = new Map<string, number>()
    const preparadas: Preparada[] = []

    linhas.forEach((bruto, i) => {
      const numero = i + 2 // linha 1 é o cabeçalho da planilha
      const normal = normalizar(bruto, cfg.campos)
      const temAlgo = Object.keys(normal).length > 0 || Object.values(bruto).some((v) => String(v ?? '').trim() !== '')
      if (!temAlgo) return
      const chave = ap.chaveDe(bruto)
      const falha = (mensagem: string) => preparadas.push({ linha: numero, acao: 'erro', chave: chave || '—', mensagem })
      if (!chave) return falha('Falta o campo que identifica o cadastro.')
      const repetida = vistas.get(chave)
      if (repetida) return falha(`Repetido na planilha (já aparece na linha ${repetida}).`)
      vistas.set(chave, numero)

      const id = ap.existentes.get(chave)
      const { valores, erros } = limpar(normal, cfg.campos, id !== undefined)
      const extra = ap.extras ? ap.extras(bruto) : { valores: {}, erros: [] }
      const todosErros = [...erros, ...extra.erros]
      if (todosErros.length) return falha(todosErros.join(' '))
      const final = { ...valores, ...extra.valores }
      if (!Object.keys(final).length) return falha('Nenhum dado para gravar.')
      preparadas.push({ linha: numero, acao: id === undefined ? 'criar' : 'atualizar', chave, mensagem: '', id, valores: final })
    })

    const relatorio = () => ({
      criar: preparadas.filter((p) => p.acao === 'criar').length,
      atualizar: preparadas.filter((p) => p.acao === 'atualizar').length,
      erros: preparadas.filter((p) => p.acao === 'erro').length
    })

    if (!corpo.aplicar) {
      return c.json({ aplicado: false, resumo: relatorio(), linhas: preparadas.map(({ linha, acao, chave, mensagem }) => ({ linha, acao, chave, mensagem })) })
    }

    // Grava: lotes de 50 comandos; se um lote falhar, tenta linha por linha para achar a que deu problema.
    const comandos = preparadas
      .filter((p) => p.acao !== 'erro')
      .map((p) => {
        const nomes = Object.keys(p.valores!)
        const vals = nomes.map((n) => p.valores![n])
        const stmt =
          p.acao === 'criar'
            ? db
                .prepare(`INSERT INTO ${cfg.tabela} (${nomes.join(', ')}${cfg.comCriadoEm ? ', criado_em' : ''}) VALUES (${nomes.map(() => '?').join(', ')}${cfg.comCriadoEm ? ', ?' : ''})`)
                .bind(...vals, ...(cfg.comCriadoEm ? [Date.now()] : []))
            : db.prepare(`UPDATE ${cfg.tabela} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`).bind(...vals, p.id)
        return { p, stmt }
      })
    for (let i = 0; i < comandos.length; i += 50) {
      const lote = comandos.slice(i, i + 50)
      try {
        await db.batch(lote.map((x) => x.stmt))
      } catch {
        for (const x of lote) {
          try {
            await x.stmt.run()
          } catch (e) {
            x.p.acao = 'erro'
            x.p.mensagem = String(e).includes('UNIQUE') ? 'Já existe um cadastro com esse valor.' : 'Não foi possível gravar esta linha.'
          }
        }
      }
    }
    return c.json({ aplicado: true, resumo: relatorio(), linhas: preparadas.filter((p) => p.acao === 'erro').map(({ linha, acao, chave, mensagem }) => ({ linha, acao, chave, mensagem })) })
  })

  return rotas
}

export const minusculo = (s: string) => s.trim().toLowerCase()
