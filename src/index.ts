import { Hono } from 'hono'

type Bindings = { ASSETS: Fetcher }

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (c) =>
  c.json({ ok: true, app: 'goiandy-orcamentos', hora: new Date().toISOString() })
)

// Qualquer outra rota vai para os arquivos estáticos (páginas, CSS, JS)
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
