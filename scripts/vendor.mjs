// Empacota as bibliotecas de Excel para o navegador. Roda antes do build.
import { build } from 'esbuild'

await build({
  entryPoints: ['web/excel.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  outfile: 'public/js/vendor/excel.js',
  logLevel: 'error'
})
console.log('public/js/vendor/excel.js gerado')
