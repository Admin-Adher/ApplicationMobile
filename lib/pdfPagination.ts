/** Shared by browser printing, server PDF rendering and the native print WebView. */
export const PDF_PAGINATION_CSS = `
  @media print {
    .sig-row, .sig-block, .signature-section, .pdf-signatures,
    .doc-footer, .footer, .photo-item, .info-card, .kpi-card, .kpi {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    h1, h2, h3, .section-header, .sh {
      break-after: avoid-page;
      page-break-after: avoid;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr, figure, img, svg {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    p { orphans: 3; widows: 3; }
    .sig-name, .sig-date { overflow-wrap: anywhere; }
  }
`;

export function withPdfPagination(html: string): string {
  if (/<style\b[^>]*\bid=["']buildtrack-pdf-pagination["']/i.test(html)) return html;
  const style = `<style id="buildtrack-pdf-pagination">${PDF_PAGINATION_CSS}</style>`;
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, () => `${style}</head>`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, tag => `${tag}<head>${style}</head>`);
  return style + html;
}
