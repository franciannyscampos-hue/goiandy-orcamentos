import { criarCadastro, type Campo } from './cadastro-generico'

const ativo: Campo = { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: true }

export const rotasVendedores = criarCadastro(
  'vendedores',
  [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 120 },
    { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 160 },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto', max: 30 },
    ativo
  ],
  { ver: 'clientes.ver', editar: 'clientes.editar' }
)

export const rotasTransportadoras = criarCadastro(
  'transportadoras',
  [
    { nome: 'codigo', rotulo: 'Código', tipo: 'texto', max: 30 },
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 160 },
    { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj' },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto', max: 30 },
    ativo
  ],
  { ver: 'clientes.ver', editar: 'clientes.editar' }
)

export const rotasIndustrias = criarCadastro(
  'industrias',
  [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 160 },
    { nome: 'tipo_frete', rotulo: 'Tipo de frete', tipo: 'enum', opcoes: ['FOB', 'CIF'], padrao: 'FOB' },
    { nome: 'pedido_minimo', rotulo: 'Pedido mínimo (R$)', tipo: 'numero' },
    { nome: 'calcular_ipi', rotulo: 'Calcular com IPI', tipo: 'bool' },
    { nome: 'informacoes', rotulo: 'Informações da indústria', tipo: 'texto', max: 4000 },
    { nome: 'observacao_pdf', rotulo: 'Observação do PDF', tipo: 'texto', max: 4000 },
    ativo
  ],
  { ver: 'industrias.ver', editar: 'industrias.editar' }
)
