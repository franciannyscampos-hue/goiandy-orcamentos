import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { limpar, type Campo } from './cadastro-generico'

const t = (nome: string, rotulo: string, max = 200, extra: Partial<Campo> = {}): Campo => ({ nome, rotulo, tipo: 'texto', max, ...extra })

const CAMPOS_CLIENTE: Campo[] = [
  { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj', obrigatorio: true },
  t('razao_social', 'Razão social', 200, { obrigatorio: true }),
  t('nome_fantasia', 'Nome fantasia'),
  t('inscricao_estadual', 'Inscrição estadual', 30),
  t('endereco', 'Endereço', 250),
  t('cep', 'CEP', 12),
  t('cidade', 'Cidade', 100),
  t('uf', 'UF', 2),
  t('telefone', 'Telefone', 30),
  t('whatsapp', 'WhatsApp', 30),
  { nome: 'email_nfe', rotulo: 'E-mail NF-e', tipo: 'email', max: 160 },
  { nome: 'email_financeiro', rotulo: 'E-mail financeiro', tipo: 'email', max: 160 },
  t('segmento', 'Segmento', 100),
  t('categoria', 'Categoria', 100),
  t('rede', 'Rede', 100),
  t('suframa', 'Suframa', 30),
  t('codigo_suasvendas', 'Código SuasVendas', 30),
  { nome: 'ver_precos', rotulo: 'Ver preços', tipo: 'bool', padrao: true },
  { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: true }
]

const CAMPOS_COMPRADOR: Campo[] = [
  t('nome', 'Nome', 120, { obrigatorio: true }),
  { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, max: 160 },
  t('telefone', 'Telefone', 30),
  { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: true }
]

const MAX_COMPRADORES = 5
const COLUNAS_COMPRADOR = 'id, cliente_id, nome, email, telefone, ativo, (senha_hash IS NOT NULL) AS tem_senha'

export const rotasClientes = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

// Valida vendedor/transportadora (opcionais): devolve null se vazio, undefined se inválido.
async function chaveEstrangeira(db: D1Database, tabela: 'vendedores' | 'transportadoras', bruto: unknown): Promise<number | null | undefined> {
  if (bruto === undefined || bruto === null || bruto === '' || bruto === 0) return null
  const id = Number(bruto)
  if (!Number.isInteger(id)) return undefined
  const achou = await db.prepare(`SELECT id FROM ${tabela} WHERE id = ?`).bind(id).first()
  return achou ? id : undefined
}

rotasClientes.get('/', exigirEquipe('clientes.ver'), async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT c.id, c.cnpj, c.razao_social, c.nome_fantasia, c.cidade, c.uf, c.ver_precos, c.ativo,
            c.vendedor_id, v.nome AS vendedor_nome,
            (SELECT COUNT(*) FROM compradores b WHERE b.cliente_id = c.id AND b.ativo = 1) AS n_compradores
     FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id
     ORDER BY c.ativo DESC, c.razao_social COLLATE NOCASE`
  ).all()
  return c.json({ itens: r.results })
})

rotasClientes.get('/:id', exigirEquipe('clientes.ver'), async (c) => {
  const id = Number(c.req.param('id'))
  const cliente = Number.isInteger(id) ? await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first() : null
  if (!cliente) return c.json({ erro: 'Cliente não encontrado.' }, 404)
  const compradores = await c.env.DB.prepare(`SELECT ${COLUNAS_COMPRADOR} FROM compradores WHERE cliente_id = ? ORDER BY ativo DESC, nome COLLATE NOCASE`)
    .bind(id)
    .all()
  return c.json({ cliente, compradores: compradores.results, limite_compradores: MAX_COMPRADORES })
})

async function salvarCliente(c: any, id: number | null) {
  const corpo = await c.req.json().catch(() => ({}))
  const { valores, erros } = limpar(corpo, CAMPOS_CLIENTE, id !== null)
  if (valores.uf) valores.uf = String(valores.uf).toUpperCase()
  const extras: Record<string, number | null> = {}
  if (id === null || corpo.vendedor_id !== undefined) {
    const v = await chaveEstrangeira(c.env.DB, 'vendedores', corpo.vendedor_id)
    if (v === undefined) erros.push('Vendedor não encontrado.')
    else extras.vendedor_id = v
  }
  if (id === null || corpo.transportadora_id !== undefined) {
    const tr = await chaveEstrangeira(c.env.DB, 'transportadoras', corpo.transportadora_id)
    if (tr === undefined) erros.push('Transportadora não encontrada.')
    else extras.transportadora_id = tr
  }
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  const todos: Record<string, string | number | null> = { ...valores, ...extras }
  const nomes = Object.keys(todos)
  try {
    if (id === null) {
      const r = await c.env.DB.prepare(`INSERT INTO clientes (${nomes.join(', ')}, criado_em) VALUES (${nomes.map(() => '?').join(', ')}, ?)`)
        .bind(...nomes.map((n) => todos[n]), Date.now())
        .run()
      id = r.meta.last_row_id as number
    } else {
      if (!nomes.length) return c.json({ erro: 'Nada para alterar.' }, 400)
      const r = await c.env.DB.prepare(`UPDATE clientes SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
        .bind(...nomes.map((n) => todos[n]), id)
        .run()
      if (!r.meta.changes) return c.json({ erro: 'Cliente não encontrado.' }, 404)
    }
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Já existe um cliente com esse CNPJ.' }, 409)
    throw e
  }
  const item = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first()
  return c.json({ item }, 200)
}

rotasClientes.post('/', exigirEquipe('clientes.editar'), (c) => salvarCliente(c, null).then((r) => (r.status === 200 ? new Response(r.body, { status: 201, headers: r.headers }) : r)))

rotasClientes.put('/:id', exigirEquipe('clientes.editar'), (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ erro: 'Cliente não encontrado.' }, 404)
  return salvarCliente(c, id)
})

// Compradores (até 5 ativos por CNPJ; cada um entra com o próprio e-mail)
rotasClientes.post('/:id/compradores', exigirEquipe('clientes.editar'), async (c) => {
  const clienteId = Number(c.req.param('id'))
  const cliente = Number.isInteger(clienteId) ? await c.env.DB.prepare('SELECT id FROM clientes WHERE id = ?').bind(clienteId).first() : null
  if (!cliente) return c.json({ erro: 'Cliente não encontrado.' }, 404)
  const corpo = await c.req.json().catch(() => ({}))
  const { valores, erros } = limpar(corpo, CAMPOS_COMPRADOR, false)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  if (valores.ativo === 1) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM compradores WHERE cliente_id = ? AND ativo = 1').bind(clienteId).first<{ n: number }>()
    if ((n?.n ?? 0) >= MAX_COMPRADORES) return c.json({ erro: `Cada CNPJ pode ter no máximo ${MAX_COMPRADORES} compradores ativos.` }, 400)
  }
  try {
    const r = await c.env.DB.prepare('INSERT INTO compradores (cliente_id, nome, email, telefone, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(clienteId, valores.nome, valores.email, valores.telefone, valores.ativo, Date.now())
      .run()
    const item = await c.env.DB.prepare(`SELECT ${COLUNAS_COMPRADOR} FROM compradores WHERE id = ?`).bind(r.meta.last_row_id).first()
    return c.json({ item }, 201)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Este e-mail já está cadastrado como comprador.' }, 409)
    throw e
  }
})

rotasClientes.put('/compradores/:cid', exigirEquipe('clientes.editar'), async (c) => {
  const cid = Number(c.req.param('cid'))
  const atual = Number.isInteger(cid) ? await c.env.DB.prepare('SELECT cliente_id, ativo FROM compradores WHERE id = ?').bind(cid).first<{ cliente_id: number; ativo: number }>() : null
  if (!atual) return c.json({ erro: 'Comprador não encontrado.' }, 404)
  const corpo = await c.req.json().catch(() => ({}))
  const { valores, erros } = limpar(corpo, CAMPOS_COMPRADOR, true)
  if (erros.length) return c.json({ erro: erros[0], erros }, 400)
  const nomes = Object.keys(valores)
  if (!nomes.length) return c.json({ erro: 'Nada para alterar.' }, 400)
  if (valores.ativo === 1 && atual.ativo === 0) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM compradores WHERE cliente_id = ? AND ativo = 1').bind(atual.cliente_id).first<{ n: number }>()
    if ((n?.n ?? 0) >= MAX_COMPRADORES) return c.json({ erro: `Cada CNPJ pode ter no máximo ${MAX_COMPRADORES} compradores ativos.` }, 400)
  }
  try {
    await c.env.DB.prepare(`UPDATE compradores SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
      .bind(...nomes.map((n) => valores[n]), cid)
      .run()
    if (valores.ativo === 0) await c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'comprador' AND usuario_id = ?").bind(cid).run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'Este e-mail já está cadastrado como comprador.' }, 409)
    throw e
  }
  const item = await c.env.DB.prepare(`SELECT ${COLUNAS_COMPRADOR} FROM compradores WHERE id = ?`).bind(cid).first()
  return c.json({ item })
})
