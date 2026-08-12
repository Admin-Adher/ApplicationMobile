export type FloatingPanelLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
};

type AnchorBounds = {
  top: number;
  right: number;
  bottom: number;
};

type FloatingPanelLayoutInput = {
  anchor: AnchorBounds;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth?: number;
  viewportMargin?: number;
  gap?: number;
};

export function computeFloatingPanelLayout({
  anchor,
  panelHeight,
  viewportWidth,
  viewportHeight,
  preferredWidth = 304,
  viewportMargin = 16,
  gap = 8,
}: FloatingPanelLayoutInput): FloatingPanelLayout {
  const usableWidth = Math.max(0, viewportWidth - viewportMargin * 2);
  const width = Math.min(preferredWidth, usableWidth);
  const spaceBelow = Math.max(0, viewportHeight - viewportMargin - anchor.bottom - gap);
  const spaceAbove = Math.max(0, anchor.top - viewportMargin - gap);
  const fitsBelow = panelHeight <= spaceBelow;
  const fitsAbove = panelHeight <= spaceAbove;
  const placement = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove) ? 'bottom' : 'top';
  const availableHeight = placement === 'bottom' ? spaceBelow : spaceAbove;
  const renderedHeight = Math.min(panelHeight, availableHeight);
  const maxLeft = Math.max(viewportMargin, viewportWidth - viewportMargin - width);
  const left = Math.min(Math.max(anchor.right - width, viewportMargin), maxLeft);
  const top = placement === 'bottom'
    ? anchor.bottom + gap
    : Math.max(viewportMargin, anchor.top - gap - renderedHeight);

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.floor(availableHeight),
    placement,
  };
}
