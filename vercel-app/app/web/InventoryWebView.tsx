'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { privateMediaUrl, uploadRegisteredWebFile } from '@/lib/private-media-client';
import {
  startWebBarcodeScanner,
  webBarcodeCameraErrorMessage,
  type WebBarcodeScannerControls,
} from '../../../lib/webBarcodeScanner';
import styles from './inventory.module.css';

type InventoryMode = 'home' | 'in' | 'out' | 'stock' | 'history';
type ExportLanguage = 'fr' | 'en' | 'es';

const INVENTORY_EXPORT_UI_COPY: Record<ExportLanguage, {
  language: string;
  workbook: string;
  pdf: string;
  pdfError: string;
}> = {
  fr: { language: 'Langue du document', workbook: 'Classeur Excel', pdf: 'Rapport PDF', pdfError: 'Le rapport PDF n’a pas pu être généré.' },
  en: { language: 'Document language', workbook: 'Excel workbook', pdf: 'PDF report', pdfError: 'The PDF report could not be generated.' },
  es: { language: 'Idioma del documento', workbook: 'Libro Excel', pdf: 'Informe PDF', pdfError: 'No se pudo generar el informe PDF.' },
};

type InventoryProductRow = {
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

type InventoryMovementRow = {
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

type Props = {
  products: InventoryProductRow[];
  movements: InventoryMovementRow[];
  projects: any[];
  companies: any[];
  selectedProjectId: string;
  organizationId?: string | null;
  canRecord: boolean;
  canManage: boolean;
  canAdjust: boolean;
  canExport: boolean;
  uiLanguage: ExportLanguage;
  exportLanguage: ExportLanguage;
  onExportLanguageChange: (language: ExportLanguage) => void;
  onReload: () => Promise<void> | void;
};

type FormState = {
  reference: string;
  barcode: string;
  designation: string;
  quantity: string;
  supplier: string;
  location: string;
  minStock: string;
  buildingName: string;
  zoneName: string;
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

const EMPTY_FORM: FormState = {
  reference: '', barcode: '', designation: '', quantity: '', supplier: '', location: '', minStock: '0',
  buildingName: '', zoneName: '', companyId: '', personName: '', comment: '', allowNegative: false,
};

const EMPTY_PRODUCT_EDIT: ProductEditState = {
  reference: '', barcode: '', designation: '', supplier: '', location: '', minStock: '0',
};

function normalizeReference(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export default function InventoryWebView({
  products,
  movements,
  projects,
  companies,
  selectedProjectId,
  canRecord,
  canManage,
  canAdjust,
  canExport,
  uiLanguage,
  exportLanguage,
  onExportLanguageChange,
  onReload,
}: Props) {
  const exportUiCopy = INVENTORY_EXPORT_UI_COPY[uiLanguage];
  const [mode, setMode] = useState<InventoryMode>('home');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [editingProduct, setEditingProduct] = useState<InventoryProductRow | null>(null);
  const [editForm, setEditForm] = useState<ProductEditState>(EMPTY_PRODUCT_EDIT);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<WebBarcodeScannerControls | null>(null);

  const activeProjectId = selectedProjectId === 'all' ? '' : selectedProjectId;
  const scopedProducts = useMemo(
    () => products.filter(product => !activeProjectId || String(product.chantier_id) === String(activeProjectId)),
    [activeProjectId, products],
  );
  const scopedMovements = useMemo(
    () => movements
      .filter(movement => !activeProjectId || String(movement.chantier_id) === String(activeProjectId))
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()),
    [activeProjectId, movements],
  );
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr');
    const normalized = normalizeReference(search);
    if (!needle) return scopedProducts;
    return scopedProducts.filter(product =>
      String(product.reference ?? '').toLocaleLowerCase('fr').includes(needle)
      || normalizeReference(product.reference ?? '').includes(normalized)
      || String(product.designation ?? '').toLocaleLowerCase('fr').includes(needle)
      || String(product.barcode ?? '').includes(search.trim()),
    );
  }, [scopedProducts, search]);
  const filteredMovements = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr');
    if (!needle) return scopedMovements;
    return scopedMovements.filter(movement => [
      movement.reference,
      movement.designation,
      movement.building_name,
      movement.zone_name,
      movement.company_name,
      movement.person_name,
      movement.comment,
      movement.user_name,
    ].some(value => String(value ?? '').toLocaleLowerCase('fr').includes(needle)));
  }, [scopedMovements, search]);
  const lowStockProducts = scopedProducts.filter(product =>
    numberValue(product.current_stock) <= numberValue(product.min_stock),
  );
  const totalUnits = scopedProducts.reduce((sum, product) => sum + numberValue(product.current_stock), 0);
  const selectedProduct = scopedProducts.find(product => product.id === selectedProductId) ?? null;
  const selectedCompany = companies.find(company => String(company.id) === form.companyId);

  useEffect(() => () => stopScanner(), []);

  function patchForm(patch: Partial<FormState>) {
    setForm(current => ({ ...current, ...patch }));
  }

  function selectProduct(product: InventoryProductRow) {
    setSelectedProductId(product.id);
    setForm(current => ({
      ...current,
      reference: product.reference ?? '',
      barcode: product.barcode ?? '',
      designation: product.designation ?? product.reference ?? '',
      supplier: product.supplier ?? '',
      location: product.location ?? '',
      minStock: String(numberValue(product.min_stock)),
    }));
  }

  function resolveTypedProduct(reference = form.reference, barcode = form.barcode) {
    const normalized = normalizeReference(reference);
    const found = scopedProducts.find(product =>
      (!!barcode.trim() && String(product.barcode ?? '') === barcode.trim())
      || (!!normalized && normalizeReference(product.reference ?? '') === normalized),
    );
    if (found) selectProduct(found);
    else setSelectedProductId(null);
    return found ?? null;
  }

  function openMovement(nextMode: 'in' | 'out', product?: InventoryProductRow) {
    setMode(nextMode);
    setError('');
    setNotice('');
    setPhoto(null);
    setForm({ ...EMPTY_FORM });
    setSelectedProductId(null);
    if (product) selectProduct(product);
  }

  function openProductEditor(product: InventoryProductRow) {
    if (!canManage) return;
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
    setError('');
    setNotice('');
  }

  function closeProductEditor() {
    setEditingProduct(null);
    setEditPhoto(null);
    setEditForm(EMPTY_PRODUCT_EDIT);
  }

  function stopScanner() {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerLoading(false);
    setScannerOpen(false);
  }

  async function enrichScannedBarcode(rawValue: string) {
    patchForm({ barcode: rawValue, reference: form.reference || rawValue });
    const found = scopedProducts.find(product => String(product.barcode ?? '') === rawValue);
    if (found) {
      selectProduct(found);
      setNotice(`Produit trouvé : ${found.designation || found.reference}.`);
      return;
    }

    try {
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch('/api/inventory-barcode-lookup', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: rawValue, language: navigator.language || 'fr' }),
      });
      if (!response.ok) return;
      const payload = await response.json();
      const match = payload?.match;
      if (!match?.designation) return;
      setForm(current => ({
        ...current,
        barcode: rawValue,
        reference: current.reference || rawValue,
        designation: current.designation || String(match.designation),
        supplier: current.supplier || String(match.brand ?? ''),
      }));
      setNotice(`Produit identifié : ${String(match.designation)}. Vérifiez la variante avant validation.`);
    } catch {
      // Le code reste saisi même si l'enrichissement catalogue est indisponible.
    }
  }

  async function startScanner() {
    setScanError('');
    setScannerLoading(true);
    try {
      setScannerOpen(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!videoRef.current) throw new Error('Aperçu caméra indisponible.');
      let detectedDuringStart = false;
      const controls = await startWebBarcodeScanner({
        video: videoRef.current,
        loadZXing: () => import('@zxing/browser'),
        onDetected: result => {
          detectedDuringStart = true;
          stopScanner();
          void enrichScannedBarcode(result.text);
        },
      });
      if (detectedDuringStart) controls.stop();
      else {
        scannerControlsRef.current = controls;
        setScannerLoading(false);
      }
    } catch (scanFailure: any) {
      stopScanner();
      setScanError(webBarcodeCameraErrorMessage(scanFailure, "Impossible d'ouvrir la caméra."));
    }
  }

  async function uploadPhoto(file: File, productId: string) {
    return uploadRegisteredWebFile('photos', file, `inventory_${activeProjectId}_${productId}`);
  }

  async function submitMovement(event: React.FormEvent) {
    event.preventDefault();
    if (mode !== 'in' && mode !== 'out') return;
    setError('');
    setNotice('');
    if (!canRecord) return setError("Votre rôle n'autorise pas l'enregistrement de mouvements.");
    if (!activeProjectId) return setError('Sélectionnez un chantier.');
    const existing = selectedProduct ?? resolveTypedProduct();
    const reference = form.reference.trim().toUpperCase();
    const quantity = Number(form.quantity);
    if (!reference) return setError('La référence est obligatoire.');
    if (!Number.isFinite(quantity) || quantity <= 0) return setError('La quantité doit être supérieure à zéro.');
    if (mode === 'out' && !existing) return setError("Cette référence n'existe pas dans le stock du chantier.");
    if (mode === 'out' && !form.buildingName.trim()) return setError('La destination est obligatoire pour une sortie.');
    if (!existing && !form.designation.trim()) return setError('La désignation est obligatoire pour une nouvelle référence.');
    if (mode === 'out' && existing && quantity > numberValue(existing.current_stock) && !(canAdjust && form.allowNegative)) {
      return setError(`Stock insuffisant : ${numberValue(existing.current_stock)} unité(s) disponible(s).`);
    }

    setSaving(true);
    try {
      const productId = existing?.id ?? crypto.randomUUID();
      const movementId = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();
      const photoUrl = photo ? await uploadPhoto(photo, productId) : existing?.photo_url ?? null;
      const designation = (existing?.designation ?? form.designation).trim() || reference;
      const { data: rpcData, error: rpcError } = await (supabaseBrowser.rpc as any)('record_inventory_movement', {
        p_operation_id: operationId,
        p_movement: {
          id: movementId,
          chantier_id: activeProjectId,
          product_id: productId,
          movement_type: mode,
          quantity,
          reference,
          barcode: form.barcode.trim() || existing?.barcode || null,
          supplier: form.supplier.trim() || existing?.supplier || null,
          location: form.location.trim() || existing?.location || null,
          building_name: form.buildingName.trim() || null,
          zone_name: form.zoneName.trim() || null,
          company_id: form.companyId || null,
          company_name: selectedCompany?.name ?? null,
          person_name: form.personName.trim() || null,
          comment: form.comment.trim() || null,
          created_at: now,
        },
        p_product: {
          id: productId,
          reference,
          designation,
          barcode: form.barcode.trim() || existing?.barcode || null,
          photo_url: photoUrl,
          min_stock: numberValue(form.minStock),
          location: form.location.trim() || existing?.location || null,
          supplier: form.supplier.trim() || existing?.supplier || null,
        },
        p_allow_negative: canAdjust && form.allowNegative,
      });
      if (rpcError) throw rpcError;
      const outcome = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!outcome || outcome.status !== 'ok') throw new Error(outcome?.message ?? 'Mouvement refusé par le serveur.');
      await onReload();
      setNotice(`${mode === 'in' ? 'Entrée' : 'Sortie'} enregistrée. Nouveau stock : ${numberValue(outcome.stock_after)}.`);
      setForm({ ...EMPTY_FORM });
      setSelectedProductId(null);
      setPhoto(null);
      setMode('home');
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
    if (!canManage || !editingProduct) return setError("Votre rôle n'autorise pas la modification des fiches produits.");
    const reference = editForm.reference.trim().toUpperCase();
    const designation = editForm.designation.trim();
    const minStock = Number(editForm.minStock.replace(',', '.'));
    if (!reference) return setError('La référence est obligatoire.');
    if (!designation) return setError('La désignation est obligatoire.');
    if (!Number.isFinite(minStock) || minStock < 0) return setError('Le stock minimum doit être positif ou nul.');

    setSaving(true);
    try {
      const photoUrl = editPhoto ? await uploadPhoto(editPhoto, editingProduct.id) : editingProduct.photo_url ?? null;
      const { data: rpcData, error: rpcError } = await (supabaseBrowser.rpc as any)('update_inventory_product', {
        p_product_id: editingProduct.id,
        p_patch: {
          reference,
          designation,
          barcode: editForm.barcode.trim() || null,
          photo_url: photoUrl,
          min_stock: minStock,
          location: editForm.location.trim() || null,
          supplier: editForm.supplier.trim() || null,
        },
      });
      if (rpcError) throw rpcError;
      const outcome = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!outcome || outcome.status !== 'ok') throw new Error(outcome?.message ?? 'Modification refusée par le serveur.');
      await onReload();
      closeProductEditor();
      setNotice(`La fiche ${reference} a été mise à jour.`);
    } catch (editError: any) {
      setError(editError?.message ?? String(editError));
    } finally {
      setSaving(false);
    }
  }

  async function exportWorkbook(kind: 'stock' | 'history') {
    try {
      setError('');
      const { downloadInventoryWorkbook } = await import('@/lib/inventory-workbook');
      const chantierName = projects.find(project => String(project.id) === String(activeProjectId))?.name
        ?? (activeProjectId ? 'Chantier BuildTrack' : 'Tous les chantiers');
      const date = new Date().toISOString().slice(0, 10);
      const exportedProducts = kind === 'history' ? scopedProducts : filteredProducts;
      downloadInventoryWorkbook({
        kind,
        chantierName,
        language: exportLanguage,
        filename: `buildtrack-${kind === 'history' ? 'mouvements-stock' : 'stock'}-${safeFilename(chantierName)}-${exportLanguage}-${date}.xlsx`,
        products: exportedProducts.map(product => ({
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
        })),
        movements: filteredMovements.map(movement => ({
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
        })),
      });
    } catch (exportError: any) {
      setError(exportError?.message ?? 'Le classeur Excel n’a pas pu être généré.');
    }
  }

  const exportStock = () => void exportWorkbook('stock');
  const exportHistory = () => void exportWorkbook('history');

  async function printInventoryPdf() {
    try {
      setError('');
      const { buildInventoryPdfHtml } = await import('../../../lib/inventoryPdfDocument');
      const chantierName = projects.find(project => String(project.id) === String(activeProjectId))?.name
        ?? (activeProjectId ? 'Chantier BuildTrack' : 'Tous les chantiers');
      const html = buildInventoryPdfHtml(
        filteredProducts.map(product => ({
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
        })),
        filteredMovements.map(movement => ({
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
        })),
        chantierName,
        exportLanguage,
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
    } catch (exportError: any) {
      setError(exportError?.message ?? exportUiCopy.pdfError);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Gestion de stock chantier</p>
          <h2>Stock en temps réel</h2>
          <p>Entrée → scan/référence → quantité → validation</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void onReload()} disabled={saving}>Actualiser</button>
      </div>

      {error ? <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      {scanError ? <div className={styles.error} role="alert">{scanError}<button type="button" onClick={() => setScanError('')}>×</button></div> : null}

      <div className={styles.actions}>
        <button type="button" className={mode === 'in' ? styles.actionActive : ''} onClick={() => openMovement('in')} disabled={!canRecord}>
          <span className={styles.actionIcon}>↓</span><strong>ENTRÉE</strong><small>Réceptionner du matériel</small>
        </button>
        <button type="button" className={mode === 'out' ? styles.actionActive : ''} onClick={() => openMovement('out')} disabled={!canRecord}>
          <span className={`${styles.actionIcon} ${styles.exitIcon}`}>↑</span><strong>SORTIE</strong><small>Envoyer vers une zone</small>
        </button>
        <button type="button" className={mode === 'stock' ? styles.actionActive : ''} onClick={() => setMode('stock')}>
          <span className={styles.actionIcon}>▦</span><strong>STOCK</strong><small>Consulter les références</small>
        </button>
        <button type="button" className={mode === 'history' ? styles.actionActive : ''} onClick={() => setMode('history')}>
          <span className={styles.actionIcon}>◷</span><strong>HISTORIQUE</strong><small>Tracer les mouvements</small>
        </button>
      </div>

      <div className={styles.kpis}>
        <div><strong>{scopedProducts.length}</strong><span>Références</span></div>
        <div><strong>{totalUnits}</strong><span>Unités en stock</span></div>
        <div className={lowStockProducts.length ? styles.lowKpi : ''}><strong>{lowStockProducts.length}</strong><span>Stocks faibles</span></div>
        <div><strong>{scopedMovements.length}</strong><span>Mouvements</span></div>
      </div>

      {(mode === 'in' || mode === 'out') && (
        <form className={styles.formCard} onSubmit={submitMovement}>
          <div className={styles.formHeading}>
            <div><span>{mode === 'in' ? 'Entrée de matériel' : 'Sortie de matériel'}</span><h3>{mode === 'in' ? 'Ajouter au stock' : 'Déduire du stock'}</h3></div>
            <button type="button" className={styles.closeButton} onClick={() => { stopScanner(); setMode('home'); }}>×</button>
          </div>
          <div className={styles.scanRow}>
            <label><span>Référence *</span><input list="inventory-products" value={form.reference} onChange={event => { patchForm({ reference: event.target.value }); setSelectedProductId(null); }} onBlur={() => resolveTypedProduct()} placeholder="ABC-12580" autoFocus /></label>
            <label><span>Code-barres / QR</span><input value={form.barcode} onChange={event => { patchForm({ barcode: event.target.value }); setSelectedProductId(null); }} onBlur={() => resolveTypedProduct()} inputMode="numeric" /></label>
            <button type="button" className={styles.scanButton} onClick={() => scannerOpen ? stopScanner() : void startScanner()}>{scannerLoading ? 'Ouverture…' : scannerOpen ? 'Fermer caméra' : 'Scanner'}</button>
          </div>
          <datalist id="inventory-products">{scopedProducts.map(product => <option key={product.id} value={product.reference}>{product.designation}</option>)}</datalist>
          {scannerOpen ? <div className={styles.scanner}><video ref={videoRef} muted playsInline /><div className={styles.scanFrame} /></div> : null}
          {selectedProduct ? <div className={styles.foundProduct}><strong>Produit trouvé</strong><span>{selectedProduct.designation}</span><b>{numberValue(selectedProduct.current_stock)} en stock</b></div> : null}
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Désignation *</span><input value={form.designation} onChange={event => patchForm({ designation: event.target.value })} disabled={!!selectedProduct} placeholder="Vanne DN25" /></label>
            <label><span>Quantité *</span><input value={form.quantity} onChange={event => patchForm({ quantity: event.target.value })} type="number" min="0.001" step="any" /></label>
            <label><span>Stock après mouvement</span><input value={selectedProduct ? String(numberValue(selectedProduct.current_stock) + (mode === 'in' ? 1 : -1) * numberValue(form.quantity)) : mode === 'in' ? form.quantity : ''} readOnly /></label>
            {mode === 'in' ? <>
              <label><span>Fournisseur</span><input value={form.supplier} onChange={event => patchForm({ supplier: event.target.value })} /></label>
              <label><span>Emplacement</span><input value={form.location} onChange={event => patchForm({ location: event.target.value })} placeholder="Magasin principal" /></label>
              <label><span>Stock minimum</span><input value={form.minStock} onChange={event => patchForm({ minStock: event.target.value })} type="number" min="0" /></label>
              <label><span>Photo du produit</span><input type="file" accept="image/*" capture="environment" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label>
            </> : <>
              <label><span>Bâtiment / destination *</span><input value={form.buildingName} onChange={event => patchForm({ buildingName: event.target.value })} placeholder="Service Building" /></label>
              <label><span>Zone</span><input value={form.zoneName} onChange={event => patchForm({ zoneName: event.target.value })} /></label>
              <label><span>Entreprise</span><select value={form.companyId} onChange={event => patchForm({ companyId: event.target.value })}><option value="">Non renseignée</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
              <label><span>Personne</span><input value={form.personName} onChange={event => patchForm({ personName: event.target.value })} /></label>
            </>}
            <label className={styles.wide}><span>Commentaire</span><textarea value={form.comment} onChange={event => patchForm({ comment: event.target.value })} rows={3} /></label>
            {mode === 'out' && canAdjust && selectedProduct && numberValue(form.quantity) > numberValue(selectedProduct.current_stock) ? <label className={styles.checkbox}><input type="checkbox" checked={form.allowNegative} onChange={event => patchForm({ allowNegative: event.target.checked })} /><span>Autoriser exceptionnellement le stock négatif</span></label> : null}
          </div>
          <div className={styles.formActions}><button type="button" onClick={() => setMode('home')}>Annuler</button><button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : mode === 'in' ? "VALIDER L'ENTRÉE" : 'VALIDER LA SORTIE'}</button></div>
        </form>
      )}

      {editingProduct && canManage ? (
        <form className={styles.formCard} onSubmit={submitProductEdit}>
          <div className={styles.formHeading}>
            <div><span>Fiche produit</span><h3>Modifier {editingProduct.reference}</h3></div>
            <button type="button" className={styles.closeButton} onClick={closeProductEditor}>×</button>
          </div>
          <div className={styles.formGrid}>
            <label><span>Référence *</span><input value={editForm.reference} onChange={event => setEditForm(current => ({ ...current, reference: event.target.value }))} autoFocus /></label>
            <label><span>Code-barres / QR</span><input value={editForm.barcode} onChange={event => setEditForm(current => ({ ...current, barcode: event.target.value }))} /></label>
            <label className={styles.wide}><span>Désignation *</span><input value={editForm.designation} onChange={event => setEditForm(current => ({ ...current, designation: event.target.value }))} /></label>
            <label><span>Stock minimum</span><input value={editForm.minStock} onChange={event => setEditForm(current => ({ ...current, minStock: event.target.value }))} type="number" min="0" step="any" /></label>
            <label><span>Emplacement</span><input value={editForm.location} onChange={event => setEditForm(current => ({ ...current, location: event.target.value }))} /></label>
            <label><span>Fournisseur</span><input value={editForm.supplier} onChange={event => setEditForm(current => ({ ...current, supplier: event.target.value }))} /></label>
            <label><span>Nouvelle photo</span><input type="file" accept="image/*" capture="environment" onChange={event => setEditPhoto(event.target.files?.[0] ?? null)} /></label>
          </div>
          <div className={styles.formActions}><button type="button" onClick={closeProductEditor}>Annuler</button><button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'ENREGISTRER LA FICHE'}</button></div>
        </form>
      ) : null}

      {(mode === 'home' || mode === 'stock' || mode === 'history') && (
        <section className={styles.tableCard}>
          <div className={styles.tableToolbar}>
            <div><h3>{mode === 'history' ? 'Historique des mouvements' : mode === 'stock' ? 'Tableau de stock' : 'Stock chantier'}</h3><p>{mode === 'history' ? `${filteredMovements.length} mouvement(s)` : `${filteredProducts.length} référence(s)`}</p></div>
            <div className={styles.tableTools}>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher référence, produit, destination…" />
              {canExport ? <div className={styles.exportLanguage} role="radiogroup" aria-label={exportUiCopy.language}><span>{exportUiCopy.language}</span>{(['fr', 'en', 'es'] as const).map(language => <button key={language} type="button" role="radio" aria-checked={exportLanguage === language} className={exportLanguage === language ? styles.exportLanguageActive : ''} onClick={() => onExportLanguageChange(language)}>{language.toUpperCase()}</button>)}</div> : null}
              {canExport ? <button type="button" onClick={mode === 'history' ? exportHistory : exportStock}>{exportUiCopy.workbook}</button> : null}
              {canExport ? <button type="button" onClick={() => void printInventoryPdf()}>{exportUiCopy.pdf}</button> : null}
            </div>
          </div>
          {mode === 'history' ? (
            <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Désignation</th><th>Qté</th><th>Stock</th><th>Destination</th><th>Entreprise</th><th>Utilisateur</th><th>Commentaire</th></tr></thead><tbody>{filteredMovements.map(movement => <tr key={movement.id}><td>{movement.created_at ? new Date(movement.created_at).toLocaleString('fr-FR') : '—'}</td><td><span className={movement.movement_type === 'in' ? styles.inBadge : styles.outBadge}>{movement.movement_type === 'in' ? 'Entrée' : 'Sortie'}</span></td><td><strong>{movement.reference}</strong></td><td>{movement.designation}</td><td>{movement.movement_type === 'in' ? '+' : '−'}{movement.quantity}</td><td>{numberValue(movement.stock_before)} → {numberValue(movement.stock_after)}</td><td>{movement.building_name || movement.zone_name || '—'}</td><td>{movement.company_name || '—'}</td><td>{movement.user_name || '—'}</td><td>{movement.comment || '—'}</td></tr>)}</tbody></table>{!filteredMovements.length ? <p className={styles.empty}>Aucun mouvement enregistré.</p> : null}</div>
          ) : (
            <div className={styles.tableScroll}><table><thead><tr><th>Photo</th><th>Référence</th><th>Désignation</th><th>Stock</th><th>Entrées</th><th>Sorties</th><th>Minimum</th><th>Localisation</th><th>Actions</th></tr></thead><tbody>{filteredProducts.map(product => { const low = numberValue(product.current_stock) <= numberValue(product.min_stock); const photoUrl = privateMediaUrl(product.photo_url); return <tr key={product.id} className={low ? styles.lowRow : ''}><td>{photoUrl ? <img className={styles.productPhoto} src={photoUrl} alt="" /> : <span className={styles.photoPlaceholder}>▦</span>}</td><td><strong>{product.reference}</strong>{product.barcode ? <small>{product.barcode}</small> : null}</td><td>{product.designation || product.reference}</td><td><b className={low ? styles.lowStock : ''}>{numberValue(product.current_stock)}</b>{low ? <small className={styles.warning}>Stock faible</small> : null}</td><td>{numberValue(product.total_entries)}</td><td>{numberValue(product.total_exits)}</td><td>{numberValue(product.min_stock)}</td><td>{product.location || '—'}</td><td><div className={styles.rowActions}>{canRecord ? <button type="button" onClick={() => openMovement('in', product)}>+ Entrée</button> : null}{canRecord ? <button type="button" onClick={() => openMovement('out', product)}>− Sortie</button> : null}{canManage ? <button type="button" onClick={() => openProductEditor(product)}>Modifier</button> : null}</div></td></tr>; })}</tbody></table>{!filteredProducts.length ? <p className={styles.empty}>Aucun produit dans ce chantier.</p> : null}</div>
          )}
        </section>
      )}
    </div>
  );
}
