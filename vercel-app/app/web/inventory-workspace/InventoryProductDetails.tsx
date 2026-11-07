'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { inventoryCopy, inventoryLocale, numberValue, type InventoryLanguage, type InventoryMovementRow, type InventoryProductRow } from './inventory-model';
import styles from './InventoryWorkspace.module.css';

export default function InventoryProductDetails({ product, movements, language, photo, onClose, onEdit, onReceive, onDispatch }: {
  product: InventoryProductRow;
  movements: InventoryMovementRow[];
  language: InventoryLanguage;
  photo: ReactNode;
  onClose: () => void;
  onEdit?: () => void;
  onReceive?: () => void;
  onDispatch?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copy = inventoryCopy(language);
  const locale = inventoryLocale(language);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [product.id]);

  const facts = [
    [copy.currentStock, numberValue(product.current_stock).toLocaleString(locale)],
    [copy.minimum, numberValue(product.min_stock).toLocaleString(locale)],
    [copy.supplier, product.supplier || '—'],
    [copy.location, product.location || copy.unstored],
    [copy.barcode, product.barcode || '—'],
    [copy.entries, numberValue(product.total_entries).toLocaleString(locale)],
    [copy.exits, numberValue(product.total_exits).toLocaleString(locale)],
  ];
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="inventory-product-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className={styles.dialogHeading}>
        <div><span>{product.reference}</span><h3 id="inventory-product-title">{copy.productSheet}</h3><p>{product.designation}</p></div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label={copy.close} autoFocus>×</button>
      </header>
      <div className={styles.productDetailsBody}>
        {photo}
        <dl className={styles.cardFacts}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {(onEdit || onReceive || onDispatch) && <div className={styles.cardActions}>
          {onEdit && <button type="button" onClick={onEdit}>{copy.edit}</button>}
          {onReceive && <button type="button" onClick={onReceive}>{copy.receive}</button>}
          {onDispatch && <button type="button" onClick={onDispatch}>{copy.dispatch}</button>}
        </div>}
        <h4>{copy.historyTitle}</h4>
        {movements.map(movement => <article key={movement.id} className={styles.movementCard}>
          <div className={styles.cardTopline}>
            <strong>{movement.movement_type === 'in' ? copy.receive : copy.dispatch}</strong>
            <time>{movement.created_at ? new Date(movement.created_at).toLocaleString(locale) : '—'}</time>
          </div>
          <p>{copy.quantity} · {numberValue(movement.quantity).toLocaleString(locale)} · {numberValue(movement.stock_before).toLocaleString(locale)} → {numberValue(movement.stock_after).toLocaleString(locale)}</p>
          <p>{[movement.building_name, movement.zone_name, movement.company_name, movement.person_name, movement.user_name, movement.location].filter(Boolean).join(' · ')}</p>
          {movement.comment && <p>{movement.comment}</p>}
        </article>)}
        {!movements.length && <p>{copy.noMovements}</p>}
      </div>
    </dialog>
  );
}
