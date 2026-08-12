import { inventoryDocumentCopy, type InventoryDocumentCopy, type InventoryDocumentLanguage } from './inventoryDocumentCopy';

export type InventoryWorkbookKind = 'stock' | 'history' | 'entries' | 'exits' | 'by_building' | 'by_company' | 'reorder';

export type InventoryWorkbookProduct = {
  reference: string;
  designation: string;
  photoUrl?: string | null;
  currentStock: number;
  minStock: number;
  totalEntries: number;
  totalExits: number;
  location?: string | null;
  supplier?: string | null;
  barcode?: string | null;
};

export type InventoryWorkbookMovement = {
  createdAt: Date | string | number;
  movementType: 'in' | 'out';
  reference: string;
  designation: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  userName?: string | null;
  buildingName?: string | null;
  zoneName?: string | null;
  companyName?: string | null;
  personName?: string | null;
  supplier?: string | null;
  comment?: string | null;
};

type SheetStyleMeta = {
  cellStyles: Record<string, number>;
  freezeRows: number;
  tabColor: string;
  landscape: boolean;
};

type StyledWorkbook = {
  SheetNames: string[];
  Sheets: Record<string, any>;
  Props?: Record<string, unknown>;
  __buildTrackStyles?: { sheets: Record<string, SheetStyleMeta>; excelDateFormat: string };
};

type XlsxRuntime = {
  utils: {
    aoa_to_sheet: (rows: unknown[][], options?: Record<string, unknown>) => any;
    book_append_sheet: (workbook: StyledWorkbook, sheet: any, name: string) => void;
    book_new: () => StyledWorkbook;
    encode_cell: (cell: { r: number; c: number }) => string;
  };
  write: (workbook: StyledWorkbook, options: Record<string, unknown>) => ArrayBuffer | Uint8Array;
};

type ZipRuntime = {
  strFromU8: (bytes: Uint8Array) => string;
  strToU8: (text: string) => Uint8Array;
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>;
  zipSync: (files: Record<string, Uint8Array>, options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) => Uint8Array;
};

type SheetBuild = {
  sheet: any;
  meta: SheetStyleMeta;
};

const STYLE = {
  normal: 0,
  title: 1,
  subtitle: 2,
  meta: 3,
  section: 4,
  kpiLabel: 5,
  kpiValue: 6,
  header: 7,
  body: 8,
  bodyAlt: 9,
  number: 10,
  numberAlt: 11,
  date: 12,
  dateAlt: 13,
  ok: 14,
  low: 15,
  out: 16,
  link: 17,
  warningNumber: 18,
  total: 19,
  bodyWrap: 20,
  bodyWrapAlt: 21,
  percentage: 22,
} as const;

const XLSX_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/>
    <numFmt numFmtId="165" formatCode="#,##0.##;[Red]-#,##0.##;–"/>
  </numFmts>
  <fonts count="10">
    <font><sz val="10"/><color rgb="FF17243A"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
    <font><b/><sz val="22"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F3B75"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="19"/><color rgb="FF0F3B75"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF087A61"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF9A5B00"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFB42318"/><name val="Calibri"/><family val="2"/></font>
    <font><u/><sz val="10"/><color rgb="FF145DA0"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F3B75"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F8F4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE6F7EF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFDE8E8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD8E1EC"/></left><right style="thin"><color rgb="FFD8E1EC"/></right><top style="thin"><color rgb="FFD8E1EC"/></top><bottom style="thin"><color rgb="FFD8E1EC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="23">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="8" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="165" fontId="8" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function movementDate(value: Date | string | number): Date | string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date;
}

function statusFor(product: InventoryWorkbookProduct, copy: InventoryDocumentCopy): string {
  if (product.currentStock <= 0) return copy.status.out;
  if (product.minStock > 0 && product.currentStock <= product.minStock) return copy.status.low;
  return copy.status.available;
}

function productsToOrder(products: InventoryWorkbookProduct[]): InventoryWorkbookProduct[] {
  return products
    .filter(product => product.minStock > 0 && product.currentStock <= product.minStock)
    .sort((a, b) => (a.currentStock - a.minStock) - (b.currentStock - b.minStock));
}

function consumptionBy(
  movements: InventoryWorkbookMovement[],
  key: (movement: InventoryWorkbookMovement) => string,
  notProvided: string,
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const movement of movements) {
    if (movement.movementType !== 'out') continue;
    const label = key(movement).trim() || notProvided;
    totals.set(label, (totals.get(label) ?? 0) + numberValue(movement.quantity));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function address(xlsx: XlsxRuntime, row: number, column: number): string {
  return xlsx.utils.encode_cell({ r: row, c: column });
}

function styleRange(
  xlsx: XlsxRuntime,
  meta: SheetStyleMeta,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  style: number | ((row: number, column: number) => number),
): void {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      meta.cellStyles[address(xlsx, row, column)] = typeof style === 'function' ? style(row, column) : style;
    }
  }
}

function createDataSheet(
  xlsx: XlsxRuntime,
  title: string,
  subtitle: string,
  headers: string[],
  data: unknown[][],
  widths: number[],
  noData: string,
  options: {
    numericColumns?: number[];
    dateColumns?: number[];
    wrapColumns?: number[];
    statusColumn?: number;
    statusValues?: { low: string; out: string };
    warningNumberColumns?: number[];
    linkColumns?: number[];
    tabColor?: string;
  } = {},
): SheetBuild {
  const empty = data.length === 0;
  const rows: unknown[][] = [
    [title],
    [subtitle],
    [],
    headers,
    ...(empty ? [[noData]] : data),
  ];
  const sheet = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
  const lastColumn = Math.max(headers.length - 1, 0);
  const lastRow = rows.length - 1;
  sheet['!cols'] = widths.map(width => ({ wch: width }));
  sheet['!rows'] = [{ hpt: 34 }, { hpt: 22 }, { hpt: 8 }, { hpt: 28 }, ...data.map(() => ({ hpt: 24 }))];
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
  ];
  if (empty) sheet['!merges'].push({ s: { r: 4, c: 0 }, e: { r: 4, c: lastColumn } });
  sheet['!autofilter'] = { ref: `A4:${address(xlsx, lastRow, lastColumn)}` };
  sheet['!margins'] = { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };

  const meta: SheetStyleMeta = {
    cellStyles: {},
    freezeRows: 4,
    tabColor: options.tabColor ?? '145DA0',
    landscape: headers.length > 7,
  };
  styleRange(xlsx, meta, 0, 0, 0, lastColumn, STYLE.title);
  styleRange(xlsx, meta, 1, 1, 0, lastColumn, STYLE.meta);
  styleRange(xlsx, meta, 3, 3, 0, lastColumn, STYLE.header);
  styleRange(xlsx, meta, 4, lastRow, 0, lastColumn, (row, column) => {
    const alternate = (row - 4) % 2 === 1;
    if (options.dateColumns?.includes(column)) return alternate ? STYLE.dateAlt : STYLE.date;
    if (options.numericColumns?.includes(column)) return alternate ? STYLE.numberAlt : STYLE.number;
    if (options.wrapColumns?.includes(column)) return alternate ? STYLE.bodyWrapAlt : STYLE.bodyWrap;
    return alternate ? STYLE.bodyAlt : STYLE.body;
  });

  if (!empty && options.statusColumn != null) {
    data.forEach((row, index) => {
      const value = String(row[options.statusColumn!] ?? '');
      meta.cellStyles[address(xlsx, index + 4, options.statusColumn!)] = value === options.statusValues?.out
        ? STYLE.out
        : value === options.statusValues?.low
          ? STYLE.low
          : STYLE.ok;
    });
  }
  if (!empty) {
    for (const column of options.warningNumberColumns ?? []) {
      data.forEach((row, index) => {
        if (numberValue(row[column]) > 0) meta.cellStyles[address(xlsx, index + 4, column)] = STYLE.warningNumber;
      });
    }
    for (const column of options.linkColumns ?? []) {
      data.forEach((row, index) => {
        if (String(row[column] ?? '').startsWith('http')) meta.cellStyles[address(xlsx, index + 4, column)] = STYLE.link;
      });
    }
  }
  return { sheet, meta };
}

function appendStyledSheet(
  xlsx: XlsxRuntime,
  workbook: StyledWorkbook,
  name: string,
  build: SheetBuild,
): void {
  xlsx.utils.book_append_sheet(workbook, build.sheet, name.slice(0, 31));
  if (!workbook.__buildTrackStyles) workbook.__buildTrackStyles = { sheets: {}, excelDateFormat: 'dd/mm/yyyy hh:mm' };
  workbook.__buildTrackStyles.sheets[name.slice(0, 31)] = build.meta;
}

function setFormula(sheet: any, cell: string, formula: string, value: number): void {
  sheet[cell] = { t: 'n', f: formula, v: value };
}

function createStockSheet(
  xlsx: XlsxRuntime,
  products: InventoryWorkbookProduct[],
  chantierName: string,
  generatedAt: Date,
  copy: InventoryDocumentCopy,
): SheetBuild {
  const data = products.map(product => [
    product.reference,
    product.designation,
    statusFor(product, copy),
    product.currentStock,
    product.minStock,
    Math.max(product.minStock - product.currentStock, 0),
    product.totalEntries,
    product.totalExits,
    product.location ?? '',
    product.supplier ?? '',
    product.barcode ?? '',
    product.photoUrl ?? '',
  ]);
  const build = createDataSheet(
    xlsx,
    `BuildTrack — ${copy.workbook.title.stock}`,
    `${chantierName} · ${copy.workbook.generatedOn} ${generatedAt.toLocaleString(copy.locale)}`,
    copy.workbook.headers.stock,
    data,
    [18, 34, 17, 14, 15, 15, 12, 12, 24, 24, 20, 38],
    copy.noData,
    { numericColumns: [3, 4, 5, 6, 7], statusColumn: 2, statusValues: copy.status, warningNumberColumns: [5], linkColumns: [11], tabColor: '145DA0' },
  );
  products.forEach((product, index) => {
    const row = index + 5;
    const formulaCell = `F${row}`;
    setFormula(build.sheet, formulaCell, `MAX(E${row}-D${row},0)`, Math.max(product.minStock - product.currentStock, 0));
    if (product.photoUrl?.startsWith('http')) build.sheet[`L${row}`].l = { Target: product.photoUrl, Tooltip: copy.workbook.photoTooltip };
  });
  return build;
}

function createReorderSheet(
  xlsx: XlsxRuntime,
  products: InventoryWorkbookProduct[],
  chantierName: string,
  generatedAt: Date,
  copy: InventoryDocumentCopy,
): SheetBuild {
  const reorder = productsToOrder(products);
  const data = reorder.map(product => [
    product.reference,
    product.designation,
    statusFor(product, copy),
    product.currentStock,
    product.minStock,
    Math.max(product.minStock - product.currentStock, 0),
    product.location ?? '',
    product.supplier ?? '',
    product.barcode ?? '',
  ]);
  const build = createDataSheet(
    xlsx,
    `BuildTrack — ${copy.workbook.title.reorder}`,
    `${chantierName} · ${copy.workbook.minimumStockPriority} · ${generatedAt.toLocaleString(copy.locale)}`,
    copy.workbook.headers.reorder,
    data,
    [18, 34, 17, 14, 14, 18, 24, 24, 20],
    copy.noData,
    { numericColumns: [3, 4, 5], statusColumn: 2, statusValues: copy.status, warningNumberColumns: [5], tabColor: 'D97706' },
  );
  reorder.forEach((product, index) => {
    const row = index + 5;
    setFormula(build.sheet, `F${row}`, `MAX(E${row}-D${row},0)`, Math.max(product.minStock - product.currentStock, 0));
  });
  return build;
}

function createMovementSheet(
  xlsx: XlsxRuntime,
  title: string,
  movements: InventoryWorkbookMovement[],
  chantierName: string,
  generatedAt: Date,
  copy: InventoryDocumentCopy,
  filter?: 'in' | 'out',
): SheetBuild {
  const selected = filter ? movements.filter(movement => movement.movementType === filter) : movements;
  const data = selected.map(movement => [
    movementDate(movement.createdAt),
    movement.movementType === 'in' ? copy.movement.in : copy.movement.out,
    movement.reference,
    movement.designation,
    movement.quantity,
    movement.stockBefore,
    movement.stockAfter,
    movement.userName ?? '',
    movement.buildingName ?? '',
    movement.zoneName ?? '',
    movement.companyName ?? '',
    movement.personName ?? '',
    movement.supplier ?? '',
    movement.comment ?? '',
  ]);
  const build = createDataSheet(
    xlsx,
    `BuildTrack — ${title}`,
    `${chantierName} · ${copy.workbook.movementCount(selected.length)} · ${copy.workbook.generatedOn} ${generatedAt.toLocaleString(copy.locale)}`,
    copy.workbook.headers.movements,
    data,
    [21, 12, 18, 32, 12, 14, 14, 22, 24, 22, 24, 22, 24, 42],
    copy.noData,
    { numericColumns: [4, 5, 6], dateColumns: [0], wrapColumns: [13], tabColor: filter === 'in' ? '0E9F6E' : filter === 'out' ? 'DC2626' : '6B7280' },
  );
  selected.forEach((movement, index) => {
    build.meta.cellStyles[`B${index + 5}`] = movement.movementType === 'in' ? STYLE.ok : STYLE.out;
  });
  return build;
}

function createConsumptionSheet(
  xlsx: XlsxRuntime,
  title: string,
  label: string,
  totals: Array<[string, number]>,
  chantierName: string,
  generatedAt: Date,
  copy: InventoryDocumentCopy,
): SheetBuild {
  const totalQuantity = totals.reduce((sum, [, quantity]) => sum + quantity, 0);
  const data = totals.map(([name, quantity]) => [name, quantity, totalQuantity > 0 ? quantity / totalQuantity : 0]);
  const build = createDataSheet(
    xlsx,
    `BuildTrack — ${title}`,
    `${chantierName} · ${copy.workbook.consumptionFromIssues} · ${generatedAt.toLocaleString(copy.locale)}`,
    [label, copy.workbook.headers.consumptionBuilding[1], copy.workbook.headers.consumptionBuilding[2]],
    data,
    [38, 20, 18],
    copy.noData,
    { numericColumns: [1, 2], tabColor: '7C3AED' },
  );
  totals.forEach(([_, quantity], index) => {
    const row = index + 5;
    build.sheet[`C${row}`] = { t: 'n', f: totalQuantity > 0 ? `B${row}/SUM(B$5:B$${Math.max(totals.length + 4, 5)})` : '0', v: totalQuantity > 0 ? quantity / totalQuantity : 0, z: '0.0%' };
    build.meta.cellStyles[`C${row}`] = STYLE.percentage;
  });
  return build;
}

function createSummarySheet(
  xlsx: XlsxRuntime,
  products: InventoryWorkbookProduct[],
  movements: InventoryWorkbookMovement[],
  chantierName: string,
  generatedAt: Date,
  copy: InventoryDocumentCopy,
): SheetBuild {
  const reorder = productsToOrder(products);
  const totalStock = products.reduce((sum, product) => sum + numberValue(product.currentStock), 0);
  const totalEntries = movements.filter(movement => movement.movementType === 'in').reduce((sum, movement) => sum + numberValue(movement.quantity), 0);
  const totalExits = movements.filter(movement => movement.movementType === 'out').reduce((sum, movement) => sum + numberValue(movement.quantity), 0);
  const lowRows = reorder.slice(0, 10).map(product => [
    product.reference,
    product.designation,
    statusFor(product, copy),
    product.currentStock,
    product.minStock,
    Math.max(product.minStock - product.currentStock, 0),
    product.location ?? '',
    product.supplier ?? '',
  ]);
  const rows: unknown[][] = [
    [`BuildTrack — ${copy.workbook.title.summary}`],
    [`${copy.workbook.siteLabel} : ${chantierName}`],
    [`${copy.workbook.generatedOn} ${generatedAt.toLocaleString(copy.locale)} · ${copy.workbook.calculatedCellsHint}`],
    [],
    [products.length, '', totalStock, '', reorder.length, '', movements.length, '', totalEntries, '', totalExits, ''],
    [copy.workbook.kpi.references, '', copy.workbook.kpi.units, '', copy.workbook.kpi.reorder, '', copy.workbook.kpi.movements, '', copy.workbook.kpi.entries, '', copy.workbook.kpi.exits, ''],
    [],
    [copy.workbook.restockPriorities],
    copy.workbook.headers.summaryReorder,
    ...(lowRows.length ? lowRows : [[copy.workbook.noBelowMinimum]]),
  ];
  const sheet = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet['!cols'] = [18, 28, 18, 4, 18, 4, 18, 24, 19, 4, 19, 4].map(width => ({ wch: width }));
  sheet['!rows'] = [{ hpt: 38 }, { hpt: 24 }, { hpt: 20 }, { hpt: 8 }, { hpt: 34 }, { hpt: 28 }, { hpt: 8 }, { hpt: 25 }, { hpt: 28 }, ...lowRows.map(() => ({ hpt: 24 }))];
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 1 } },
    { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } },
    { s: { r: 4, c: 4 }, e: { r: 4, c: 5 } },
    { s: { r: 4, c: 6 }, e: { r: 4, c: 7 } },
    { s: { r: 4, c: 8 }, e: { r: 4, c: 9 } },
    { s: { r: 4, c: 10 }, e: { r: 4, c: 11 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    { s: { r: 5, c: 2 }, e: { r: 5, c: 3 } },
    { s: { r: 5, c: 4 }, e: { r: 5, c: 5 } },
    { s: { r: 5, c: 6 }, e: { r: 5, c: 7 } },
    { s: { r: 5, c: 8 }, e: { r: 5, c: 9 } },
    { s: { r: 5, c: 10 }, e: { r: 5, c: 11 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 11 } },
  ];
  if (!lowRows.length) sheet['!merges'].push({ s: { r: 9, c: 0 }, e: { r: 9, c: 11 } });
  sheet['!margins'] = { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
  const meta: SheetStyleMeta = { cellStyles: {}, freezeRows: 0, tabColor: '0F3B75', landscape: true };
  styleRange(xlsx, meta, 0, 0, 0, 11, STYLE.title);
  styleRange(xlsx, meta, 1, 1, 0, 11, STYLE.subtitle);
  styleRange(xlsx, meta, 2, 2, 0, 11, STYLE.meta);
  [0, 2, 4, 6, 8, 10].forEach(column => {
    styleRange(xlsx, meta, 4, 4, column, column + 1, STYLE.kpiValue);
    styleRange(xlsx, meta, 5, 5, column, column + 1, STYLE.kpiLabel);
  });
  styleRange(xlsx, meta, 7, 7, 0, 11, STYLE.section);
  styleRange(xlsx, meta, 8, 8, 0, 7, STYLE.header);
  styleRange(xlsx, meta, 9, rows.length - 1, 0, 7, (row, column) => {
    if (column >= 3 && column <= 5) return (row - 9) % 2 ? STYLE.numberAlt : STYLE.number;
    return (row - 9) % 2 ? STYLE.bodyAlt : STYLE.body;
  });
  lowRows.forEach((row, index) => {
    const status = String(row[2]);
    meta.cellStyles[`C${index + 10}`] = status === copy.status.out ? STYLE.out : STYLE.low;
    if (numberValue(row[5]) > 0) meta.cellStyles[`F${index + 10}`] = STYLE.warningNumber;
  });

  const stockEnd = Math.max(products.length + 4, 5);
  const movementEnd = Math.max(movements.length + 4, 5);
  if (products.length) {
    setFormula(sheet, 'A5', `COUNTA('${copy.workbook.sheet.stock}'!A5:A${stockEnd})`, products.length);
    setFormula(sheet, 'C5', `SUM('${copy.workbook.sheet.stock}'!D5:D${stockEnd})`, totalStock);
  }
  if (reorder.length) {
    setFormula(sheet, 'E5', `COUNTA('${copy.workbook.sheet.reorder}'!A5:A${reorder.length + 4})`, reorder.length);
  }
  if (movements.length) {
    setFormula(sheet, 'G5', `COUNTA('${copy.workbook.sheet.movements}'!A5:A${movementEnd})`, movements.length);
    setFormula(sheet, 'I5', `SUMIF('${copy.workbook.sheet.movements}'!B5:B${movementEnd},"${copy.movement.in}",'${copy.workbook.sheet.movements}'!E5:E${movementEnd})`, totalEntries);
    setFormula(sheet, 'K5', `SUMIF('${copy.workbook.sheet.movements}'!B5:B${movementEnd},"${copy.movement.out}",'${copy.workbook.sheet.movements}'!E5:E${movementEnd})`, totalExits);
  }
  return { sheet, meta };
}

export function buildInventoryWorkbookEngine(
  xlsx: XlsxRuntime,
  kind: InventoryWorkbookKind,
  products: InventoryWorkbookProduct[],
  movements: InventoryWorkbookMovement[],
  chantierName: string,
  generatedAt = new Date(),
  language: InventoryDocumentLanguage = 'fr',
): StyledWorkbook {
  const copy = inventoryDocumentCopy(language);
  const workbook = xlsx.utils.book_new();
  workbook.__buildTrackStyles = { sheets: {}, excelDateFormat: copy.excelDateFormat };
  workbook.Props = {
    Title: `BuildTrack - Stock - ${chantierName}`,
    Subject: copy.workbook.subject,
    Author: 'BuildTrack',
    Company: 'BuildTrack',
    CreatedDate: generatedAt,
  };

  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.stock, createStockSheet(xlsx, products, chantierName, generatedAt, copy));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.reorder, createReorderSheet(xlsx, products, chantierName, generatedAt, copy));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.movements, createMovementSheet(xlsx, copy.workbook.title.movements, movements, chantierName, generatedAt, copy));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.entries, createMovementSheet(xlsx, copy.workbook.title.entries, movements, chantierName, generatedAt, copy, 'in'));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.exits, createMovementSheet(xlsx, copy.workbook.title.exits, movements, chantierName, generatedAt, copy, 'out'));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.byBuilding, createConsumptionSheet(
    xlsx,
    copy.workbook.title.byBuilding,
    copy.workbook.headers.consumptionBuilding[0],
    consumptionBy(movements, movement => [movement.buildingName, movement.zoneName].filter(Boolean).join(' / '), copy.notProvided),
    chantierName,
    generatedAt,
    copy,
  ));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.byCompany, createConsumptionSheet(
    xlsx,
    copy.workbook.title.byCompany,
    copy.workbook.headers.consumptionCompany[0],
    consumptionBy(movements, movement => movement.companyName ?? '', copy.notProvided),
    chantierName,
    generatedAt,
    copy,
  ));
  appendStyledSheet(xlsx, workbook, copy.workbook.sheet.summary, createSummarySheet(xlsx, products, movements, chantierName, generatedAt, copy));

  const focusByKind: Record<InventoryWorkbookKind, string> = {
    stock: copy.workbook.sheet.stock,
    history: copy.workbook.sheet.movements,
    entries: copy.workbook.sheet.entries,
    exits: copy.workbook.sheet.exits,
    by_building: copy.workbook.sheet.byBuilding,
    by_company: copy.workbook.sheet.byCompany,
    reorder: copy.workbook.sheet.reorder,
  };
  const focus = focusByKind[kind];
  workbook.SheetNames = [copy.workbook.sheet.summary, focus, ...workbook.SheetNames.filter(name => name !== copy.workbook.sheet.summary && name !== focus)];
  return workbook;
}

function applyCellStyles(xml: string, styles: Record<string, number>): string {
  return xml.replace(/<c\b([^>]*)>/g, (match, attributes: string) => {
    const addressMatch = attributes.match(/\br="([^"]+)"/);
    if (!addressMatch) return match;
    const style = styles[addressMatch[1]];
    if (style == null) return match;
    const selfClosing = /\/\s*$/.test(attributes);
    const cleanAttributes = attributes
      .replace(/\s*\/\s*$/, '')
      .replace(/\s+s="\d+"/g, '');
    return `<c${cleanAttributes} s="${style}"${selfClosing ? '/>' : '>'}`;
  });
}

function applySheetView(xml: string, meta: SheetStyleMeta): string {
  const pane = meta.freezeRows > 0
    ? `<pane ySplit="${meta.freezeRows}" topLeftCell="A${meta.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${meta.freezeRows + 1}" sqref="A${meta.freezeRows + 1}"/>`
    : '';
  return xml.replace(
    /<sheetViews><sheetView\b([^>]*)\/?>(?:<\/sheetView>)?<\/sheetViews>/,
    (_match, attributes: string) => {
      const cleanAttributes = attributes
        .replace(/\s*\/\s*$/, '')
        .replace(/\s+showGridLines="[^"]*"/g, '');
      return `<sheetViews><sheetView${cleanAttributes} showGridLines="0">${pane}</sheetView></sheetViews>`;
    },
  );
}

function polishWorksheetXml(xml: string, meta: SheetStyleMeta): string {
  let next = applyCellStyles(xml, meta.cellStyles);
  next = applySheetView(next, meta);
  next = next.replace(
    /<worksheet([^>]*)>/,
    `<worksheet$1><sheetPr><tabColor rgb="FF${meta.tabColor}"/><pageSetUpPr fitToPage="1"/></sheetPr>`,
  );
  if (!next.includes('<pageSetup ')) {
    const pageSetup = `<pageSetup orientation="${meta.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`;
    const pageMargins = /<pageMargins\b[^>]*\/>/;
    if (pageMargins.test(next)) {
      next = next.replace(pageMargins, match => `${match}${pageSetup}`);
    } else if (next.includes('<ignoredErrors')) {
      next = next.replace('<ignoredErrors', `${pageSetup}<ignoredErrors`);
    } else {
      next = next.replace('</worksheet>', `${pageSetup}</worksheet>`);
    }
  }
  return next;
}

export function writeInventoryWorkbookBytesEngine(
  xlsx: XlsxRuntime,
  zip: ZipRuntime,
  workbook: StyledWorkbook,
): Uint8Array {
  const raw = xlsx.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
    cellDates: true,
  });
  const files = zip.unzipSync(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  const excelDateFormat = workbook.__buildTrackStyles?.excelDateFormat ?? 'dd/mm/yyyy hh:mm';
  files['xl/styles.xml'] = zip.strToU8(XLSX_STYLES_XML.replace('dd/mm/yyyy hh:mm', excelDateFormat));
  const styleMeta = workbook.__buildTrackStyles?.sheets ?? {};
  workbook.SheetNames.forEach((name, index) => {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const bytes = files[path];
    const meta = styleMeta[name];
    if (!bytes || !meta) return;
    files[path] = zip.strToU8(polishWorksheetXml(zip.strFromU8(bytes), meta));
  });
  return zip.zipSync(files, { level: 6 });
}

export function inventoryWorkbookBytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return output;
}
