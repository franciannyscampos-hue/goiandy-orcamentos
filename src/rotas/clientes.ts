import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'
import { gerarHashSenha, senhaProvisoria } from '../auth/crypto'
import { limpar, type Campo } from './cadastro-generico'
import { cnpjValido, soDigitos } from '../util/validar'
import { consultarCnpj } from '../util/cnpj-consulta'
import { consultarCep } from '../util/cep-consulta'
import { criarImportacao, minusculo } from './importacao'

const t = (nome: string, rotulo: string, max = 200, extra: Partial<Campo> = {}): Campo => ({ nome, rotulo, tipo: 'texto', max, ...extra })

const CAMPOS_CLIENTE: Campo[] = [
  { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj', obrigatorio: true },
  t('razao_social', 'Razão social', 200, { obrigatorio: true }),
  t('nome_fantasia', 'Nome fantasia'),
  t('inscricao_estadual', 'Inscrição estadual', 30),
  t('endereco', 'Endereço', 250),
  { nome: 'cep', rotulo: 'CEP', tipo: 'cep' },
  t('cidade', 'Cidade', 100),
  t('uf', 'UF', 2),
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
  { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'telefone' },
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
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
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
            (SELECT COUNT(*) FROM compradores b WHERE b.cliente_id = c.id AND b.ativo = 1) AS n_compradores,
            (SELECT COUNT(*) FROM liberacoes l WHERE l.cliente_id = c.id) AS n_liberacoes
     FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id
     ORDER BY c.ativo DESC, c.razao_social COLLATE NOCASE`
  ).all()
  return c.json({ itens: r.results })
})

// Consulta de CEP (endereço, bairro, cidade e UF).
rotasClientes.get('/consulta-cep/:cep', exigirEquipe('clientes.editar'), async (c) => {
  const cep = soDigitos(c.req.param('cep'))
  if (cep.length !== 8) return c.json({ erro: 'O CEP precisa ter 8 números.' }, 400)
  const r = await consultarCep(cep)
  if (!r.ok) return c.json({ erro: r.erro }, r.status as 404 | 502)
  return c.json({ dados: r.dados })
})

// Consulta o CNPJ na Receita (BrasilAPI) e avisa se já está cadastrado. Fica antes de /:id.
rotasClientes.get('/consulta-cnpj/:cnpj', exigirEquipe('clientes.editar'), async (c) => {
  const cnpj = soDigitos(c.req.param('cnpj'))
  if (!cnpjValido(cnpj)) return c.json({ erro: 'CNPJ não é um CNPJ válido.' }, 400)
  const existente = await c.env.DB.prepare('SELECT id, razao_social FROM clientes WHERE cnpj = ?').bind(cnpj).first<{ id: number; razao_social: string }>()
  const r = await consultarCnpj(cnpj)
  if (!r.ok) return c.json({ erro: r.erro, ja_cadastrado: existente }, r.status as 404 | 502)
  return c.json({ dados: r.dados, ja_cadastrado: existente })
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

// Gera a senha provisória do comprador (aparece uma única vez; o comprador troca no primeiro acesso)
rotasClientes.post('/compradores/:cid/senha', exigirEquipe('clientes.editar'), async (c) => {
  const cid = Number(c.req.param('cid'))
  const b = Number.isInteger(cid) ? await c.env.DB.prepare('SELECT id, email, ativo FROM compradores WHERE id = ?').bind(cid).first<{ id: number; email: string; ativo: number }>() : null
  if (!b) return c.json({ erro: 'Comprador não encontrado.' }, 404)
  if (!b.ativo) return c.json({ erro: 'Este comprador está inativo.' }, 400)
  const senha = senhaProvisoria()
  const { hash, salt } = await gerarHashSenha(senha)
  await c.env.DB.prepare('UPDATE compradores SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = 0 WHERE id = ?').bind(hash, salt, cid).run()
  await c.env.DB.prepare("DELETE FROM sessoes WHERE tipo = 'comprador' AND usuario_id = ?").bind(cid).run()
  await c.env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), c.get('usuario').id, 'comprador.senha', b.email).run()
  return c.json({ senha, email: b.email })
})

// Importação em massa de clientes (a chave é o CNPJ; vendedor e transportadora entram pelo nome já cadastrado).
async function mapaNomes(db: D1Database, tabela: 'vendedores' | 'transportadoras') {
  const r = await db.prepare(`SELECT id, nome FROM ${tabela}`).all<{ id: number; nome: string }>()
  return new Map((r.results ?? []).map((x) => [minusculo(x.nome), x.id]))
}

rotasClientes.route(
  '/',
  criarImportacao({
    tabela: 'clientes',
    campos: CAMPOS_CLIENTE,
    permissao: 'clientes.editar',
    comCriadoEm: true,
    colunas: [
      { titulo: 'CNPJ', campo: 'cnpj', exemplo: '45.723.174/0001-10', obrigatorio: true, largura: 22 },
      { titulo: 'Razão social', campo: 'razao_social', exemplo: 'Mercado Bom Ltda', obrigatorio: true, largura: 32 },
      { titulo: 'Nome fantasia', campo: 'nome_fantasia', exemplo: 'Mercado Bom', largura: 24 },
      { titulo: 'Inscrição estadual', campo: 'inscricao_estadual', exemplo: '13.456.789-0', largura: 20 },
      { titulo: 'Endereço', campo: 'endereco', exemplo: 'Av. Principal, 100, Centro', largura: 34 },
      { titulo: 'CEP', campo: 'cep', exemplo: '78005-000' },
      { titulo: 'Cidade', campo: 'cidade', exemplo: 'Cuiabá' },
      { titulo: 'UF', campo: 'uf', exemplo: 'MT', largura: 6 },
      { titulo: 'Telefone', campo: 'telefone', exemplo: '(65) 3333-4444' },
      { titulo: 'WhatsApp', campo: 'whatsapp', exemplo: '(65) 99999-0000' },
      { titulo: 'E-mail NF-e', campo: 'email_nfe', exemplo: 'nfe@mercadobom.com.br', largura: 28 },
      { titulo: 'E-mail financeiro', campo: 'email_financeiro', exemplo: 'financeiro@mercadobom.com.br', largura: 28 },
      { titulo: 'Segmento', campo: 'segmento', exemplo: 'Utilidades domésticas', largura: 24 },
      { titulo: 'Categoria', campo: 'categoria', exemplo: 'A', largura: 14 },
      { titulo: 'Rede', campo: 'rede', exemplo: 'Rede Bom Preço', largura: 20 },
      { titulo: 'Suframa', campo: 'suframa', exemplo: '' },
      { titulo: 'Código SuasVendas', campo: 'codigo_suasvendas', exemplo: '1234', largura: 18 },
      { titulo: 'Vendedor (nome já cadastrado)', campo: 'vendedor', exemplo: 'Maria Souza', largura: 28 },
      { titulo: 'Transportadora (nome já cadastrado)', campo: 'transportadora', exemplo: 'Rodonaves', largura: 32 },
      { titulo: 'Pode ver preços (Sim/Não)', campo: 'ver_precos', exemplo: 'Sim', largura: 24 },
      { titulo: 'Ativo (Sim/Não)', campo: 'ativo', exemplo: 'Sim' }
    ],
    preparar: async (db) => {
      const existentes = new Map(
        ((await db.prepare('SELECT id, cnpj FROM clientes').all<{ id: number; cnpj: string }>()).results ?? []).map((x) => [x.cnpj, x.id])
      )
      const vendedores = await mapaNomes(db, 'vendedores')
      const transportadoras = await mapaNomes(db, 'transportadoras')
      return {
        chaveDe: (b) => soDigitos(b.cnpj ?? ''),
        existentes,
        extras: (b) => {
          const valores: Record<string, number | null> = {}
          const erros: string[] = []
          const v = (b.vendedor ?? '').trim()
          if (v) {
            const id = vendedores.get(minusculo(v))
            if (id === undefined) erros.push(`Vendedor "${v}" não está cadastrado.`)
            else valores.vendedor_id = id
          }
          const t = (b.transportadora ?? '').trim()
          if (t) {
            const id = transportadoras.get(minusculo(t))
            if (id === undefined) erros.push(`Transportadora "${t}" não está cadastrada.`)
            else valores.transportadora_id = id
          }
          return { valores, erros }
        }
      }
    }
  })
)
