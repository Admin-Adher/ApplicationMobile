import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readProgress, progressDiff } from '../lib/plan-progress/core';

const api: any = {};
runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/geometry.js','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,{exports:api});
const base = [{x:100,y:100},{x:400,y:250},{x:550,y:450}];

describe('work geometry and precise progress',()=>{
  it('aligns the next elbow with the first segment on an inclined plan',()=>{
    const p=api.orthogonalPoint(base.slice(0,2),{x:360,y:400});
    expect((p.x-400)*300+(p.y-250)*150).toBeCloseTo(0,8);
    expect(p.x).not.toBe(400);expect(p.y).not.toBe(250);
    expect(api.orthogonalPoint(base.slice(0,1),base[1])).toEqual(base[1]);
  });
  it('creates a true rotated rectangle with four corners and the expected area',()=>{
    const points=api.orientedRectangle([{x:100,y:100},{x:400,y:250},{x:350,y:450}]);
    const a=points[0],b=points[1],c=points[2];
    expect((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)).toBeCloseTo(0,8);
    expect(api.polygonArea(points)).toBeCloseTo(67500,7);
    expect(api.geometryProblem('area',points)).toBe('');
  });
  it('moves one point by exactly one centimetre at the calibrated scale',()=>{
    const scale=.025,points=api.translatePoints(base,1,.01/scale,0,{width:1000,height:700});
    expect(points[1].x-base[1].x).toBeCloseTo(.4,10);
    expect(points[1].y).toBe(base[1].y);expect(points[0]).toEqual(base[0]);
    expect(base[1].x).toBe(400);
  });
  it('clamps a whole-work translation without changing its shape or section',()=>{
    const points=api.translatePoints(base,1,700,-300,{width:1000,height:700},true);
    expect(Math.max(...points.map((p: any)=>p.x))).toBe(1000);
    expect(Math.min(...points.map((p: any)=>p.y))).toBe(0);
    for(let i=1;i<base.length;i++)expect(api.distance(points[i-1],points[i])).toBeCloseTo(api.distance(base[i-1],base[i]),9);
  });
  it('rejects crossed, self-touching, flat and repeated-vertex surfaces',()=>{
    for(const points of [
      [{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}],
      [{x:0,y:0},{x:100,y:0},{x:50,y:50},{x:50,y:0},{x:0,y:100}],
      [{x:0,y:0},{x:50,y:0},{x:100,y:0}],
      [{x:0,y:0},{x:100,y:0},{x:100,y:0},{x:0,y:100}],
    ])expect(api.geometryProblem('area',points)).not.toBe('');
    expect(api.geometryProblem('line',base)).toBe('');
    expect(api.geometryProblem('point',[{x:1,y:2}])).toBe('');
  });
  it('inserts at the nearest segment, including the closing edge of a surface',()=>{
    const points=[{x:100,y:100},{x:400,y:100},{x:400,y:400},{x:100,y:400}];
    expect(api.closestSegment(points,{x:98,y:230},true).index).toBe(3);
    expect(api.closestSegment(points,{x:250,y:103},false).index).toBe(0);
  });
  it('keeps legacy 50% while respecting explicit zero and exact percentages',()=>{
    expect(api.progressWeight({status:'progress'})).toBe(.5);
    expect(api.progressWeight({status:'progress',progressPercent:0})).toBe(0);
    expect(api.progressWeight({status:'progress',progressPercent:37.5})).toBe(.375);
    expect(api.progressWeight({status:'installed',progressPercent:25})).toBe(1);
    expect(api.progressWeight({status:'checked'})).toBe(1);
  });
  it('validates optional percentages and sends precise progress as independent field changes',()=>{
    const element={id:'w',docId:'p',name:'Gaine',lotId:'["company",null]',status:'progress',kind:'line',page:1,points:base};
    const before={elements:[element],calibrations:{'p:1':.01},billed:{}};
    const after={...before,elements:[{...element,progressPercent:37.5}]};
    expect(readProgress(after)).toEqual(after);
    expect(progressDiff(before,after)).toEqual([{target:'elements',key:'w',before:{progressPercent:null},after:{progressPercent:37.5}}]);
    for(const progressPercent of [-1,101,NaN,Infinity,'25'])expect(()=>readProgress({...before,elements:[{...element,progressPercent}]})).toThrow();
  });
});
