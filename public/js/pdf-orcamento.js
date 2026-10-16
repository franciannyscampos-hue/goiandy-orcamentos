// Gera o PDF do orçamento no navegador, no modelo do Pedido 31989 (cabeçalho, cliente, orçamento, transporte, itens com foto, totais).
// Os dados vêm sempre do banco (via API); o PDF é só a apresentação.
import { PDFDocument, StandardFonts, rgb } from './vendor/pdf.js'

const AZUL = rgb(0.008, 0.149, 0.29)
const CINZA = rgb(0.93, 0.94, 0.95)
const LINHA = rgb(0.75, 0.77, 0.8)
const PRETO = rgb(0.1, 0.1, 0.1)
const VERMELHO = rgb(0.8, 0.1, 0.1)

const MAPA = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '-', '…': '...', '−': '-', ' ': ' ' }
const limpar = (t) => String(t ?? '').replace(/[–—“”‘’•…− ]/g, (m) => MAPA[m] || ' ').replace(/[^\x20-\x7E -ÿ]/g, '?')
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBr = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' })
const dataHoraBr = (ms) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })
const fmtCnpj = (d) => { const s = String(d || '').replace(/\D/g, ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '' }

async function baixar(url) {
  try {
    const r = await fetch(url, { credentials: 'same-origin' })
    return r.ok ? await r.blob() : null
  } catch { return null }
}

// Reduz a imagem para miniatura JPEG (PDF leve, mesmo com muitos itens)
async function miniatura(blob, lado = 110) {
  try {
    const bmp = await createImageBitmap(blob)
    const f = Math.min(1, lado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * f)); c.height = Math.max(1, Math.round(bmp.height * f))
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height)
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
    return { bytes: new Uint8Array(await out.arrayBuffer()), w: c.width, h: c.height }
  } catch { return null }
}

async function emLotes(lista, n, fn) {
  const res = new Array(lista.length)
  let k = 0
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (k < lista.length) { const i = k++; res[i] = await fn(lista[i], i) } }))
  return res
}

/**
 * dados: { orcamento, itens, cliente, vendedor?, comprador?, verPrecos, urlFoto(id), urlLogoIndustria? }
 * Devolve um Blob application/pdf.
 */
export async function gerarPdfOrcamento(dados) {
  const { orcamento: o, itens, cliente: cli = {}, verPrecos } = dados
  const pdf = await PDFDocument.create()
  const fonte = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 595.28, H = 841.89, M = 28

  // imagens
  const logoGoiandy = await baixar('/portal/logo-goiandy.png')
  const imgGoiandy = logoGoiandy ? await pdf.embedPng(new Uint8Array(await logoGoiandy.arrayBuffer())).catch(() => null) : null
  let imgInd = null
  if (dados.urlLogoIndustria) {
    const b = await baixar(dados.urlLogoIndustria)
    const m = b ? await miniatura(b, 300) : null
    imgInd = m ? await pdf.embedJpg(m.bytes).catch(() => null) : null
    if (imgInd) imgInd._wh = [m.w, m.h]
  }
  const thumbs = await emLotes(itens, 6, async (i) => {
    if (!i.foto_id) return null
    const b = await baixar(dados.urlFoto(i.foto_id))
    const m = b ? await miniatura(b) : null
    if (!m) return null
    const img = await pdf.embedJpg(m.bytes).catch(() => null)
    return img ? { img, w: m.w, h: m.h } : null
  })

  const quebrar = (texto, f, tam, largura, maxLinhas = 99) => {
    const palavras = limpar(texto).split(/\s+/).filter(Boolean)
    const linhas = []
    let atual = ''
    for (const p of palavras) {
      const t = atual ? atual + ' ' + p : p
      if (f.widthOfTextAtSize(t, tam) <= largura) atual = t
      else {
        if (atual) linhas.push(atual)
        let resto = p
        while (f.widthOfTextAtSize(resto, tam) > largura && resto.length > 1) {
          let n = resto.length - 1
          while (n > 1 && f.widthOfTextAtSize(resto.slice(0, n), tam) > largura) n--
          linhas.push(resto.slice(0, n)); resto = resto.slice(n)
        }
        atual = resto
      }
    }
    if (atual) linhas.push(atual)
    if (linhas.length > maxLinhas) { linhas.length = maxLinhas; linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/.{0,3}$/, '...') }
    return linhas
  }

  let pagina, y
  const texto = (t, x, yy, { tam = 8.5, f = fonte, cor = PRETO, dir = false, largura = 0 } = {}) => {
    const s = limpar(t)
    const px = dir ? x - f.widthOfTextAtSize(s, tam) : largura ? x + (largura - f.widthOfTextAtSize(s, tam)) / 2 : x
    pagina.drawText(s, { x: px, y: yy, size: tam, font: f, color: cor })
  }
  const par = (rotulo, valor, x, yy, larguraMax) => {
    texto(rotulo, x, yy, { tam: 8 })
    const rw = fonte.widthOfTextAtSize(limpar(rotulo) + ' ', 8) + 2
    const linhas = quebrar(valor || '', negrito, 8, larguraMax - rw, 2)
    linhas.forEach((l, k) => texto(l, x + rw, yy - k * 10, { tam: 8, f: negrito }))
    return Math.max(1, linhas.length)
  }

  // ---------- cabeçalho ----------
  function cabecalho() {
    pagina = pdf.addPage([W, H]); y = H - M
    if (imgGoiandy) { const h = 58, w = (imgGoiandy.width / imgGoiandy.height) * h; pagina.drawImage(imgGoiandy, { x: M, y: y - h, width: w, height: h }) }
    texto('GOIANDY REPRESENTAÇÕES', 150, y - 22, { tam: 13, f: negrito })
    quebrar('Por favor acusar recebimento deste orçamento, prezado cliente não fazemos trocas de mercadorias quebradas pela transportadora.', fonte, 8, 250).forEach((l, k) => texto(l, 150, y - 36 - k * 10))
    if (imgInd) { const mh = 56, mw = 120; const [iw, ih] = imgInd._wh; const f = Math.min(mw / iw, mh / ih); pagina.drawImage(imgInd, { x: W - M - iw * f, y: y - mh + (mh - ih * f) / 2, width: iw * f, height: ih * f }) }
    y -= 70
  }
  const secao = (titulo, destaque) => {
    pagina.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.6, color: LINHA })
    y -= 10
    texto(titulo, M, y, { tam: 9.5 })
    if (destaque) texto(destaque, M + fonte.widthOfTextAtSize(limpar(titulo) + ' ', 9.5) + 2, y, { tam: 10, f: negrito, cor: VERMELHO })
    y -= 14
  }

  cabecalho()
  secao('Informações sobre o Cliente')
  const meio = M + 300, larg = 290
  let n = Math.max(par('Razão Social:', cli.razao_social, M, y, larg), par('Comprador:', dados.comprador?.nome || o.comprador, meio, y, larg)); y -= n * 10 + 2
  n = Math.max(par('Nome Fantasia:', cli.nome_fantasia, M, y, larg), par('E-mail do Comprador:', dados.comprador?.email || o.comprador_email, meio, y, larg)); y -= n * 10 + 2
  n = Math.max(par('CNPJ/CPF:', fmtCnpj(cli.cnpj), M, y, larg), par('Inscr. Estadual:', cli.inscricao_estadual, meio, y, larg)); y -= n * 10 + 2
  n = Math.max(par('Telefone:', cli.telefone, M, y, larg), par('Whatsapp:', cli.whatsapp, meio, y, larg)); y -= n * 10 + 2
  n = Math.max(par('E-mail NF-e:', cli.email_nfe, M, y, larg), par('Suframa:', cli.suframa, meio, y, larg)); y -= n * 10 + 2
  n = par('Endereço:', [cli.endereco, cli.cep && 'CEP ' + cli.cep, [cli.cidade, cli.uf].filter(Boolean).join('-')].filter(Boolean).join(', '), M, y, W - 2 * M); y -= n * 10 + 6

  secao('Informações sobre o ORÇAMENTO - Nº', String(o.id))
  n = Math.max(par('Indústria:', o.industria, M, y, larg), par('Data do envio:', o.enviado_em ? dataBr(o.enviado_em) : '', meio, y, larg)); y -= n * 10 + 2
  const cond = o.tabela_tipo === 'vista' ? 'À vista' : o.tabela_prazo ? (/^[\d\s\/.,+-]+$/.test(o.tabela_prazo) ? o.tabela_prazo.trim() + ' dias' : o.tabela_prazo) : 'A prazo'
  n = Math.max(par('Condição de Pagto:', cond, M, y, larg), par('Tipo de Frete:', o.tipo_frete, meio, y, larg)); y -= n * 10 + 2
  n = Math.max(par('Tabela de preço:', o.tabela_nome, M, y, larg), par('Situação:', o.status, meio, y, larg)); y -= n * 10 + 6

  secao('Informações sobre o Transporte')
  n = par('Preferência de transportadora:', o.transportadora_texto || 'não informada', M, y, W - 2 * M); y -= n * 10 + 8

  // ---------- tabela de itens ----------
  const cols = verPrecos
    ? [{ t: 'Cód.', x: M, w: 66 }, { t: 'Produto', w: 175 }, { t: 'Cód. Barras', w: 66 }, { t: 'NCM', w: 48 }, { t: 'Qtde', w: 30, d: 1 }, { t: 'R$ Unit', w: 44, d: 1 }, { t: 'IPI %', w: 28, d: 1 }, { t: 'R$ Total', w: 52, d: 1 }]
    : [{ t: 'Cód.', x: M, w: 70 }, { t: 'Produto', w: 270 }, { t: 'Cód. Barras', w: 90 }, { t: 'NCM', w: 60 }, { t: 'Qtde', w: 47, d: 1 }]
  let cx = M
  for (const c of cols) { c.x = cx; cx += c.w }
  const totalLarg = cx - M
  const cabTabela = () => {
    pagina.drawRectangle({ x: M, y: y - 14, width: totalLarg, height: 16, color: CINZA, borderColor: LINHA, borderWidth: 0.5 })
    for (const c of cols) texto(c.t, c.d ? c.x + c.w - 3 : c.x + 3, y - 9, { tam: 7.5, f: negrito, dir: !!c.d })
    y -= 16
  }
  const ALT = 52
  if (y - ALT - 90 < M) { cabecalho(); }
  cabTabela()
  itens.forEach((i, k) => {
    if (y - ALT < M + 50) { cabecalho(); cabTabela() }
    pagina.drawRectangle({ x: M, y: y - ALT, width: totalLarg, height: ALT, borderColor: LINHA, borderWidth: 0.4 })
    const c0 = cols[0]
    texto(i.referencia, c0.x + 3, y - 10, { tam: 7.5, f: negrito })
    const th = thumbs[k]
    if (th) { const f = Math.min(36 / th.w, 36 / th.h); pagina.drawImage(th.img, { x: c0.x + 3 + (36 - th.w * f) / 2, y: y - 14 - 36 + (36 - th.h * f) / 2 - 0, width: th.w * f, height: th.h * f }) }
    texto(String(k + 1), c0.x + 46, y - 28, { tam: 7, cor: rgb(0.45, 0.45, 0.45) })
    quebrar(i.descricao, fonte, 8, cols[1].w - 8, 4).forEach((l, j) => texto(l, cols[1].x + 4, y - 11 - j * 10, { tam: 8 }))
    texto(i.codigo_barras || '', cols[2].x + 3, y - 11, { tam: 7.5 })
    texto(i.ncm || '', cols[3].x + 3, y - 11, { tam: 7.5 })
    texto(String(i.qtd), cols[4].x + cols[4].w - 3, y - 11, { tam: 8, dir: true })
    if (verPrecos) {
      texto(brl(i.preco_unit), cols[5].x + cols[5].w - 3, y - 11, { tam: 8, dir: true })
      texto(brl(i.ipi || 0), cols[6].x + cols[6].w - 3, y - 11, { tam: 8, dir: true })
      texto(brl(i.total_linha), cols[7].x + cols[7].w - 3, y - 11, { tam: 8, dir: true })
      if (i.promocao) texto('promoção', cols[5].x + cols[5].w - 3, y - 22, { tam: 6.5, dir: true, cor: VERMELHO })
    }
    y -= ALT
  })
  // total de unidades
  const unid = itens.reduce((a, i) => a + Number(i.qtd), 0)
  pagina.drawRectangle({ x: M, y: y - 14, width: totalLarg, height: 14, borderColor: LINHA, borderWidth: 0.4 })
  texto(String(unid), cols[4].x + cols[4].w - 3, y - 10, { tam: 8, f: negrito, dir: true })
  y -= 22

  if (verPrecos) {
    if (y - 50 < M) { cabecalho() }
    pagina.drawRectangle({ x: M, y: y - 34, width: totalLarg, height: 34, color: CINZA, borderColor: LINHA, borderWidth: 0.5 })
    const quatro = [['Total s/ impostos (R$)', brl(o.subtotal)], ['Qtde Itens', String(unid)], ['IPI R$', brl(o.ipi_total)], ['Total Final R$', brl(o.total)]]
    const cw = totalLarg / 4
    quatro.forEach(([r, v], k) => { texto(r, M + k * cw, y - 12, { tam: 8, f: negrito, largura: cw }); texto(v, M + k * cw, y - 27, { tam: 10, f: negrito, largura: cw }) })
    y -= 46
  } else {
    texto('Valores serão informados pela equipe da Goiandy.', M, y - 4, { tam: 8.5, f: negrito }); y -= 20
  }

  // ---------- observação e assinatura ----------
  if (y - 110 < M) cabecalho()
  texto('Observação', M, y, { tam: 9, f: negrito }); y -= 12
  const obs = (o.observacao_cliente ? 'Cliente: ' + o.observacao_cliente + '. ' : '') + 'Por favor acusar recebimento deste orçamento, prezado cliente não fazemos trocas de mercadorias quebradas pela transportadora.'
  quebrar(obs, fonte, 8, W - 2 * M, 8).forEach((l) => { texto(l, M, y, { tam: 8 }); y -= 10 })
  y -= 28
  pagina.drawLine({ start: { x: W / 2 - 110, y }, end: { x: W / 2 + 110, y }, thickness: 0.6, color: PRETO })
  texto('GOIANDY - Vendedor', W / 2 - 110, y - 11, { tam: 8.5, f: negrito, largura: 220 })

  // rodapé em todas as páginas
  const paginas = pdf.getPages()
  paginas.forEach((p, k) => {
    p.drawText(limpar(`Orçamento nº ${o.id} - Goiandy Representações - gerado em ${dataHoraBr(Date.now())} - página ${k + 1} de ${paginas.length}`), { x: M, y: 14, size: 7, font: fonte, color: rgb(0.45, 0.45, 0.45) })
  })
  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export function baixarPdf(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
