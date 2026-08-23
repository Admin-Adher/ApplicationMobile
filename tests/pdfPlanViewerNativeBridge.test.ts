import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseNativePdfPlanBridgeMessage,
  serializeForInlineScript,
} from '../components/pdfPlanViewerNativeBridge';

const viewerSource = readFileSync(
  fileURLToPath(new URL('../components/PdfPlanViewer.tsx', import.meta.url).href),
  'utf8',
);

const validLine = {
  id: 'ann-safe-1',
  tool: 'line',
  points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
  color: '#EF4444',
  strokeWidth: 3,
  page: 2,
};

describe('native PDF plan WebView boundary', () => {
  it('neutralizes script terminators, HTML comments and JS line separators while preserving data', () => {
    const payload = {
      planUri: 'https://example.test/plan.pdf?</script><script>globalThis.pwned=1</script><!--',
      annotation: 'Gaine d’évacuation “A”\u2028niveau +1\u2029 & contrôle',
      pdfWorker: '</SCRIPT><img src=x onerror=alert(1)>',
    };

    const serialized = serializeForInlineScript(payload);

    expect(serialized).not.toMatch(/<\/script/i);
    expect(serialized).not.toContain('<!--');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(serialized).toContain('\\u003C');
    expect(serialized).toContain('\\u003E');
    expect(serialized).toContain('\\u0026');
    expect(JSON.parse(serialized)).toEqual(payload);

    const html = `<script>var DATA=${serialized};</script>`;
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html).not.toContain('globalThis.pwned=1</script>');
  });

  it('keeps legitimate Unicode, accents, quotes and annotation text intact', () => {
    const payload = {
      text: 'Réserve “façade nord” — Ø 125 mm / niveau R+2',
      quote: 'L\'équipe dit: "contrôlé"',
    };
    expect(JSON.parse(serializeForInlineScript(payload))).toEqual(payload);
  });

  it('accepts the legitimate bridge protocol and rejects forged drawing payloads', () => {
    const valid = parseNativePdfPlanBridgeMessage(JSON.stringify({
      type: 'annotationsChange',
      annotations: [validLine],
      canUndo: true,
      canRedo: false,
      canClear: true,
    }));

    expect(valid).toEqual({
      type: 'annotationsChange',
      annotations: [validLine],
      canUndo: true,
      canRedo: false,
      canClear: true,
    });

    expect(parseNativePdfPlanBridgeMessage(JSON.stringify({
      type: 'annotationsChange',
      annotations: [{ ...validLine, tool: 'script', text: '</script><script>alert(1)</script>' }],
      canUndo: true,
      canRedo: false,
      canClear: true,
    }))).toBeNull();
    expect(parseNativePdfPlanBridgeMessage(JSON.stringify({
      type: 'pinMove', reserveId: 'reserve-1', planX: Number.POSITIVE_INFINITY, planY: 30,
    }))).toBeNull();
    expect(parseNativePdfPlanBridgeMessage(JSON.stringify({
      type: 'annotationsChange',
      annotations: [{ ...validLine, points: [{ x: -1, y: 20 }, { x: 30, y: 101 }] }],
      canUndo: true,
      canRedo: false,
      canClear: true,
    }))).toBeNull();
    expect(parseNativePdfPlanBridgeMessage('{"type":"unknown"}')).toBeNull();
  });

  it('accepts only bounded, integral page change notifications', () => {
    expect(parseNativePdfPlanBridgeMessage('{"type":"pageChange","page":3}')).toEqual({
      type: 'pageChange',
      page: 3,
    });
    expect(parseNativePdfPlanBridgeMessage('{"type":"pageChange","page":0}')).toBeNull();
    expect(parseNativePdfPlanBridgeMessage('{"type":"pageChange","page":2.5}')).toBeNull();
    expect(parseNativePdfPlanBridgeMessage('{"type":"pageChange","page":100001}')).toBeNull();
  });

  it('uses the safe serializer for every value crossing the initial HTML script parser', () => {
    expect(viewerSource).toContain('const safePlanUri = serializeForInlineScript(planUri)');
    expect(viewerSource).toContain('const safeAnns = serializeForInlineScript(sanitizePlanDrawings(annotations ?? []))');
    expect(viewerSource).toContain('const safePins = serializeForInlineScript(pinsData)');
    expect(viewerSource).toContain('const safeGhostPins = serializeForInlineScript(ghostPinsData)');
    expect(viewerSource).toContain("const safePdfJsSource = serializeForInlineScript(pdfJsSource ?? '')");
    expect(viewerSource).toContain("const safePdfJsWorkerSource = serializeForInlineScript(pdfJsWorkerSource ?? '')");
    expect(viewerSource).toContain('const safeCopy = serializeForInlineScript(copy)');
    expect(viewerSource).toContain('var PLAN_URI=${safePlanUri};');
    expect(viewerSource).not.toContain('var PLAN_URI=${JSON.stringify(planUri)};');
  });

  it('keeps render, text, history and exported capture scoped to the active page', () => {
    expect(viewerSource).toContain('drawingsForPage(pageNum).forEach');
    expect(viewerSource).toContain('fontSize:14,page:pageNum');
    expect(viewerSource).toContain('window.redoAnnotation=function()');
    expect(viewerSource).toContain('replacePageDrawings(pageNum,[])');
    expect(viewerSource).toContain('new XMLSerializer().serializeToString(annSvg)');
    expect(viewerSource).toContain('var expectedAnnotationCount=drawingsForPage(pageNum).length;');
    expect(viewerSource).toContain("if(expectedAnnotationCount){post({type:'canvasCapture',dataUrl:null});return;}");
    expect(viewerSource).toContain("overlay.onerror=function(){URL.revokeObjectURL(objectUrl);post({type:'canvasCapture',dataUrl:null});};");
    expect(viewerSource).toContain('ctx.drawImage(overlay,0,0,out.width,out.height)');
    expect(viewerSource).toContain('Math.min(12,Math.round(h/Math.max(w/nx,0.15)))');
  });

  it('serializes page rendering and publishes the page only after the latest render wins', () => {
    expect(viewerSource).toContain('var renderRequestId=0;');
    expect(viewerSource).toContain("if(previousTask&&typeof previousTask.cancel==='function')");
    expect(viewerSource).toContain('if(requestId!==renderRequestId)return false;');
    expect(viewerSource).toContain('pageNum=num;');
    expect(viewerSource).toContain("post({type:'pageChange',page:pageNum});");
    expect(viewerSource).not.toContain('pageNum=n;renderPage();');
  });

  it('never resurrects a stale external snapshot after undo or clear', () => {
    expect(viewerSource).toContain(
      "if(!force&&hasLocalAnnotationChanges&&incomingSignature!==lastLocalAnnotationSignature)",
    );
    expect(viewerSource).toContain(
      'externalAnnotationSignature !== localAnnotationSignatureRef.current;',
    );
    expect(viewerSource).not.toContain('externalAnnotationCount < localAnnotationCountRef.current');
    expect(viewerSource).toContain('injectAnnotations(false);');
  });
});
