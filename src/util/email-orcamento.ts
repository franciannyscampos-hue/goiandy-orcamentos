import type { Bindings } from '../types'
import { emailConfigurado, enviarEmail } from './email'
import { registrarHistorico, type Ator } from './historico'

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dh = (ms: number) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })
const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

// Guarda o PDF (se veio) e manda o e-mail do orçamento ao comprador, com cópia ao vendedor e à equipe.
export async function enviarEmailsOrcamento(env: Bindings, orcId: number, pdf: Uint8Array | null, ator: Ator, atualizacao: boolean): Promise<{ enviado: boolean; erro?: string }> {
  const o = await env.DB.prepare(
    `SELECT o.*, i.nome AS industria, cl.razao_social, cl.nome_fantasia, cl.cnpj, v.nome AS vendedor, v.email AS vendedor_email, b.nome AS comprador, b.email AS comprador_email
       FROM orcamentos o JOIN clientes cl ON cl.id = o.cliente_id JOIN industrias i ON i.id = o.industria_id
       LEFT JOIN vendedores v ON v.id = cl.vendedor_id LEFT JOIN compradores b ON b.id = o.comprador_id WHERE o.id = ? AND o.status <> 'carrinho'`
  ).bind(orcId).first<Record<string, unknown>>()
  if (!o) return { enviado: false, erro: 'Orçamento não encontrado.' }
  if (pdf) {
    const chave = `orcamentos/${orcId}/orcamento-${orcId}-${Date.now()}.pdf`
    await env.ARQUIVOS.put(chave, pdf, { httpMetadata: { contentType: 'application/pdf' } })
    await env.DB.prepare('UPDATE orcamentos SET pdf_chave = ? WHERE id = ?').bind(chave, orcId).run()
  }
  if (!emailConfigurado(env)) {
    await registrarHistorico({ env }, orcId, ator, 'email', 'E-mail não enviado: envio por e-mail ainda não configurado.')
    return { enviado: false, erro: 'E-mail ainda não configurado.' }
  }
  const itens = await env.DB.prepare('SELECT referencia, descricao, qtd, preco_unit, total_linha FROM orcamento_itens WHERE orcamento_id = ? ORDER BY id').bind(orcId).all<{ referencia: string; descricao: string; qtd: number; preco_unit: number | null; total_linha: number }>()
  const ver = !!o.ver_precos
  const nomeCli = String(o.nome_fantasia || o.razao_social)
  const assunto = `${atualizacao ? 'Orçamento atualizado' : 'Orçamento'} nº ${orcId} - ${o.industria} - ${nomeCli}`
  const linhasHtml = itens.results.map((i) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${esc(i.referencia)}</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${esc(i.descricao)}</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${i.qtd}</td>${ver ? `<td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${brl(Number(i.total_linha))}</td>` : ''}</tr>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:680px">
<h2 style="color:#02264a;margin:0 0 8px">Goiandy Representações</h2>
<p>${atualizacao ? 'O orçamento abaixo foi <strong>atualizado</strong>.' : 'Recebemos o orçamento abaixo.'} O PDF segue em anexo.</p>
<p><strong>Orçamento nº ${orcId}</strong> · ${esc(o.industria)} · ${esc(o.tabela_nome)}<br>Cliente: ${esc(nomeCli)} (${esc(o.cnpj)})<br>Comprador: ${esc(o.comprador)}${o.vendedor ? `<br>Vendedor: ${esc(o.vendedor)}` : ''}<br>Enviado em ${dh(Number(o.enviado_em))}</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#f3f4f6"><th style="padding:4px 8px;text-align:left">Ref.</th><th style="padding:4px 8px;text-align:left">Produto</th><th style="padding:4px 8px;text-align:right">Qtde</th>${ver ? '<th style="padding:4px 8px;text-align:right">Total</th>' : ''}</tr>${linhasHtml}</table>
${ver ? `<p style="font-size:16px"><strong>Total final: ${brl(Number(o.total))}</strong></p>` : '<p>Valores serão informados pela equipe da Goiandy.</p>'}
${o.transportadora_texto ? `<p>Transportadora: ${esc(o.transportadora_texto)}</p>` : ''}${o.observacao_cliente ? `<p>Observação: ${esc(o.observacao_cliente)}</p>` : ''}
<p style="color:#6b7280;font-size:12px">Informamos que não realizamos a troca de mercadorias que apresentem quebras decorrentes do transporte.</p></div>`
  const texto = `Goiandy Representações\n${atualizacao ? 'Orçamento atualizado' : 'Orçamento'} nº ${orcId} - ${o.industria} - ${nomeCli}\n` + itens.results.map((i) => `${i.referencia} ${i.descricao} - ${i.qtd} un.`).join('\n') + (ver ? `\nTotal final: ${brl(Number(o.total))}` : '') + '\nO PDF segue em anexo.'
  const para = [String(o.comprador_email || '')].filter(emailValido)
  const cc = [String(o.vendedor_email || '')].filter(emailValido)
  const bcc = [env.EMAIL_EQUIPE || env.EMAIL_REMETENTE || ''].filter(emailValido)
  if (!para.length) para.push(...bcc.splice(0))
  const r = await enviarEmail(env, { para, cc, bcc, assunto, html, texto, anexo: pdf ? { nome: `Orcamento-${orcId}.pdf`, tipo: 'application/pdf', bytes: pdf } : undefined })
  await registrarHistorico({ env }, orcId, ator, 'email', r.ok ? `E-mail enviado para ${[...para, ...cc].join(', ')} (com cópia à equipe)${pdf ? ' com PDF' : ' sem PDF'}` : `Falha ao enviar e-mail: ${r.erro}`)
  return { enviado: r.ok, erro: r.erro }
}
