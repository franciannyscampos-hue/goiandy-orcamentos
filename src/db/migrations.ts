// Cada migração roda uma única vez. Use sempre CREATE ... IF NOT EXISTS.
// Para mudar o banco depois, adicione uma nova migração no fim da lista (nunca edite as antigas).

export type Migracao = { id: string; comandos: string[] }

export const migracoes: Migracao[] = [
  {
    id: '001_base',
    comandos: [
      `CREATE TABLE IF NOT EXISTS perfis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE,
        descricao TEXT NOT NULL DEFAULT '',
        permissoes TEXT NOT NULL DEFAULT '[]',
        sistema INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS vendedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        telefone TEXT NOT NULL DEFAULT '',
        ativo INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        senha_hash TEXT NOT NULL,
        senha_salt TEXT NOT NULL,
        perfil_id INTEGER NOT NULL REFERENCES perfis(id),
        vendedor_id INTEGER REFERENCES vendedores(id),
        ativo INTEGER NOT NULL DEFAULT 1,
        deve_trocar_senha INTEGER NOT NULL DEFAULT 0,
        tentativas_falhas INTEGER NOT NULL DEFAULT 0,
        bloqueado_ate INTEGER NOT NULL DEFAULT 0,
        criado_em INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessoes (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL CHECK (tipo IN ('equipe','comprador')),
        usuario_id INTEGER NOT NULL,
        expira_em INTEGER NOT NULL,
        criado_em INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(tipo, usuario_id)`,
      `CREATE TABLE IF NOT EXISTS transportadoras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL DEFAULT '',
        nome TEXT NOT NULL,
        cnpj TEXT NOT NULL DEFAULT '',
        telefone TEXT NOT NULL DEFAULT '',
        ativo INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS industrias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        logo_chave TEXT,
        tipo_frete TEXT NOT NULL DEFAULT 'CIF' CHECK (tipo_frete IN ('FOB','CIF')),
        pedido_minimo REAL NOT NULL DEFAULT 0,
        calcular_ipi INTEGER NOT NULL DEFAULT 0,
        informacoes TEXT NOT NULL DEFAULT '',
        observacao_pdf TEXT NOT NULL DEFAULT '',
        tabela_padrao_id INTEGER,
        ativo INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        razao_social TEXT NOT NULL,
        nome_fantasia TEXT NOT NULL DEFAULT '',
        cnpj TEXT NOT NULL UNIQUE,
        inscricao_estadual TEXT NOT NULL DEFAULT '',
        endereco TEXT NOT NULL DEFAULT '',
        cep TEXT NOT NULL DEFAULT '',
        cidade TEXT NOT NULL DEFAULT '',
        uf TEXT NOT NULL DEFAULT '',
        telefone TEXT NOT NULL DEFAULT '',
        whatsapp TEXT NOT NULL DEFAULT '',
        email_nfe TEXT NOT NULL DEFAULT '',
        email_financeiro TEXT NOT NULL DEFAULT '',
        segmento TEXT NOT NULL DEFAULT '',
        categoria TEXT NOT NULL DEFAULT '',
        rede TEXT NOT NULL DEFAULT '',
        suframa TEXT NOT NULL DEFAULT '',
        codigo_suasvendas TEXT NOT NULL DEFAULT '',
        transportadora_id INTEGER REFERENCES transportadoras(id),
        vendedor_id INTEGER REFERENCES vendedores(id),
        ver_precos INTEGER NOT NULL DEFAULT 1,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_clientes_vendedor ON clientes(vendedor_id)`,
      `CREATE TABLE IF NOT EXISTS compradores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        telefone TEXT NOT NULL DEFAULT '',
        senha_hash TEXT,
        senha_salt TEXT,
        token_convite TEXT,
        convite_expira_em INTEGER NOT NULL DEFAULT 0,
        ativo INTEGER NOT NULL DEFAULT 1,
        tentativas_falhas INTEGER NOT NULL DEFAULT 0,
        bloqueado_ate INTEGER NOT NULL DEFAULT 0,
        criado_em INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_compradores_cliente ON compradores(cliente_id)`
    ]
  }
]
