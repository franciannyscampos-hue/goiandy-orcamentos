import { criarCadastro, type Campo } from './cadastro-generico'
import { criarImportacao, minusculo } from './importacao'

const ativo: Campo = { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: true }

const camposVendedor: Campo[] = [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 120 },
    { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 160 },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto', max: 30 },
    ativo
]
export const rotasVendedores = criarCadastro('vendedores', camposVendedor, { ver: 'clientes.ver', editar: 'clientes.editar' })

const camposTransportadora: Campo[] = [
    { nome: 'codigo', rotulo: 'Código', tipo: 'texto', max: 30 },
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 160 },
    { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj' },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto', max: 30 },
    ativo
]
export const rotasTransportadoras = criarCadastro('transportadoras', camposTransportadora, { ver: 'clientes.ver', editar: 'clientes.editar' })

const camposIndustria: Campo[] = [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 160 },
    { nome: 'tipo_frete', rotulo: 'Tipo de frete', tipo: 'enum', opcoes: ['FOB', 'CIF'], padrao: 'FOB' },
    { nome: 'pedido_minimo', rotulo: 'Pedido mínimo (R$)', tipo: 'numero' },
    { nome: 'calcular_ipi', rotulo: 'Calcular com IPI', tipo: 'bool' },
    { nome: 'informacoes', rotulo: 'Informações da indústria', tipo: 'texto', max: 4000 },
    { nome: 'observacao_pdf', rotulo: 'Observação do PDF', tipo: 'texto', max: 4000 },
    ativo
]
export const rotasIndustrias = criarCadastro('industrias', camposIndustria, { ver: 'industrias.ver', editar: 'industrias.editar' })

const mapaPorNome = async (db: D1Database, tabela: string) => {
  const r = await db.prepare(`SELECT id, nome FROM ${tabela}`).all<{ id: number; nome: string }>()
  return new Map((r.results ?? []).map((x) => [minusculo(x.nome), x.id]))
}

rotasTransportadoras.route(
  '/',
  criarImportacao({
    tabela: 'transportadoras',
    campos: camposTransportadora,
    permissao: 'clientes.editar',
    colunas: [
      { titulo: 'Nome', campo: 'nome', exemplo: 'Rodonaves', obrigatorio: true, largura: 28 },
      { titulo: 'Código', campo: 'codigo', exemplo: '1001' },
      { titulo: 'CNPJ', campo: 'cnpj', exemplo: '11.222.333/0001-81', largura: 22 },
      { titulo: 'Telefone', campo: 'telefone', exemplo: '(65) 3333-4444' },
      { titulo: 'Ativo (Sim/Não)', campo: 'ativo', exemplo: 'Sim' }
    ],
    preparar: async (db) => ({ chaveDe: (b) => minusculo(b.nome ?? ''), existentes: await mapaPorNome(db, 'transportadoras') })
  })
)

rotasIndustrias.route(
  '/',
  criarImportacao({
    tabela: 'industrias',
    campos: camposIndustria,
    permissao: 'industrias.editar',
    colunas: [
      { titulo: 'Nome', campo: 'nome', exemplo: 'KE Home', obrigatorio: true, largura: 28 },
      { titulo: 'Tipo de frete (FOB/CIF)', campo: 'tipo_frete', exemplo: 'CIF', largura: 22 },
      { titulo: 'Pedido mínimo (R$)', campo: 'pedido_minimo', exemplo: '3000,00', largura: 20 },
      { titulo: 'Calcular com IPI (Sim/Não)', campo: 'calcular_ipi', exemplo: 'Não', largura: 24 },
      { titulo: 'Informações da indústria', campo: 'informacoes', exemplo: 'Prazo de entrega 15 dias úteis', largura: 40 },
      { titulo: 'Observação do PDF', campo: 'observacao_pdf', exemplo: 'Frete por conta da indústria', largura: 40 },
      { titulo: 'Ativo (Sim/Não)', campo: 'ativo', exemplo: 'Sim' }
    ],
    preparar: async (db) => ({ chaveDe: (b) => minusculo(b.nome ?? ''), existentes: await mapaPorNome(db, 'industrias') })
  })
)

rotasVendedores.route(
  '/',
  criarImportacao({
    tabela: 'vendedores',
    campos: camposVendedor,
    permissao: 'clientes.editar',
    colunas: [
      { titulo: 'Nome', campo: 'nome', exemplo: 'Maria Souza', obrigatorio: true, largura: 28 },
      { titulo: 'E-mail', campo: 'email', exemplo: 'maria@goiandyrep.com.br', largura: 30 },
      { titulo: 'Telefone', campo: 'telefone', exemplo: '(65) 99999-0000' },
      { titulo: 'Ativo (Sim/Não)', campo: 'ativo', exemplo: 'Sim' }
    ],
    preparar: async (db) => ({ chaveDe: (b) => minusculo(b.nome ?? ''), existentes: await mapaPorNome(db, 'vendedores') })
  })
)
