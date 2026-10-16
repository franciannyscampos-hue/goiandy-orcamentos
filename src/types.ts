export type Bindings = {
  ASSETS: Fetcher
  DB: D1Database
  ARQUIVOS: R2Bucket
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

export type CompradorSessao = {
  id: number
  nome: string
  email: string
  cliente_id: number
  cliente_nome: string
  ver_precos: boolean
  deve_trocar_senha: boolean
}

export type Variaveis = {
  usuario: UsuarioSessao
  comprador: CompradorSessao
}
