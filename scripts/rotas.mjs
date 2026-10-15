// Depois do build: só /api passa pelo servidor; páginas, CSS e JS saem direto do Cloudflare.
import { writeFileSync } from 'node:fs'

writeFileSync('dist/_routes.json', JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }))
console.log('dist/_routes.json atualizado')
