// Pacote único de Excel para o navegador (gerado em public/js/vendor/excel.js no build).
import { readSheet } from 'read-excel-file/universal'
import writeExcelFile from 'write-excel-file/universal'

// Lê a primeira aba e devolve linhas de texto (células vazias viram "").
export async function lerPlanilha(arquivo) {
  const linhas = await readSheet(arquivo)
  return linhas.map((l) => l.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())))
}

// Gera o modelo: cabeçalho em negrito, uma linha de exemplo e larguras de coluna.
export async function gerarModelo(colunas, exemplo) {
  const cab = colunas.map((c) => ({ value: c.titulo + (c.obrigatorio ? ' *' : ''), fontWeight: 'bold', backgroundColor: '#dbeafe' }))
  const ex = exemplo.map((v) => ({ value: String(v), type: String }))
  return writeExcelFile([cab, ex], { columns: colunas.map((c) => ({ width: c.largura || 20 })) }).toBlob()
}

// Planilha simples para relatórios: cabeçalho em negrito e larguras por coluna.
export async function gerarPlanilha(titulos, linhas, larguras = []) {
  const cab = titulos.map((t) => ({ value: t, fontWeight: 'bold', backgroundColor: '#dbeafe' }))
  const corpo = linhas.map((l) => l.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: String(v ?? ''), type: String })))
  return writeExcelFile([cab, ...corpo], { columns: titulos.map((_, i) => ({ width: larguras[i] || 18 })), stickyRowsCount: 1 }).toBlob()
}
