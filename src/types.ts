export type Bindings = {
  ASSETS: Fetcher
  DB: D1Database
  ADMIN_EMAIL?: string
  ADMIN_SENHA?: string
  ADMIN_REDEFINIR_SENHA?: string
}

export type UsuarioSessao = {
  id: number
  nome: string
  email: string
  perfil: string
  permissoes: string[]
  vendedor_id: number | null
  deve_trocar_senha: boolean
}

export type Variaveis = {
  usuario: UsuarioSessao
}
