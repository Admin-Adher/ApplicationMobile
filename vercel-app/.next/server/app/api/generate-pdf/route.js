"use strict";(()=>{var a={};a.id=474,a.ids=[474],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},301:(a,b,c)=>{c.d(b,{Cx:()=>k,E3:()=>l,ER:()=>d,Kj:()=>e,RE:()=>h,To:()=>i,_z:()=>g,b:()=>f,j1:()=>j});let d={open:"Ouvert",in_progress:"En cours",waiting:"En attente",verification:"V\xe9rification",closed:"Cl\xf4tur\xe9"},e={open:"Ouverte",in_progress:"En cours",waiting:"En attente",verification:"V\xe9rification",closed:"Cl\xf4tur\xe9e"},f={open:"#DC2626",in_progress:"#2563EB",waiting:"#D97706",verification:"#7C3AED",closed:"#059669"},g={critical:"Critique",high:"Haute",medium:"Moyenne",low:"Basse"},h={critical:"#DC2626",high:"#EA580C",medium:"#D97706",low:"#6B7280"};function i(a,b=!1){return a?(b?e:d)[a]??a:"—"}function j(a){return a?g[a]??a:"—"}function k(a){return a?f[a]??"#6B7280":"#6B7280"}function l(a){return a?h[a]??"#6B7280":"#6B7280"}},846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},1630:a=>{a.exports=require("http")},1645:a=>{a.exports=require("net")},1820:a=>{a.exports=require("os")},1941:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>V,patchFetch:()=>U,routeModule:()=>Q,serverHooks:()=>T,workAsyncStorage:()=>R,workUnitAsyncStorage:()=>S});var d={};c.r(d),c.d(d,{OPTIONS:()=>O,POST:()=>P,maxDuration:()=>G});var e=c(5736),f=c(9117),g=c(4044),h=c(9326),i=c(2324),j=c(261),k=c(4290),l=c(5328),m=c(8928),n=c(6595),o=c(3421),p=c(7679),q=c(1681),r=c(3446),s=c(6439),t=c(1356),u=c(641),v=c(301),w=c(8847);function x(a){return null==a?"":String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let y=v.ER,z=v.b,A=v._z,B=v.RE;function C(a){return null==a?"":String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var D=c(3496),E=c(2457),F=c(7854);let G=60,H=["https://buildtrack-mobile.vercel.app","http://localhost:5000","http://localhost:3000"];function I(a,b=[]){let c=[a,...b].map(a=>(function(a,b="document"){return String(a??b).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/['\u2019`]/g,"").replace(/&/g," et ").replace(/[^a-zA-Z0-9._-]+/g,"_").replace(/_+/g,"_").replace(/^_+|_+$/g,"").slice(0,48).replace(/^_+|_+$/g,"")||b})(a,"")).filter(Boolean);return`${c.length>0?c.join("_"):"Document"}.pdf`}function J(a){return{"Access-Control-Allow-Origin":H.includes(a)?a:H[0],"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}}async function K(a,b){let c=function(){let a=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.EXPO_PUBLIC_SUPABASE_URL,b=process.env.SUPABASE_SERVICE_ROLE_KEY;return a&&b?(0,E.UU)(a,b,{auth:{autoRefreshToken:!1,persistSession:!1}}):null}(),d=String(a??"").trim().toLowerCase();if(!c||!d)return(0,F.C9)(b);let{data:e,error:f}=await c.from("profiles").select("preferred_language").eq("email",d).maybeSingle();return f?(console.warn("[generate-pdf] preferred_language indisponible:",f.message),(0,F.C9)(b)):(0,F.C9)(e?.preferred_language??b)}let L={fr:{hello:"Bonjour,",individualTitle:"Fiche de r\xe9serve",individualSubject:(a,b)=>`Fiche r\xe9serve — ${a} (${b})`,individualIntro:a=>`Veuillez trouver ci-joint la fiche de r\xe9serve <strong>${a}</strong>.`,status:"Statut",building:"B\xe2timent",level:"Niveau",allCompanies:"Toutes les entreprises",reportSubject:(a,b,c)=>`Rapport des ${a} — ${b} (${c})`,reportTitle:a=>`Rapport des ${a}`,reportIntro:(a,b,c,d)=>`Veuillez trouver ci-joint le rapport des ${a} pour <strong>${b}</strong> (${c}), g\xe9n\xe9r\xe9 le ${d}.`,reserveCount:a=>`r\xe9serve${1!==a?"s":""} export\xe9e${1!==a?"s":""}`,reservesKind:"r\xe9serves",plansKind:"plans"},en:{hello:"Hello,",individualTitle:"Issue sheet",individualSubject:(a,b)=>`Issue sheet — ${a} (${b})`,individualIntro:a=>`Please find attached the issue sheet for <strong>${a}</strong>.`,status:"Status",building:"Building",level:"Level",allCompanies:"All companies",reportSubject:(a,b,c)=>`${a} report — ${b} (${c})`,reportTitle:a=>`${a} report`,reportIntro:(a,b,c,d)=>`Please find attached the ${a.toLowerCase()} report for <strong>${b}</strong> (${c}), generated on ${d}.`,reserveCount:a=>`${1===a?"issue":"issues"} exported`,reservesKind:"Issues",plansKind:"Plans"},es:{hello:"Hola,",individualTitle:"Ficha de reserva",individualSubject:(a,b)=>`Ficha de reserva — ${a} (${b})`,individualIntro:a=>`Adjuntamos la ficha de reserva <strong>${a}</strong>.`,status:"Estado",building:"Edificio",level:"Nivel",allCompanies:"Todas las empresas",reportSubject:(a,b,c)=>`Informe de ${a} — ${b} (${c})`,reportTitle:a=>`Informe de ${a}`,reportIntro:(a,b,c,d)=>`Adjuntamos el informe de ${a} para <strong>${b}</strong> (${c}), generado el ${d}.`,reserveCount:a=>`${1===a?"reserva exportada":"reservas exportadas"}`,reservesKind:"reservas",plansKind:"planos"}},M={fr:"fr-FR",en:"en-GB",es:"es-ES"},N={fr:{},en:{open:"Open",in_progress:"In progress",waiting:"Pending",verification:"Verification",closed:"Closed"},es:{open:"Abierta",in_progress:"En curso",waiting:"En espera",verification:"Verificaci\xf3n",closed:"Cerrada"}};async function O(a){let b=a.headers.get("origin")??"";return new u.NextResponse(null,{status:204,headers:J(b)})}async function P(a){let b=J(a.headers.get("origin")??"");try{let d,e,f,g=await a.json(),h=g.type??"plans";if("global_reserves"===h){if(!g.chantierName||!Array.isArray(g.reserves))return u.NextResponse.json({success:!1,error:"Payload invalide (global_reserves)"},{status:400,headers:b});d=function(a){let{chantierName:b,companyFilter:c,generatedAt:d,reserves:e}=a,f=new Date(d||Date.now()).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}),g=v.ER,h=v.b,i=v._z,j=v.RE,k={};for(let a of e)k[a.status]=(k[a.status]??0)+1;let l=e.length,m={};for(let a of e)for(let b of Array.isArray(a.companies)&&a.companies.length>0?a.companies:a.company?[a.company]:["—"])m[b]||(m[b]={total:0,closed:0}),m[b].total++,"closed"===a.status&&m[b].closed++;let n=Object.entries(m).sort((a,b)=>b[1].total-a[1].total).map(([a,b])=>{let c=b.total>0?Math.round(b.closed/b.total*100):0,d=c>=80?"#059669":c>=50?"#D97706":"#DC2626";return`<tr>
        <td style="padding:7px 12px;font-weight:600">${x(a)}</td>
        <td style="padding:7px 12px;text-align:center">${b.total}</td>
        <td style="padding:7px 12px;text-align:center;color:#22c55e;font-weight:700">${b.closed}</td>
        <td style="padding:7px 12px;text-align:center">
          <span style="background:${d}18;color:${d};padding:2px 8px;border-radius:8px;font-weight:700;font-size:11px">${c}%</span>
        </td>
      </tr>`}).join(""),o=["open","in_progress","waiting","verification","closed"].map(a=>{let b=k[a]??0;if(!b)return"";let c=h[a];return`<div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 16px;border:1px solid #e2e8f0;min-width:80px">
      <div style="font-size:22px;font-weight:800;color:${c}">${b}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">${g[a]}</div>
    </div>`}).join(""),p=[...e].sort((a,b)=>{let c={open:0,in_progress:1,waiting:2,verification:3,closed:4};return(c[a.status]??9)-(c[b.status]??9)}).map((a,b)=>{let c=h[a.status]??"#6b7280",d=j[a.priority]??"#6b7280",e=Array.isArray(a.companies)&&a.companies.length>0?a.companies:a.company?[a.company]:["—"];return`<tr style="background:${b%2==0?"#ffffff":"#f9fafb"}">
        <td style="text-align:center;width:36px;padding:6px 8px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:10px">${b+1}</span>
        </td>
        <td style="padding:6px 8px;font-weight:600;font-size:11px">${x(a.title)}</td>
        <td style="padding:6px 8px;font-size:11px">${e.map(a=>x(a)).join(", ")}</td>
        <td style="padding:6px 8px;font-size:11px">B\xe2t. ${x(a.building||"?")} \xb7 ${x(a.level||"—")}</td>
        <td style="padding:6px 8px"><span style="color:${c};font-weight:600;font-size:10px">${g[a.status]??a.status}</span></td>
        <td style="padding:6px 8px"><span style="color:${d};font-weight:600;font-size:10px">${i[a.priority]??a.priority}</span></td>
        <td style="padding:6px 8px;font-size:11px">${x(a.deadline)||"—"}</td>
      </tr>`}).join(""),q=e.filter(a=>Array.isArray(a.photos)&&a.photos.length>0).slice(0,20).map((a,b)=>{let c=Array.isArray(a.companies)&&a.companies.length>0?a.companies:a.company?[a.company]:[],d=a.photos.slice(0,3).map(a=>`<img src="${x(a.uri)}" style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0" onerror="this.style.opacity='0.1'"/>`).join("");return`<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="background:#f8fafc;padding:8px 12px;font-size:11px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0">
          <span style="color:#003082">#${b+1}</span> ${x(a.title)}
          <span style="color:#94a3b8;font-weight:400;margin-left:8px">— ${c.map(a=>x(a)).join(", ")||"—"} \xb7 B\xe2t. ${x(a.building||"?")}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px">${d}</div>
      </div>`}).join("");return`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport R\xe9serves — ${x(b)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
  </style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:24px 28px;border-radius:8px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.75;margin-bottom:4px">BuildTrack \xb7 Rapport des r\xe9serves</div>
    <div style="font-size:22px;font-weight:800;margin-bottom:2px">${x(b)}</div>
    <div style="font-size:13px;opacity:0.8">${x(c??"Toutes les entreprises")} \xb7 G\xe9n\xe9r\xe9 le ${f}</div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 20px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:#003082">${l}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">Total r\xe9serves</div>
    </div>
    ${o}
  </div>
  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">R\xe9capitulatif par entreprise</div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 12px;text-align:left;font-size:10px">Entreprise</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Total</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Cl\xf4tur\xe9es</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Taux cl\xf4ture</th>
      </tr></thead>
      <tbody>${n}</tbody>
    </table>
  </div>
  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">
      Liste d\xe9taill\xe9e (${l} r\xe9serve${1!==l?"s":""})
    </div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Titre</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Entreprise</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Localisation</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Statut</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Priorit\xe9</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">\xc9ch\xe9ance</th>
      </tr></thead>
      <tbody>${p}</tbody>
    </table>
  </div>
  ${q?`<div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">Photos</div>
    ${q}
  </div>`:""}
  <div style="margin-top:24px;padding-top:12px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
    <span>G\xe9n\xe9r\xe9 par BuildTrack</span>
    <span>${x(b)} \xb7 ${f}</span>
  </div>
</body>
</html>`}(g)}else if("individual_reserve"===h){if(!g.reserve||!g.chantierName)return u.NextResponse.json({success:!1,error:"Payload invalide (individual_reserve)"},{status:400,headers:b});d=function(a){let{reserve:b,chantierName:c,companyColor:d,planUri:e,planX:f,planY:g,planName:h,pinNum:i}=a,j=v.b,k=v.Kj,l=v.RE,m=v._z,n=d||"#003082",o=j[b.status]??"#6B7280",p=k[b.status]??b.status,q=l[b.priority]??"#6B7280",r=m[b.priority]??b.priority,s=Array.isArray(b.companies)&&b.companies.length>0?b.companies:b.company?[b.company]:[],t=new Date().toLocaleDateString("fr-FR"),u="";u=e&&null!=f&&null!=g?`
      <div style="margin-bottom:10px">
        <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">Plan de localisation — ${x(h||"Plan")}</div>
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE">
          <img src="${x(e)}" style="width:100%;height:auto;display:block" onerror="this.style.display='none'"/>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%">
            <circle cx="${f}" cy="${g}" r="2.2" fill="${n}" stroke="#fff" stroke-width="0.55"/>
            <text x="${f}" y="${g}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="3.5" font-weight="bold" font-family="Arial,sans-serif">${i||1}</text>
          </svg>
        </div>
      </div>`:`<div style="width:100%;height:100px;border-radius:8px;border:1.5px dashed #DDE4EE;background:#F9FAFB;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:11px;color:#9CA3AF">Aucun plan associ\xe9</div>`;let y=(Array.isArray(b.photos)&&b.photos.length>0?b.photos:b.photoUri?[{uri:b.photoUri,kind:"defect"}]:[]).slice(0,3).filter(a=>a.uri&&a.uri.startsWith("http")),z=y.length>0?`
    <div style="margin-top:10px">
      <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">Photos (${y.length})</div>
      <div style="display:flex;gap:8px">
        ${y.map(a=>{let b="defect"===a.kind;return`<div style="flex:1;min-width:0;text-align:center">
            <img src="${x(a.uri)}" onerror="this.style.opacity='0.15'"
              style="width:100%;height:auto;max-height:240px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block"/>
            <span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${b?"#FEF2F2":"#ECFDF5"};color:${b?"#DC2626":"#059669"}">
              ${b?"● Constat":"● Lev\xe9e"}
            </span>
          </div>`}).join("")}
      </div>
    </div>`:"",A=[...b.history||[]].reverse().slice(0,5).map(a=>`<tr>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;white-space:nowrap">${x(a.createdAt)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;font-weight:600">${x(a.action)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;color:#6B7280">${x(a.author)}</td>
      ${a.oldValue&&a.newValue?`<td style="padding:4px 8px;font-size:9px;color:#6B7280;border-bottom:1px solid #EEF3FA">${x(a.oldValue)} → ${x(a.newValue)}</td>`:"<td></td>"}
    </tr>`).join("");return`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Fiche r\xe9serve ${x(b.id)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 11px; line-height: 1.4; }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    .container { padding: 0; max-width: 780px; margin: 0 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #003082; padding-bottom: 10px; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 9px; font-weight: 700; }
    .col2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .info-cell { background: #F4F7FB; border-radius: 6px; padding: 7px 10px; border: 1px solid #DDE4EE; }
    .lbl { font-size: 8px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
    .val { font-size: 11px; color: #1A2742; font-weight: 600; }
    .desc-box { background: #F4F7FB; border-radius: 6px; padding: 8px 12px; border-left: 3px solid #003082; margin-bottom: 10px; font-size: 11px; line-height: 1.5; }
    .sh { font-size: 9px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px; padding-bottom: 4px; border-bottom: 1px solid #DDE4EE; margin-bottom: 6px; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead th { background: #003082; color: #fff; padding: 5px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
    tbody td { padding: 4px 8px; border-bottom: 1px solid #EEF3FA; vertical-align: top; }
    tbody tr:nth-child(even) { background: #F9FAFB; }
    .doc-footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #DDE4EE; display: flex; justify-content: space-between; font-size: 8px; color: #9CA3AF; }
  </style></head>
  <body><div class="container">
    <div class="top-bar">
      <div>
        <div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Fiche de r\xe9serve \xb7 BuildTrack</div>
        <div style="font-size:22px;font-weight:900;color:#003082;line-height:1">${x(b.id)}</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742;margin-top:2px">${x(b.title)}</div>
        <div style="font-size:10px;color:#6B7280">${x(c)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
          <span class="badge" style="background:${o}22;color:${o}">${p}</span>
          <span class="badge" style="background:${q}18;color:${q}">${r}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:10px;color:#6B7280;flex-shrink:0;margin-left:16px">
        <div>Cr\xe9\xe9 le <strong style="color:#1A2742">${x(b.createdAt)}</strong></div>
        ${b.closedAt?`<div style="color:#059669;margin-top:2px;font-weight:700">✓ Cl\xf4tur\xe9 le ${x(b.closedAt)}</div>`:""}
        <div style="margin-top:4px">\xc9ch\xe9ance : <strong>${x(b.deadline||"—")}</strong></div>
        <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${t}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">Entreprise${s.length>1?"s":""}</div>
            <div class="val" style="color:${n}">${s.map(a=>x(a)).join(", ")||"—"}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Localisation</div>
            <div class="val">B\xe2t. ${x(b.building)} \xb7 ${x(b.level)}</div>
          </div>
        </div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">Zone</div>
            <div class="val">${x(b.zone||"—")}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">\xc9ch\xe9ance</div>
            <div class="val" style="color:${"closed"!==b.status?"#DC2626":"#059669"}">${x(b.deadline||"—")}</div>
          </div>
        </div>
        <div class="desc-box">${x((0,w.s)(b.description,b.title))}</div>
        ${z}
      </div>
      <div>${u}</div>
    </div>
    ${A?`<div class="sh">Historique</div>
    <table><thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>D\xe9tail</th></tr></thead>
    <tbody>${A}</tbody></table>`:""}
    <div style="margin-top:16px;display:flex;gap:20px">
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">Conducteur de travaux</div></div>
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">${s.map(a=>x(a)).join(", ")||"Entreprise"}</div></div>
    </div>
    <div class="doc-footer">
      <span>Fiche r\xe9serve \xb7 BuildTrack</span>
      <span>${x(c)} \xb7 ${t}</span>
    </div>
  </div></body></html>`}(g)}else{if(!g.chantierName||!Array.isArray(g.reserves)||!Array.isArray(g.plans))return u.NextResponse.json({success:!1,error:"Payload invalide (plans)"},{status:400,headers:b});d=function(a){let{chantierName:b,companyFilter:c,generatedAt:d,plans:e,reserves:f}=a,g=new Map,h=[];for(let a of f)a.planId?(g.has(a.planId)||g.set(a.planId,[]),g.get(a.planId).push(a)):h.push(a);let i=new Set(g.keys()),j=e.filter(a=>i.has(a.id)),k=new Set;for(let a of j)k.add(a.building??"");let l=Array.from(k).sort((a,b)=>a||b?a?b?a.localeCompare(b,"fr"):-1:1:0),m=[];for(let a of l){let b=j.filter(b=>(b.building??"")===a),c=a||"Sans b\xe2timent",d=[],e=0;for(let a of b){let b=g.get(a.id)??[];0!==b.length&&(e+=b.length,d.push(function(a,b){let c=a.level?`<span style="font-size:11px;background:#e2e8f0;color:#64748b;padding:2px 8px;border-radius:10px;margin-left:8px">${C(a.level)}</span>`:"",d="";if(a.uri&&"pdf"!==a.fileType&&"dxf"!==a.fileType){let c=b.filter(a=>null!=a.planX&&null!=a.planY).map((a,b)=>`
        <circle cx="${a.planX}%" cy="${a.planY}%" r="10"
          fill="#003082" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>
        <text x="${a.planX}%" y="${a.planY}%"
          text-anchor="middle" dominant-baseline="central"
          fill="#fff" font-size="9" font-weight="bold" font-family="Arial,sans-serif">${b+1}</text>`).join("");d=`
      <div style="position:relative;width:100%;margin:12px 0">
        <img src="${C(a.uri)}"
          style="width:100%;height:auto;display:block;border-radius:6px;border:1px solid #e2e8f0"
          onerror="this.style.display='none'"/>
        ${c?`<svg xmlns="http://www.w3.org/2000/svg"
              style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${c}</svg>`:""}
      </div>`}let e=b.map((a,b)=>(function(a,b){let c=z[a.status]??"#6b7280",d=B[a.priority]??"#6b7280";return`<tr style="background:${b%2==0?"#ffffff":"#f9fafb"}">
    <td style="text-align:center;width:36px;padding:7px 10px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:11px">${b+1}</span>
    </td>
    <td style="padding:7px 10px;font-weight:600">${C(a.title)}</td>
    <td style="padding:7px 10px">${C(a.company)||"—"}</td>
    <td style="padding:7px 10px">${C(a.level)||"—"}</td>
    <td style="padding:7px 10px"><span style="color:${c};font-weight:600">${y[a.status]??a.status}</span></td>
    <td style="padding:7px 10px"><span style="color:${d};font-weight:600">${A[a.priority]??a.priority}</span></td>
    <td style="padding:7px 10px">${C(a.deadline)||"—"}</td>
  </tr>`})(a,b)).join(""),f=b.filter(a=>a.photos&&a.photos.length>0).map((a,b)=>{let c=a.photos.slice(0,2).map(a=>`<img src="${C(a.uri)}"
          style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0"
          onerror="this.style.opacity='0.15'"/>`).join("");return`<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9">
        <div style="font-size:10px;color:#64748b;margin-bottom:5px;font-weight:600">
          #${b+1} ${C(a.title)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${c}</div>
      </div>`}).join("");return`
    <div style="background:#fff;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:14px;overflow:hidden">
      <div style="background:#f8fafc;padding:10px 16px;font-size:12px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px">
        📐 ${C(a.name)}${c}
        <span style="margin-left:auto;font-size:11px;color:#94a3b8;font-weight:400">
          ${b.length} r\xe9serve${1!==b.length?"s":""}
        </span>
      </div>
      ${d?`<div style="padding:12px 16px">${d}</div>`:""}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        ${function(a="#003082"){return`<thead><tr style="background:${a}">
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">#</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Titre</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Entreprise</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Niveau</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Statut</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Priorit\xe9</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">\xc9ch\xe9ance</th>
  </tr></thead>`}()}
        <tbody>${e}</tbody>
      </table>
      ${f?`<div style="background:#f8fafc;padding:8px 12px;font-size:10px;font-weight:700;color:#475569;border-top:1px solid #e2e8f0">
            📷 Photos
           </div>${f}`:""}
    </div>`}(a,b)))}0!==e&&m.push(`
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          🏗️ ${C(c)}
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${e} r\xe9serve${1!==e?"s":""}
          </span>
        </div>
        ${d.join("")}
      </div>`)}let n="";if(h.length>0){let a=h.map((a,b)=>{let c=z[a.status]??"#6b7280",d=B[a.priority]??"#6b7280";return`<tr style="background:${b%2==0?"#fff":"#f9fafb"}">
          <td style="text-align:center;width:36px;padding:7px 10px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#475569;color:#fff;font-weight:700;font-size:11px">${b+1}</span>
          </td>
          <td style="padding:7px 10px;font-weight:600">${C(a.title)}</td>
          <td style="padding:7px 10px">${C(a.company)||"—"}</td>
          <td style="padding:7px 10px">${C(a.building)||"—"}</td>
          <td style="padding:7px 10px">${C(a.level)||"—"}</td>
          <td style="padding:7px 10px"><span style="color:${c};font-weight:600">${y[a.status]??a.status}</span></td>
          <td style="padding:7px 10px"><span style="color:${d};font-weight:600">${A[a.priority]??a.priority}</span></td>
          <td style="padding:7px 10px">${C(a.deadline)||"—"}</td>
        </tr>`}).join("");n=`
      <div style="margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#475569 0%,#64748b 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          📍 R\xe9serves hors plan
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${h.length} r\xe9serve${1!==h.length?"s":""}
          </span>
        </div>
        <div style="background:#fff;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#475569">
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Titre</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Entreprise</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">B\xe2timent</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Niveau</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Statut</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Priorit\xe9</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">\xc9ch\xe9ance</th>
            </tr></thead>
            <tbody>${a}</tbody>
          </table>
        </div>
      </div>`}let o=f.length,p=new Map;for(let a of f)p.set(a.status,(p.get(a.status)??0)+1);let q=["open","in_progress","waiting","verification","closed"].map(a=>{let b=p.get(a)??0;if(0===b)return"";let c=z[a],d=o>0?Math.round(b/o*100):0;return`<tr>
        <td style="padding:8px 12px">
          <span style="color:${c};font-weight:600">${y[a]??a}</span>
        </td>
        <td style="padding:8px 12px;text-align:right;font-weight:700">${b}</td>
        <td style="padding:8px 12px;text-align:right;color:#94a3b8">${d}%</td>
        <td style="padding:8px 12px;width:40%">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${c};height:8px;width:${d}%"></div>
          </div>
        </td>
      </tr>`}).join(""),r=new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}),s=m.length,t=j.length;return`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport des r\xe9serves — ${C(b)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    tbody tr:hover { background: #f1f5f9; }
    .cover { display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 90vh; text-align: center; padding: 60px 40px; page-break-after: always; }
  </style>
</head>
<body>
  <div class="cover">
    <div style="font-size:48px;margin-bottom:20px">📋</div>
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#003082;font-weight:700;margin-bottom:12px">
      BuildTrack
    </div>
    <div style="font-size:28px;font-weight:800;color:#1e293b;margin-bottom:8px">Rapport des r\xe9serves</div>
    <div style="font-size:18px;color:#64748b;margin-bottom:6px">${C(b)}</div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px">${C(c??"Toutes les entreprises")}</div>
    <div style="display:flex;gap:40px;margin:16px 0">
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${o}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">r\xe9serves</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${s}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">b\xe2timents</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${t}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">plans</div>
      </div>
    </div>
    <div style="margin-top:20px;padding:12px 24px;background:#f0f4ff;border-radius:8px;border:1px solid #c7d2fe;font-size:11px;color:#475569">
      G\xe9n\xe9r\xe9 le ${r}
    </div>
  </div>

  <div style="padding:20px 24px">
    ${m.join("\n")}
    ${n}

    ${q?`
    <div style="margin-top:32px;page-break-before:auto">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px">
        Synth\xe8se par statut
      </div>
      <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <tbody>${q}</tbody>
      </table>
    </div>`:""}

    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
      <span>G\xe9n\xe9r\xe9 par BuildTrack — ${C(b)}</span>
      <span>Document confidentiel \xb7 ${r}</span>
    </div>
  </div>
</body>
</html>`}(g)}try{e=(await Promise.resolve().then(c.t.bind(c,4637,23))).default,f=(await Promise.resolve().then(c.bind(c,8856))).default}catch(a){return console.error("[generate-pdf] Import error:",a?.message),u.NextResponse.json({success:!1,error:"Puppeteer non disponible sur ce runtime"},{status:503,headers:b})}let i=process.env.CHROMIUM_PACK_URL??"https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar",j=await e.executablePath(i),k=await f.launch({args:e.args,defaultViewport:e.defaultViewport,executablePath:j,headless:!0}),l=await k.newPage();await l.setContent(d,{waitUntil:"networkidle0",timeout:3e4});let m=await l.pdf({format:"A4",printBackground:!0,margin:{top:"15mm",bottom:"15mm",left:"12mm",right:"12mm"}});await k.close(),g.sendByEmail&&Array.isArray(g.recipients)&&g.recipients.length>0&&await Promise.allSettled(g.recipients.map(async a=>{let b,c,d,e=await K(a,g.language),f=L[e],i=new Date(g.generatedAt||Date.now()).toLocaleDateString(M[e],{day:"2-digit",month:"long",year:"numeric"});if("individual_reserve"===h){var j;let a=g.reserve,h=a.title||a.id;b=I("Reserve",[a.id||"reserve",a.title,g.chantierName]),c=f.individualSubject(h,g.chantierName);let i=(j=a.status,"fr"===e?(0,v.To)(j,!0):N[e][j??""]??j??"—");d=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${f.individualTitle}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${g.chantierName}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${f.hello}</p>
                <p style="margin:0 0 16px 0">${f.individualIntro(h)}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0">
                  <div style="font-size:13px;color:#64748b">${f.status} : <strong>${i}</strong></div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px">${f.building} : <strong>${a.building||"—"}</strong> \xb7 ${f.level} : <strong>${a.level||"—"}</strong></div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`}else{let a=g.companyFilter,e=a??f.allCompanies,j=Array.isArray(g.reserves)?g.reserves.length:0,k=a?e:null;b=I("global_reserves"===h?"Rapport_Reserves":"Rapport_Plans",[g.chantierName,k]);let l="global_reserves"===h?f.reservesKind:f.plansKind;c=f.reportSubject(l,g.chantierName,e),d=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${f.reportTitle(l)}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${g.chantierName} \xb7 ${e}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${f.hello}</p>
                <p style="margin:0 0 16px 0">${f.reportIntro(l,g.chantierName,e,i)}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
                  <div style="font-size:32px;font-weight:800;color:#003082">${j}</div>
                  <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">${f.reserveCount(j)}</div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`}return(0,D.Z)({to:a,subject:c,html:d,attachments:[{filename:b,content:Buffer.from(m),contentType:"application/pdf"}]})}));let n=Buffer.from(m).toString("base64");return u.NextResponse.json({success:!0,pdfBase64:n},{headers:b})}catch(a){return console.error("[generate-pdf] Erreur:",a?.message??a),u.NextResponse.json({success:!1,error:a?.message??"Erreur serveur"},{status:500,headers:b})}}let Q=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/generate-pdf/route",pathname:"/api/generate-pdf",filename:"route",bundlePath:"app/api/generate-pdf/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"C:\\Program Files\\BuildTrack\\ApplicationMobile-1\\vercel-app\\app\\api\\generate-pdf\\route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:R,workUnitAsyncStorage:S,serverHooks:T}=Q;function U(){return(0,g.patchFetch)({workAsyncStorage:R,workUnitAsyncStorage:S})}async function V(a,b,c){var d;let e="/api/generate-pdf/route";"/index"===e&&(e="/");let g=await Q.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:C}=g,D=(0,j.normalizeAppPath)(e),E=!!(y.dynamicRoutes[D]||y.routes[C]);if(E&&!x){let a=!!y.routes[C],b=y.dynamicRoutes[D];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let F=null;!E||Q.isDev||x||(F="/index"===(F=C)?"/":F);let G=!0===Q.isDev||!E,H=E&&!G,I=a.method||"GET",J=(0,i.getTracer)(),K=J.getActiveScopeSpan(),L={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:G,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:H,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>Q.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},M=new k.NodeNextRequest(a),N=new k.NodeNextResponse(b),O=l.NextRequestAdapter.fromNodeNextRequest(M,(0,l.signalFromNodeResponse)(b));try{let d=async c=>Q.handle(O,L).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=J.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${I} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${I} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=L.renderOpts.fetchMetrics;let i=L.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=L.renderOpts.collectedTags;if(!E)return await (0,o.I)(M,N,e,L.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==L.renderOpts.collectedRevalidate&&!(L.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&L.renderOpts.collectedRevalidate,d=void 0===L.renderOpts.collectedExpire||L.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:L.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await Q.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:H,isOnDemandRevalidate:A})},z),b}},l=await Q.handleResponse({req:a,nextConfig:w,cacheKey:F,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!E)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&E||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(M,N,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};K?await g(K):await J.withPropagatedContext(a.headers,()=>J.trace(m.BaseServerSpan.handleRequest,{spanName:`${I} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":I,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await Q.onRequestError(a,b,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:H,isOnDemandRevalidate:A})}),E)throw b;return await (0,o.I)(M,N,new Response(null,{status:500})),null}}},3033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},3873:a=>{a.exports=require("path")},4075:a=>{a.exports=require("zlib")},4631:a=>{a.exports=require("tls")},4637:a=>{a.exports=require("@sparticuz/chromium-min")},4735:a=>{a.exports=require("events")},4870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},4985:a=>{a.exports=require("dns")},5511:a=>{a.exports=require("crypto")},5591:a=>{a.exports=require("https")},6439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},7910:a=>{a.exports=require("stream")},8354:a=>{a.exports=require("util")},8847:(a,b,c)=>{c.d(b,{s:()=>e});let d=new Set(["Aucune description fournie.","Aucune description fournie","Position provisoire"]);function e(a,b,c="—"){let f=String(a??"").trim();return f&&!d.has(f)?f:String(b??"").trim()||c}},8856:a=>{a.exports=import("puppeteer-core")},9021:a=>{a.exports=require("fs")},9121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},9294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},9551:a=>{a.exports=require("url")},9646:a=>{a.exports=require("child_process")}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[331,457,692,112,271],()=>b(b.s=1941));module.exports=c})();