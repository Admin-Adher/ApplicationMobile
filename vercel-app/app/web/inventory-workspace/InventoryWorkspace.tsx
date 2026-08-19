'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  privateMediaAccess,
  subscribePrivateMedia,
} from '@/lib/private-media-client';
import {
  startWebBarcodeScanner,
  webBarcodeCameraErrorMessage,
  type WebBarcodeScannerControls,
} from '../../../../lib/webBarcodeScanner';
import {
  EMPTY_INVENTORY_DESTINATION,
  createInventoryDestinationCatalog,
  inventoryDestinationPolicy,
  inventoryDestinationZones,
  toInventoryMovementDestination,
  transitionInventoryDestination,
  type InventoryDestination,
  type InventoryDestinationIntent,
} from '../../../../lib/inventoryDestinationModel';
import { isSameInventoryScanCode, nextInventoryScanPhase } from '../../../../lib/inventoryLocationScan';
import { InventoryIcon } from './InventoryIcon';
import {
  lookupInventoryBarcode,
  recordInventoryMovement,
  updateInventoryProduct,
  uploadInventoryPhoto,
} from './inventory-operations';
import {
  buildInventoryProjection,
  inventoryCopy,
  inventoryLocale,
  inventoryProjectName,
  isInventoryLowStock,
  normalizeInventoryReference,
  numberValue,
  type InventoryCompanyRow,
  type InventoryLanguage,
  type InventoryMode,
  type InventoryMovementRow,
  type InventoryProductFilter,
  type InventoryProductRow,
  type InventoryWorkspaceProps,
  type InventoryMovementFilter,
} from './inventory-model';
import { computeFloatingPanelLayout, type FloatingPanelLayout } from './floating-panel';
import styles from './InventoryWorkspace.module.css';

type FormState = {
  reference: string;
  barcode: string;
  designation: string;
  quantity: string;
  supplier: string;
  location: string;
  minStock: string;
  destination: InventoryDestination;
  companyId: string;
  personName: string;
  comment: string;
  allowNegative: boolean;
};

type ProductEditState = {
  reference: string;
  barcode: string;
  designation: string;
  supplier: string;
  location: string;
  minStock: string;
};

type LookupState = 'idle' | 'searching' | 'found' | 'incomplete' | 'notFound' | 'unavailable';
type ExportKind = 'xlsx' | 'docx' | 'pdf';

const EMPTY_FORM: FormState = {
  reference: '',
  barcode: '',
  designation: '',
  quantity: '',
  supplier: '',
  location: '',
  minStock: '0',
  destination: EMPTY_INVENTORY_DESTINATION,
  companyId: '',
  personName: '',
  comment: '',
  allowNegative: false,
};

const EMPTY_PRODUCT_EDIT: ProductEditState = {
  reference: '',
  barcode: '',
  designation: '',
  supplier: '',
  location: '',
  minStock: '0',
};

const MANUAL_BUILDING_VALUE = '__manual-building__';
const MANUAL_ZONE_VALUE = '__manual-zone__';

function safeFilename(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function movementDestinationLabel(movement: InventoryMovementRow) {
  return [movement.building_name, movement.zone_name]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(' · ') || '—';
}

function normalizeExportProduct(product: InventoryProductRow) {
  return {
    reference: product.reference,
    designation: product.designation || product.reference,
    photoUrl: product.photo_url,
    currentStock: numberValue(product.current_stock),
    minStock: numberValue(product.min_stock),
    totalEntries: numberValue(product.total_entries),
    totalExits: numberValue(product.total_exits),
    location: product.location,
    supplier: product.supplier,
    barcode: product.barcode,
  };
}

function normalizeExportMovement(movement: InventoryMovementRow) {
  return {
    createdAt: movement.created_at ?? '',
    movementType: movement.movement_type,
    reference: movement.reference ?? '',
    designation: movement.designation ?? movement.reference ?? '',
    quantity: numberValue(movement.quantity),
    stockBefore: numberValue(movement.stock_before),
    stockAfter: numberValue(movement.stock_after),
    userName: movement.user_name,
    buildingName: movement.building_name,
    zoneName: movement.zone_name,
    companyName: movement.company_name,
    personName: movement.person_name,
    supplier: movement.supplier,
    comment: movement.comment,
  };
}

function ProductThumbnail({ product, language }: { product: InventoryProductRow; language: InventoryLanguage }) {
  const [, rerender] = useState(0);
  const copy = inventoryCopy(language);
  useEffect(() => subscribePrivateMedia(() => rerender(value => value + 1)), []);
  const media = privateMediaAccess(product.photo_url);
  const label = product.designation || product.reference;

  if (media.url) {
    return (
      <img
        className={styles.productPhoto}
        src={media.url}
        alt={copy.photoAlt(label, product.reference)}
        loading="lazy"
      />
    );
  }
  return (
    <span className={styles.photoPlaceholder} data-loading={media.status === 'resolving' ? 'true' : 'false'} aria-hidden="true">
      <InventoryIcon name="box" size={20} />
    </span>
  );
}

function ProjectTag({ name }: { name: string }) {
  return (
    <span className={styles.projectTag}>
      <InventoryIcon name="building" size={14} />
      <span>{name}</span>
    </span>
  );
}

export default function InventoryWorkspace({
  snapshot,
  selectedProjectId,
  capabilities,
  language,
  reportLanguage,
  onReportLanguageChange,
  onReload,
}: InventoryWorkspaceProps) {
  const copy = inventoryCopy(language);
  const locale = inventoryLocale(language);
  const [mode, setMode] = useState<InventoryMode>('stock');
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState<InventoryProductFilter>('all');
  const [movementFilter, setMovementFilter] = useState<InventoryMovementFilter>('all');
  const [operationProjectId, setOperationProjectId] = useState(selectedProjectId === 'all' ? '' : selectedProjectId);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [editingProduct, setEditingProduct] = useState<InventoryProductRow | null>(null);
  const [editForm, setEditForm] = useState<ProductEditState>(EMPTY_PRODUCT_EDIT);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'product' | 'location'>('product');
  const [scanError, setScanError] = useState('');
  const [lookupState, setLookupState] = useState<LookupState>('idle');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPanelLayout, setExportPanelLayout] = useState<FloatingPanelLayout | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<WebBarcodeScannerControls | null>(null);
  const scannerTargetRef = useRef<'product' | 'location'>('product');
  const locationEdited = useRef(false);
  const lastProductCode = useRef('');
  const [knownLocation, setKnownLocation] = useState('');
  const [confirmingLocation, setConfirmingLocation] = useState(false);
  const operationPanelRef = useRef<HTMLElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  const exportPanelRef = useRef<HTMLDivElement | null>(null);

  const projection = useMemo(() => buildInventoryProjection({
    snapshot,
    selectedProjectId,
    search,
    language,
    productFilter,
    movementFilter,
  }), [snapshot, selectedProjectId, search, language, productFilter, movementFilter]);

  const operationProducts = useMemo(
    () => snapshot.products.filter(product => String(product.chantier_id) === String(operationProjectId)),
    [snapshot.products, operationProjectId],
  );
  const operationCompanies = useMemo(
    () => snapshot.companies.filter(company => !company.chantier_id || String(company.chantier_id) === String(operationProjectId)),
    [snapshot.companies, operationProjectId],
  );
  const operationProject = snapshot.projects.find(project => String(project.id) === String(operationProjectId));
  const destinationCatalog = useMemo(
    () => createInventoryDestinationCatalog(operationProject?.buildings),
    [operationProject?.buildings],
  );
  const destinationPolicy = inventoryDestinationPolicy(mode === 'out' ? 'out' : 'in');
  const destinationZones = useMemo(
    () => inventoryDestinationZones(destinationCatalog, form.destination.buildingId),
    [destinationCatalog, form.destination.buildingId],
  );
  const destinationZoneGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; zones: typeof destinationZones }>();
    for (const zone of destinationZones) {
      const key = zone.levelId || zone.levelName || '__zones__';
      const current = groups.get(key) ?? { key, label: zone.levelName || copy.zone, zones: [] };
      current.zones.push(zone);
      groups.set(key, current);
    }
    return Array.from(groups.values());
  }, [copy.zone, destinationZones]);
  const selectedProduct = operationProducts.find(product => product.id === selectedProductId) ?? null;
  const selectedCompany = snapshot.companies.find(company => String(company.id) === form.companyId);
  const selectedScopeProject = snapshot.projects.find(project => String(project.id) === String(projection.activeProjectId));
  const scopeName = projection.isAggregate
    ? copy.allProjects
    : inventoryProjectName(selectedScopeProject, copy.allProjects);

  function stopScanner() {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerLoading(false);
    setScannerOpen(false);
  }

  useEffect(() => () => {
    scannerControlsRef.current?.stop();
    const stream = videoRef.current?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    stopScanner();
    setMode('stock');
    setOperationProjectId(selectedProjectId === 'all' ? '' : selectedProjectId);
    setSelectedProductId(null);
    locationEdited.current = false;
    setForm({ ...EMPTY_FORM });
    setPhoto(null);
    setLookupState('idle');
    setError('');
  // This reset is intentionally tied only to a project-scope change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (editingProduct) {
        closeProductEditor();
        return;
      }
      if (exportOpen) setExportOpen(false);
      if (scannerOpen) stopScanner();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        exportOpen
        && exportMenuRef.current
        && !exportMenuRef.current.contains(target)
        && !exportPanelRef.current?.contains(target)
      ) {
        setExportOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  });

  useLayoutEffect(() => {
    if (!exportOpen) {
      setExportPanelLayout(null);
      return;
    }

    let frame = 0;
    const updatePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const anchor = exportButtonRef.current?.getBoundingClientRect();
        const panel = exportPanelRef.current;
        if (!anchor || !panel) return;

        const nextLayout = computeFloatingPanelLayout({
          anchor,
          panelHeight: panel.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        setExportPanelLayout(current => (
          current
          && current.top === nextLayout.top
          && current.left === nextLayout.left
          && current.width === nextLayout.width
          && current.maxHeight === nextLayout.maxHeight
          && current.placement === nextLayout.placement
            ? current
            : nextLayout
        ));
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [exportOpen, language, reportLanguage]);

  function patchForm(patch: Partial<FormState>) {
    if ('location' in patch) locationEdited.current = true;
    setForm(current => ({ ...current, ...patch }));
  }

  function updateDestination(intent: InventoryDestinationIntent) {
    setForm(current => ({
      ...current,
      destination: transitionInventoryDestination(destinationCatalog, current.destination, intent),
    }));
  }

  function clearFeedback() {
    setError('');
    setNotice('');
    setScanError('');
  }

  function transitionToMode(nextMode: InventoryMode) {
    stopScanner();
    setMode(nextMode);
    setLookupState('idle');
    setScanError('');
    if (nextMode === 'stock' || nextMode === 'history') {
      setPhoto(null);
      setSelectedProductId(null);
      setForm({ ...EMPTY_FORM });
    }
  }

  function selectProduct(product: InventoryProductRow) {
    setSelectedProductId(product.id);
    setForm(current => ({
      ...current,
      reference: product.reference ?? '',
      barcode: product.barcode ?? '',
      designation: product.designation ?? product.reference ?? '',
      supplier: product.supplier ?? '',
      location: locationEdited.current ? current.location : (product.location ?? ''),
      minStock: String(numberValue(product.min_stock)),
    }));
  }

  function resolveTypedProduct(reference = form.reference, barcode = form.barcode) {
    const normalized = normalizeInventoryReference(reference);
    const found = operationProducts.find(product =>
      (!!barcode.trim() && String(product.barcode ?? '') === barcode.trim())
      || (!!normalized && normalizeInventoryReference(product.reference ?? '') === normalized),
    );
    if (found) {
      selectProduct(found);
      setLookupState('found');
    } else {
      setSelectedProductId(null);
    }
    return found ?? null;
  }

  function openMovement(nextMode: 'in' | 'out', product?: InventoryProductRow) {
    stopScanner();
    clearFeedback();
    setPhoto(null);
    locationEdited.current = false;
    setForm({ ...EMPTY_FORM });
    setSelectedProductId(null);
    setLookupState('idle');
    const nextProjectId = product?.chantier_id ?? (projection.isAggregate ? '' : projection.activeProjectId);
    setOperationProjectId(nextProjectId);
    setMode(nextMode);
    if (product) selectProduct(product);
    window.requestAnimationFrame(() => operationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function changeOperationProject(projectId: string) {
    stopScanner();
    setOperationProjectId(projectId);
    setSelectedProductId(null);
    setPhoto(null);
    locationEdited.current = false;
    setForm({ ...EMPTY_FORM });
    setLookupState('idle');
    setScanError('');
  }

  function openProductEditor(product: InventoryProductRow) {
    if (!capabilities.canManage) return;
    stopScanner();
    setEditingProduct(product);
    setEditPhoto(null);
    setEditForm({
      reference: product.reference ?? '',
      barcode: product.barcode ?? '',
      designation: product.designation ?? product.reference ?? '',
      supplier: product.supplier ?? '',
      location: product.location ?? '',
      minStock: String(numberValue(product.min_stock)),
    });
    clearFeedback();
  }

  function closeProductEditor() {
    setEditingProduct(null);
    setEditPhoto(null);
    setEditForm(EMPTY_PRODUCT_EDIT);
  }

  async function enrichScannedBarcode(rawValue: string) {
    patchForm({ barcode: rawValue, reference: form.reference || rawValue });
    setLookupState('searching');
    const found = operationProducts.find(product => String(product.barcode ?? '') === rawValue);
    if (found) {
      selectProduct(found);
      setLookupState('found');
      return;
    }

    try {
      const result = await lookupInventoryBarcode(rawValue, language);
      if (result.state !== 'found') {
        setLookupState(result.state);
        return;
      }
      const { match } = result;
      setForm(current => ({
        ...current,
        barcode: rawValue,
        reference: current.reference || rawValue,
        designation: current.designation || match.designation,
        supplier: current.supplier || String(match.brand ?? ''),
      }));
      setLookupState(match.variantComplete === true ? 'found' : 'incomplete');
    } catch {
      setLookupState('unavailable');
    }
  }

  async function startScanner(target: 'product' | 'location' = 'product') {
    setScanError('');
    setScannerLoading(true);
    scannerTargetRef.current = target;
    setScannerTarget(target);
    if (target === 'product') setLookupState('idle');
    try {
      setScannerOpen(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!videoRef.current) throw new Error(copy.cameraUnavailable);
      let detectedDuringStart = false;
      const controls = await startWebBarcodeScanner({
        video: videoRef.current,
        loadZXing: () => import('@zxing/browser'),
        onDetected: result => {
          const scanned = result.text.trim();
          if (!scanned) return;
          const nextTarget = scannerTargetRef.current;
          if (nextTarget === 'location' && isSameInventoryScanCode(scanned, lastProductCode.current)) return;
          detectedDuringStart = true;
          stopScanner();
          if (nextTarget === 'location') {
            locationEdited.current = true;
            setConfirmingLocation(false);
            patchForm({ location: scanned });
            return;
          }
          lastProductCode.current = scanned;
          void enrichScannedBarcode(scanned).then(() => {
            const existing = operationProducts.find(product => String(product.barcode ?? '') === scanned || product.reference === scanned);
            const next = nextInventoryScanPhase({ mode, existingLocation: existing?.location });
            if (next === 'confirm' && existing?.location) {
              setKnownLocation(existing.location);
              setConfirmingLocation(true);
              locationEdited.current = true;
              patchForm({ location: existing.location });
              return;
            }
            if (next === 'location') void startScanner('location');
          });
        },
      });
      if (detectedDuringStart) controls.stop();
      else {
        scannerControlsRef.current = controls;
        setScannerLoading(false);
      }
    } catch (scanFailure: unknown) {
      stopScanner();
      setScanError(webBarcodeCameraErrorMessage(scanFailure, copy.cameraUnavailable));
    }
  }

  async function submitMovement(event: React.FormEvent) {
    event.preventDefault();
    if (mode !== 'in' && mode !== 'out') return;
    setError('');
    setNotice('');
    if (!capabilities.canRecord) return setError(copy.recordForbidden);
    if (!operationProjectId) return setError(copy.selectProjectError);
    const existing = selectedProduct ?? resolveTypedProduct();
    const reference = form.reference.trim().toUpperCase();
    const quantity = Number(form.quantity.replace(',', '.'));
    if (!reference) return setError(copy.referenceRequired);
    if (!Number.isFinite(quantity) || quantity <= 0) return setError(copy.quantityInvalid);
    if (mode === 'out' && !existing) return setError(copy.unknownExit);
    if (mode === 'in' && !(form.location.trim() || existing?.location)) return setError(copy.locationRequired);
    if (destinationPolicy.buildingRequired && !form.destination.buildingName.trim()) return setError(copy.destinationRequired);
    if (!existing && !form.designation.trim()) return setError(copy.designationRequired);
    if (mode === 'out' && existing && quantity > numberValue(existing.current_stock) && !(capabilities.canAdjust && form.allowNegative)) {
      return setError(copy.insufficientStock(numberValue(existing.current_stock)));
    }

    setSaving(true);
    try {
      const productId = existing?.id ?? crypto.randomUUID();
      const movementId = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();
      const photoUrl = photo ? await uploadInventoryPhoto(photo, operationProjectId, productId) : existing?.photo_url ?? null;
      const designation = (existing?.designation ?? form.designation).trim() || reference;
      const movementDestination = toInventoryMovementDestination(form.destination);
      const outcome = await recordInventoryMovement({
        operationId,
        movement: {
          id: movementId,
          chantier_id: operationProjectId,
          product_id: productId,
          movement_type: mode,
          quantity,
          reference,
          barcode: form.barcode.trim() || existing?.barcode || null,
          supplier: form.supplier.trim() || existing?.supplier || null,
          location: form.location.trim() || existing?.location || null,
          ...movementDestination,
          company_id: form.companyId || null,
          company_name: selectedCompany?.name ?? null,
          person_name: form.personName.trim() || null,
          comment: form.comment.trim() || null,
          created_at: now,
        },
        product: {
          id: productId,
          reference,
          designation,
          barcode: form.barcode.trim() || existing?.barcode || null,
          photo_url: photoUrl,
          min_stock: numberValue(form.minStock),
          location: form.location.trim() || existing?.location || null,
          supplier: form.supplier.trim() || existing?.supplier || null,
        },
        allowNegative: capabilities.canAdjust && form.allowNegative,
      });
      if (!outcome || outcome.status !== 'ok') throw new Error(outcome?.message ?? copy.operationRejected);
      await onReload();
      const movementName = mode === 'in' ? copy.receive : copy.dispatch;
      setNotice(`${copy.movementSaved(movementName, numberValue(outcome.stockAfter))} ${copy.scanNext}`);
      setForm({ ...EMPTY_FORM });
      setSelectedProductId(null);
      setPhoto(null);
      setLookupState('idle');
      locationEdited.current = false;
      lastProductCode.current = '';
      setConfirmingLocation(false);
      void startScanner('product');
    } catch (submitError: any) {
      setError(submitError?.message ?? String(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function submitProductEdit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!capabilities.canManage || !editingProduct) return setError(copy.manageForbidden);
    const reference = editForm.reference.trim().toUpperCase();
    const designation = editForm.designation.trim();
    const minStock = Number(editForm.minStock.replace(',', '.'));
    if (!reference) return setError(copy.referenceRequired);
    if (!designation) return setError(copy.designationRequired);
    if (!Number.isFinite(minStock) || minStock < 0) return setError(copy.minimumInvalid);

    setSaving(true);
    try {
      const photoUrl = editPhoto
        ? await uploadInventoryPhoto(editPhoto, editingProduct.chantier_id, editingProduct.id)
        : editingProduct.photo_url ?? null;
      const outcome = await updateInventoryProduct({
        productId: editingProduct.id,
        patch: {
          reference,
          designation,
          barcode: editForm.barcode.trim() || null,
          photo_url: photoUrl,
          min_stock: minStock,
          location: editForm.location.trim() || null,
          supplier: editForm.supplier.trim() || null,
        },
      });
      if (!outcome || outcome.status !== 'ok') throw new Error(outcome?.message ?? copy.editRejected);
      await onReload();
      closeProductEditor();
      setNotice(copy.productUpdated(reference));
    } catch (editError: any) {
      setError(editError?.message ?? String(editError));
    } finally {
      setSaving(false);
    }
  }

  function exportContext() {
    const projectName = projection.isAggregate
      ? copy.allProjects
      : inventoryProjectName(selectedScopeProject, copy.allProjects);
    return { projectName, date: new Date().toISOString().slice(0, 10) };
  }

  async function exportWorkbook() {
    setExporting('xlsx');
    try {
      setError('');
      const { downloadInventoryWorkbook } = await import('@/lib/inventory-workbook');
      const { projectName, date } = exportContext();
      const kind = mode === 'history' ? 'history' : 'stock';
      downloadInventoryWorkbook({
        kind,
        chantierName: projectName,
        language: reportLanguage,
        filename: `buildtrack-${kind === 'history' ? 'mouvements-stock' : 'stock'}-${safeFilename(projectName)}-${reportLanguage}-${date}.xlsx`,
        products: (kind === 'history' ? projection.scopedProducts : projection.filteredProducts).map(normalizeExportProduct),
        movements: projection.filteredMovements.map(normalizeExportMovement),
      });
      setNotice(copy.exportDone);
      setExportOpen(false);
    } catch (exportError: any) {
      setError(exportError?.message ?? copy.exportError);
    } finally {
      setExporting(null);
    }
  }

  async function exportInventoryWord() {
    setExporting('docx');
    try {
      setError('');
      const { downloadInventoryDocx } = await import('@/lib/inventory-docx');
      const { projectName, date } = exportContext();
      downloadInventoryDocx({
        chantierName: projectName,
        language: reportLanguage,
        filename: `buildtrack-stock-${safeFilename(projectName)}-${reportLanguage}-${date}.docx`,
        products: projection.filteredProducts.map(normalizeExportProduct),
        movements: projection.filteredMovements.map(normalizeExportMovement),
      });
      setNotice(copy.exportDone);
      setExportOpen(false);
    } catch (exportError: any) {
      setError(exportError?.message ?? copy.exportError);
    } finally {
      setExporting(null);
    }
  }

  async function printInventoryPdf() {
    setExporting('pdf');
    try {
      setError('');
      const { buildInventoryPdfHtml } = await import('../../../../lib/inventoryPdfDocument');
      const { projectName } = exportContext();
      const html = buildInventoryPdfHtml(
        projection.filteredProducts.map(normalizeExportProduct),
        projection.filteredMovements.map(normalizeExportMovement),
        projectName,
        reportLanguage,
      );
      const frame = document.createElement('iframe');
      frame.title = 'BuildTrack inventory PDF';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.right = '0';
      frame.style.bottom = '0';
      frame.style.border = '0';
      frame.onload = () => {
        window.setTimeout(() => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          window.setTimeout(() => frame.remove(), 1_500);
        }, 120);
      };
      frame.srcdoc = html;
      document.body.appendChild(frame);
      setNotice(copy.exportDone);
      setExportOpen(false);
    } catch (exportError: any) {
      setError(exportError?.message ?? copy.exportError);
    } finally {
      setExporting(null);
    }
  }

  async function reload() {
    setRefreshing(true);
    setError('');
    try {
      await onReload();
    } catch (reloadError: any) {
      setError(reloadError?.message ?? String(reloadError));
    } finally {
      setRefreshing(false);
    }
  }

  const lookupMessage = lookupState === 'searching' ? copy.lookupSearching
    : lookupState === 'found' ? copy.lookupFound
      : lookupState === 'incomplete' ? copy.lookupIncomplete
        : lookupState === 'notFound' ? copy.lookupNotFound
          : lookupState === 'unavailable' ? copy.lookupUnavailable
            : '';

  return (
    <div className={styles.root} data-testid="inventory-workspace">
      <header className={styles.heading}>
        <div>
          <p>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <span>{copy.description}</span>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void reload()} disabled={refreshing || saving}>
          <InventoryIcon name="refresh" size={18} />
          <span>{refreshing ? copy.refreshing : copy.refresh}</span>
        </button>
      </header>

      <section className={styles.metricRail} aria-label={copy.title}>
        <button type="button" className={styles.metric} onClick={() => { setProductFilter('all'); transitionToMode('stock'); }}>
          <span className={styles.metricIcon}><InventoryIcon name="box" /></span>
          <span className={styles.metricValue}>{projection.scopedProducts.length.toLocaleString(locale)}</span>
          <strong>{copy.references}</strong>
        </button>
        <button type="button" className={styles.metric} onClick={() => { setProductFilter('all'); transitionToMode('stock'); }}>
          <span className={styles.metricIcon}><InventoryIcon name="check" /></span>
          <span className={styles.metricValue}>{projection.totalUnits.toLocaleString(locale)}</span>
          <strong>{copy.units}</strong>
        </button>
        <button type="button" className={styles.metric} data-tone={projection.lowStockProducts.length ? 'warning' : 'neutral'} onClick={() => { setProductFilter('low'); transitionToMode('stock'); }}>
          <span className={styles.metricIcon}><InventoryIcon name="warning" /></span>
          <span className={styles.metricValue}>{projection.lowStockProducts.length.toLocaleString(locale)}</span>
          <strong>{copy.lowStocks}</strong>
        </button>
        <button type="button" className={styles.metric} onClick={() => { setMovementFilter('all'); transitionToMode('history'); }}>
          <span className={styles.metricIcon}><InventoryIcon name="history" /></span>
          <span className={styles.metricValue}>{projection.scopedMovements.length.toLocaleString(locale)}</span>
          <strong>{copy.movements}</strong>
        </button>
      </section>

      <section className={styles.commandBar} aria-labelledby="inventory-operations-title">
        <div className={styles.commandCopy}>
          <span>{scopeName}</span>
          <h3 id="inventory-operations-title">{copy.operations}</h3>
          <p>{projection.isAggregate ? copy.aggregateHint : copy.operationsHelp}</p>
        </div>
        <div className={styles.operationButtons}>
          <button type="button" data-tone="receive" onClick={() => openMovement('in')} disabled={!capabilities.canRecord}>
            <span><InventoryIcon name="arrowDown" /></span>
            <span><strong>{copy.receive}</strong><small>{copy.receiveHelp}</small></span>
          </button>
          <button type="button" data-tone="dispatch" onClick={() => openMovement('out')} disabled={!capabilities.canRecord}>
            <span><InventoryIcon name="arrowUp" /></span>
            <span><strong>{copy.dispatch}</strong><small>{copy.dispatchHelp}</small></span>
          </button>
        </div>
        <div className={styles.viewTabs} role="tablist" aria-label={copy.title}>
          <button type="button" role="tab" aria-selected={mode !== 'history'} className={mode !== 'history' ? styles.viewTabActive : ''} onClick={() => transitionToMode('stock')}>
            <InventoryIcon name="box" size={18} />
            <span>{copy.stock}</span>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'history'} className={mode === 'history' ? styles.viewTabActive : ''} onClick={() => transitionToMode('history')}>
            <InventoryIcon name="history" size={18} />
            <span>{copy.history}</span>
          </button>
        </div>
      </section>

      {error ? <div className={styles.error} role="alert"><InventoryIcon name="warning" /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label={copy.dismiss}><InventoryIcon name="close" /></button></div> : null}
      {notice ? <div className={styles.notice} role="status"><InventoryIcon name="check" /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label={copy.dismiss}><InventoryIcon name="close" /></button></div> : null}
      {scanError ? <div className={styles.error} role="alert"><InventoryIcon name="camera" /><span>{scanError}</span><button type="button" onClick={() => setScanError('')} aria-label={copy.dismiss}><InventoryIcon name="close" /></button></div> : null}

      {(mode === 'in' || mode === 'out') ? (
        <section ref={operationPanelRef} className={styles.operationPanel} aria-labelledby="inventory-movement-title">
          <div className={styles.panelHeading}>
            <div>
              <span>{mode === 'in' ? copy.receive : copy.dispatch}</span>
              <h3 id="inventory-movement-title">{mode === 'in' ? copy.receiveTitle : copy.dispatchTitle}</h3>
              <p>{mode === 'in' ? copy.receiveSubtitle : copy.dispatchSubtitle}</p>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => transitionToMode('stock')} aria-label={copy.close}>
              <InventoryIcon name="close" />
            </button>
          </div>

          <form onSubmit={submitMovement} className={styles.operationForm}>
            <fieldset className={styles.identityPanel}>
              <legend>{copy.identitySection}</legend>
              <label htmlFor="inventory-project">{copy.project} *</label>
              <select
                id="inventory-project"
                value={operationProjectId}
                onChange={event => changeOperationProject(event.target.value)}
                disabled={!projection.isAggregate && !!operationProjectId}
                required
              >
                <option value="">{copy.chooseProject}</option>
                {snapshot.projects.map(project => <option key={project.id} value={project.id}>{inventoryProjectName(project, String(project.id))}</option>)}
              </select>

              <div className={styles.fieldPair}>
                <div className={styles.field}>
                  <label htmlFor="inventory-reference">{copy.reference} *</label>
                  <input
                    id="inventory-reference"
                    list="inventory-products"
                    value={form.reference}
                    onChange={event => { patchForm({ reference: event.target.value }); setSelectedProductId(null); setLookupState('idle'); }}
                    onBlur={() => resolveTypedProduct()}
                    placeholder="ABC-12580"
                    autoComplete="off"
                    autoFocus
                    required
                    disabled={!operationProjectId}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="inventory-barcode">{copy.barcode}</label>
                  <input
                    id="inventory-barcode"
                    value={form.barcode}
                    onChange={event => { patchForm({ barcode: event.target.value }); setSelectedProductId(null); setLookupState('idle'); }}
                    onBlur={() => resolveTypedProduct()}
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={!operationProjectId}
                  />
                </div>
              </div>
              <datalist id="inventory-products">{operationProducts.map(product => <option key={product.id} value={product.reference}>{product.designation}</option>)}</datalist>

              <button type="button" className={styles.scanButton} onClick={() => scannerOpen ? stopScanner() : void startScanner('product')} disabled={!operationProjectId}>
                <InventoryIcon name="camera" />
                <span>{scannerLoading ? copy.openingCamera : scannerOpen ? copy.stopCamera : copy.scan}</span>
              </button>
              {lookupMessage ? (
                <div className={styles.lookupStatus} data-status={lookupState} role="status">
                  {lookupState === 'found' ? <InventoryIcon name="check" /> : lookupState === 'incomplete' || lookupState === 'notFound' ? <InventoryIcon name="warning" /> : <InventoryIcon name="search" />}
                  <span>{lookupMessage}</span>
                </div>
              ) : null}
              {selectedProduct ? (
                <div className={styles.foundProduct}>
                  <ProductThumbnail product={selectedProduct} language={language} />
                  <span><small>{copy.productFound}</small><strong>{selectedProduct.designation || selectedProduct.reference}</strong></span>
                  <b>{numberValue(selectedProduct.current_stock)} {copy.available}</b>
                </div>
              ) : null}
              {mode === 'out' ? (
                <div className={styles.pickLocation} data-missing={form.location || selectedProduct?.location ? 'false' : 'true'}>
                  <InventoryIcon name="pin" />
                  <span>
                    <small>{copy.pickFrom}</small>
                    <strong>{form.location || selectedProduct?.location || copy.pickLocationMissing}</strong>
                    <em>{copy.pickFromHint}</em>
                  </span>
                  <button type="button" className={styles.scanFieldButton} onClick={() => void startScanner('location')} disabled={!operationProjectId}>
                    <InventoryIcon name="camera" size={16} />
                    <span>{form.location || selectedProduct?.location ? copy.otherLocation : copy.setLocation}</span>
                  </button>
                </div>
              ) : null}
            </fieldset>

            <fieldset className={styles.detailsPanel}>
              <legend>{copy.detailsSection}</legend>
              <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label htmlFor="inventory-designation">{copy.designation} *</label>
                  <input id="inventory-designation" value={form.designation} onChange={event => patchForm({ designation: event.target.value })} disabled={!!selectedProduct || !operationProjectId} placeholder="Vanne DN25" required={!selectedProduct} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="inventory-quantity">{copy.quantity} *</label>
                  <input id="inventory-quantity" value={form.quantity} onChange={event => patchForm({ quantity: event.target.value })} type="number" inputMode="decimal" min="0.001" step="any" required />
                </div>
                <div className={styles.field}>
                  <label htmlFor="inventory-stock-after">{copy.stockAfter}</label>
                  <input
                    id="inventory-stock-after"
                    className={styles.readOnlyField}
                    value={selectedProduct ? String(numberValue(selectedProduct.current_stock) + (mode === 'in' ? 1 : -1) * numberValue(form.quantity)) : mode === 'in' ? form.quantity : ''}
                    readOnly
                  />
                </div>
                {mode === 'in' ? <>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <strong className={styles.blockTitle}>{copy.storeHere}</strong>
                    <p className={styles.fieldHint}>{copy.storeHereHint}</p>
                  </div>
                  <div className={styles.field}><label htmlFor="inventory-supplier">{copy.supplier}</label><input id="inventory-supplier" value={form.supplier} onChange={event => patchForm({ supplier: event.target.value })} /></div>
                  <div className={styles.field}>
                    <label htmlFor="inventory-location">{copy.location} *</label>
                    <div className={styles.locationRow}>
                      <input id="inventory-location" value={form.location} onChange={event => patchForm({ location: event.target.value })} placeholder={copy.mainStore} required />
                      <button type="button" className={styles.scanFieldButton} onClick={() => void startScanner('location')} disabled={!operationProjectId}>
                        <InventoryIcon name="camera" size={16} />
                        <span>{copy.scanShelf}</span>
                      </button>
                    </div>
                  </div>
                  <div className={styles.field}><label htmlFor="inventory-minimum">{copy.minimum}</label><input id="inventory-minimum" value={form.minStock} onChange={event => patchForm({ minStock: event.target.value })} type="number" min="0" step="any" /></div>
                  <div className={styles.field}><label htmlFor="inventory-photo">{copy.productPhoto}</label><input id="inventory-photo" className={styles.fileInput} type="file" accept="image/*" capture="environment" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></div>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <strong className={styles.blockTitle}>{copy.receivedAt}</strong>
                  </div>
                </> : null}
                <p id="inventory-destination-flow-hint" className={`${styles.destinationHint} ${styles.fieldWide}`}>
                  {mode === 'in' ? copy.entryDestinationHint : copy.exitDestinationHint}
                </p>
                <div className={styles.field}>
                  <label htmlFor={destinationCatalog.hasHierarchy ? 'inventory-building' : 'inventory-building-manual'}>{mode === 'in' ? copy.entryBuilding : copy.exitBuilding}{destinationPolicy.buildingRequired ? ' *' : ''}</label>
                  {destinationCatalog.hasHierarchy ? (
                    <>
                      <select
                        id="inventory-building"
                        value={form.destination.buildingMode === 'manual' ? MANUAL_BUILDING_VALUE : form.destination.buildingId ?? ''}
                        onChange={event => {
                          if (event.target.value === MANUAL_BUILDING_VALUE) updateDestination({ type: 'edit-building', buildingName: '' });
                          else updateDestination({ type: 'select-building', buildingId: event.target.value });
                        }}
                        aria-describedby="inventory-destination-flow-hint"
                        required={destinationPolicy.buildingRequired}
                      >
                        <option value="">{copy.chooseBuilding}</option>
                        {destinationCatalog.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
                        <option value={MANUAL_BUILDING_VALUE}>{copy.otherDestination}</option>
                      </select>
                      {form.destination.buildingMode === 'manual' ? (
                        <input
                          id="inventory-building-manual"
                          aria-label={copy.manualBuilding}
                          aria-describedby="inventory-destination-flow-hint"
                          value={form.destination.buildingName}
                          onChange={event => updateDestination({ type: 'edit-building', buildingName: event.target.value })}
                          placeholder={copy.manualBuilding}
                          required={destinationPolicy.buildingRequired}
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <input
                        id="inventory-building-manual"
                        value={form.destination.buildingName}
                        onChange={event => updateDestination({ type: 'edit-building', buildingName: event.target.value })}
                        placeholder={copy.manualBuilding}
                        aria-describedby="inventory-destination-flow-hint inventory-destination-hierarchy-hint"
                        required={destinationPolicy.buildingRequired}
                      />
                      <span id="inventory-destination-hierarchy-hint" className={styles.fieldHint}>{copy.noConfiguredHierarchy}</span>
                    </>
                  )}
                </div>
                <div className={styles.field}>
                  <label htmlFor={destinationCatalog.hasHierarchy && form.destination.buildingMode === 'catalog' ? 'inventory-zone' : 'inventory-zone-manual'}>{copy.zone}</label>
                  {destinationCatalog.hasHierarchy && form.destination.buildingMode === 'catalog' ? (
                    <>
                      <select
                        id="inventory-zone"
                        value={form.destination.zoneMode === 'manual' ? MANUAL_ZONE_VALUE : form.destination.zoneId ?? ''}
                        onChange={event => {
                          if (event.target.value === MANUAL_ZONE_VALUE) updateDestination({ type: 'edit-zone', zoneName: '' });
                          else updateDestination({ type: 'select-zone', zoneId: event.target.value });
                        }}
                        disabled={!form.destination.buildingId}
                      >
                        <option value="">{form.destination.buildingId ? copy.chooseZone : copy.chooseBuildingFirst}</option>
                        {destinationZoneGroups.map(group => (
                          <optgroup key={group.key} label={group.label}>
                            {group.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                          </optgroup>
                        ))}
                        {form.destination.buildingId ? <option value={MANUAL_ZONE_VALUE}>{copy.otherDestination}</option> : null}
                      </select>
                      {form.destination.zoneMode === 'manual' ? (
                        <input
                          id="inventory-zone-manual"
                          aria-label={copy.manualZone}
                          value={form.destination.zoneName}
                          onChange={event => updateDestination({ type: 'edit-zone', zoneName: event.target.value })}
                          placeholder={copy.manualZone}
                          disabled={!form.destination.buildingName.trim()}
                        />
                      ) : null}
                    </>
                  ) : (
                    <input
                      id="inventory-zone-manual"
                      value={form.destination.zoneName}
                      onChange={event => updateDestination({ type: 'edit-zone', zoneName: event.target.value })}
                      placeholder={form.destination.buildingName.trim() ? copy.manualZone : copy.chooseBuildingFirst}
                      disabled={!form.destination.buildingName.trim()}
                    />
                  )}
                </div>
                {mode === 'out' ? <>
                  <div className={styles.field}>
                    <label htmlFor="inventory-company">{copy.company}</label>
                    <select id="inventory-company" value={form.companyId} onChange={event => patchForm({ companyId: event.target.value })}>
                      <option value="">{copy.notSpecified}</option>
                      {operationCompanies.map((company: InventoryCompanyRow) => <option key={company.id} value={company.id}>{company.name}</option>)}
                    </select>
                  </div>
                  <div className={styles.field}><label htmlFor="inventory-person">{copy.person}</label><input id="inventory-person" value={form.personName} onChange={event => patchForm({ personName: event.target.value })} /></div>
                </> : null}
                <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="inventory-comment">{copy.comment}</label><textarea id="inventory-comment" value={form.comment} onChange={event => patchForm({ comment: event.target.value })} rows={3} /></div>
                {mode === 'out' && capabilities.canAdjust && selectedProduct && numberValue(form.quantity) > numberValue(selectedProduct.current_stock) ? (
                  <label className={`${styles.checkbox} ${styles.fieldWide}`} htmlFor="inventory-negative">
                    <input id="inventory-negative" type="checkbox" checked={form.allowNegative} onChange={event => patchForm({ allowNegative: event.target.checked })} />
                    <span>{copy.allowNegative}</span>
                  </label>
                ) : null}
              </div>
            </fieldset>

            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => transitionToMode('stock')}>{copy.cancel}</button>
              <button type="submit" className={mode === 'in' ? styles.primaryButton : styles.dangerButton} disabled={saving || !operationProjectId}>
                {saving ? copy.saving : mode === 'in' ? copy.validateEntry : copy.validateExit}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className={styles.dataPanel} aria-labelledby="inventory-data-title">
          <div className={styles.dataHeading}>
            <div>
              <span>{scopeName}</span>
              <h3 id="inventory-data-title">{mode === 'history' ? copy.historyTitle : copy.stockTitle}</h3>
              <p>{mode === 'history' ? copy.historySubtitle(projection.filteredMovements.length) : copy.stockSubtitle(projection.filteredProducts.length)}</p>
            </div>
            <div className={styles.dataActions}>
              <label className={styles.searchField}>
                <InventoryIcon name="search" size={19} />
                <span className={styles.srOnly}>{mode === 'history' ? copy.searchHistory : copy.searchStock}</span>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder={mode === 'history' ? copy.searchHistory : copy.searchStock} />
                {search ? <button type="button" onClick={() => setSearch('')} aria-label={copy.clearSearch}><InventoryIcon name="close" size={18} /></button> : null}
              </label>
              {capabilities.canExport ? (
                <div className={styles.exportMenu} ref={exportMenuRef}>
                  <button ref={exportButtonRef} type="button" className={styles.exportButton} aria-expanded={exportOpen} aria-haspopup="dialog" aria-controls="inventory-export-panel" onClick={() => setExportOpen(value => !value)}>
                    <InventoryIcon name="download" size={18} />
                    <span>{copy.export}</span>
                    <InventoryIcon name="chevron" size={16} />
                  </button>
                  {exportOpen && typeof document !== 'undefined' ? createPortal(
                    <div
                      id="inventory-export-panel"
                      ref={exportPanelRef}
                      className={styles.exportPanel}
                      role="dialog"
                      aria-label={copy.exportTitle}
                      data-placement={exportPanelLayout?.placement ?? 'bottom'}
                      style={{
                        top: exportPanelLayout?.top ?? 0,
                        left: exportPanelLayout?.left ?? 0,
                        width: exportPanelLayout?.width,
                        maxHeight: exportPanelLayout?.maxHeight,
                        visibility: exportPanelLayout ? 'visible' : 'hidden',
                      }}
                    >
                      <div><strong>{copy.exportTitle}</strong><span>{copy.documentLanguage}</span></div>
                      <div className={styles.languageSelector} role="radiogroup" aria-label={copy.documentLanguage}>
                        {(['fr', 'en', 'es'] as const).map(reportCode => <button key={reportCode} type="button" role="radio" aria-checked={reportLanguage === reportCode} className={reportLanguage === reportCode ? styles.languageActive : ''} onClick={() => onReportLanguageChange(reportCode)}>{reportCode.toUpperCase()}</button>)}
                      </div>
                      <button type="button" onClick={() => void exportWorkbook()} disabled={!!exporting}><InventoryIcon name="file" /><span><strong>{copy.workbook}</strong><small>.xlsx</small></span>{exporting === 'xlsx' ? <InventoryIcon name="refresh" className={styles.spinning} /> : null}</button>
                      <button type="button" onClick={() => void exportInventoryWord()} disabled={!!exporting}><InventoryIcon name="file" /><span><strong>{copy.word}</strong><small>.docx</small></span>{exporting === 'docx' ? <InventoryIcon name="refresh" className={styles.spinning} /> : null}</button>
                      <button type="button" onClick={() => void printInventoryPdf()} disabled={!!exporting}><InventoryIcon name="file" /><span><strong>{copy.pdf}</strong><small>.pdf</small></span>{exporting === 'pdf' ? <InventoryIcon name="refresh" className={styles.spinning} /> : null}</button>
                    </div>,
                    document.body,
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.filterBar} role="group" aria-label={mode === 'history' ? copy.history : copy.stock}>
            {mode === 'history' ? <>
              {(['all', 'in', 'out'] as const).map(filter => (
                <button key={filter} type="button" aria-pressed={movementFilter === filter} className={movementFilter === filter ? styles.filterActive : ''} onClick={() => setMovementFilter(filter)}>
                  {filter === 'all' ? copy.all : filter === 'in' ? copy.entries : copy.exits}
                </button>
              ))}
            </> : <>
              {(['all', 'low'] as const).map(filter => (
                <button key={filter} type="button" aria-pressed={productFilter === filter} className={productFilter === filter ? styles.filterActive : ''} onClick={() => setProductFilter(filter)}>
                  {filter === 'all' ? copy.all : copy.lowOnly}
                </button>
              ))}
            </>}
          </div>

          {mode === 'history' ? <>
            <div className={styles.desktopTable} data-testid="inventory-history-table">
              <table>
                <thead><tr><th>{copy.date}</th>{projection.isAggregate ? <th>{copy.project}</th> : null}<th>{copy.type}</th><th>{copy.reference}</th><th>{copy.designation}</th><th>{copy.quantity}</th><th>{copy.balance}</th><th>{copy.destination}</th><th>{copy.company}</th><th>{copy.user}</th><th>{copy.comment}</th></tr></thead>
                <tbody>{projection.filteredMovements.map(movement => (
                  <tr key={movement.id}>
                    <td><time dateTime={movement.created_at ?? undefined}>{movement.created_at ? new Date(movement.created_at).toLocaleString(locale) : '—'}</time></td>
                    {projection.isAggregate ? <td><ProjectTag name={projection.projectNames.get(String(movement.chantier_id)) ?? copy.allProjects} /></td> : null}
                    <td><span className={movement.movement_type === 'in' ? styles.inBadge : styles.outBadge}>{movement.movement_type === 'in' ? copy.receive : copy.dispatch}</span></td>
                    <td><strong>{movement.reference}</strong></td><td>{movement.designation}</td>
                    <td className={styles.numeric}>{movement.movement_type === 'in' ? '+' : '−'}{numberValue(movement.quantity).toLocaleString(locale)}</td>
                    <td className={styles.numeric}>{numberValue(movement.stock_before).toLocaleString(locale)} <span aria-hidden="true">→</span> {numberValue(movement.stock_after).toLocaleString(locale)}</td>
                    <td>{movementDestinationLabel(movement)}</td><td>{movement.company_name || '—'}</td><td>{movement.user_name || '—'}</td><td>{movement.comment || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className={styles.mobileCards} data-testid="inventory-history-cards">
              {projection.filteredMovements.map(movement => (
                <article className={styles.movementCard} key={movement.id}>
                  <div className={styles.cardTopline}>
                    <span className={movement.movement_type === 'in' ? styles.inBadge : styles.outBadge}>{movement.movement_type === 'in' ? copy.receive : copy.dispatch}</span>
                    <time dateTime={movement.created_at ?? undefined}>{movement.created_at ? new Date(movement.created_at).toLocaleString(locale) : '—'}</time>
                  </div>
                  <div className={styles.cardIdentity}><strong>{movement.reference}</strong><span>{movement.designation || movement.reference}</span></div>
                  {projection.isAggregate ? <ProjectTag name={projection.projectNames.get(String(movement.chantier_id)) ?? copy.allProjects} /> : null}
                  <dl className={styles.cardFacts}>
                    <div><dt>{copy.quantity}</dt><dd>{movement.movement_type === 'in' ? '+' : '−'}{numberValue(movement.quantity).toLocaleString(locale)}</dd></div>
                    <div><dt>{copy.balance}</dt><dd>{numberValue(movement.stock_before).toLocaleString(locale)} → {numberValue(movement.stock_after).toLocaleString(locale)}</dd></div>
                    <div><dt>{copy.destination}</dt><dd>{movementDestinationLabel(movement)}</dd></div>
                    <div><dt>{copy.company}</dt><dd>{movement.company_name || '—'}</dd></div>
                  </dl>
                  {movement.comment ? <p className={styles.cardComment}>{movement.comment}</p> : null}
                </article>
              ))}
            </div>
            {!projection.filteredMovements.length ? <div className={styles.emptyState}><InventoryIcon name="history" size={28} /><strong>{copy.noMovements}</strong></div> : null}
          </> : <>
            <div className={styles.desktopTable} data-testid="inventory-stock-table">
              <table>
                <thead><tr><th>{copy.photo}</th>{projection.isAggregate ? <th>{copy.project}</th> : null}<th>{copy.reference}</th><th>{copy.designation}</th><th>{copy.currentStock}</th><th>{copy.entries}</th><th>{copy.exits}</th><th>{copy.minimum}</th><th>{copy.location}</th><th>{copy.actions}</th></tr></thead>
                <tbody>{projection.filteredProducts.map(product => {
                  const low = isInventoryLowStock(product);
                  return (
                    <tr key={product.id} className={low ? styles.lowRow : ''}>
                      <td><ProductThumbnail product={product} language={language} /></td>
                      {projection.isAggregate ? <td><ProjectTag name={projection.projectNames.get(String(product.chantier_id)) ?? copy.allProjects} /></td> : null}
                      <td><strong>{product.reference}</strong>{product.barcode ? <small>{product.barcode}</small> : null}</td>
                      <td>{product.designation || product.reference}</td>
                      <td><b className={low ? styles.lowStock : ''}>{numberValue(product.current_stock).toLocaleString(locale)}</b>{low ? <small className={styles.warning}>{copy.lowStock}</small> : null}</td>
                      <td className={styles.numeric}>{numberValue(product.total_entries).toLocaleString(locale)}</td><td className={styles.numeric}>{numberValue(product.total_exits).toLocaleString(locale)}</td><td className={styles.numeric}>{numberValue(product.min_stock).toLocaleString(locale)}</td><td>{product.location || copy.unstored}</td>
                      <td><div className={styles.rowActions}>{capabilities.canRecord ? <button type="button" onClick={() => openMovement('in', product)} aria-label={`${copy.receive} ${product.reference}`}><InventoryIcon name="plus" size={16} /><span>{copy.receive}</span></button> : null}{capabilities.canRecord ? <button type="button" onClick={() => openMovement('out', product)} aria-label={`${copy.dispatch} ${product.reference}`}><InventoryIcon name="minus" size={16} /><span>{copy.dispatch}</span></button> : null}{capabilities.canManage ? <button type="button" onClick={() => openProductEditor(product)} aria-label={`${copy.edit} ${product.reference}`}><InventoryIcon name="edit" size={16} /><span className={styles.srOnly}>{copy.edit}</span></button> : null}</div></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className={styles.mobileCards} data-testid="inventory-stock-cards">
              {projection.filteredProducts.map(product => {
                const low = isInventoryLowStock(product);
                return (
                  <article className={`${styles.productCard} ${low ? styles.productCardLow : ''}`} key={product.id}>
                    <div className={styles.productCardHeader}>
                      <ProductThumbnail product={product} language={language} />
                      <div className={styles.cardIdentity}><strong>{product.reference}</strong><span>{product.designation || product.reference}</span>{product.barcode ? <small>{product.barcode}</small> : null}</div>
                      <div className={styles.stockPill} data-low={low ? 'true' : 'false'}><strong>{numberValue(product.current_stock).toLocaleString(locale)}</strong><span>{copy.currentStock}</span></div>
                    </div>
                    {projection.isAggregate ? <ProjectTag name={projection.projectNames.get(String(product.chantier_id)) ?? copy.allProjects} /> : null}
                    <dl className={styles.cardFacts}>
                      <div><dt>{copy.minimum}</dt><dd>{numberValue(product.min_stock).toLocaleString(locale)}</dd></div>
                      <div><dt>{copy.entries}</dt><dd>{numberValue(product.total_entries).toLocaleString(locale)}</dd></div>
                      <div><dt>{copy.exits}</dt><dd>{numberValue(product.total_exits).toLocaleString(locale)}</dd></div>
                      <div><dt>{copy.location}</dt><dd>{product.location || copy.unstored}</dd></div>
                    </dl>
                    {low ? <div className={styles.lowAlert}><InventoryIcon name="warning" size={16} /><span>{copy.lowStock}</span></div> : null}
                    {(capabilities.canRecord || capabilities.canManage) ? <div className={styles.cardActions}>{capabilities.canRecord ? <button type="button" onClick={() => openMovement('in', product)}><InventoryIcon name="plus" size={16} />{copy.receive}</button> : null}{capabilities.canRecord ? <button type="button" onClick={() => openMovement('out', product)}><InventoryIcon name="minus" size={16} />{copy.dispatch}</button> : null}{capabilities.canManage ? <button type="button" onClick={() => openProductEditor(product)} aria-label={`${copy.edit} ${product.reference}`}><InventoryIcon name="edit" size={16} /><span>{copy.edit}</span></button> : null}</div> : null}
                  </article>
                );
              })}
            </div>
            {!projection.filteredProducts.length ? <div className={styles.emptyState}><InventoryIcon name="box" size={28} /><strong>{copy.noProducts}</strong></div> : null}
          </>}
        </section>
      )}

      {editingProduct && capabilities.canManage ? (
        <div className={styles.dialogBackdrop} role="presentation">
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="inventory-edit-title">
            <div className={styles.dialogHeading}>
              <div><span>{editingProduct.reference}</span><h3 id="inventory-edit-title">{copy.editTitle}</h3><p>{copy.editSubtitle}</p></div>
              <button type="button" className={styles.iconButton} onClick={closeProductEditor} aria-label={copy.close}><InventoryIcon name="close" /></button>
            </div>
            {error ? <div className={styles.dialogError} role="alert"><InventoryIcon name="warning" /><span>{error}</span></div> : null}
            <form onSubmit={submitProductEdit} className={styles.editForm}>
              <div className={styles.field}><label htmlFor="inventory-edit-reference">{copy.reference} *</label><input id="inventory-edit-reference" value={editForm.reference} onChange={event => setEditForm(current => ({ ...current, reference: event.target.value }))} autoFocus required /></div>
              <div className={styles.field}><label htmlFor="inventory-edit-barcode">{copy.barcode}</label><input id="inventory-edit-barcode" value={editForm.barcode} onChange={event => setEditForm(current => ({ ...current, barcode: event.target.value }))} /></div>
              <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="inventory-edit-designation">{copy.designation} *</label><input id="inventory-edit-designation" value={editForm.designation} onChange={event => setEditForm(current => ({ ...current, designation: event.target.value }))} required /></div>
              <div className={styles.field}><label htmlFor="inventory-edit-minimum">{copy.minimum}</label><input id="inventory-edit-minimum" value={editForm.minStock} onChange={event => setEditForm(current => ({ ...current, minStock: event.target.value }))} type="number" min="0" step="any" /></div>
              <div className={styles.field}><label htmlFor="inventory-edit-location">{copy.location}</label><input id="inventory-edit-location" value={editForm.location} onChange={event => setEditForm(current => ({ ...current, location: event.target.value }))} /></div>
              <div className={styles.field}><label htmlFor="inventory-edit-supplier">{copy.supplier}</label><input id="inventory-edit-supplier" value={editForm.supplier} onChange={event => setEditForm(current => ({ ...current, supplier: event.target.value }))} /></div>
              <div className={styles.field}><label htmlFor="inventory-edit-photo">{copy.newPhoto}</label><input id="inventory-edit-photo" className={styles.fileInput} type="file" accept="image/*" capture="environment" onChange={event => setEditPhoto(event.target.files?.[0] ?? null)} /></div>
              <div className={`${styles.formActions} ${styles.fieldWide}`}><button type="button" className={styles.secondaryButton} onClick={closeProductEditor}>{copy.cancel}</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? copy.saving : copy.saveProduct}</button></div>
            </form>
          </section>
        </div>
      ) : null}
      {(scannerOpen || confirmingLocation) && typeof document !== 'undefined' ? createPortal(
        <div className={styles.scanOverlay} role="dialog" aria-modal="true">
          {scannerOpen ? (
            <>
              <video ref={videoRef} muted playsInline className={styles.scanOverlayVideo} aria-label={scannerTarget === 'location' ? copy.scannerLocationHelp : copy.scannerHelp} />
              <div className={styles.scanOverlayChrome}>
                <p className={styles.scanStep}>{mode === 'in' ? (scannerTarget === 'location' ? copy.scanStepLocation : copy.scanStepProduct) : copy.scan}</p>
                <p>{scannerTarget === 'location' ? copy.scannerLocationHelp : copy.scannerHelp}</p>
                <button type="button" className={styles.secondaryButton} onClick={stopScanner}>{copy.stopCamera}</button>
              </div>
            </>
          ) : (
            <div className={styles.scanConfirm}>
              <small>{copy.knownLocation}</small>
              <strong>{knownLocation}</strong>
              <div className={styles.locationRow}>
                <button type="button" className={styles.primaryButton} onClick={() => { setConfirmingLocation(false); patchForm({ location: knownLocation }); }}>{copy.confirmLocation}</button>
                <button type="button" className={styles.secondaryButton} onClick={() => { setConfirmingLocation(false); void startScanner('location'); }}>{copy.changeLocation}</button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
