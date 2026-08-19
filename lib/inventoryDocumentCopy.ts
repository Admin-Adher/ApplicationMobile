export type InventoryDocumentLanguage = 'fr' | 'en' | 'es';

export type InventoryDocumentCopy = {
  locale: string;
  excelDateFormat: string;
  notProvided: string;
  noData: string;
  status: { available: string; low: string; out: string };
  movement: { in: string; out: string };
  workbook: {
    subject: string;
    generatedOn: string;
    calculatedCellsHint: string;
    minimumStockPriority: string;
    movementCount: (count: number) => string;
    consumptionFromIssues: string;
    photoTooltip: string;
    siteLabel: string;
    sheet: {
      summary: string;
      stock: string;
      reorder: string;
      movements: string;
      entries: string;
      exits: string;
      byBuilding: string;
      byCompany: string;
    };
    title: {
      summary: string;
      stock: string;
      reorder: string;
      movements: string;
      entries: string;
      exits: string;
      byBuilding: string;
      byCompany: string;
    };
    headers: {
      stock: string[];
      reorder: string[];
      movements: string[];
      consumptionBuilding: string[];
      consumptionCompany: string[];
      summaryReorder: string[];
    };
    kpi: {
      references: string;
      units: string;
      reorder: string;
      movements: string;
      entries: string;
      exits: string;
    };
    restockPriorities: string;
    noBelowMinimum: string;
  };
  pdf: {
    tagline: string;
    documentType: string;
    generatedOn: string;
    kpiReferences: string;
    kpiUnits: string;
    kpiEntries: string;
    kpiExits: string;
    kpiReorder: string;
    lowStock: (count: number) => string;
    stockSection: string;
    reorderSection: string;
    buildingSection: string;
    companySection: string;
    movementsSection: string;
    stockHeaders: string[];
    reorderHeaders: string[];
    buildingHeaders: string[];
    companyHeaders: string[];
    movementHeaders: string[];
  };
  filename: { stock: string; movements: string };
};

export const INVENTORY_DOCUMENT_COPY: Record<InventoryDocumentLanguage, InventoryDocumentCopy> = {
  fr: {
    locale: 'fr-FR', excelDateFormat: 'dd/mm/yyyy hh:mm', notProvided: 'Non renseigné', noData: 'Aucune donnée disponible pour cette sélection.',
    status: { available: 'DISPONIBLE', low: 'STOCK FAIBLE', out: 'RUPTURE' },
    movement: { in: 'ENTRÉE', out: 'SORTIE' },
    workbook: {
      subject: 'Classeur opérationnel de gestion de stock chantier', generatedOn: 'généré le', calculatedCellsHint: 'les cellules calculées restent modifiables dans Excel', minimumStockPriority: 'priorité calculée à partir du stock minimum', movementCount: count => `${count} mouvement(s)`, consumptionFromIssues: 'consommation issue des sorties', photoTooltip: 'Ouvrir la photo du produit', siteLabel: 'Chantier',
      sheet: { summary: 'Synthèse', stock: 'État du stock', reorder: 'À commander', movements: 'Mouvements', entries: 'Entrées', exits: 'Sorties', byBuilding: 'Par bâtiment', byCompany: 'Par entreprise' },
      title: { summary: 'Tableau de bord stock', stock: 'État du stock', reorder: 'Produits à commander', movements: 'Historique des mouvements', entries: 'Entrées de matériel', exits: 'Sorties de matériel', byBuilding: 'Consommation par bâtiment', byCompany: 'Consommation par entreprise' },
      headers: {
        stock: ['Référence', 'Désignation', 'Statut', 'Stock actuel', 'Stock minimum', 'À commander', 'Entrées', 'Sorties', 'Emplacement magasin', 'Fournisseur', 'Code-barres / QR', 'Photo'],
        reorder: ['Référence', 'Désignation', 'Statut', 'Stock actuel', 'Minimum', 'Quantité suggérée', 'Emplacement magasin', 'Fournisseur', 'Code-barres / QR'],
        movements: ['Date et heure', 'Type', 'Référence', 'Désignation', 'Quantité', 'Stock avant', 'Stock après', 'Utilisateur', 'Bâtiment', 'Zone', 'Entreprise', 'Personne', 'Fournisseur', 'Commentaire'],
        consumptionBuilding: ['Bâtiment / zone', 'Quantité sortie', 'Part du total'], consumptionCompany: ['Entreprise', 'Quantité sortie', 'Part du total'],
        summaryReorder: ['Référence', 'Désignation', 'Statut', 'Stock', 'Minimum', 'Qté suggérée', 'Emplacement magasin', 'Fournisseur'],
      },
      kpi: { references: 'RÉFÉRENCES', units: 'UNITÉS EN STOCK', reorder: 'À COMMANDER', movements: 'MOUVEMENTS', entries: 'QUANTITÉ ENTRÉE', exits: 'QUANTITÉ SORTIE' }, restockPriorities: 'Priorités de réapprovisionnement', noBelowMinimum: 'Aucun produit sous son seuil minimum.',
    },
    pdf: {
      tagline: 'Gestion de stock chantier', documentType: 'ÉTAT DU STOCK', generatedOn: 'Généré le', kpiReferences: 'RÉFÉRENCES', kpiUnits: 'UNITÉS EN STOCK', kpiEntries: 'ENTRÉES', kpiExits: 'SORTIES', kpiReorder: 'À COMMANDER', lowStock: count => `Stock faible : ${count} produit(s) à commander.`, stockSection: 'État du stock', reorderSection: 'Produits à commander', buildingSection: 'Consommation par bâtiment', companySection: 'Consommation par entreprise', movementsSection: 'Derniers mouvements',
      stockHeaders: ['Référence', 'Désignation', 'Stock', 'Mini.', 'Entrées', 'Sorties', 'Emplacement magasin'], reorderHeaders: ['Référence', 'Désignation', 'Stock', 'Minimum', 'Fournisseur'], buildingHeaders: ['Bâtiment / zone', 'Quantité sortie'], companyHeaders: ['Entreprise', 'Quantité sortie'], movementHeaders: ['Date', 'Type', 'Référence', 'Qté', 'Destination', 'Entreprise', 'Utilisateur'],
    },
    filename: { stock: 'stock', movements: 'mouvements-stock' },
  },
  en: {
    locale: 'en-US', excelDateFormat: 'mm/dd/yyyy hh:mm', notProvided: 'Not provided', noData: 'No data is available for this selection.',
    status: { available: 'AVAILABLE', low: 'LOW STOCK', out: 'OUT OF STOCK' },
    movement: { in: 'RECEIPT', out: 'ISSUE' },
    workbook: {
      subject: 'Operational construction inventory workbook', generatedOn: 'generated on', calculatedCellsHint: 'calculated cells remain editable in Excel', minimumStockPriority: 'priority calculated from minimum stock', movementCount: count => `${count} movement(s)`, consumptionFromIssues: 'consumption calculated from stock issues', photoTooltip: 'Open the product photo', siteLabel: 'Project',
      sheet: { summary: 'Summary', stock: 'Stock status', reorder: 'To reorder', movements: 'Movements', entries: 'Receipts', exits: 'Issues', byBuilding: 'By building', byCompany: 'By company' },
      title: { summary: 'Inventory dashboard', stock: 'Stock status', reorder: 'Products to reorder', movements: 'Movement history', entries: 'Material receipts', exits: 'Material issues', byBuilding: 'Consumption by building', byCompany: 'Consumption by company' },
      headers: {
        stock: ['Reference', 'Description', 'Status', 'Current stock', 'Minimum stock', 'To reorder', 'Receipts', 'Issues', 'Storage location', 'Supplier', 'Barcode / QR', 'Photo'],
        reorder: ['Reference', 'Description', 'Status', 'Current stock', 'Minimum', 'Suggested quantity', 'Storage location', 'Supplier', 'Barcode / QR'],
        movements: ['Date and time', 'Type', 'Reference', 'Description', 'Quantity', 'Stock before', 'Stock after', 'User', 'Building', 'Area', 'Company', 'Person', 'Supplier', 'Comment'],
        consumptionBuilding: ['Building / area', 'Issued quantity', 'Share of total'], consumptionCompany: ['Company', 'Issued quantity', 'Share of total'],
        summaryReorder: ['Reference', 'Description', 'Status', 'Stock', 'Minimum', 'Suggested qty.', 'Storage location', 'Supplier'],
      },
      kpi: { references: 'REFERENCES', units: 'UNITS IN STOCK', reorder: 'TO REORDER', movements: 'MOVEMENTS', entries: 'RECEIVED QUANTITY', exits: 'ISSUED QUANTITY' }, restockPriorities: 'Restocking priorities', noBelowMinimum: 'No product is below its minimum stock level.',
    },
    pdf: {
      tagline: 'Construction inventory management', documentType: 'STOCK STATUS', generatedOn: 'Generated on', kpiReferences: 'REFERENCES', kpiUnits: 'UNITS IN STOCK', kpiEntries: 'RECEIPTS', kpiExits: 'ISSUES', kpiReorder: 'TO REORDER', lowStock: count => `Low stock: ${count} product(s) to reorder.`, stockSection: 'Stock status', reorderSection: 'Products to reorder', buildingSection: 'Consumption by building', companySection: 'Consumption by company', movementsSection: 'Latest movements',
      stockHeaders: ['Reference', 'Description', 'Stock', 'Min.', 'Receipts', 'Issues', 'Storage location'], reorderHeaders: ['Reference', 'Description', 'Stock', 'Minimum', 'Supplier'], buildingHeaders: ['Building / area', 'Issued quantity'], companyHeaders: ['Company', 'Issued quantity'], movementHeaders: ['Date', 'Type', 'Reference', 'Qty.', 'Destination', 'Company', 'User'],
    },
    filename: { stock: 'inventory', movements: 'inventory-movements' },
  },
  es: {
    locale: 'es-ES', excelDateFormat: 'dd/mm/yyyy hh:mm', notProvided: 'No indicado', noData: 'No hay datos disponibles para esta selección.',
    status: { available: 'DISPONIBLE', low: 'STOCK BAJO', out: 'AGOTADO' },
    movement: { in: 'ENTRADA', out: 'SALIDA' },
    workbook: {
      subject: 'Libro operativo de gestión de stock de obra', generatedOn: 'generado el', calculatedCellsHint: 'las celdas calculadas se pueden editar en Excel', minimumStockPriority: 'prioridad calculada a partir del stock mínimo', movementCount: count => `${count} movimiento(s)`, consumptionFromIssues: 'consumo calculado a partir de las salidas', photoTooltip: 'Abrir la foto del producto', siteLabel: 'Obra',
      sheet: { summary: 'Resumen', stock: 'Estado del stock', reorder: 'Por pedir', movements: 'Movimientos', entries: 'Entradas', exits: 'Salidas', byBuilding: 'Por edificio', byCompany: 'Por empresa' },
      title: { summary: 'Panel de stock', stock: 'Estado del stock', reorder: 'Productos por pedir', movements: 'Historial de movimientos', entries: 'Entradas de material', exits: 'Salidas de material', byBuilding: 'Consumo por edificio', byCompany: 'Consumo por empresa' },
      headers: {
        stock: ['Referencia', 'Descripción', 'Estado', 'Stock actual', 'Stock mínimo', 'Por pedir', 'Entradas', 'Salidas', 'Ubicación de almacén', 'Proveedor', 'Código de barras / QR', 'Foto'],
        reorder: ['Referencia', 'Descripción', 'Estado', 'Stock actual', 'Mínimo', 'Cantidad sugerida', 'Ubicación de almacén', 'Proveedor', 'Código de barras / QR'],
        movements: ['Fecha y hora', 'Tipo', 'Referencia', 'Descripción', 'Cantidad', 'Stock anterior', 'Stock posterior', 'Usuario', 'Edificio', 'Zona', 'Empresa', 'Persona', 'Proveedor', 'Comentario'],
        consumptionBuilding: ['Edificio / zona', 'Cantidad de salida', 'Parte del total'], consumptionCompany: ['Empresa', 'Cantidad de salida', 'Parte del total'],
        summaryReorder: ['Referencia', 'Descripción', 'Estado', 'Stock', 'Mínimo', 'Cant. sugerida', 'Ubicación de almacén', 'Proveedor'],
      },
      kpi: { references: 'REFERENCIAS', units: 'UNIDADES EN STOCK', reorder: 'POR PEDIR', movements: 'MOVIMIENTOS', entries: 'CANTIDAD DE ENTRADA', exits: 'CANTIDAD DE SALIDA' }, restockPriorities: 'Prioridades de reposición', noBelowMinimum: 'Ningún producto está por debajo de su stock mínimo.',
    },
    pdf: {
      tagline: 'Gestión de stock de obra', documentType: 'ESTADO DEL STOCK', generatedOn: 'Generado el', kpiReferences: 'REFERENCIAS', kpiUnits: 'UNIDADES EN STOCK', kpiEntries: 'ENTRADAS', kpiExits: 'SALIDAS', kpiReorder: 'POR PEDIR', lowStock: count => `Stock bajo: ${count} producto(s) por pedir.`, stockSection: 'Estado del stock', reorderSection: 'Productos por pedir', buildingSection: 'Consumo por edificio', companySection: 'Consumo por empresa', movementsSection: 'Últimos movimientos',
      stockHeaders: ['Referencia', 'Descripción', 'Stock', 'Mín.', 'Entradas', 'Salidas', 'Ubicación de almacén'], reorderHeaders: ['Referencia', 'Descripción', 'Stock', 'Mínimo', 'Proveedor'], buildingHeaders: ['Edificio / zona', 'Cantidad de salida'], companyHeaders: ['Empresa', 'Cantidad de salida'], movementHeaders: ['Fecha', 'Tipo', 'Referencia', 'Cant.', 'Destino', 'Empresa', 'Usuario'],
    },
    filename: { stock: 'stock', movements: 'movimientos-stock' },
  },
};

export function inventoryDocumentCopy(language: InventoryDocumentLanguage): InventoryDocumentCopy {
  return INVENTORY_DOCUMENT_COPY[language];
}
