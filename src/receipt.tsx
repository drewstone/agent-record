import { renderToStaticMarkup } from 'react-dom/server'
import { RunReceiptView } from './workspace/RunOverview.js'
import { runReceiptSchema } from './workspace/run-receipt.js'
import type { RunReceipt } from './workspace/run-receipt.js'

/** Shareable HTML uses exactly the component that renders the live document, with print drawers open. */
export function renderRunReceipt(receipt: RunReceipt, { css = '', api = '/api/discovery' }: { css?: string; api?: string } = {}) {
  const doc = runReceiptSchema.parse(receipt)
  const markup = renderToStaticMarkup(<div className="agent-record ar-ws" data-theme="light"><RunReceiptView api={api} receipt={doc} print /></div>)
  const title = doc.title.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style><body>${markup}</body></html>`
}
