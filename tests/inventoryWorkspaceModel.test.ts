import { describe, expect, it } from 'vitest';
import {
  buildInventoryProjection,
  inventoryCopy,
  inventoryLocale,
  isInventoryLowStock,
  type AuthorizedInventorySnapshot,
} from '../vercel-app/app/web/inventory-workspace/inventory-model';

const snapshot: AuthorizedInventorySnapshot = {
  projects: [
    { id: 'project-a', name: 'Tropicalia' },
    { id: 'project-b', name: 'Service Building' },
  ],
  companies: [],
  products: [
    { id: 'product-a', chantier_id: 'project-a', reference: 'ABC-12580', designation: 'Vanne DN25', current_stock: 8, min_stock: 10, total_entries: 35, total_exits: 27 },
    { id: 'product-b', chantier_id: 'project-b', reference: 'ELEC-02', designation: 'Disjoncteur', current_stock: 0, min_stock: 0 },
  ],
  movements: [
    { id: 'movement-a', chantier_id: 'project-a', product_id: 'product-a', movement_type: 'out', quantity: 2, reference: 'ABC-12580', designation: 'Vanne DN25', building_name: 'Villas', created_at: '2026-08-12T08:00:00.000Z' },
    { id: 'movement-b', chantier_id: 'project-b', product_id: 'product-b', movement_type: 'in', quantity: 4, reference: 'ELEC-02', designation: 'Disjoncteur', created_at: '2026-08-12T09:00:00.000Z' },
  ],
};

describe('BuildTrack inventory workspace model', () => {
  it('does not flag a zero-stock product when no minimum threshold is configured', () => {
    expect(isInventoryLowStock(snapshot.products[0])).toBe(true);
    expect(isInventoryLowStock(snapshot.products[1])).toBe(false);
  });

  it('keeps tenant-authorized rows separated by the selected project scope', () => {
    const projection = buildInventoryProjection({
      snapshot,
      selectedProjectId: 'project-a',
      search: '',
      language: 'fr',
      productFilter: 'all',
      movementFilter: 'all',
    });

    expect(projection.isAggregate).toBe(false);
    expect(projection.scopedProducts.map(product => product.id)).toEqual(['product-a']);
    expect(projection.scopedMovements.map(movement => movement.id)).toEqual(['movement-a']);
    expect(projection.totalUnits).toBe(8);
  });

  it('makes project identity searchable and explicit in the aggregate scope', () => {
    const projection = buildInventoryProjection({
      snapshot,
      selectedProjectId: 'all',
      search: 'service building',
      language: 'en',
      productFilter: 'all',
      movementFilter: 'all',
    });

    expect(projection.isAggregate).toBe(true);
    expect(projection.projectNames.get('project-b')).toBe('Service Building');
    expect(projection.filteredProducts.map(product => product.id)).toEqual(['product-b']);
    expect(projection.filteredMovements.map(movement => movement.id)).toEqual(['movement-b']);
  });

  it('combines text and status filters without changing the authorized snapshot', () => {
    const projection = buildInventoryProjection({
      snapshot,
      selectedProjectId: 'all',
      search: 'vanne',
      language: 'fr',
      productFilter: 'low',
      movementFilter: 'out',
    });

    expect(projection.filteredProducts.map(product => product.id)).toEqual(['product-a']);
    expect(projection.filteredMovements.map(movement => movement.id)).toEqual(['movement-a']);
    expect(snapshot.products).toHaveLength(2);
  });

  it('ships complete FR, EN and ES workspace copy with stable locales', () => {
    expect(inventoryCopy('fr').title).toBe('Stock & mouvements');
    expect(inventoryCopy('en').receiveTitle).toBe('Record a receipt');
    expect(inventoryCopy('es').dispatchTitle).toBe('Registrar una salida');
    expect([inventoryLocale('fr'), inventoryLocale('en'), inventoryLocale('es')]).toEqual(['fr-FR', 'en-GB', 'es-ES']);
  });
});
