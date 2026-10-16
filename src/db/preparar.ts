import type { Bindings } from '../types'
import { migracoes } from './migrations'
import { gerarHashSenha, sha256Hex } from '../auth/crypto'

// Lista de permissões do sistema. "*" = tudo (Administrador).
export const PERMISSOES = [
  'clientes.ver',
  'clientes.editar',
  'industrias.ver',
  'industrias.editar',
  'tabelas.ver',
  'tabelas.editar',
  'itens.ver',
  'itens.editar',
  'fotos.enviar',
  'orcamentos.ver_todos',
  'orcamentos.ver_proprios',
  'orcamentos.atender',
  'equipe.gerenciar'
] as const

const PERFIS_INICIAIS = [
  { nome: 'Administrador', descricao: 'Acesso total ao sistema', permissoes: ['*'] },
  {
    nome: 'Vendedor',
    descricao: 'Vê só os clientes e orçamentos dele e atualiza o status',
    permissoes: ['orcamentos.ver_proprios', 'orcamentos.atender']
  },
  {
    nome: 'Cadastro',
    descricao: 'Mexe em itens, tabelas e fotos; não mexe em clientes nem em permissões',
    permissoes: ['industrias.ver', 'industrias.editar', 'tabelas.ver', 'tabelas.editar', 'itens.ver', 'itens.editar', 'fotos.enviar']
  }
]

let pronto: Promise<void> | null = null

// Garante que o banco está atualizado. Roda uma vez por instância do servidor.
export function prepararBanco(env: Bindings): Promise<void> {
  if (!pronto) {
    pronto = executar(env).catch((erro) => {
      pronto = null // tenta de novo no próximo acesso
      throw erro
    })
  }
  return pronto
}

async function executar(env: Bindings): Promise<void> {
  const db = env.DB
  await db.prepare('CREATE TABLE IF NOT EXISTS _migracoes (id TEXT PRIMARY KEY, aplicada_em INTEGER NOT NULL)').run()
  const aplicadas = new Set(((await db.prepare('SELECT id FROM _migracoes').all<{ id: string }>()).results ?? []).map((r) => r.id))

  for (const m of migracoes) {
    if (aplicadas.has(m.id)) continue
    await db.batch(m.comandos.map((sql) => db.prepare(sql)))
    await db.prepare('INSERT OR IGNORE INTO _migracoes (id, aplicada_em) VALUES (?, ?)').bind(m.id, Date.now()).run()
  }

  for (const p of PERFIS_INICIAIS) {
    await db
      .prepare('INSERT OR IGNORE INTO perfis (nome, descricao, permissoes, sistema) VALUES (?, ?, ?, 1)')
      .bind(p.nome, p.descricao, JSON.stringify(p.permissoes))
      .run()
  }

  // Primeiro administrador: criado só se não existir nenhum usuário e as variáveis estiverem definidas.
  const total = await db.prepare('SELECT COUNT(*) AS n FROM usuarios').first<{ n: number }>()
  if ((total?.n ?? 0) === 0 && env.ADMIN_EMAIL && env.ADMIN_SENHA) {
    const perfil = await db.prepare("SELECT id FROM perfis WHERE nome = 'Administrador'").first<{ id: number }>()
    if (perfil) {
      const { hash, salt } = await gerarHashSenha(env.ADMIN_SENHA)
      await db
        .prepare(
          'INSERT OR IGNORE INTO usuarios (nome, email, senha_hash, senha_salt, perfil_id, deve_trocar_senha, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)'
        )
        .bind('Administrador', env.ADMIN_EMAIL.trim().toLowerCase(), hash, salt, perfil.id, Date.now())
        .run()
    }
  }

  // Recuperação de senha do administrador: vale uma única vez para cada valor do segredo ADMIN_REDEFINIR_SENHA.
  // Depois de usar, o segredo pode ser apagado no Cloudflare.
  if (env.ADMIN_REDEFINIR_SENHA && env.ADMIN_EMAIL && env.ADMIN_REDEFINIR_SENHA.length >= 10) {
    const marca = 'redefinir_' + (await sha256Hex(env.ADMIN_REDEFINIR_SENHA)).slice(0, 16)
    const jaFeito = await db.prepare('SELECT 1 AS x FROM _migracoes WHERE id = ?').bind(marca).first()
    if (!jaFeito) {
      const email = env.ADMIN_EMAIL.trim().toLowerCase()
      let u = await db.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first<{ id: number }>()
      if (!u) {
        // O e-mail gravado no banco pode ser outro (ex.: o ADMIN_EMAIL mudou depois do primeiro acesso): usa o primeiro administrador.
        u = await db
          .prepare("SELECT u.id FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE p.nome = 'Administrador' ORDER BY u.id LIMIT 1")
          .first<{ id: number }>()
        if (u) await db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').bind(email, u.id).run()
      }
      if (u) {
        const { hash, salt } = await gerarHashSenha(env.ADMIN_REDEFINIR_SENHA)
        await db.batch([
          db
            .prepare('UPDATE usuarios SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = 0, ativo = 1 WHERE id = ?')
            .bind(hash, salt, u.id),
          db.prepare("DELETE FROM sessoes WHERE tipo = 'equipe' AND usuario_id = ?").bind(u.id),
          db.prepare('INSERT OR IGNORE INTO _migracoes (id, aplicada_em) VALUES (?, ?)').bind(marca, Date.now())
        ])
      }
    }
  }
}
