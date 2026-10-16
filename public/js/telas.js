// Configuração de cada tela de cadastro (colunas da lista e campos do formulário).
import { brl, formatarCnpj } from './util.js'

const ativo = { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool' }

export const telas = {
  vendedores: {
    titulo: 'Vendedores',
    api: '/vendedores',
    permVer: 'clientes.ver',
    permEditar: 'clientes.editar',
    importar: true,
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'telefone', rotulo: 'Telefone' }
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      ativo
    ]
  },
  transportadoras: {
    titulo: 'Transportadoras',
    api: '/transportadoras',
    permVer: 'clientes.ver',
    permEditar: 'clientes.editar',
    importar: true,
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'codigo', rotulo: 'Código' },
      { campo: 'cnpj', rotulo: 'CNPJ', formato: formatarCnpj },
      { campo: 'telefone', rotulo: 'Telefone' }
    ],
    campos: [
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto' },
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto' },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
      ativo
    ]
  },
  industrias: {
    titulo: 'Indústrias',
    api: '/industrias',
    permVer: 'industrias.ver',
    permEditar: 'industrias.editar',
    importar: true,
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'tipo_frete', rotulo: 'Frete' },
      { campo: 'pedido_minimo', rotulo: 'Pedido mínimo', formato: brl },
      { campo: 'calcular_ipi', rotulo: 'Calcula IPI', formato: (v) => (v ? 'Sim' : 'Não') }
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { nome: 'tipo_frete', rotulo: 'Tipo de frete', tipo: 'enum', opcoes: ['FOB', 'CIF'] },
      { nome: 'pedido_minimo', rotulo: 'Pedido mínimo (R$)', tipo: 'numero', padrao: 0 },
      { nome: 'calcular_ipi', rotulo: 'Calcular com IPI', tipo: 'bool' },
      { nome: 'informacoes', rotulo: 'Informações da indústria (o cliente vê)', tipo: 'area' },
      { nome: 'observacao_pdf', rotulo: 'Observação do PDF', tipo: 'area' },
      ativo
    ]
  }
}
