import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { lerNumero } from '../util/numeros'
import { soDigitos } from '../util/validar'

export const rotasItens = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

const MAX_FOTO = 5 * 1024 * 1024
const POR_PAGINA = 50

// Descobre o tipo da imagem pelo conteúdo (não confia no nome nem no cabeçalho enviado).
function tipoImagem(b: Uint8Array): string | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

// "1234" -> foto 1; "1234(3)" ou "1234 (3)" -> foto 3. Aceita a extensão no fim.
export function lerNomeFoto(nome: string): { referencia: string; posicao: number } | null {
  const base = nome.split(/[\\/]/).pop()!.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim()
  const m = base.match(/^(.*?)\s*\((\d)\)$/)
  const referencia = (m ? m[1] : base).trim()
  const posicao = m ? Number(m[2]) : 1
  if (!referencia || posicao < 1 || posicao > 5) return null
  return { referencia, posicao }
}

async function guardarFoto(c: { env: Bindings }, itemId: number, posicao: number, bytes: Uint8Array) {
  const tipo = tipoImagem(bytes)
  if (!tipo) return { erro: 'O arquivo não é uma imagem JPG, PNG ou WebP.', status: 400 as const }
  if (bytes.length > MAX_FOTO) return { erro: 'A foto passa de 5 MB.', status: 413 as const }
  const antiga = await c.env.DB.prepare('SELECT chave FROM fotos WHERE item_id = ? AND posicao = ?').bind(itemId, posicao).first<{ chave: string }>()
  const sufixo = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => x.toString(16).padStart(2, '0')).join('')
  const chave = `fotos/${itemId}/${posicao}-${sufixo}`
  await c.env.ARQUIVOS.put(chave, bytes, { httpMetadata: { contentType: tipo } })
  await c.env.DB.prepare(
    `INSERT INTO fotos (item_id, posicao, chave, tipo_conteudo, tamanho, criado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id, posicao) DO UPDATE SET chave = excluded.chave, tipo_conteudo = excluded.tipo_conteudo, tamanho = excluded.tamanho, criado_em = excluded.criado_em`
  ).bind(itemId, posicao, chave, tipo, bytes.length, Date.now()).run()
  if (antiga) await c.env.ARQUIVOS.delete(antiga.chave)
  return { ok: true as const }
}

rotasItens.get('/industrias', exigirEquipe('itens.ver'), async (c) => {
  const r = await c.env.DB.prepare('SELECT id, nome, ativo FROM industrias ORDER BY ativo DESC, nome COLLATE NOCASE').all()
  return c.json({ itens: r.results })
})

// Filtros comuns da lista e do relatório: indústria (opcional), busca e com/sem foto.
function filtrosItens(c: { req: { query: (k: string) => string | undefined } }) {
  const filtros: string[] = []
  const args: unknown[] = []
  const industria = Number(c.req.query('industria_id'))
  if (Number.isInteger(industria) && industria > 0) {
    filtros.push('it.industria_id = ?')
    args.push(industria)
  }
  const busca = (c.req.query('busca') ?? '').trim()
  if (busca) {
    filtros.push('(it.referencia LIKE ? OR it.descricao LIKE ? OR it.codigo_barras LIKE ?)')
    args.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
  }
  const foto = c.req.query('foto') ?? (c.req.query('sem_foto') === '1' ? 'sem' : '')
  if (foto === 'sem') filtros.push('NOT EXISTS (SELECT 1 FROM fotos f WHERE f.item_id = it.id)')
  if (foto === 'com') filtros.push('EXISTS (SELECT 1 FROM fotos f WHERE f.item_id = it.id)')
  return { filtros, args }
}

rotasItens.get('/', exigirEquipe('itens.ver'), async (c) => {
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const { filtros, args } = filtrosItens(c)
  const onde = filtros.length ? filtros.join(' AND ') : '1 = 1'
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM itens it WHERE ${onde}`).bind(...args).first<{ n: number }>()
  const r = await c.env.DB.prepare(
    `SELECT it.id, it.referencia, it.descricao, it.categoria, it.ativo, ind.nome AS industria,
            (SELECT COUNT(*) FROM fotos f WHERE f.item_id = it.id) AS n_fotos,
            (SELECT f.id FROM fotos f WHERE f.item_id = it.id ORDER BY f.posicao LIMIT 1) AS foto_id
       FROM itens it JOIN industrias ind ON ind.id = it.industria_id WHERE ${onde}
      ORDER BY ind.nome COLLATE NOCASE, it.referencia COLLATE NOCASE LIMIT ? OFFSET ?`
  ).bind(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA).all()
  return c.json({ itens: r.results, total: total?.n ?? 0, pagina, por_pagina: POR_PAGINA })
})

// Relatório para Excel: devolve em blocos (depois_id) para a tela juntar tudo em uma planilha só.
rotasItens.get('/exportar', exigirEquipe('itens.ver'), async (c) => {
  const depois = Math.max(0, Number(c.req.query('depois_id')) || 0)
  const { filtros, args } = filtrosItens(c)
  filtros.push('it.id > ?')
  args.push(depois)
  const lote = 2000
  const r = await c.env.DB.prepare(
    `SELECT it.id, ind.nome AS industria, it.referencia, it.descricao, it.categoria, it.marca, it.codigo_barras, it.qtd_caixa, it.qtd_minima, it.ativo,
            (SELECT COUNT(*) FROM fotos f WHERE f.item_id = it.id) AS n_fotos
       FROM itens it JOIN industrias ind ON ind.id = it.industria_id WHERE ${filtros.join(' AND ')} ORDER BY it.id LIMIT ?`
  ).bind(...args, lote).all<{ id: number }>()
  const itens = r.results
  return c.json({ itens, proximo: itens.length === lote ? itens[itens.length - 1].id : null })
})

// Envio em massa: o item é achado pelo nome do arquivo (referência + posição) dentro da indústria.
rotasItens.post('/fotos-lote', exigirEquipe('fotos.enviar'), async (c) => {
  const industria = Number(c.req.query('industria_id'))
  const nome = c.req.query('nome') ?? ''
  if (!Number.isInteger(industria) || industria <= 0) return c.json({ erro: 'Escolha a indústria.' }, 400)
  const lido = lerNomeFoto(nome)
  if (!lido) return c.json({ erro: 'Nome do arquivo fora do padrão (use 1234, 1234(1) ... 1234(5)).' }, 400)
  const item = await c.env.DB.prepare('SELECT id FROM itens WHERE industria_id = ? AND referencia = ?').bind(industria, lido.referencia).first<{ id: number }>()
  if (!item) return c.json({ erro: `A referência ${lido.referencia} não está cadastrada nesta indústria.`, referencia: lido.referencia }, 404)
  const r = await guardarFoto(c, item.id, lido.posicao, new Uint8Array(await c.req.arrayBuffer()))
  if ('erro' in r) return c.json({ erro: r.erro }, r.status)
  return c.json({ ok: true, referencia: lido.referencia, posicao: lido.posicao })
})

// Entrega a foto (só para a equipe logada; o acesso dos clientes entra na etapa do portal)
rotasItens.get('/foto/:id', exigirEquipe('itens.ver'), async (c) => {
  const f = await c.env.DB.prepare('SELECT chave, tipo_conteudo FROM fotos WHERE id = ?').bind(Number(c.req.param('id'))).first<{ chave: string; tipo_conteudo: string }>()
  if (!f) return c.json({ erro: 'Foto não encontrada.' }, 404)
  const o = await c.env.ARQUIVOS.get(f.chave)
  if (!o) return c.json({ erro: 'Foto não encontrada.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': f.tipo_conteudo, 'Cache-Control': 'private, max-age=3600' } })
})

async function carregarItem(c: { env: Bindings }, id: number) {
  const item = await c.env.DB.prepare('SELECT it.*, i.nome AS industria FROM itens it JOIN industrias i ON i.id = it.industria_id WHERE it.id = ?').bind(id).first()
  if (!item) return null
  const fotos = await c.env.DB.prepare('SELECT id, posicao FROM fotos WHERE item_id = ? ORDER BY posicao').bind(id).all()
  return { item, fotos: fotos.results }
}

rotasItens.get('/:id', exigirEquipe('itens.ver'), async (c) => {
  const r = await carregarItem(c, Number(c.req.param('id')))
  return r ? c.json(r) : c.json({ erro: 'Item não encontrado.' }, 404)
})

rotasItens.put('/:id', exigirEquipe('itens.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await c.env.DB.prepare('SELECT id FROM itens WHERE id = ?').bind(id).first())) return c.json({ erro: 'Item não encontrado.' }, 404)
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const texto = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
  const descricao = texto(b.descricao)
  if (!descricao) return c.json({ erro: 'A descrição é obrigatória.' }, 400)
  const inteiro = (v: unknown, nome: string) => {
    const n = lerNumero(v)
    if (n === null) return 0
    if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) throw new Error(`${nome} precisa ser um número inteiro.`)
    return n
  }
  let qtdCaixa = 0
  let qtdMinima = 0
  try {
    qtdCaixa = inteiro(b.qtd_caixa, 'Quantidade da caixa')
    qtdMinima = inteiro(b.qtd_minima, 'Quantidade mínima')
  } catch (e) {
    return c.json({ erro: (e as Error).message }, 400)
  }
  await c.env.DB.prepare(
    `UPDATE itens SET descricao = ?, codigo_barras = ?, categoria = ?, marca = ?, medida = ?, cor = ?, ncm = ?, qtd_caixa = ?, qtd_minima = ?, nao_abre_caixa = ?, ativo = ? WHERE id = ?`
  ).bind(descricao, soDigitos(texto(b.codigo_barras, 30)), texto(b.categoria, 100), texto(b.marca, 100), texto(b.medida, 100), texto(b.cor, 100), soDigitos(texto(b.ncm, 20)), qtdCaixa, qtdMinima, b.nao_abre_caixa ? 1 : 0, b.ativo === false ? 0 : 1, id).run()
  return c.json({ ok: true })
})

rotasItens.post('/:id/fotos/:posicao', exigirEquipe('fotos.enviar'), async (c) => {
  const id = Number(c.req.param('id'))
  const posicao = Number(c.req.param('posicao'))
  if (!Number.isInteger(posicao) || posicao < 1 || posicao > 5) return c.json({ erro: 'A posição da foto vai de 1 a 5.' }, 400)
  if (!(await c.env.DB.prepare('SELECT id FROM itens WHERE id = ?').bind(id).first())) return c.json({ erro: 'Item não encontrado.' }, 404)
  const r = await guardarFoto(c, id, posicao, new Uint8Array(await c.req.arrayBuffer()))
  if ('erro' in r) return c.json({ erro: r.erro }, r.status)
  return c.json({ ok: true })
})

rotasItens.delete('/:id/fotos/:posicao', exigirEquipe('fotos.enviar'), async (c) => {
  const id = Number(c.req.param('id'))
  const f = await c.env.DB.prepare('SELECT chave FROM fotos WHERE item_id = ? AND posicao = ?').bind(id, Number(c.req.param('posicao'))).first<{ chave: string }>()
  if (!f) return c.json({ erro: 'Foto não encontrada.' }, 404)
  await c.env.ARQUIVOS.delete(f.chave)
  await c.env.DB.prepare('DELETE FROM fotos WHERE item_id = ? AND posicao = ?').bind(id, Number(c.req.param('posicao'))).run()
  return c.json({ ok: true })
})
