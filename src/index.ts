import { Hono } from 'hono'
import type { Bindings, Variaveis } from './types'
import { prepararBanco } from './db/preparar'
import { rotasAuth } from './rotas/auth'
import { rotasClientes } from './rotas/clientes'
import { rotasEquipe } from './rotas/equipe'
import { rotasTabelas } from './rotas/tabelas'
import { rotasIndustrias, rotasTransportadoras, rotasVendedores } from './rotas/cadastros'

const app = new Hono<{ Bindings: Bindings; Variables: Variaveis }>()

// Cabeçalhos de segurança em todas as respostas
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'same-origin')
})

app.get('/api/health', (c) =>
  c.json({ ok: true, app: 'goiandy-orcamentos', hora: new Date().toISOString(), banco: !!c.env.DB, arquivos: !!c.env.ARQUIVOS })
)

// Tudo que é /api abaixo daqui precisa do banco pronto
app.use('/api/*', async (c, next) => {
  await prepararBanco(c.env)
  await next()
})

// Pedidos que mudam dados só aceitam JSON (protege contra envio de formulários de outros sites)
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const tipo = c.req.header('content-type') ?? ''
    if (!tipo.includes('application/json')) return c.json({ erro: 'Formato de pedido inválido.' }, 415)
  }
  await next()
})

app.route('/api/auth', rotasAuth)
app.route('/api/vendedores', rotasVendedores)
app.route('/api/transportadoras', rotasTransportadoras)
app.route('/api/clientes', rotasClientes)
app.route('/api/equipe', rotasEquipe)
app.route('/api/tabelas', rotasTabelas)
app.route('/api/industrias', rotasIndustrias)

app.onError((erro, c) => {
  console.error(erro)
  return c.json({ erro: 'Erro interno. Tente de novo em instantes.' }, 500)
})

// Qualquer outra rota vai para os arquivos estáticos (páginas, CSS, JS)
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
