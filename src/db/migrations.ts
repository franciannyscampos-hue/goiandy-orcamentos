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
  },
  {
    id: '002_auditoria',
    comandos: [
      `CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quando INTEGER NOT NULL,
        usuario_id INTEGER,
        acao TEXT NOT NULL,
        detalhe TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria(quando)`
    ]
  },
  {
    id: '003_tabelas_itens_fotos',
    comandos: [
      `CREATE TABLE IF NOT EXISTS tabelas_preco (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        industria_id INTEGER NOT NULL REFERENCES industrias(id),
        nome TEXT NOT NULL,
        vencimento TEXT NOT NULL DEFAULT '',
        tipo TEXT NOT NULL DEFAULT 'prazo' CHECK (tipo IN ('vista','prazo')),
        prazo TEXT NOT NULL DEFAULT '',
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em INTEGER NOT NULL,
        UNIQUE (industria_id, nome)
      )`,
      `CREATE TABLE IF NOT EXISTS itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        industria_id INTEGER NOT NULL REFERENCES industrias(id),
        referencia TEXT NOT NULL COLLATE NOCASE,
        descricao TEXT NOT NULL DEFAULT '',
        codigo_barras TEXT NOT NULL DEFAULT '',
        categoria TEXT NOT NULL DEFAULT '',
        marca TEXT NOT NULL DEFAULT '',
        medida TEXT NOT NULL DEFAULT '',
        cor TEXT NOT NULL DEFAULT '',
        ncm TEXT NOT NULL DEFAULT '',
        qtd_caixa INTEGER NOT NULL DEFAULT 0,
        qtd_minima INTEGER NOT NULL DEFAULT 0,
        nao_abre_caixa INTEGER NOT NULL DEFAULT 0,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em INTEGER NOT NULL,
        UNIQUE (industria_id, referencia)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_itens_categoria ON itens(industria_id, categoria)`,
      `CREATE TABLE IF NOT EXISTS precos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tabela_id INTEGER NOT NULL REFERENCES tabelas_preco(id),
        item_id INTEGER NOT NULL REFERENCES itens(id),
        preco REAL,
        preco_promocional REAL,
        ipi REAL NOT NULL DEFAULT 0,
        novo INTEGER NOT NULL DEFAULT 0,
        observacao TEXT NOT NULL DEFAULT '',
        UNIQUE (tabela_id, item_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_precos_item ON precos(item_id)`,
      `CREATE TABLE IF NOT EXISTS fotos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES itens(id),
        posicao INTEGER NOT NULL CHECK (posicao BETWEEN 1 AND 5),
        chave TEXT NOT NULL,
        tipo_conteudo TEXT NOT NULL DEFAULT 'image/jpeg',
        tamanho INTEGER NOT NULL DEFAULT 0,
        criado_em INTEGER NOT NULL,
        UNIQUE (item_id, posicao)
      )`
    ]
  },
  {
    id: '004_liberacoes',
    comandos: [
      // Quais tabelas de preço cada cliente (CNPJ) enxerga. A indústria liberada é a das tabelas liberadas.
      `CREATE TABLE IF NOT EXISTS liberacoes (
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        tabela_id INTEGER NOT NULL REFERENCES tabelas_preco(id),
        criado_em INTEGER NOT NULL,
        PRIMARY KEY (cliente_id, tabela_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_liberacoes_tabela ON liberacoes(tabela_id)`
    ]
  },
  {
    id: '005_portal_senha',
    comandos: [`ALTER TABLE compradores ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 1`]
  },
  {
    id: '006_marca_busca_compra',
    comandos: [
      // Logo e banners das indústrias (arquivos ficam no R2; aqui só a chave)
      // (a coluna logo_chave já existe desde a primeira migração, vazia/NULL)
      `ALTER TABLE industrias ADD COLUMN logo_tipo TEXT NOT NULL DEFAULT ''`,
      `CREATE TABLE IF NOT EXISTS banners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        industria_id INTEGER NOT NULL REFERENCES industrias(id),
        chave TEXT NOT NULL,
        tipo_conteudo TEXT NOT NULL DEFAULT 'image/jpeg',
        criado_em INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_banners_industria ON banners(industria_id)`,
      // Indústrias que o cliente já compra (o resto liberado aparece como sugestão)
      `CREATE TABLE IF NOT EXISTS cliente_industrias_compra (
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        industria_id INTEGER NOT NULL REFERENCES industrias(id),
        PRIMARY KEY (cliente_id, industria_id)
      )`,
      // Busca rápida por palavra (ignora acento e maiúscula) para a busca do portal
      `CREATE VIRTUAL TABLE IF NOT EXISTS itens_busca USING fts5(referencia, descricao, content='itens', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
      `CREATE TRIGGER IF NOT EXISTS itens_busca_ai AFTER INSERT ON itens BEGIN
         INSERT INTO itens_busca(rowid, referencia, descricao) VALUES (new.id, new.referencia, new.descricao);
       END`,
      `CREATE TRIGGER IF NOT EXISTS itens_busca_ad AFTER DELETE ON itens BEGIN
         INSERT INTO itens_busca(itens_busca, rowid, referencia, descricao) VALUES ('delete', old.id, old.referencia, old.descricao);
       END`,
      `CREATE TRIGGER IF NOT EXISTS itens_busca_au AFTER UPDATE OF referencia, descricao ON itens
         WHEN old.referencia IS NOT new.referencia OR old.descricao IS NOT new.descricao BEGIN
         INSERT INTO itens_busca(itens_busca, rowid, referencia, descricao) VALUES ('delete', old.id, old.referencia, old.descricao);
         INSERT INTO itens_busca(rowid, referencia, descricao) VALUES (new.id, new.referencia, new.descricao);
       END`,
      `INSERT INTO itens_busca(itens_busca) VALUES ('rebuild')`
    ]
  },
  {
    id: '007_orcamentos',
    comandos: [
      // Carrinho (status 'carrinho') e orçamentos enviados. O número do orçamento é o próprio id.
      `CREATE TABLE IF NOT EXISTS orcamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        comprador_id INTEGER REFERENCES compradores(id),
        industria_id INTEGER NOT NULL REFERENCES industrias(id),
        tabela_id INTEGER NOT NULL REFERENCES tabelas_preco(id),
        status TEXT NOT NULL DEFAULT 'carrinho' CHECK (status IN ('carrinho','Novo','Em atendimento','Pedido gerado','Cancelado')),
        tabela_nome TEXT NOT NULL DEFAULT '',
        tabela_tipo TEXT NOT NULL DEFAULT '',
        tabela_prazo TEXT NOT NULL DEFAULT '',
        tipo_frete TEXT NOT NULL DEFAULT '',
        calcular_ipi INTEGER NOT NULL DEFAULT 0,
        ver_precos INTEGER NOT NULL DEFAULT 1,
        transportadora_texto TEXT NOT NULL DEFAULT '',
        observacao_cliente TEXT NOT NULL DEFAULT '',
        subtotal REAL NOT NULL DEFAULT 0,
        ipi_total REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        qtd_total INTEGER NOT NULL DEFAULT 0,
        pdf_chave TEXT NOT NULL DEFAULT '',
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL,
        enviado_em INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orc_carrinho ON orcamentos(comprador_id, tabela_id) WHERE status = 'carrinho'`,
      `CREATE INDEX IF NOT EXISTS idx_orc_cliente ON orcamentos(cliente_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_orc_status ON orcamentos(status, enviado_em)`,
      `CREATE TABLE IF NOT EXISTS orcamento_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id),
        item_id INTEGER NOT NULL REFERENCES itens(id),
        qtd INTEGER NOT NULL CHECK (qtd > 0),
        referencia TEXT NOT NULL DEFAULT '',
        descricao TEXT NOT NULL DEFAULT '',
        codigo_barras TEXT NOT NULL DEFAULT '',
        ncm TEXT NOT NULL DEFAULT '',
        preco_unit REAL,
        ipi REAL NOT NULL DEFAULT 0,
        promocao INTEGER NOT NULL DEFAULT 0,
        total_linha REAL NOT NULL DEFAULT 0,
        UNIQUE (orcamento_id, item_id)
      )`
    ]
  },
  {
    id: '008_orcamento_edicao',
    comandos: [`ALTER TABLE orcamentos ADD COLUMN edicao_liberada INTEGER NOT NULL DEFAULT 0`]
  }
]
