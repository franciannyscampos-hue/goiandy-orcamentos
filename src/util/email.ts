import type { Bindings } from '../types'

// Envio de e-mail pela API do Gmail, usando a conta orcamento@goiandyrep.com.br (OAuth com refresh token).
// Sem as chaves configuradas, nada é enviado e o sistema continua funcionando normalmente.
export const emailConfigurado = (env: Bindings) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && env.EMAIL_REMETENTE)

export type MensagemEmail = {
  para: string[]
  cc?: string[]
  bcc?: string[]
  assunto: string
  html: string
  texto: string
  anexo?: { nome: string; tipo: string; bytes: Uint8Array }
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const b64Linhas = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd()
const utf8 = (t: string) => new TextEncoder().encode(t)
const cabecalhoTexto = (t: string) => (/^[\x20-\x7E]*$/.test(t) ? t : `=?UTF-8?B?${base64(utf8(t))}?=`)
const semQuebra = (t: string) => t.replace(/[\r\n]+/g, ' ').trim()

export function montarMime(de: string, nomeDe: string, m: MensagemEmail): string {
  const limite = 'goiandy_' + crypto.randomUUID().replace(/-/g, '')
  const alt = 'alt_' + crypto.randomUUID().replace(/-/g, '')
  const linhas = [
    `From: ${cabecalhoTexto(semQuebra(nomeDe))} <${semQuebra(de)}>`,
    `To: ${m.para.map(semQuebra).join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map(semQuebra).join(', ')}`] : []),
    ...(m.bcc?.length ? [`Bcc: ${m.bcc.map(semQuebra).join(', ')}`] : []),
    `Subject: ${cabecalhoTexto(semQuebra(m.assunto))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    '',
    `--${limite}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Linhas(base64(utf8(m.texto))),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Linhas(base64(utf8(m.html))),
    `--${alt}--`
  ]
  if (m.anexo) {
    const nome = m.anexo.nome.replace(/[^\w.\-]/g, '_')
    linhas.push(`--${limite}`, `Content-Type: ${m.anexo.tipo}; name="${nome}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${nome}"`, '', b64Linhas(base64(m.anexo.bytes)))
  }
  linhas.push(`--${limite}--`, '')
  return linhas.join('\r\n')
}

const urlBase64 = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function tokenDeAcesso(env: Bindings): Promise<string> {
  const r = await fetch(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: env.GOOGLE_REFRESH_TOKEN!, grant_type: 'refresh_token' })
  })
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!r.ok || !d.access_token) throw new Error(`Google recusou o acesso (${d.error_description || d.error || r.status}). Gere um novo refresh token.`)
  return d.access_token
}

export async function enviarEmail(env: Bindings, m: MensagemEmail): Promise<{ ok: boolean; erro?: string }> {
  if (!emailConfigurado(env)) return { ok: false, erro: 'E-mail ainda não configurado no servidor.' }
  if (!m.para.length) return { ok: false, erro: 'Nenhum destinatário.' }
  try {
    const token = await tokenDeAcesso(env)
    const raw = urlBase64(base64(utf8(montarMime(env.EMAIL_REMETENTE!, 'Goiandy Representações', m))))
    const r = await fetch(env.GMAIL_API_URL || 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return { ok: false, erro: `Gmail respondeu ${r.status}: ${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: String((e as Error).message || e).slice(0, 300) }
  }
}
