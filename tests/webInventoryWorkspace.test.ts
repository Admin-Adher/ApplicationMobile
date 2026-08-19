import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web inventory workspace', () => {
  it('owns Stock behind one authorized snapshot and capability interface', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const model = read('vercel-app/app/web/inventory-workspace/inventory-model.ts');
    const operations = read('vercel-app/app/web/inventory-workspace/inventory-operations.ts');

    expect(page).toContain("import InventoryWorkspace from './inventory-workspace/InventoryWorkspace'");
    expect(page).toContain('<InventoryWorkspace');
    expect(page).toContain('snapshot={{');
    expect(page).toContain('capabilities={{');
    expect(page).not.toContain('<InventoryWebView');
    expect(page).not.toContain('organizationId={profile?.organization_id}');
    expect(model).toContain('AuthorizedInventorySnapshot');
    expect(model).toContain('InventoryCapabilities');
    expect(workspace).not.toContain('supabaseBrowser');
    expect(workspace).toContain('recordInventoryMovement({');
    expect(operations).toContain("'record_inventory_movement'");
    expect(operations).toContain("'update_inventory_product'");
    expect(operations).toContain("'admin_delete_inventory_product'");
    expect(operations).toContain('p_operation_id: input.operationId');
    expect(page).toContain('canDelete: isAdmin(profile)');
    expect(workspace).toContain('capabilities.canDelete');
    expect(workspace).toContain('deleteInventoryProduct');
  });

  it('makes aggregate project identity and row-scoped operations explicit', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const model = read('vercel-app/app/web/inventory-workspace/inventory-model.ts');

    expect(workspace).toContain('product?.chantier_id ?? (projection.isAggregate');
    expect(workspace).toContain('value={operationProjectId}');
    expect(workspace).toContain('projection.isAggregate ? <th>{copy.project}</th>');
    expect(workspace).toContain('<ProjectTag name={projection.projectNames.get');
    expect(model).toContain("const isAggregate = selectedProjectId === 'all'");
  });

  it('closes camera resources on every navigation seam and uses the chosen UI language for lookup', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');

    expect(workspace).toMatch(/function transitionToMode[\s\S]*?stopScanner\(\);[\s\S]*?setMode\(nextMode\)/);
    expect(workspace).toMatch(/function openMovement[\s\S]*?stopScanner\(\)/);
    const operations = read('vercel-app/app/web/inventory-workspace/inventory-operations.ts');
    expect(workspace).toContain('lookupInventoryBarcode(rawValue, language)');
    expect(operations).toContain('body: JSON.stringify({ code, language })');
    expect(workspace).not.toContain('navigator.language');
    expect(workspace).toContain('stream?.getTracks().forEach(track => track.stop())');
  });

  it('guides destination selection from the project hierarchy and persists stable identifiers', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const destinationModel = read('lib/inventoryDestinationModel.ts');

    expect(workspace).toContain('createInventoryDestinationCatalog(operationProject?.buildings)');
    expect(workspace).toContain('disabled={!form.destination.buildingId}');
    expect(workspace).toContain("type: 'select-building'");
    expect(workspace).toContain("type: 'select-zone'");
    expect(workspace).toContain('...movementDestination');
    expect(destinationModel).toContain('building_id: destination.buildingId?.trim() || null');
    expect(destinationModel).toContain('zone_id: destination.zoneId?.trim() || null');
  });

  it('captures the same building and zone data for receipts and dispatches', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const entryFields = workspace.indexOf("{mode === 'in' ? <>", workspace.indexOf('className={styles.formGrid}'));
    const sharedDestination = workspace.indexOf('id="inventory-destination-flow-hint"');
    const dispatchFields = workspace.indexOf("{mode === 'out' ? <>", sharedDestination);

    expect(entryFields).toBeGreaterThan(-1);
    expect(sharedDestination).toBeGreaterThan(entryFields);
    expect(dispatchFields).toBeGreaterThan(sharedDestination);
    expect(workspace).toContain("{mode === 'in' ? copy.entryDestinationHint : copy.exitDestinationHint}");
    expect(workspace).toContain("inventoryDestinationPolicy(mode === 'out' ? 'out' : 'in')");
    expect(workspace).toContain('required={destinationPolicy.buildingRequired}');
    expect(workspace).toContain('disabled={!form.destination.buildingName.trim()}');
    expect(workspace).toContain("movement_type: mode");
    expect(workspace).toContain('...movementDestination');
    expect(workspace).toContain('movementDestinationLabel(movement)');
  });

  it('uses responsive cards, restrained BuildTrack styling and accessible controls', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const css = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.module.css');

    expect(workspace).toContain('data-testid="inventory-stock-cards"');
    expect(workspace).toContain('data-testid="inventory-history-cards"');
    expect(workspace).toContain('htmlFor="inventory-reference"');
    expect(workspace).toContain('aria-modal="true"');
    expect(workspace).toContain('role="radiogroup"');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container inventory (max-width: 68rem)');
    expect(css).toContain('@container inventory (max-width: 44rem)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });
});
