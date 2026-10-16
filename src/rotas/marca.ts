import { Hono } from 'hono'
import type { Bindings, Variaveis } from '../types'
import { exigirEquipe } from '../auth/sessao'

// Logo e banners das indústrias (o portal do cliente usa os dois)
export const rotasMarca = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

const MAX_LOGO = 2 * 1024 * 1024
const MAX_BANNER = 4 * 1024 * 1024
const MAX_BANNERS = 10

function tipoImagem(b: Uint8Array): string | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}
const sufixo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => x.toString(16).padStart(2, '0')).join('')

rotasMarca.get('/industria/:id', exigirEquipe('industrias.ver'), async (c) => {
  const id = Number(c.req.param('id'))
  const i = await c.env.DB.prepare("SELECT id, nome, logo_chave <> '' AS tem_logo FROM industrias WHERE id = ?").bind(id).first()
  if (!i) return c.json({ erro: 'Indústria não encontrada.' }, 404)
  const b = await c.env.DB.prepare('SELECT id FROM banners WHERE industria_id = ? ORDER BY id').bind(id).all()
  return c.json({ industria: i, banners: b.results })
})

rotasMarca.post('/industria/:id/logo', exigirEquipe('industrias.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  const i = await c.env.DB.prepare('SELECT logo_chave FROM industrias WHERE id = ?').bind(id).first<{ logo_chave: string }>()
  if (!i) return c.json({ erro: 'Indústria não encontrada.' }, 404)
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  const tipo = tipoImagem(bytes)
  if (!tipo) return c.json({ erro: 'O arquivo não é uma imagem JPG, PNG ou WebP.' }, 400)
  if (bytes.length > MAX_LOGO) return c.json({ erro: 'A logo passa de 2 MB.' }, 413)
  const chave = `marca/${id}/logo-${sufixo()}`
  await c.env.ARQUIVOS.put(chave, bytes, { httpMetadata: { contentType: tipo } })
  await c.env.DB.prepare('UPDATE industrias SET logo_chave = ?, logo_tipo = ? WHERE id = ?').bind(chave, tipo, id).run()
  if (i.logo_chave) await c.env.ARQUIVOS.delete(i.logo_chave)
  return c.json({ ok: true })
})

rotasMarca.delete('/industria/:id/logo', exigirEquipe('industrias.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  const i = await c.env.DB.prepare('SELECT logo_chave FROM industrias WHERE id = ?').bind(id).first<{ logo_chave: string }>()
  if (!i) return c.json({ erro: 'Indústria não encontrada.' }, 404)
  if (i.logo_chave) await c.env.ARQUIVOS.delete(i.logo_chave)
  await c.env.DB.prepare("UPDATE industrias SET logo_chave = '', logo_tipo = '' WHERE id = ?").bind(id).run()
  return c.json({ ok: true })
})

rotasMarca.post('/industria/:id/banners', exigirEquipe('industrias.editar'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await c.env.DB.prepare('SELECT id FROM industrias WHERE id = ?').bind(id).first())) return c.json({ erro: 'Indústria não encontrada.' }, 404)
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM banners WHERE industria_id = ?').bind(id).first<{ n: number }>()
  if ((n?.n ?? 0) >= MAX_BANNERS) return c.json({ erro: `Cada indústria pode ter até ${MAX_BANNERS} banners.` }, 400)
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  const tipo = tipoImagem(bytes)
  if (!tipo) return c.json({ erro: 'O arquivo não é uma imagem JPG, PNG ou WebP.' }, 400)
  if (bytes.length > MAX_BANNER) return c.json({ erro: 'O banner passa de 4 MB.' }, 413)
  const chave = `marca/${id}/banner-${sufixo()}`
  await c.env.ARQUIVOS.put(chave, bytes, { httpMetadata: { contentType: tipo } })
  const r = await c.env.DB.prepare('INSERT INTO banners (industria_id, chave, tipo_conteudo, criado_em) VALUES (?, ?, ?, ?)').bind(id, chave, tipo, Date.now()).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

rotasMarca.delete('/banner/:bid', exigirEquipe('industrias.editar'), async (c) => {
  const b = await c.env.DB.prepare('SELECT id, chave FROM banners WHERE id = ?').bind(Number(c.req.param('bid'))).first<{ id: number; chave: string }>()
  if (!b) return c.json({ erro: 'Banner não encontrado.' }, 404)
  await c.env.ARQUIVOS.delete(b.chave)
  await c.env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(b.id).run()
  return c.json({ ok: true })
})

// Visualização na tela da equipe
rotasMarca.get('/banner/:bid', exigirEquipe('industrias.ver'), async (c) => {
  const b = await c.env.DB.prepare('SELECT chave, tipo_conteudo FROM banners WHERE id = ?').bind(Number(c.req.param('bid'))).first<{ chave: string; tipo_conteudo: string }>()
  const o = b && (await c.env.ARQUIVOS.get(b.chave))
  if (!b || !o) return c.json({ erro: 'Banner não encontrado.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': b.tipo_conteudo, 'Cache-Control': 'private, max-age=300' } })
})

rotasMarca.get('/logo/:id', exigirEquipe('industrias.ver'), async (c) => {
  const i = await c.env.DB.prepare('SELECT logo_chave, logo_tipo FROM industrias WHERE id = ?').bind(Number(c.req.param('id'))).first<{ logo_chave: string; logo_tipo: string }>()
  const o = i?.logo_chave ? await c.env.ARQUIVOS.get(i.logo_chave) : null
  if (!i || !o) return c.json({ erro: 'Logo não encontrada.' }, 404)
  return new Response(o.body, { headers: { 'Content-Type': i.logo_tipo, 'Cache-Control': 'private, max-age=300' } })
})
