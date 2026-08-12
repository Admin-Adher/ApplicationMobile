export type InventoryLanguage = 'fr' | 'en' | 'es';
export type InventoryMode = 'in' | 'out' | 'stock' | 'history';
export type InventoryProductFilter = 'all' | 'low';
export type InventoryMovementFilter = 'all' | 'in' | 'out';

export type InventoryProductRow = {
  id: string;
  organization_id?: string | null;
  chantier_id: string;
  reference: string;
  designation?: string | null;
  barcode?: string | null;
  photo_url?: string | null;
  current_stock?: number | null;
  total_entries?: number | null;
  total_exits?: number | null;
  min_stock?: number | null;
  location?: string | null;
  supplier?: string | null;
};

export type InventoryMovementRow = {
  id: string;
  chantier_id: string;
  product_id: string;
  movement_type: 'in' | 'out';
  quantity: number;
  stock_before?: number | null;
  stock_after?: number | null;
  reference?: string | null;
  designation?: string | null;
  supplier?: string | null;
  building_name?: string | null;
  zone_name?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  person_name?: string | null;
  comment?: string | null;
  user_name?: string | null;
  created_at?: string | null;
};

export type InventoryProjectRow = {
  id: string;
  name?: string | null;
  title?: string | null;
};

export type InventoryCompanyRow = {
  id: string;
  name?: string | null;
  chantier_id?: string | null;
};

export type AuthorizedInventorySnapshot = {
  products: InventoryProductRow[];
  movements: InventoryMovementRow[];
  projects: InventoryProjectRow[];
  companies: InventoryCompanyRow[];
};

export type InventoryCapabilities = {
  canRecord: boolean;
  canManage: boolean;
  canAdjust: boolean;
  canExport: boolean;
};

export type InventoryWorkspaceProps = {
  snapshot: AuthorizedInventorySnapshot;
  selectedProjectId: string;
  capabilities: InventoryCapabilities;
  language: InventoryLanguage;
  reportLanguage: InventoryLanguage;
  onReportLanguageChange: (language: InventoryLanguage) => void;
  onReload: () => Promise<void> | void;
};

export function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeInventoryReference(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function inventoryLocale(language: InventoryLanguage) {
  if (language === 'fr') return 'fr-FR';
  if (language === 'es') return 'es-ES';
  return 'en-GB';
}

export function isInventoryLowStock(product: InventoryProductRow) {
  const minimum = numberValue(product.min_stock);
  return minimum > 0 && numberValue(product.current_stock) <= minimum;
}

export function inventoryProjectName(project: InventoryProjectRow | undefined, fallback: string) {
  return String(project?.name ?? project?.title ?? '').trim() || fallback;
}

type ProjectionInput = {
  snapshot: AuthorizedInventorySnapshot;
  selectedProjectId: string;
  search: string;
  language: InventoryLanguage;
  productFilter: InventoryProductFilter;
  movementFilter: InventoryMovementFilter;
};

export function buildInventoryProjection({
  snapshot,
  selectedProjectId,
  search,
  language,
  productFilter,
  movementFilter,
}: ProjectionInput) {
  const isAggregate = selectedProjectId === 'all';
  const activeProjectId = isAggregate ? '' : selectedProjectId;
  const locale = inventoryLocale(language);
  const projectNames = new Map(snapshot.projects.map(project => [
    String(project.id),
    inventoryProjectName(project, String(project.id)),
  ]));
  const scopedProducts = snapshot.products.filter(product =>
    !activeProjectId || String(product.chantier_id) === String(activeProjectId),
  );
  const scopedMovements = snapshot.movements
    .filter(movement => !activeProjectId || String(movement.chantier_id) === String(activeProjectId))
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  const needle = search.trim().toLocaleLowerCase(locale);
  const normalizedReference = normalizeInventoryReference(search);
  const filteredProducts = scopedProducts.filter(product => {
    if (productFilter === 'low' && !isInventoryLowStock(product)) return false;
    if (!needle) return true;
    return String(product.reference ?? '').toLocaleLowerCase(locale).includes(needle)
      || normalizeInventoryReference(product.reference ?? '').includes(normalizedReference)
      || String(product.designation ?? '').toLocaleLowerCase(locale).includes(needle)
      || String(product.barcode ?? '').includes(search.trim())
      || String(product.location ?? '').toLocaleLowerCase(locale).includes(needle)
      || String(projectNames.get(String(product.chantier_id)) ?? '').toLocaleLowerCase(locale).includes(needle);
  });
  const filteredMovements = scopedMovements.filter(movement => {
    if (movementFilter !== 'all' && movement.movement_type !== movementFilter) return false;
    if (!needle) return true;
    return [
      movement.reference,
      movement.designation,
      movement.building_name,
      movement.zone_name,
      movement.company_name,
      movement.person_name,
      movement.comment,
      movement.user_name,
      projectNames.get(String(movement.chantier_id)),
    ].some(value => String(value ?? '').toLocaleLowerCase(locale).includes(needle));
  });

  return {
    isAggregate,
    activeProjectId,
    projectNames,
    scopedProducts,
    scopedMovements,
    filteredProducts,
    filteredMovements,
    lowStockProducts: scopedProducts.filter(isInventoryLowStock),
    totalUnits: scopedProducts.reduce((sum, product) => sum + numberValue(product.current_stock), 0),
  };
}

const FR = {
  eyebrow: 'Logistique chantier',
  title: 'Stock & mouvements',
  description: 'Pilotez les références, les réceptions et les distributions depuis un espace opérationnel unique.',
  refresh: 'Actualiser',
  refreshing: 'Actualisation…',
  references: 'Références',
  units: 'Unités disponibles',
  lowStocks: 'Stocks faibles',
  movements: 'Mouvements',
  receive: 'Entrée',
  receiveHelp: 'Réceptionner du matériel',
  dispatch: 'Sortie',
  dispatchHelp: 'Distribuer vers le chantier',
  stock: 'Stock',
  history: 'Historique',
  operations: 'Opérations rapides',
  operationsHelp: 'Une saisie guidée, du scan à la validation.',
  allProjects: 'Tous les chantiers',
  aggregateHint: 'Vue consolidée : le chantier est indiqué sur chaque référence et mouvement.',
  stockTitle: 'Référentiel de stock',
  historyTitle: 'Journal des mouvements',
  stockSubtitle: (count: number) => `${count} référence${count > 1 ? 's' : ''} affichée${count > 1 ? 's' : ''}`,
  historySubtitle: (count: number) => `${count} mouvement${count > 1 ? 's' : ''} affiché${count > 1 ? 's' : ''}`,
  searchStock: 'Référence, désignation, code-barres, chantier…',
  searchHistory: 'Référence, destination, entreprise, utilisateur…',
  clearSearch: 'Effacer la recherche',
  all: 'Tous',
  lowOnly: 'Stock faible',
  entries: 'Entrées',
  exits: 'Sorties',
  export: 'Exporter',
  exportTitle: 'Rapports de stock',
  documentLanguage: 'Langue du document',
  workbook: 'Classeur Excel',
  word: 'Rapport Word',
  pdf: 'Rapport PDF',
  exportDone: 'Le document a été préparé.',
  exportError: 'Le document n’a pas pu être généré.',
  close: 'Fermer',
  dismiss: 'Masquer le message',
  project: 'Chantier',
  product: 'Produit',
  photo: 'Photo',
  reference: 'Référence',
  designation: 'Désignation',
  barcode: 'Code-barres / QR',
  currentStock: 'Stock',
  minimum: 'Minimum',
  location: 'Localisation',
  supplier: 'Fournisseur',
  actions: 'Actions',
  edit: 'Modifier',
  lowStock: 'Stock faible',
  noProducts: 'Aucune référence ne correspond à ces critères.',
  noMovements: 'Aucun mouvement ne correspond à ces critères.',
  date: 'Date',
  type: 'Type',
  quantity: 'Quantité',
  balance: 'Avant / après',
  destination: 'Destination',
  company: 'Entreprise',
  user: 'Utilisateur',
  comment: 'Commentaire',
  receiveTitle: 'Enregistrer une entrée',
  dispatchTitle: 'Enregistrer une sortie',
  receiveSubtitle: 'Identifiez le produit puis confirmez la quantité reçue.',
  dispatchSubtitle: 'Identifiez le produit puis renseignez sa destination.',
  identitySection: 'Identification produit',
  detailsSection: 'Détails du mouvement',
  selectProject: 'Sélectionner un chantier',
  chooseProject: 'Choisissez le chantier concerné',
  scan: 'Scanner',
  stopCamera: 'Fermer la caméra',
  openingCamera: 'Ouverture…',
  scannerHelp: 'Présentez le code-barres ou le QR code face à la caméra.',
  lookupSearching: 'Recherche du produit…',
  lookupFound: 'Produit identifié. Vérifiez les informations avant validation.',
  lookupIncomplete: 'Produit probable trouvé. La variante doit être confirmée.',
  lookupNotFound: 'Produit non trouvé. Complétez la désignation manuellement.',
  lookupUnavailable: 'Catalogue momentanément indisponible. Le code reste saisi.',
  productFound: 'Produit déjà en stock',
  available: 'disponible(s)',
  stockAfter: 'Stock après mouvement',
  mainStore: 'Magasin principal',
  productPhoto: 'Photo du produit',
  building: 'Bâtiment / destination',
  zone: 'Zone',
  person: 'Personne',
  notSpecified: 'Non renseignée',
  allowNegative: 'Autoriser exceptionnellement un stock négatif',
  cancel: 'Annuler',
  validateEntry: 'Valider l’entrée',
  validateExit: 'Valider la sortie',
  saving: 'Enregistrement…',
  selectProjectError: 'Sélectionnez un chantier.',
  recordForbidden: 'Votre rôle n’autorise pas l’enregistrement de mouvements.',
  manageForbidden: 'Votre rôle n’autorise pas la modification des fiches produits.',
  referenceRequired: 'La référence est obligatoire.',
  quantityInvalid: 'La quantité doit être supérieure à zéro.',
  unknownExit: 'Cette référence n’existe pas dans le stock du chantier.',
  destinationRequired: 'La destination est obligatoire pour une sortie.',
  designationRequired: 'La désignation est obligatoire pour une nouvelle référence.',
  insufficientStock: (stock: number) => `Stock insuffisant : ${stock} unité(s) disponible(s).`,
  movementSaved: (kind: string, stock: number) => `${kind} enregistrée. Nouveau stock : ${stock}.`,
  editTitle: 'Modifier la fiche produit',
  editSubtitle: 'Mettez à jour les informations de référence sans modifier directement le stock.',
  newPhoto: 'Nouvelle photo',
  saveProduct: 'Enregistrer la fiche',
  minimumInvalid: 'Le stock minimum doit être positif ou nul.',
  productUpdated: (reference: string) => `La fiche ${reference} a été mise à jour.`,
  operationRejected: 'Mouvement refusé par le serveur.',
  editRejected: 'Modification refusée par le serveur.',
  cameraUnavailable: 'Impossible d’ouvrir la caméra.',
  photoAlt: (name: string, reference: string) => `${name}, référence ${reference}`,
};

const EN: typeof FR = {
  ...FR,
  eyebrow: 'Site logistics', title: 'Stock & movements', description: 'Manage references, receipts and site distribution from one operational workspace.',
  refresh: 'Refresh', refreshing: 'Refreshing…', references: 'References', units: 'Units available', lowStocks: 'Low stock', movements: 'Movements',
  receive: 'Receive', receiveHelp: 'Add delivered materials', dispatch: 'Dispatch', dispatchHelp: 'Send materials to site', stock: 'Stock', history: 'History',
  operations: 'Quick operations', operationsHelp: 'A guided flow from scan to validation.', allProjects: 'All projects', aggregateHint: 'Consolidated view: each reference and movement shows its project.',
  stockTitle: 'Stock catalogue', historyTitle: 'Movement log', stockSubtitle: count => `${count} reference${count === 1 ? '' : 's'} shown`, historySubtitle: count => `${count} movement${count === 1 ? '' : 's'} shown`,
  searchStock: 'Reference, description, barcode, project…', searchHistory: 'Reference, destination, company, user…', clearSearch: 'Clear search', all: 'All', lowOnly: 'Low stock', entries: 'Receipts', exits: 'Dispatches',
  export: 'Export', exportTitle: 'Stock reports', documentLanguage: 'Document language', workbook: 'Excel workbook', word: 'Word report', pdf: 'PDF report', exportDone: 'The document is ready.', exportError: 'The document could not be generated.',
  close: 'Close', dismiss: 'Dismiss message', project: 'Project', product: 'Product', photo: 'Photo', reference: 'Reference', designation: 'Description', barcode: 'Barcode / QR', currentStock: 'Stock', minimum: 'Minimum', location: 'Location', supplier: 'Supplier', actions: 'Actions', edit: 'Edit', lowStock: 'Low stock',
  noProducts: 'No reference matches these filters.', noMovements: 'No movement matches these filters.', date: 'Date', type: 'Type', quantity: 'Quantity', balance: 'Before / after', destination: 'Destination', company: 'Company', user: 'User', comment: 'Comment',
  receiveTitle: 'Record a receipt', dispatchTitle: 'Record a dispatch', receiveSubtitle: 'Identify the product, then confirm the received quantity.', dispatchSubtitle: 'Identify the product, then enter its destination.', identitySection: 'Product identification', detailsSection: 'Movement details', selectProject: 'Select a project', chooseProject: 'Choose the relevant project',
  scan: 'Scan', stopCamera: 'Close camera', openingCamera: 'Opening…', scannerHelp: 'Hold the barcode or QR code in front of the camera.', lookupSearching: 'Looking up product…', lookupFound: 'Product identified. Check the details before validation.', lookupIncomplete: 'Probable product found. Confirm the exact variant.', lookupNotFound: 'Product not found. Enter the description manually.', lookupUnavailable: 'Catalogue temporarily unavailable. The code is still entered.',
  productFound: 'Product already in stock', available: 'available', stockAfter: 'Stock after movement', mainStore: 'Main store', productPhoto: 'Product photo', building: 'Building / destination', zone: 'Zone', person: 'Person', notSpecified: 'Not specified', allowNegative: 'Exceptionally allow negative stock', cancel: 'Cancel', validateEntry: 'Confirm receipt', validateExit: 'Confirm dispatch', saving: 'Saving…',
  selectProjectError: 'Select a project.', recordForbidden: 'Your role cannot record stock movements.', manageForbidden: 'Your role cannot edit product records.', referenceRequired: 'A reference is required.', quantityInvalid: 'Quantity must be greater than zero.', unknownExit: 'This reference does not exist in the project stock.', destinationRequired: 'A destination is required for a dispatch.', designationRequired: 'A description is required for a new reference.', insufficientStock: stock => `Insufficient stock: ${stock} unit(s) available.`, movementSaved: (kind, stock) => `${kind} recorded. New stock: ${stock}.`,
  editTitle: 'Edit product record', editSubtitle: 'Update reference data without directly changing stock.', newPhoto: 'New photo', saveProduct: 'Save product', minimumInvalid: 'Minimum stock must be zero or greater.', productUpdated: reference => `${reference} was updated.`, operationRejected: 'The server rejected this movement.', editRejected: 'The server rejected this update.', cameraUnavailable: 'Unable to open the camera.', photoAlt: (name, reference) => `${name}, reference ${reference}`,
};

const ES: typeof FR = {
  ...FR,
  eyebrow: 'Logística de obra', title: 'Stock y movimientos', description: 'Gestiona referencias, recepciones y distribuciones de obra desde un único espacio operativo.',
  refresh: 'Actualizar', refreshing: 'Actualizando…', references: 'Referencias', units: 'Unidades disponibles', lowStocks: 'Stock bajo', movements: 'Movimientos',
  receive: 'Entrada', receiveHelp: 'Recibir material', dispatch: 'Salida', dispatchHelp: 'Enviar material a obra', stock: 'Stock', history: 'Historial', operations: 'Operaciones rápidas', operationsHelp: 'Un flujo guiado desde el escaneo hasta la validación.',
  allProjects: 'Todos los proyectos', aggregateHint: 'Vista consolidada: cada referencia y movimiento muestra su proyecto.', stockTitle: 'Catálogo de stock', historyTitle: 'Registro de movimientos', stockSubtitle: count => `${count} referencia${count === 1 ? '' : 's'} mostrada${count === 1 ? '' : 's'}`, historySubtitle: count => `${count} movimiento${count === 1 ? '' : 's'} mostrado${count === 1 ? '' : 's'}`,
  searchStock: 'Referencia, descripción, código de barras, proyecto…', searchHistory: 'Referencia, destino, empresa, usuario…', clearSearch: 'Borrar búsqueda', all: 'Todos', lowOnly: 'Stock bajo', entries: 'Entradas', exits: 'Salidas', export: 'Exportar', exportTitle: 'Informes de stock', documentLanguage: 'Idioma del documento', workbook: 'Libro Excel', word: 'Informe Word', pdf: 'Informe PDF', exportDone: 'El documento está preparado.', exportError: 'No se pudo generar el documento.',
  close: 'Cerrar', dismiss: 'Ocultar mensaje', project: 'Proyecto', product: 'Producto', photo: 'Foto', reference: 'Referencia', designation: 'Descripción', barcode: 'Código de barras / QR', currentStock: 'Stock', minimum: 'Mínimo', location: 'Ubicación', supplier: 'Proveedor', actions: 'Acciones', edit: 'Editar', lowStock: 'Stock bajo', noProducts: 'Ninguna referencia coincide con estos filtros.', noMovements: 'Ningún movimiento coincide con estos filtros.', date: 'Fecha', type: 'Tipo', quantity: 'Cantidad', balance: 'Antes / después', destination: 'Destino', company: 'Empresa', user: 'Usuario', comment: 'Comentario',
  receiveTitle: 'Registrar una entrada', dispatchTitle: 'Registrar una salida', receiveSubtitle: 'Identifica el producto y confirma la cantidad recibida.', dispatchSubtitle: 'Identifica el producto e indica su destino.', identitySection: 'Identificación del producto', detailsSection: 'Detalles del movimiento', selectProject: 'Seleccionar un proyecto', chooseProject: 'Elige el proyecto correspondiente', scan: 'Escanear', stopCamera: 'Cerrar cámara', openingCamera: 'Abriendo…', scannerHelp: 'Coloca el código de barras o QR frente a la cámara.', lookupSearching: 'Buscando el producto…', lookupFound: 'Producto identificado. Comprueba los datos antes de validar.', lookupIncomplete: 'Producto probable encontrado. Confirma la variante exacta.', lookupNotFound: 'Producto no encontrado. Completa la descripción manualmente.', lookupUnavailable: 'Catálogo temporalmente no disponible. El código permanece introducido.',
  productFound: 'Producto ya disponible', available: 'disponible(s)', stockAfter: 'Stock después del movimiento', mainStore: 'Almacén principal', productPhoto: 'Foto del producto', building: 'Edificio / destino', zone: 'Zona', person: 'Persona', notSpecified: 'Sin especificar', allowNegative: 'Autorizar excepcionalmente stock negativo', cancel: 'Cancelar', validateEntry: 'Validar entrada', validateExit: 'Validar salida', saving: 'Guardando…', selectProjectError: 'Selecciona un proyecto.', recordForbidden: 'Tu rol no permite registrar movimientos.', manageForbidden: 'Tu rol no permite modificar fichas de producto.', referenceRequired: 'La referencia es obligatoria.', quantityInvalid: 'La cantidad debe ser superior a cero.', unknownExit: 'Esta referencia no existe en el stock del proyecto.', destinationRequired: 'El destino es obligatorio para una salida.', designationRequired: 'La descripción es obligatoria para una nueva referencia.', insufficientStock: stock => `Stock insuficiente: ${stock} unidad(es) disponible(s).`, movementSaved: (kind, stock) => `${kind} registrada. Nuevo stock: ${stock}.`,
  editTitle: 'Editar ficha de producto', editSubtitle: 'Actualiza los datos de referencia sin modificar directamente el stock.', newPhoto: 'Nueva foto', saveProduct: 'Guardar ficha', minimumInvalid: 'El stock mínimo debe ser positivo o cero.', productUpdated: reference => `La ficha ${reference} se ha actualizado.`, operationRejected: 'El servidor rechazó este movimiento.', editRejected: 'El servidor rechazó esta modificación.', cameraUnavailable: 'No se puede abrir la cámara.', photoAlt: (name, reference) => `${name}, referencia ${reference}`,
};

export type InventoryCopy = typeof FR;

export function inventoryCopy(language: InventoryLanguage): InventoryCopy {
  if (language === 'fr') return FR;
  if (language === 'es') return ES;
  return EN;
}
