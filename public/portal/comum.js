// Funções de apoio do portal (formatação e blocos repetidos).
import { el, brl } from '/js/util.js'

export const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
export const dataHoraBr = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' }) : '')
export const num = (n) => String(n).replace('.', ',')
export const prazoTxt = (t) => (t.tipo === 'vista' ? 'À vista' : 'A prazo' + (t.prazo ? ' ' + t.prazo : ''))
// Condição de pagamento em destaque: "À vista" ou "30/45/55 dias"
export const condicao = (t) => (t.tipo === 'vista' ? 'À vista' : t.prazo ? (/^[\d\s\/.,+-]+$/.test(t.prazo) ? t.prazo.trim() + ' dias' : t.prazo) : 'A prazo')

export function textoCaixa(i) {
  const partes = []
  if (i.nao_abre_caixa && i.qtd_caixa) partes.push(`Só caixa fechada (${i.qtd_caixa} un.)`)
  else {
    if (i.qtd_minima) partes.push(`Mín. ${i.qtd_minima} un.`)
    if (i.qtd_caixa) partes.push(`caixa com ${i.qtd_caixa}`)
  }
  return partes.join(' · ')
}

export function blocoPreco(i, verPrecos) {
  if (!verPrecos) return el('div', { class: 'p-vitrine' }, 'Consulte os valores com seu vendedor')
  const p = el('div', { class: 'p-preco' }, brl(i.preco))
  if (i.preco_original) p.append(el('small', {}, brl(i.preco_original)))
  if (i.ipi > 0) p.append(el('span', { class: 'ipi' }, `+ IPI ${num(i.ipi)}%`))
  if (i.promocao) p.append(el('span', { class: 'ipi' }, 'Promoção · sem desconto adicional'))
  return p
}

export const SITUACAO = { Novo: 'st-novo', 'Em atendimento': 'st-atend', 'Pedido gerado': 'st-ok', Cancelado: 'st-cancel' }
export const seloSituacao = (s) => el('span', { class: 'selo-st ' + (SITUACAO[s] || '') }, s)
