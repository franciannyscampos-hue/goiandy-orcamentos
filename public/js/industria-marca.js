// Logo e banners da indústria (aparecem no portal do cliente). Só para indústria já salva.
import { el, api, pode } from './util.js'
import { prepararImagem, enviarBinario } from './itens.js'

export function secaoMarca(item, usuario) {
  const podeEditar = pode(usuario, 'industrias.editar')
  const area = el('div', { class: 'compradores' })
  const id = item.id

  async function desenhar() {
    const r = await api('/marca/industria/' + id)
    if (!r.ok) return area.replaceChildren(el('h4', {}, 'Logo e banners'), el('p', { class: 'mudo' }, r.dados.erro || 'Não foi possível carregar.'))
    const { industria, banners } = r.dados
    const erro = el('div')
    const falha = (e) => erro.replaceChildren(el('div', { class: 'erro', role: 'alert' }, String(e.message || e)))

    // logo
    const arqLogo = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', style: 'display:none' })
    arqLogo.addEventListener('change', async () => {
      if (!arqLogo.files[0]) return
      try {
        const blob = await prepararImagem(arqLogo.files[0], 700)
        const e = await enviarBinario(`/marca/industria/${id}/logo`, blob)
        if (!e.ok) throw new Error(e.dados.erro || 'Não foi possível enviar a logo.')
        desenhar()
      } catch (e) { falha(e) }
    })
    const logo = el('div', { class: 'marca-logo' }, industria.tem_logo ? el('img', { src: `/api/marca/logo/${id}?v=${Date.now()}`, alt: 'Logo' }) : el('span', { class: 'mudo pequeno' }, 'sem logo'))

    // banners
    const arqBanner = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, style: 'display:none' })
    arqBanner.addEventListener('change', async () => {
      try {
        for (const f of arqBanner.files) {
          const blob = await prepararImagem(f, 1920)
          const e = await enviarBinario(`/marca/industria/${id}/banners`, blob)
          if (!e.ok) throw new Error(`${f.name}: ${e.dados.erro || 'não foi possível enviar.'}`)
        }
      } catch (e) { falha(e); return }
      desenhar()
    })
    area.replaceChildren(
      el('h4', {}, 'Logo e banners (portal do cliente)'),
      el('div', { class: 'mudo pequeno' }, 'A logo aparece nos cartões de "Escolha a indústria". Os banners passam no topo da página inicial do cliente que tiver esta indústria liberada, e o clique leva ao catálogo dela.'),
      el('div', { class: 'marca-linha' }, logo, podeEditar ? el('div', { class: 'acoes-cartao' }, arqLogo,
        el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => arqLogo.click() }, industria.tem_logo ? 'Trocar logo' : 'Enviar logo'),
        industria.tem_logo ? el('button', { type: 'button', class: 'link', onclick: async () => { await api(`/marca/industria/${id}/logo`, { metodo: 'DELETE', corpo: {} }); desenhar() } }, 'Remover') : '') : ''),
      el('div', { class: 'dica' }, 'Logo: fundo branco ou transparente, formato quadrado ou horizontal.'),
      el('h4', {}, `Banners (${banners.length} de 10)`),
      el('div', { class: 'marca-banners' }, ...banners.map((b) =>
        el('div', { class: 'marca-banner' }, el('img', { src: `/api/marca/banner/${b.id}`, alt: 'Banner' }),
          podeEditar ? el('button', { type: 'button', class: 'link', onclick: async () => { if (!confirm('Remover este banner?')) return; await api('/marca/banner/' + b.id, { metodo: 'DELETE', corpo: {} }); desenhar() } }, 'Remover') : ''))),
      podeEditar ? el('div', { class: 'acoes-cartao' }, arqBanner, el('button', { type: 'button', class: 'secundario botao-pequeno', onclick: () => arqBanner.click() }, '+ Adicionar banner(s)')) : '',
      el('div', { class: 'dica' }, 'Tamanho ideal do banner: 1700 x 560 pixels (formato bem largo). Pode escolher vários de uma vez.'),
      erro
    )
  }
  desenhar()
  return area
}
