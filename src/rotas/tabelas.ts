import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { arredondar2, hojeCuiaba, lerNumero } from '../util/numeros'
import { soDigitos } from '../util/validar'

export const rotasTabelas = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

// Colunas aceitas na planilha (o modelo da KE Home). "sinonimos" ajudam a reconhecer o cabeçalho.
export const COLUNAS_TABELA = [
  { campo: 'referencia', titulo: 'REF', obrigatorio: true, exemplo: 'CO-100', sinonimos: ['referencia', 'codigo', 'cod', 'ref'] },
  { campo: 'descricao', titulo: 'DESCRIÇÃO', obrigatorio: true, exemplo: 'CO-100-JG CORTADORES ALFABETO (40PCS)', sinonimos: ['descricao', 'produto'] },
  { campo: 'preco', titulo: 'PREÇO', exemplo: '15,25', sinonimos: ['preco', 'valor', 'preco unitario'] },
  { campo: 'qtd_caixa', titulo: 'QTD CAIXA', exemplo: '48', sinonimos: ['qtd caixa', 'qtde caixa', 'quantidade caixa', 'qtd cx', 'caixa'] },
  { campo: 'qtd_minima', titulo: 'QTD MÍNIMA', exemplo: '12', sinonimos: ['qtd minima', 'qtde minima', 'quantidade minima', 'minimo'] },
  { campo: 'preco_promocional', titulo: 'PREÇO PROMOCIONAL', exemplo: '', sinonimos: ['preco promocional', 'promocao', 'preco promo', 'promo'] },
  { campo: 'novo', titulo: 'NOVO', exemplo: '', sinonimos: ['novo', 'lancamento'] },
  { campo: 'nao_abre_caixa', titulo: 'NÃO ABRE CAIXA', exemplo: 'S', sinonimos: ['nao abre caixa', 'nao abre cx'] },
  { campo: 'ipi', titulo: 'IPI %', exemplo: '6,5', sinonimos: ['ipi', 'ipi %', 'ipi percentual'] },
  { campo: 'codigo_barras', titulo: 'CÓD. BARRAS', exemplo: '7898543141006', sinonimos: ['cod barras', 'codigo de barras', 'codigo barras', 'ean', 'gtin'] },
  { campo: 'ncm', titulo: 'NCM', exemplo: '39241000', sinonimos: ['ncm'] },
  { campo: 'categoria', titulo: 'CATEGORIA', exemplo: 'Confeitaria', sinonimos: ['categoria', 'grupo', 'linha'] },
  { campo: 'marca', titulo: 'MARCA', exemplo: '', sinonimos: ['marca'] },
  { campo: 'medida', titulo: 'MEDIDA', exemplo: '', sinonimos: ['medida', 'medidas', 'tamanho'] },
  { campo: 'cor', titulo: 'COR', exemplo: '', sinonimos: ['cor', 'cores'] },
  { campo: 'observacao', titulo: 'OBSERVAÇÃO', exemplo: '', sinonimos: ['observacao', 'obs'] }
]

const SIM = ['sim', 's', '1', 'true', 'x', 'verdadeiro']

type Aviso = 'ncm' | 'barras' | 'min_maior' | 'nao_multiplo' | 'sem_preco'

type LinhaPronta = {
  linha: number
  referencia: string
  descricao: string
  codigo_barras: string
  categoria: string
  marca: string
  medida: string
  cor: string
  ncm: string
  qtd_caixa: number
  qtd_minima: number
  nao_abre_caixa: number
  preco: number | null
  preco_promocional: number | null
  ipi: number
  novo: number
  observacao: string
}

const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const ehSim = (v: unknown) => SIM.includes(String(v ?? '').trim().toLowerCase())

// Confere e limpa uma linha da planilha. Devolve o erro (se houver) ou a linha pronta + avisos.
function prepararLinha(bruto: Record<string, unknown>, numero: number, itemExiste: boolean): { erro?: string; pronta?: LinhaPronta; avisos: Aviso[] } {
  const avisos: Aviso[] = []
  const referencia = txt(bruto.referencia, 60)
  if (!referencia) return { erro: 'Falta a referência (REF).', avisos }
  const descricao = txt(bruto.descricao, 300)
  if (!descricao && !itemExiste) return { erro: 'Falta a descrição (item novo precisa de descrição).', avisos }

  const num = (campo: string, rotulo: string): number | null | 'erro' => {
    const n = lerNumero(bruto[campo])
    if (n !== null && (Number.isNaN(n) || n < 0)) return erroNum(rotulo)
    return n
  }
  let msg = ''
  const erroNum = (rotulo: string) => {
    msg = msg || `${rotulo} não é um número válido.`
    return 'erro' as const
  }
  const preco = num('preco', 'PREÇO')
  const promo = num('preco_promocional', 'PREÇO PROMOCIONAL')
  const ipi = num('ipi', 'IPI %')
  const qc = num('qtd_caixa', 'QTD CAIXA')
  const qm = num('qtd_minima', 'QTD MÍNIMA')
  if (msg) return { erro: msg, avisos }
  const inteiro = (n: number | null | 'erro', rotulo: string) => (n !== null && n !== 'erro' && !Number.isInteger(n) ? rotulo : '')
  const naoInteiro = inteiro(qc, 'QTD CAIXA') || inteiro(qm, 'QTD MÍNIMA')
  if (naoInteiro) return { erro: `${naoInteiro} precisa ser um número inteiro.`, avisos }

  let ncm = soDigitos(String(bruto.ncm ?? ''))
  if (ncm && ncm.length !== 8) avisos.push('ncm')
  let barras = soDigitos(String(bruto.codigo_barras ?? '').replace(/\.0$/, ''))
  if (barras && ![8, 12, 13, 14].includes(barras.length)) avisos.push('barras')
  ncm = ncm.slice(0, 12)
  barras = barras.slice(0, 20)

  const qtdCaixa = (qc as number | null) ?? 0
  const qtdMinima = (qm as number | null) ?? 0
  if (qtdCaixa && qtdMinima && qtdMinima > qtdCaixa) avisos.push('min_maior')
  else if (qtdCaixa && qtdMinima && qtdCaixa % qtdMinima !== 0) avisos.push('nao_multiplo')

  const precoFinal = preco === null || preco === 'erro' ? null : arredondar2(preco)
  const promoFinal = promo === null || promo === 'erro' ? null : arredondar2(promo)
  // Sem preço e sem promoção: o item é criado, mas não entra na tabela (não aparece para o cliente).
  if ((precoFinal === null || precoFinal === 0) && (promoFinal === null || promoFinal === 0)) avisos.push('sem_preco')

  return {
    avisos,
    pronta: {
      linha: numero,
      referencia,
      descricao,
      codigo_barras: barras,
      categoria: txt(bruto.categoria, 120),
      marca: txt(bruto.marca, 120),
      medida: txt(bruto.medida, 120),
      cor: txt(bruto.cor, 120),
      ncm,
      qtd_caixa: qtdCaixa,
      qtd_minima: qtdMinima,
      nao_abre_caixa: ehSim(bruto.nao_abre_caixa) ? 1 : 0,
      preco: precoFinal && precoFinal > 0 ? precoFinal : null,
      preco_promocional: promoFinal && promoFinal > 0 ? promoFinal : null,
      ipi: ipi === null || ipi === 'erro' ? 0 : arredondar2(ipi),
      novo: ehSim(bruto.novo) ? 1 : 0,
      observacao: txt(bruto.observacao, 500)
    }
  }
}

// ---------- Tabelas de preço ----------
// Indústrias para escolher na tela (quem tem acesso a tabelas não precisa ter acesso ao cadastro de indústrias).
rotasTabelas.get('/industrias', exigirEquipe('tabelas.ver'), async (c) => {
  const r = await c.env.DB.prepare('SELECT id, nome, ativo FROM industrias ORDER BY ativo DESC, nome COLLATE NOCASE').all()
  return c.json({ itens: r.results })
})

rotasTabelas.get('/', exigirEquipe('tabelas.ver'), async (c) => {
  const industriaId = Number(c.req.query('industria_id'))
  if (!Number.isInteger(industriaId)) return c.json({ erro: 'Escolha a indústria.' }, 400)
  const r = await c.env.DB.prepare(
    `SELECT t.id, t.industria_id, t.nome, t.vencimento, t.tipo, t.prazo, t.ativo,
            (SELECT COUNT(*) FROM precos p WHERE p.tabela_id = t.id) AS n_itens,
            (t.id = i.tabela_padrao_id) AS padrao,
            (t.vencimento != '' AND t.vencimento < ?) AS vencida
       FROM tabelas_preco t JOIN industrias i ON i.id = t.industria_id
      WHERE t.industria_id = ? ORDER BY t.ativo DESC, t.nome COLLATE NOCASE`
  )
    .bind(hojeCuiaba(), industriaId)
    .all()
  return c.json({ itens: r.results })
})

function validarTabela(corpo: Record<string, unknown>, parcial: boolean) {
  const erros: string[] = []
  const v: { nome?: string; vencimento?: string; tipo?: string; prazo?: string; ativo?: number } = {}
  if (!parcial || corpo.nome !== undefined) {
    const nome = String(corpo.nome ?? '').trim()
    if (!nome) erros.push('Nome da tabela é obrigatório.')
    else if (nome.length > 100) erros.push('Nome da tabela está muito longo.')
    else v.nome = nome
  }
  if (corpo.vencimento !== undefined) {
    const d = String(corpo.vencimento ?? '').trim()
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) erros.push('Data de vencimento inválida.')
    else v.vencimento = d
  }
  if (!parcial || corpo.tipo !== undefined) {
    if (corpo.tipo !== 'vista' && corpo.tipo !== 'prazo') erros.push('Tipo da tabela precisa ser À vista ou A prazo.')
    else v.tipo = corpo.tipo
  }
  if (corpo.prazo !== undefined) {
    const p = String(corpo.prazo ?? '').trim()
    if (p.length > 60 || (p && !/^[0-9 /,.+a-zA-Z-]+$/.test(p))) erros.push('Prazo inválido. Exemplo: 30/45/55.')
    else v.prazo = p
  }
  if (corpo.ativo !== undefined) v.ativo = corpo.ativo === true || corpo.ativo === 1 ? 1 : 0
  return { v, erros }
}

rotasTabelas.post('/', exigirEquipe('tabelas.editar'), async (c) => {
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const industriaId = Number(corpo.industria_id)
  const ind = Number.isInteger(industriaId) ? await c.env.DB.prepare('SELECT id, tabela_padrao_id FROM industrias WHERE id = ?').bind(industriaId).first<{ id: number; tabela_padrao_id: number | null }>() : null
  if (!ind) return c.json({ erro: 'Indústria não encontrada.' }, 400)
  const { v, erros } = validarTabela(corpo, false)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  try {
    const r = await c.env.DB.prepare('INSERT INTO tabelas_preco (industria_id, nome, vencimento, tipo, prazo, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(industriaId, v.nome, v.vencimento ?? '', v.tipo, v.prazo ?? '', v.ativo ?? 1, Date.now())
      .run()
    const id = r.meta.last_row_id
    // A primeira tabela da indústria vira a padrão; "padrao: true" força.
    if (corpo.padrao === true || !ind.tabela_padrao_id) await c.env.DB.prepare('UPDATE industrias SET tabela_padrao_id = ? WHERE id = ?').bind(id, industriaId).run()
    return c.json({ item: { id } }, 201)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe uma tabela com esse nome nesta indústria.' }, 409)
    throw e
  }
})

rotasTabelas.put('/:id', exigirEquipe('tabelas.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  const t = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id, industria_id FROM tabelas_preco WHERE id = ?').bind(id).first<{ id: number; industria_id: number }>() : null
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const corpo = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const { v, erros } = validarTabela(corpo, true)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  const nomes = Object.keys(v)
  try {
    if (nomes.length) await c.env.DB.prepare(`UPDATE tabelas_preco SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`).bind(...nomes.map((n) => (v as Record<string, unknown>)[n]), id).run()
    if (corpo.padrao === true) await c.env.DB.prepare('UPDATE industrias SET tabela_padrao_id = ? WHERE id = ?').bind(id, t.industria_id).run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe uma tabela com esse nome nesta indústria.' }, 409)
    throw e
  }
  return c.json({ ok: true })
})

// Itens de uma tabela (com busca e páginas de 50)
rotasTabelas.get('/:id/itens', exigirEquipe('tabelas.ver'), async (c) => {
  const id = Number(c.req.param('id'))
  const t = Number.isInteger(id) ? await c.env.DB.prepare('SELECT t.*, i.nome AS industria FROM tabelas_preco t JOIN industrias i ON i.id = t.industria_id WHERE t.id = ?').bind(id).first() : null
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const busca = (c.req.query('busca') ?? '').trim()
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const porPagina = 50
  const filtro = busca ? 'AND (it.referencia LIKE ? OR it.descricao LIKE ? OR it.codigo_barras LIKE ?)' : ''
  const args = busca ? [`%${busca}%`, `%${busca}%`, `%${busca}%`] : []
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ? ${filtro}`).bind(id, ...args).first<{ n: number }>()
  const r = await c.env.DB.prepare(
    `SELECT it.id AS item_id, it.referencia, it.descricao, it.categoria, it.qtd_caixa, it.qtd_minima, it.nao_abre_caixa,
            p.preco, p.preco_promocional, p.ipi, p.novo, p.observacao,
            (SELECT COUNT(*) FROM fotos f WHERE f.item_id = it.id) AS n_fotos
       FROM precos p JOIN itens it ON it.id = p.item_id
      WHERE p.tabela_id = ? ${filtro}
      ORDER BY it.referencia COLLATE NOCASE LIMIT ? OFFSET ?`
  )
    .bind(id, ...args, porPagina, (pagina - 1) * porPagina)
    .all()
  return c.json({ tabela: t, itens: r.results, total: total?.n ?? 0, pagina, por_pagina: porPagina })
})

// Remove todos os preços da tabela (os itens continuam cadastrados). Usado para reimportar do zero.
rotasTabelas.delete('/:id/precos', exigirEquipe('tabelas.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  const t = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id FROM tabelas_preco WHERE id = ?').bind(id).first() : null
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const r = await c.env.DB.prepare('DELETE FROM precos WHERE tabela_id = ?').bind(id).run()
  return c.json({ removidos: r.meta.changes })
})

rotasTabelas.get('/importacao/modelo', exigirEquipe('tabelas.editar'), (c) => c.json({ colunas: COLUNAS_TABELA, lote: 250 }))

// Importação da planilha de preços: cria itens novos, preenche só o que está em branco nos que já existem,
// e grava preço/promoção/IPI/novo/observação desta tabela. A tela envia em lotes de até 250 linhas.
rotasTabelas.post('/:id/importar', exigirEquipe('tabelas.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  const t = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id, industria_id FROM tabelas_preco WHERE id = ?').bind(id).first<{ id: number; industria_id: number }>() : null
  if (!t) return c.json({ erro: 'Tabela não encontrada.' }, 404)
  const corpo = await c.req.json<{ linhas?: Record<string, unknown>[]; aplicar?: boolean; primeira_linha?: number }>().catch(() => ({}) as { linhas?: Record<string, unknown>[]; aplicar?: boolean; primeira_linha?: number })
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : []
  if (!linhas.length) return c.json({ erro: 'Nenhuma linha para importar.' }, 400)
  if (linhas.length > 300) return c.json({ erro: 'Envie no máximo 300 linhas por vez.' }, 400)
  const inicio = Number(corpo.primeira_linha) || 2
  const db = c.env.DB

  const existentes = new Set(
    ((await db.prepare('SELECT referencia FROM itens WHERE industria_id = ?').bind(t.industria_id).all<{ referencia: string }>()).results ?? []).map((x) => x.referencia.toLowerCase())
  )
  const jaTemPreco = new Set(
    ((await db.prepare('SELECT it.referencia FROM precos p JOIN itens it ON it.id = p.item_id WHERE p.tabela_id = ?').bind(id).all<{ referencia: string }>()).results ?? []).map((x) => x.referencia.toLowerCase())
  )

  const prontas: LinhaPronta[] = []
  const problemas: { linha: number; referencia: string; mensagem: string }[] = []
  const avisos: Record<string, number> = {}
  const vistas = new Set<string>()
  linhas.forEach((bruto, i) => {
    const numero = (typeof bruto.__linha === 'number' ? bruto.__linha : inicio + i) as number
    const ref = String(bruto.referencia ?? '').trim()
    if (ref && vistas.has(ref.toLowerCase())) return problemas.push({ linha: numero, referencia: ref, mensagem: 'Referência repetida neste lote.' })
    if (ref) vistas.add(ref.toLowerCase())
    const r = prepararLinha(bruto, numero, existentes.has(ref.toLowerCase()))
    if (r.erro || !r.pronta) return problemas.push({ linha: numero, referencia: ref || '—', mensagem: r.erro ?? 'Linha inválida.' })
    for (const a of r.avisos) avisos[a] = (avisos[a] ?? 0) + 1
    prontas.push(r.pronta)
  })

  const resumo = {
    itens_novos: prontas.filter((p) => !existentes.has(p.referencia.toLowerCase())).length,
    itens_existentes: prontas.filter((p) => existentes.has(p.referencia.toLowerCase())).length,
    precos_novos: prontas.filter((p) => (p.preco || p.preco_promocional) && !jaTemPreco.has(p.referencia.toLowerCase())).length,
    precos_atualizados: prontas.filter((p) => (p.preco || p.preco_promocional) && jaTemPreco.has(p.referencia.toLowerCase())).length,
    sem_preco: prontas.filter((p) => !p.preco && !p.preco_promocional).length,
    erros: problemas.length
  }
  if (!corpo.aplicar) return c.json({ aplicado: false, resumo, avisos, problemas })

  const agora = Date.now()
  const comandos: D1PreparedStatement[] = []
  for (const p of prontas) {
    // Item: cria; se já existe, só preenche o que estiver em branco (nunca sobrescreve).
    comandos.push(
      db
        .prepare(
          `INSERT INTO itens (industria_id, referencia, descricao, codigo_barras, categoria, marca, medida, cor, ncm, qtd_caixa, qtd_minima, nao_abre_caixa, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (industria_id, referencia) DO UPDATE SET
             descricao = CASE WHEN itens.descricao = '' THEN excluded.descricao ELSE itens.descricao END,
             codigo_barras = CASE WHEN itens.codigo_barras = '' THEN excluded.codigo_barras ELSE itens.codigo_barras END,
             categoria = CASE WHEN itens.categoria = '' THEN excluded.categoria ELSE itens.categoria END,
             marca = CASE WHEN itens.marca = '' THEN excluded.marca ELSE itens.marca END,
             medida = CASE WHEN itens.medida = '' THEN excluded.medida ELSE itens.medida END,
             cor = CASE WHEN itens.cor = '' THEN excluded.cor ELSE itens.cor END,
             ncm = CASE WHEN itens.ncm = '' THEN excluded.ncm ELSE itens.ncm END,
             qtd_caixa = CASE WHEN itens.qtd_caixa = 0 THEN excluded.qtd_caixa ELSE itens.qtd_caixa END,
             qtd_minima = CASE WHEN itens.qtd_minima = 0 THEN excluded.qtd_minima ELSE itens.qtd_minima END`
        )
        .bind(t.industria_id, p.referencia, p.descricao, p.codigo_barras, p.categoria, p.marca, p.medida, p.cor, p.ncm, p.qtd_caixa, p.qtd_minima, p.nao_abre_caixa, agora)
    )
    if (p.preco || p.preco_promocional) {
      // Preço da tabela: a planilha manda (sobrescreve preço, promoção, IPI, "novo" e observação desta tabela).
      comandos.push(
        db
          .prepare(
            `INSERT INTO precos (tabela_id, item_id, preco, preco_promocional, ipi, novo, observacao)
             VALUES (?, (SELECT id FROM itens WHERE industria_id = ? AND referencia = ?), ?, ?, ?, ?, ?)
             ON CONFLICT (tabela_id, item_id) DO UPDATE SET preco = excluded.preco, preco_promocional = excluded.preco_promocional, ipi = excluded.ipi, novo = excluded.novo, observacao = excluded.observacao`
          )
          .bind(id, t.industria_id, p.referencia, p.preco, p.preco_promocional, p.ipi, p.novo, p.observacao)
      )
    }
  }
  for (let i = 0; i < comandos.length; i += 100) await db.batch(comandos.slice(i, i + 100))
  return c.json({ aplicado: true, resumo, avisos, problemas })
})
