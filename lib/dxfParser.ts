export type DxfEntity =
  | { type: 'LINE'; x1: number; y1: number; x2: number; y2: number; layer: string }
  | { type: 'CIRCLE'; cx: number; cy: number; r: number; layer: string }
  | { type: 'ARC'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; layer: string }
  | { type: 'TEXT'; x: number; y: number; text: string; layer: string }
  | { type: 'LWPOLYLINE'; points: Array<{ x: number; y: number }>; closed: boolean; layer: string };

export interface DxfParseResult {
  entities: DxfEntity[];
  layers: string[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function parseDxfRecords(content: string): Array<{ code: number; value: string }> {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const records: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (!isNaN(code)) records.push({ code, value });
  }
  return records;
}

export function parseDxf(content: string): DxfParseResult {
  const records = parseDxfRecords(content);
  const entities: DxfEntity[] = [];

  let inEntities = false;
  let i = 0;

  while (i < records.length) {
    const rec = records[i];

    if (rec.code === 2 && rec.value === 'ENTITIES') {
      inEntities = true;
      i++;
      continue;
    }
    if (rec.code === 0 && rec.value === 'ENDSEC') {
      inEntities = false;
      i++;
      continue;
    }

    if (!inEntities) { i++; continue; }

    if (rec.code === 0) {
      const etype = rec.value;
      i++;

      if (etype === 'LINE') {
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0, layer = '0';
        while (i < records.length && records[i].code !== 0) {
          const r = records[i];
          if (r.code === 8) layer = r.value;
          if (r.code === 10) x1 = parseFloat(r.value);
          if (r.code === 20) y1 = parseFloat(r.value);
          if (r.code === 11) x2 = parseFloat(r.value);
          if (r.code === 21) y2 = parseFloat(r.value);
          i++;
        }
        entities.push({ type: 'LINE', x1, y1: -y1, x2, y2: -y2, layer });
      } else if (etype === 'CIRCLE') {
        let cx = 0, cy = 0, r = 0, layer = '0';
        while (i < records.length && records[i].code !== 0) {
          const rec2 = records[i];
          if (rec2.code === 8) layer = rec2.value;
          if (rec2.code === 10) cx = parseFloat(rec2.value);
          if (rec2.code === 20) cy = parseFloat(rec2.value);
          if (rec2.code === 40) r = parseFloat(rec2.value);
          i++;
        }
        entities.push({ type: 'CIRCLE', cx, cy: -cy, r, layer });
      } else if (etype === 'ARC') {
        let cx = 0, cy = 0, r = 0, startAngle = 0, endAngle = 360, layer = '0';
        while (i < records.length && records[i].code !== 0) {
          const rec2 = records[i];
          if (rec2.code === 8) layer = rec2.value;
          if (rec2.code === 10) cx = parseFloat(rec2.value);
          if (rec2.code === 20) cy = parseFloat(rec2.value);
          if (rec2.code === 40) r = parseFloat(rec2.value);
          if (rec2.code === 50) startAngle = parseFloat(rec2.value);
          if (rec2.code === 51) endAngle = parseFloat(rec2.value);
          i++;
        }
        entities.push({ type: 'ARC', cx, cy: -cy, r, startAngle, endAngle, layer });
      } else if (etype === 'TEXT' || etype === 'MTEXT') {
        let x = 0, y = 0, text = '', layer = '0';
        while (i < records.length && records[i].code !== 0) {
          const rec2 = records[i];
          if (rec2.code === 8) layer = rec2.value;
          if (rec2.code === 10) x = parseFloat(rec2.value);
          if (rec2.code === 20) y = parseFloat(rec2.value);
          if (rec2.code === 1) text = rec2.value;
          if (rec2.code === 3) text += rec2.value;
          i++;
        }
        if (text) entities.push({ type: 'TEXT', x, y: -y, text: text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, ''), layer });
      } else if (etype === 'LWPOLYLINE') {
        let layer = '0', flags = 0;
        const points: Array<{ x: number; y: number }> = [];
        let px = 0, hasPx = false;
        while (i < records.length && records[i].code !== 0) {
          const rec2 = records[i];
          if (rec2.code === 8) layer = rec2.value;
          if (rec2.code === 70) flags = parseInt(rec2.value, 10);
          if (rec2.code === 10) { px = parseFloat(rec2.value); hasPx = true; }
          if (rec2.code === 20 && hasPx) {
            points.push({ x: px, y: -parseFloat(rec2.value) });
            hasPx = false;
          }
          i++;
        }
        if (points.length >= 2) {
          entities.push({ type: 'LWPOLYLINE', points, closed: (flags & 1) !== 0, layer });
        }
      } else if (etype === 'POLYLINE') {
        let layer = '0', flags = 0;
        while (i < records.length && records[i].code !== 0) {
          const rec2 = records[i];
          if (rec2.code === 8) layer = rec2.value;
          if (rec2.code === 70) flags = parseInt(rec2.value, 10);
          i++;
        }
        const points: Array<{ x: number; y: number }> = [];
        while (i < records.length) {
          if (records[i].code === 0 && records[i].value === 'VERTEX') {
            i++;
            let vx = 0, vy = 0;
            while (i < records.length && records[i].code !== 0) {
              if (records[i].code === 10) vx = parseFloat(records[i].value);
              if (records[i].code === 20) vy = parseFloat(records[i].value);
              i++;
            }
            points.push({ x: vx, y: -vy });
          } else if (records[i].code === 0 && records[i].value === 'SEQEND') {
            i++;
            break;
          } else {
            break;
          }
        }
        if (points.length >= 2) {
          entities.push({ type: 'LWPOLYLINE', points, closed: (flags & 1) !== 0, layer });
        }
      } else {
        while (i < records.length && records[i].code !== 0) i++;
      }
    } else {
      i++;
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const e of entities) {
    if (e.type === 'LINE') {
      minX = Math.min(minX, e.x1, e.x2);
      minY = Math.min(minY, e.y1, e.y2);
      maxX = Math.max(maxX, e.x1, e.x2);
      maxY = Math.max(maxY, e.y1, e.y2);
    } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
      minX = Math.min(minX, e.cx - e.r);
      minY = Math.min(minY, e.cy - e.r);
      maxX = Math.max(maxX, e.cx + e.r);
      maxY = Math.max(maxY, e.cy + e.r);
    } else if (e.type === 'TEXT') {
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x);
      maxY = Math.max(maxY, e.y);
    } else if (e.type === 'LWPOLYLINE') {
      for (const p of e.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }

  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }

  const layerSet = new Set<string>();
  for (const e of entities) layerSet.add(e.layer);
  const layers = [...layerSet].sort();

  return {
    entities,
    layers,
    minX, minY, maxX, maxY,
    width: maxX - minX || 1,
    height: maxY - minY || 1,
  };
}

export function normalizeDxfPoint(
  x: number, y: number,
  dxf: DxfParseResult,
  canvasW: number, canvasH: number,
  padding = 12
): { x: number; y: number } {
  const scaleX = (canvasW - padding * 2) / dxf.width;
  const scaleY = (canvasH - padding * 2) / dxf.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = padding + (canvasW - padding * 2 - dxf.width * scale) / 2;
  const offsetY = padding + (canvasH - padding * 2 - dxf.height * scale) / 2;
  return {
    x: offsetX + (x - dxf.minX) * scale,
    y: offsetY + (y - dxf.minY) * scale,
  };
}
