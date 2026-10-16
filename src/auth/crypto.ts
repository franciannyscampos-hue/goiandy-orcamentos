// Senhas: PBKDF2-SHA256 com sal individual. Nunca guardamos a senha em texto.
const ITERACOES = 100000 // limite do Cloudflare Workers

function paraBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function deBase64(texto: string): Uint8Array {
  const s = atob(texto)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

async function derivar(senha: string, sal: Uint8Array): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES }, chave, 256)
  return new Uint8Array(bits)
}

export async function gerarHashSenha(senha: string): Promise<{ hash: string; salt: string }> {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivar(senha, sal)
  return { hash: paraBase64(hash), salt: paraBase64(sal) }
}

export async function conferirSenha(senha: string, hashB64: string, saltB64: string): Promise<boolean> {
  const calculado = await derivar(senha, deBase64(saltB64))
  const esperado = deBase64(hashB64)
  if (calculado.length !== esperado.length) return false
  let diferenca = 0
  for (let i = 0; i < calculado.length; i++) diferenca |= calculado[i] ^ esperado[i]
  return diferenca === 0
}

export function tokenAleatorio(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return paraBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(texto: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Senha provisória legível (sem letras que se confundem)
export function senhaProvisoria(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => letras[b % letras.length]).join('')
}
