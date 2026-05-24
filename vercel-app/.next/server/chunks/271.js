exports.id=271,exports.ids=[271],exports.modules={3496:(a,b,c)=>{"use strict";c.d(b,{Z:()=>f});var d=c(2731);let e=null;async function f(a){let b=function(){if(e)return e;let a=process.env.GMAIL_USER,b=process.env.GMAIL_APP_PASSWORD;return a&&b?e=d.createTransport({service:"gmail",auth:{user:a,pass:b}}):(console.warn("[Email] GMAIL_USER ou GMAIL_APP_PASSWORD non d\xe9fini — emails d\xe9sactiv\xe9s (mode simulation)."),null)}(),c=Array.isArray(a.to)?a.to:[a.to];if(!b)return console.log("[Email] Mode simulation — email non envoy\xe9 \xe0",c.join(", ")),{success:!0,simulated:!0};let f=process.env.EMAIL_FROM||"BuildTrack <buildtrack.admin@gmail.com>";try{let d=await b.sendMail({from:f,to:c.join(", "),subject:a.subject,html:a.html,attachments:a.attachments?.map(a=>({filename:a.filename,content:a.content,contentType:a.contentType}))});return console.log("[Email] Email envoy\xe9 \xe0",c.join(", "),"—",a.subject,"(",d.messageId,")"),{success:!0}}catch(b){let a=b?.message??"Erreur inconnue";return console.error("[Email] Exception SMTP:",a),{success:!1,error:a}}}},6487:()=>{},7854:(a,b,c)=>{"use strict";c.d(b,{C9:()=>m,Tr:()=>A,_:()=>D,cs:()=>u,lU:()=>w,lj:()=>B,oO:()=>d,pS:()=>x,pg:()=>v,pn:()=>z,tM:()=>y});let d=process.env.EXPO_PUBLIC_APP_URL??process.env.NEXT_PUBLIC_APP_URL??"https://buildtrack-mobile.vercel.app",e="#003082",f="#FFCB00",g={fr:"fr-FR",en:"en-GB",es:"es-ES"},h={fr:{admin:"Administrateur",conducteur:"Conducteur de travaux",chef_equipe:"Chef d'\xe9quipe",observateur:"Observateur",sous_traitant:"Sous-traitant",super_admin:"Super administrateur"},en:{admin:"Administrator",conducteur:"Construction manager",chef_equipe:"Team lead",observateur:"Observer",sous_traitant:"Subcontractor",super_admin:"Super administrator"},es:{admin:"Administrador",conducteur:"Jefe de obra",chef_equipe:"Jefe de equipo",observateur:"Observador",sous_traitant:"Subcontratista",super_admin:"Superadministrador"}};h.fr;let i={fr:{open:"Ouverte",in_progress:"En cours",waiting:"En attente",verification:"V\xe9rification",closed:"Cl\xf4tur\xe9e"},en:{open:"Open",in_progress:"In progress",waiting:"Pending",verification:"Verification",closed:"Closed"},es:{open:"Abierta",in_progress:"En curso",waiting:"En espera",verification:"Verificaci\xf3n",closed:"Cerrada"}},j={fr:{critical:"Critique",high:"Haute",medium:"Moyenne",low:"Basse"},en:{critical:"Critical",high:"High",medium:"Medium",low:"Low"},es:{critical:"Cr\xedtica",high:"Alta",medium:"Media",low:"Baja"}},k={critical:"#DC2626",high:"#EA580C",medium:"#D97706",low:"#6B7280"},l={fr:{footer:{product:"BuildTrack — Gestion de chantier num\xe9rique",automated:"Cet email a \xe9t\xe9 envoy\xe9 automatiquement, merci de ne pas y r\xe9pondre.",rights:"Bouygues Construction. Tous droits r\xe9serv\xe9s."},common:{hello:a=>`Bonjour ${a},`,ignore:"Si vous n'attendiez pas cet email, vous pouvez l'ignorer.",linkFallback:a=>`Si le bouton ne fonctionne pas, copiez ce lien : ${a}`,chantier:"Chantier",company:"Entreprise",priority:"Priorit\xe9",deadline:"\xc9ch\xe9ance",location:"Localisation",status:"Statut",email:"Email",role:"R\xf4le",ref:"R\xe9f."},invitation:{title:"Vous avez \xe9t\xe9 invit\xe9 !",intro:(a,b)=>`<strong>${a}</strong> vous invite \xe0 rejoindre l'organisation <strong>${b}</strong> sur BuildTrack en tant que :`,company:a=>`Entreprise rattach\xe9e : <strong>${a}</strong>`,create:a=>`Cr\xe9ez votre compte avec cette adresse email (<strong>${a}</strong>) pour accepter l'invitation :`,button:"Cr\xe9er mon compte →",howTitle:"Comment \xe7a marche ?",steps:(a,b)=>`1. Cliquez sur le bouton ci-dessus<br/>2. Choisissez <em>\xab Invitation re\xe7ue \xbb</em> et cr\xe9ez votre compte avec l'email <strong>${a}</strong><br/>3. Votre acc\xe8s \xe0 <strong>${b}</strong> sera automatiquement activ\xe9`,token:"Votre code d'invitation (conservez-le)",expires:a=>`Cette invitation expire le <strong>${a}</strong>.`,subject:a=>`Invitation \xe0 rejoindre ${a} sur BuildTrack`,preheader:(a,b)=>`${a} vous invite \xe0 rejoindre ${b}`},welcome:{title:a=>`Bienvenue, ${a} !`,account:a=>`Votre compte BuildTrack a bien \xe9t\xe9 cr\xe9\xe9 pour l'adresse <strong>${a}</strong>.`,orgCreated:a=>`Votre organisation <strong>${a}</strong> a \xe9t\xe9 cr\xe9\xe9e. Vous \xeates maintenant administrateur et pouvez inviter vos collaborateurs depuis l'\xe9cran Administration.`,invited:"Votre compte est cr\xe9\xe9. Si vous avez re\xe7u une invitation, connectez-vous : votre acc\xe8s \xe0 l'organisation sera activ\xe9 automatiquement.",open:"Ouvrir BuildTrack →",security:"Si vous n'avez pas cr\xe9\xe9 ce compte, contactez votre administrateur.",subject:"Bienvenue sur BuildTrack !",preheader:a=>`Votre compte BuildTrack est pr\xeat, ${a}`},passwordReset:{title:"R\xe9initialisation du mot de passe",intro:"Vous avez demand\xe9 la r\xe9initialisation de votre mot de passe BuildTrack. Cliquez sur le bouton ci-dessous pour en choisir un nouveau :",button:"R\xe9initialiser mon mot de passe →",validity:"Ce lien est valable <strong>1 heure</strong>. Apr\xe8s expiration, vous devrez faire une nouvelle demande.",ignore:"Si vous n'avez pas demand\xe9 cette r\xe9initialisation, ignorez cet email. Votre mot de passe reste inchang\xe9.",subject:"R\xe9initialisation de votre mot de passe BuildTrack",preheader:"R\xe9initialisez votre mot de passe BuildTrack"},passwordChanged:{title:"Mot de passe modifi\xe9",changed:a=>`Votre mot de passe BuildTrack a bien \xe9t\xe9 modifi\xe9 le <strong>${a}</strong>.`,safe:"Si vous \xeates \xe0 l'origine de cette modification, vous n'avez rien \xe0 faire. Vous pouvez vous connecter normalement avec votre nouveau mot de passe.",login:"Se connecter →",warning:"Si vous n'avez pas effectu\xe9 cette modification, contactez imm\xe9diatement votre administrateur ou changez votre mot de passe d\xe8s que possible.",subject:"Votre mot de passe BuildTrack a \xe9t\xe9 modifi\xe9",preheader:"Votre mot de passe BuildTrack vient d'\xeatre modifi\xe9"},accepted:{title:"Invitation accept\xe9e",intro:(a,b)=>`<strong>${a}</strong> a accept\xe9 votre invitation et a rejoint <strong>${b}</strong> sur BuildTrack.`,manage:"Vous pouvez g\xe9rer les acc\xe8s et les permissions de vos collaborateurs depuis l'\xe9cran Administration.",warning:"Si vous n'avez pas envoy\xe9 cette invitation, contactez votre administrateur syst\xe8me.",subject:(a,b)=>`${a} a rejoint ${b} sur BuildTrack`,preheader:a=>`${a} a accept\xe9 votre invitation`},revoked:{title:"Acc\xe8s r\xe9voqu\xe9",intro:a=>`Votre acc\xe8s \xe0 l'organisation <strong>${a}</strong> sur BuildTrack a \xe9t\xe9 r\xe9voqu\xe9 par un administrateur.`,details:a=>`Votre compte BuildTrack existe toujours, mais vous n'avez plus acc\xe8s aux chantiers et donn\xe9es de <strong>${a}</strong>.`,help:"Si vous pensez qu'il s'agit d'une erreur, contactez directement votre responsable ou l'administrateur de votre organisation.",subject:a=>`Votre acc\xe8s \xe0 ${a} a \xe9t\xe9 r\xe9voqu\xe9`,preheader:a=>`Votre acc\xe8s \xe0 ${a} sur BuildTrack a \xe9t\xe9 r\xe9voqu\xe9`},reserveCreated:{title:"Nouvelle r\xe9serve assign\xe9e",intro:a=>`Une nouvelle r\xe9serve a \xe9t\xe9 cr\xe9\xe9e et assign\xe9e \xe0 votre entreprise par <strong>${a}</strong>.`,description:"Description",button:"Voir la r\xe9serve",subject:a=>`Nouvelle r\xe9serve : ${a}`,preheader:a=>`R\xe9serve assign\xe9e \xe0 ${a}`},reserveStatus:{title:"Mise \xe0 jour de r\xe9serve",intro:a=>`Le statut d'une r\xe9serve qui vous concerne a \xe9t\xe9 mis \xe0 jour par <strong>${a}</strong>.`,previous:"Ancien statut",next:"Nouveau statut",button:"Voir la r\xe9serve",subject:a=>`R\xe9serve mise \xe0 jour : ${a}`,preheader:a=>`Statut mis \xe0 jour : ${a}`},overdue:{title:"R\xe9serve en retard",intro:a=>`La r\xe9serve suivante est <strong>en retard de ${a} ${a>1?"jours":"jour"}</strong> et n\xe9cessite votre attention.`,missed:"\xc9ch\xe9ance d\xe9pass\xe9e",thanks:"Merci de mettre \xe0 jour le statut de cette r\xe9serve d\xe8s que possible.",button:"Traiter la r\xe9serve",subject:(a,b)=>`R\xe9serve en retard (${a}j) : ${b}`,preheader:a=>`R\xe9serve en retard de ${a} ${a>1?"jours":"jour"}`}},en:{footer:{product:"BuildTrack — Digital construction site management",automated:"This email was sent automatically. Please do not reply.",rights:"Bouygues Construction. All rights reserved."},common:{hello:a=>`Hello ${a},`,ignore:"If you were not expecting this email, you can ignore it.",linkFallback:a=>`If the button does not work, copy this link: ${a}`,chantier:"Project",company:"Company",priority:"Priority",deadline:"Deadline",location:"Location",status:"Status",email:"Email",role:"Role",ref:"Ref."},invitation:{title:"You have been invited!",intro:(a,b)=>`<strong>${a}</strong> invites you to join <strong>${b}</strong> on BuildTrack as:`,company:a=>`Linked company: <strong>${a}</strong>`,create:a=>`Create your account with this email address (<strong>${a}</strong>) to accept the invitation:`,button:"Create my account →",howTitle:"How it works",steps:(a,b)=>`1. Click the button above<br/>2. Choose <em>"Received invitation"</em> and create your account with <strong>${a}</strong><br/>3. Your access to <strong>${b}</strong> will be activated automatically`,token:"Your invitation code (keep it)",expires:a=>`This invitation expires on <strong>${a}</strong>.`,subject:a=>`Invitation to join ${a} on BuildTrack`,preheader:(a,b)=>`${a} invites you to join ${b}`},welcome:{title:a=>`Welcome, ${a}!`,account:a=>`Your BuildTrack account has been created for <strong>${a}</strong>.`,orgCreated:a=>`Your organisation <strong>${a}</strong> has been created. You are now an administrator and can invite teammates from the Administration screen.`,invited:"Your account has been created. If you received an invitation, sign in and your organisation access will be activated automatically.",open:"Open BuildTrack →",security:"If you did not create this account, contact your administrator.",subject:"Welcome to BuildTrack!",preheader:a=>`Your BuildTrack account is ready, ${a}`},passwordReset:{title:"Password reset",intro:"You requested a BuildTrack password reset. Click the button below to choose a new password:",button:"Reset my password →",validity:"This link is valid for <strong>1 hour</strong>. After it expires, you will need to request a new one.",ignore:"If you did not request this reset, ignore this email. Your password remains unchanged.",subject:"Reset your BuildTrack password",preheader:"Reset your BuildTrack password"},passwordChanged:{title:"Password changed",changed:a=>`Your BuildTrack password was changed on <strong>${a}</strong>.`,safe:"If you made this change, no action is needed. You can sign in normally with your new password.",login:"Sign in →",warning:"If you did not make this change, contact your administrator immediately or change your password as soon as possible.",subject:"Your BuildTrack password was changed",preheader:"Your BuildTrack password has just been changed"},accepted:{title:"Invitation accepted",intro:(a,b)=>`<strong>${a}</strong> accepted your invitation and joined <strong>${b}</strong> on BuildTrack.`,manage:"You can manage access and permissions from the Administration screen.",warning:"If you did not send this invitation, contact your system administrator.",subject:(a,b)=>`${a} joined ${b} on BuildTrack`,preheader:a=>`${a} accepted your invitation`},revoked:{title:"Access revoked",intro:a=>`Your access to <strong>${a}</strong> on BuildTrack was revoked by an administrator.`,details:a=>`Your BuildTrack account still exists, but you no longer have access to <strong>${a}</strong> projects and data.`,help:"If you think this is a mistake, contact your manager or organisation administrator directly.",subject:a=>`Your access to ${a} was revoked`,preheader:a=>`Your access to ${a} on BuildTrack was revoked`},reserveCreated:{title:"New issue assigned",intro:a=>`A new issue was created and assigned to your company by <strong>${a}</strong>.`,description:"Description",button:"View issue",subject:a=>`New issue: ${a}`,preheader:a=>`Issue assigned to ${a}`},reserveStatus:{title:"Issue update",intro:a=>`The status of an issue related to you was updated by <strong>${a}</strong>.`,previous:"Previous status",next:"New status",button:"View issue",subject:a=>`Issue updated: ${a}`,preheader:a=>`Status updated: ${a}`},overdue:{title:"Overdue issue",intro:a=>`The following issue is <strong>${a} ${a>1?"days":"day"} overdue</strong> and needs your attention.`,missed:"Missed deadline",thanks:"Please update this issue status as soon as possible.",button:"Handle issue",subject:(a,b)=>`Overdue issue (${a}d): ${b}`,preheader:a=>`Issue ${a} ${a>1?"days":"day"} overdue`}},es:{footer:{product:"BuildTrack — Gesti\xf3n digital de obra",automated:"Este correo se envi\xf3 autom\xe1ticamente. Por favor, no respondas.",rights:"Bouygues Construction. Todos los derechos reservados."},common:{hello:a=>`Hola ${a},`,ignore:"Si no esperabas este correo, puedes ignorarlo.",linkFallback:a=>`Si el bot\xf3n no funciona, copia este enlace: ${a}`,chantier:"Obra",company:"Empresa",priority:"Prioridad",deadline:"Fecha l\xedmite",location:"Ubicaci\xf3n",status:"Estado",email:"Email",role:"Rol",ref:"Ref."},invitation:{title:"\xa1Has recibido una invitaci\xf3n!",intro:(a,b)=>`<strong>${a}</strong> te invita a unirte a <strong>${b}</strong> en BuildTrack como:`,company:a=>`Empresa vinculada: <strong>${a}</strong>`,create:a=>`Crea tu cuenta con este correo (<strong>${a}</strong>) para aceptar la invitaci\xf3n:`,button:"Crear mi cuenta →",howTitle:"C\xf3mo funciona",steps:(a,b)=>`1. Haz clic en el bot\xf3n anterior<br/>2. Elige <em>"Invitaci\xf3n recibida"</em> y crea tu cuenta con <strong>${a}</strong><br/>3. Tu acceso a <strong>${b}</strong> se activar\xe1 autom\xe1ticamente`,token:"Tu c\xf3digo de invitaci\xf3n (gu\xe1rdalo)",expires:a=>`Esta invitaci\xf3n caduca el <strong>${a}</strong>.`,subject:a=>`Invitaci\xf3n para unirte a ${a} en BuildTrack`,preheader:(a,b)=>`${a} te invita a unirte a ${b}`},welcome:{title:a=>`\xa1Bienvenido, ${a}!`,account:a=>`Tu cuenta BuildTrack se ha creado para <strong>${a}</strong>.`,orgCreated:a=>`Tu organizaci\xf3n <strong>${a}</strong> se ha creado. Ahora eres administrador y puedes invitar a colaboradores desde Administraci\xf3n.`,invited:"Tu cuenta se ha creado. Si recibiste una invitaci\xf3n, inicia sesi\xf3n y tu acceso a la organizaci\xf3n se activar\xe1 autom\xe1ticamente.",open:"Abrir BuildTrack →",security:"Si no creaste esta cuenta, contacta con tu administrador.",subject:"\xa1Bienvenido a BuildTrack!",preheader:a=>`Tu cuenta BuildTrack est\xe1 lista, ${a}`},passwordReset:{title:"Restablecimiento de contrase\xf1a",intro:"Has solicitado restablecer tu contrase\xf1a de BuildTrack. Haz clic en el bot\xf3n para elegir una nueva:",button:"Restablecer mi contrase\xf1a →",validity:"Este enlace es v\xe1lido durante <strong>1 hora</strong>. Despu\xe9s tendr\xe1s que solicitar uno nuevo.",ignore:"Si no solicitaste este restablecimiento, ignora este correo. Tu contrase\xf1a no cambia.",subject:"Restablece tu contrase\xf1a de BuildTrack",preheader:"Restablece tu contrase\xf1a de BuildTrack"},passwordChanged:{title:"Contrase\xf1a modificada",changed:a=>`Tu contrase\xf1a de BuildTrack se modific\xf3 el <strong>${a}</strong>.`,safe:"Si realizaste este cambio, no tienes que hacer nada. Puedes iniciar sesi\xf3n con tu nueva contrase\xf1a.",login:"Iniciar sesi\xf3n →",warning:"Si no realizaste este cambio, contacta inmediatamente con tu administrador o cambia tu contrase\xf1a cuanto antes.",subject:"Tu contrase\xf1a de BuildTrack se ha modificado",preheader:"Tu contrase\xf1a de BuildTrack acaba de modificarse"},accepted:{title:"Invitaci\xf3n aceptada",intro:(a,b)=>`<strong>${a}</strong> acept\xf3 tu invitaci\xf3n y se uni\xf3 a <strong>${b}</strong> en BuildTrack.`,manage:"Puedes gestionar accesos y permisos desde la pantalla Administraci\xf3n.",warning:"Si no enviaste esta invitaci\xf3n, contacta con tu administrador del sistema.",subject:(a,b)=>`${a} se uni\xf3 a ${b} en BuildTrack`,preheader:a=>`${a} acept\xf3 tu invitaci\xf3n`},revoked:{title:"Acceso revocado",intro:a=>`Un administrador ha revocado tu acceso a <strong>${a}</strong> en BuildTrack.`,details:a=>`Tu cuenta BuildTrack sigue existiendo, pero ya no tienes acceso a las obras y datos de <strong>${a}</strong>.`,help:"Si crees que es un error, contacta directamente con tu responsable o administrador.",subject:a=>`Tu acceso a ${a} ha sido revocado`,preheader:a=>`Tu acceso a ${a} en BuildTrack ha sido revocado`},reserveCreated:{title:"Nueva reserva asignada",intro:a=>`Se ha creado una nueva reserva y se ha asignado a tu empresa por <strong>${a}</strong>.`,description:"Descripci\xf3n",button:"Ver reserva",subject:a=>`Nueva reserva: ${a}`,preheader:a=>`Reserva asignada a ${a}`},reserveStatus:{title:"Actualizaci\xf3n de reserva",intro:a=>`El estado de una reserva relacionada contigo fue actualizado por <strong>${a}</strong>.`,previous:"Estado anterior",next:"Nuevo estado",button:"Ver reserva",subject:a=>`Reserva actualizada: ${a}`,preheader:a=>`Estado actualizado: ${a}`},overdue:{title:"Reserva retrasada",intro:a=>`La siguiente reserva lleva <strong>${a} ${a>1?"d\xedas":"d\xeda"} de retraso</strong> y necesita atenci\xf3n.`,missed:"Fecha l\xedmite superada",thanks:"Actualiza el estado de esta reserva lo antes posible.",button:"Tratar reserva",subject:(a,b)=>`Reserva retrasada (${a}d): ${b}`,preheader:a=>`Reserva con ${a} ${a>1?"d\xedas":"d\xeda"} de retraso`}}};function m(a){let b=String(a??"").trim().toLowerCase();return b.startsWith("en")?"en":b.startsWith("es")?"es":"fr"}function n(a){return l[m(a)]}function o(a){return String(a||"").trim().split(/\s+/)[0]||a||""}function p(a,b,c=!1){return(a instanceof Date?a:new Date(a)).toLocaleDateString(g[m(b)],{day:"numeric",month:"long",year:"numeric",...c?{hour:"2-digit",minute:"2-digit"}:{}})}function q(a,b){return a?i[m(b)][a]??a:"—"}function r(a,b){return a?j[m(b)][a]??a:"—"}function s(a){return a?k[a]??"#6B7280":"#6B7280"}function t(a,b="",c){let d=m(c),g=l[d];return`<!DOCTYPE html>
<html lang="${d}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BuildTrack</title>
  <style>
    body { margin: 0; padding: 0; background: #F4F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
    .header { background: ${e}; border-radius: 16px 16px 0 0; padding: 28px 36px; display: flex; align-items: center; }
    .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: ${f}; border-radius: 10px; font-size: 22px; font-weight: 700; color: ${e}; flex-shrink: 0; }
    .brand { display: inline-block; margin-left: 14px; }
    .brand-name { font-size: 18px; font-weight: 700; color: #fff; line-height: 1.2; }
    .brand-sub { font-size: 12px; color: rgba(255,255,255,0.65); }
    .divider-bar { width: 36px; height: 3px; background: ${f}; border-radius: 2px; margin: 14px 0 0; }
    .body { background: #fff; padding: 36px; border-left: 1px solid #DDE4EE; border-right: 1px solid #DDE4EE; }
    .footer { background: #EEF3FA; border-radius: 0 0 16px 16px; padding: 20px 36px; text-align: center; border: 1px solid #DDE4EE; border-top: 0; }
    .footer p { font-size: 11px; color: #8899BB; margin: 0; line-height: 1.6; }
    h1 { font-size: 22px; font-weight: 700; color: ${e}; margin: 0 0 12px; }
    p { font-size: 14px; color: #334155; line-height: 1.7; margin: 0 0 14px; }
    .btn { display: inline-block; background: ${f}; color: ${e} !important; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; margin: 10px 0 20px; }
    .info-box { background: #EEF3FA; border-radius: 10px; padding: 16px 20px; border-left: 3px solid ${e}; margin: 18px 0; }
    .info-box p { margin: 0; font-size: 13px; color: #334155; }
    .token-box { background: #F4F7FB; border-radius: 10px; padding: 14px 20px; border: 1px solid #DDE4EE; text-align: center; margin: 16px 0; }
    .token { font-size: 22px; font-weight: 700; color: ${e}; letter-spacing: 3px; font-family: 'Courier New', monospace; }
    .role-badge { display: inline-block; background: #EEF3FA; border: 1px solid ${e}33; color: ${e}; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; margin: 4px 0; }
    .separator { border: none; border-top: 1px solid #EEF3FA; margin: 24px 0; }
  </style>
</head>
<body>
  ${b?`<span style="display:none;max-height:0;overflow:hidden;">${b}</span>`:""}
  <div class="wrapper">
    <div class="header">
      <div class="logo-box">B</div>
      <div class="brand">
        <div class="brand-name">Bouygues</div>
        <div class="brand-sub">Construction</div>
        <div class="divider-bar"></div>
      </div>
    </div>
    <div class="body">
      ${a}
    </div>
    <div class="footer">
      <p>${g.footer.product}<br/>
      ${g.footer.automated}<br/>
      &copy; ${new Date().getFullYear()} ${g.footer.rights}</p>
    </div>
  </div>
</body>
</html>`}function u(a){var b;let c=n(a.language),e=`${d}/invite?token=${encodeURIComponent(a.token)}`,f=p(a.expiresAt,a.language),g=`
    <h1>${c.invitation.title}</h1>
    <p>${c.invitation.intro(a.invitedByName,a.organizationName)}</p>
    <p style="text-align:center;"><span class="role-badge">${(b=a.role,h[m(a.language)][b]??b)}</span></p>
    ${a.companyName?`<p style="text-align:center;margin-top:-4px;">${c.invitation.company(a.companyName)}</p>`:""}
    <p>${c.invitation.create(a.email)}</p>
    <div style="text-align:center;">
      <a href="${e}" class="btn">${c.invitation.button}</a>
    </div>
    <div class="info-box">
      <p><strong>${c.invitation.howTitle}</strong><br/>${c.invitation.steps(a.email,a.organizationName)}</p>
    </div>
    <div class="token-box">
      <p style="font-size:12px;color:#8899BB;margin:0 0 8px;">${c.invitation.token}</p>
      <div class="token">${a.token}</div>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.invitation.expires(f)} ${c.common.ignore}</p>
  `;return{subject:c.invitation.subject(a.organizationName),html:t(g,c.invitation.preheader(a.invitedByName,a.organizationName),a.language)}}function v(a){let b=n(a.language),c=o(a.name),e=`
    <h1>${b.welcome.title(c)}</h1>
    <p>${b.welcome.account(a.email)}</p>
    <div class="info-box">
      <p>${a.organizationName?b.welcome.orgCreated(a.organizationName):b.welcome.invited}</p>
    </div>
    <div style="text-align:center;">
      <a href="${d}" class="btn">${b.welcome.open}</a>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.welcome.security}</p>
  `;return{subject:b.welcome.subject,html:t(e,b.welcome.preheader(c),a.language)}}function w(a){let b=n(a.language),c=o(a.name),d=`
    <h1>${b.passwordReset.title}</h1>
    <p>${b.common.hello(c)}</p>
    <p>${b.passwordReset.intro}</p>
    <div style="text-align:center;">
      <a href="${a.resetUrl}" class="btn">${b.passwordReset.button}</a>
    </div>
    <div class="info-box">
      <p>${b.passwordReset.validity}</p>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.passwordReset.ignore}</p>
  `;return{subject:b.passwordReset.subject,html:t(d,b.passwordReset.preheader,a.language)}}function x(a){var b;let c=n(a.language),d=o(a.adminName),e=`
    <h1>${c.accepted.title}</h1>
    <p>${c.common.hello(d)}</p>
    <p>${c.accepted.intro(a.inviteeName,a.organizationName)}</p>
    <div class="info-box">
      <p><strong>${c.common.email} :</strong> ${a.inviteeEmail}<br/>
      <strong>${c.common.role} :</strong> <span class="role-badge">${(b=a.role,h[m(a.language)][b]??b)}</span></p>
    </div>
    <p>${c.accepted.manage}</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.accepted.warning}</p>
  `;return{subject:c.accepted.subject(a.inviteeName,a.organizationName),html:t(e,c.accepted.preheader(a.inviteeName),a.language)}}function y(a){let b=n(a.language),c=o(a.name),d=`
    <h1>${b.revoked.title}</h1>
    <p>${b.common.hello(c)}</p>
    <p>${b.revoked.intro(a.organizationName)}</p>
    <div class="info-box">
      <p>${b.revoked.details(a.organizationName)}</p>
    </div>
    <p>${b.revoked.help}</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.footer.automated}</p>
  `;return{subject:b.revoked.subject(a.organizationName),html:t(d,b.revoked.preheader(a.organizationName),a.language)}}function z(a){let b=n(a.language),c=o(a.recipientName),e=a.reserveUrl??`${d}/reserve/${encodeURIComponent(a.reserveId)}`,f=[a.chantierName?`<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${b.common.chantier}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${a.chantierName}</td></tr>`:"",a.companyName?`<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${b.common.company}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${a.companyName}</td></tr>`:"",a.priority?`<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${b.common.priority}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${r(a.priority,a.language)}</td></tr>`:"",a.deadline?`<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${b.common.deadline}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${p(a.deadline,a.language)}</td></tr>`:"",a.building?`<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${b.common.location}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${a.building}${a.level?` - ${a.level}`:""}${a.zone?` / ${a.zone}`:""}</td></tr>`:""].filter(Boolean).join(""),g=`
    <h1>${b.reserveCreated.title}</h1>
    <p>${b.common.hello(c)}</p>
    <p>${b.reserveCreated.intro(a.createdBy)}</p>
    <div class="info-box" style="border-left-color:${s(a.priority)};">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${a.reserveTitle}${a.reserveCode?` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${a.reserveCode})</span>`:""}</p>
      <table style="border-collapse:collapse;width:100%;">${f}</table>
    </div>
    ${a.description?`<p style="color:#475569;font-size:13px;"><strong>${b.reserveCreated.description} :</strong> ${a.description}</p>`:""}
    <a href="${e}" class="btn">${b.reserveCreated.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.common.linkFallback(e)}</p>
  `;return{subject:b.reserveCreated.subject(a.reserveTitle),html:t(g,b.reserveCreated.preheader(a.companyName),a.language)}}function A(a){let b=n(a.language),c=o(a.recipientName),e=a.reserveUrl??`${d}/reserve/${encodeURIComponent(a.reserveId)}`,f=q(a.newStatus,a.language),g=a.previousStatus?q(a.previousStatus,a.language):null,h=`
    <h1>${b.reserveStatus.title}</h1>
    <p>${b.common.hello(c)}</p>
    <p>${b.reserveStatus.intro(a.changedBy)}</p>
    <div class="info-box">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${a.reserveTitle}${a.reserveCode?` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${a.reserveCode})</span>`:""}</p>
      ${g?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.reserveStatus.previous} : <strong>${g}</strong></p>`:""}
      <p style="font-size:13px;margin:4px 0;">${b.reserveStatus.next} : <strong>${f}</strong></p>
      ${a.chantierName?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.common.chantier} : ${a.chantierName}</p>`:""}
      ${a.companyName?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.common.company} : ${a.companyName}</p>`:""}
    </div>
    <a href="${e}" class="btn">${b.reserveStatus.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.common.linkFallback(e)}</p>
  `;return{subject:b.reserveStatus.subject(a.reserveTitle),html:t(h,b.reserveStatus.preheader(f),a.language)}}function B(a){let b=n(a.language),c=o(a.recipientName),e=a.reserveUrl??`${d}/reserve/${encodeURIComponent(a.reserveId)}`,f=`
    <h1 style="color:#DC2626;">${b.overdue.title}</h1>
    <p>${b.common.hello(c)}</p>
    <p>${b.overdue.intro(a.daysLate)}</p>
    <div class="info-box" style="border-left-color:#EF4444;">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${a.reserveTitle}${a.reserveCode?` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${a.reserveCode})</span>`:""}</p>
      <p style="font-size:13px;margin:4px 0;color:#EF4444;font-weight:600;">${b.overdue.missed} : ${p(a.deadline,a.language)}</p>
      ${a.priority?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.common.priority} : ${r(a.priority,a.language)}</p>`:""}
      ${a.chantierName?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.common.chantier} : ${a.chantierName}</p>`:""}
      ${a.companyName?`<p style="font-size:13px;margin:4px 0;color:#64748B;">${b.common.company} : ${a.companyName}</p>`:""}
    </div>
    <p>${b.overdue.thanks}</p>
    <a href="${e}" class="btn" style="background:#DC2626;color:#fff !important;">${b.overdue.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${b.common.linkFallback(e)}</p>
  `;return{subject:b.overdue.subject(a.daysLate,a.reserveTitle),html:t(f,b.overdue.preheader(a.daysLate),a.language)}}let C={fr:{title:"Escalade — r\xe9serve non r\xe9solue",intro:(a,b,c)=>`La r\xe9serve ci-dessous, impliquant l'entreprise <strong>${a}</strong>${b?` sur le chantier <strong>${b}</strong>`:""}, n'a pas \xe9t\xe9 trait\xe9e malgr\xe9 <strong>${c} rappels quotidiens</strong> envoy\xe9s \xe0 ses destinataires. Elle est d\xe9sormais escalad\xe9e \xe0 l'\xe9quipe d'administration.`,overdue:a=>`EN RETARD DE ${a} ${a>1?"JOURS":"JOUR"}`,admin:"ESCALADE ADMIN",missed:"\xc9ch\xe9ance d\xe9pass\xe9e",action:a=>`Merci de relancer ${a} ou de prendre le relais directement depuis l'application.`,button:"Voir la r\xe9serve →",footer:a=>`Vous recevez cet email en tant qu'administrateur de l'organisation BuildTrack. Les rappels quotidiens \xe0 ${a} ont \xe9t\xe9 suspendus pour \xe9viter le spam.`,subject:(a,b,c)=>`[Escalade ${a}j] ${b} — ${c} ne r\xe9pond pas`,preheader:a=>`Escalade : r\xe9serve non r\xe9solue apr\xe8s ${a} rappels`},en:{title:"Escalation — unresolved issue",intro:(a,b,c)=>`The issue below, involving <strong>${a}</strong>${b?` on project <strong>${b}</strong>`:""}, has not been handled despite <strong>${c} daily reminders</strong> sent to its recipients. It is now escalated to the administration team.`,overdue:a=>`${a} ${a>1?"DAYS":"DAY"} OVERDUE`,admin:"ADMIN ESCALATION",missed:"Missed deadline",action:a=>`Please follow up with ${a} or take over directly from the app.`,button:"View issue →",footer:a=>`You are receiving this email as a BuildTrack organisation administrator. Daily reminders to ${a} have been suspended to avoid spam.`,subject:(a,b,c)=>`[Escalation ${a}d] ${b} — ${c} has not responded`,preheader:a=>`Escalation: unresolved issue after ${a} reminders`},es:{title:"Escalado — reserva sin resolver",intro:(a,b,c)=>`La reserva siguiente, relacionada con <strong>${a}</strong>${b?` en la obra <strong>${b}</strong>`:""}, no se ha tratado pese a <strong>${c} recordatorios diarios</strong> enviados a sus destinatarios. Ahora se escala al equipo de administraci\xf3n.`,overdue:a=>`${a} ${a>1?"D\xcdAS":"D\xcdA"} DE RETRASO`,admin:"ESCALADO ADMIN",missed:"Fecha l\xedmite superada",action:a=>`Por favor, contacta con ${a} o toma el relevo directamente desde la aplicaci\xf3n.`,button:"Ver reserva →",footer:a=>`Recibes este correo como administrador de la organizaci\xf3n BuildTrack. Los recordatorios diarios a ${a} se han suspendido para evitar spam.`,subject:(a,b,c)=>`[Escalado ${a}d] ${b} — ${c} no responde`,preheader:a=>`Escalado: reserva sin resolver tras ${a} recordatorios`}};function D(a){let b=m(a.language),c=n(b),e=C[b],f=o(a.recipientName),g=r(a.priority,b),h=s(a.priority),i=a.reserveUrl??`${d}/reserve/${encodeURIComponent(a.reserveId)}`,j=p(a.deadline,b),k=`
    <h1 style="color:#DC2626;">${e.title}</h1>
    <p>${c.common.hello(f)}</p>
    <p>${e.intro(a.companyName,a.chantierName,a.reminderDays)}</p>

    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${a.reserveTitle}</p>
      ${a.reserveCode?`<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">${c.common.ref} ${a.reserveCode}</p>`:""}
      <p style="margin:0 0 6px;">
        <span style="display:inline-block;background:${h}18;color:${h};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-right:6px;">${g.toUpperCase()}</span>
        <span style="display:inline-block;background:#DC262618;color:#DC2626;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${e.overdue(a.daysLate)}</span>
        <span style="display:inline-block;background:#7C3AED18;color:#7C3AED;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-left:6px;">${e.admin}</span>
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#5E738A;">${e.missed} : <strong style="color:#DC2626;">${j}</strong></p>
    </div>

    <p style="font-size:14px;color:#334155;">${e.action(a.companyName)}</p>

    <div style="text-align:center;">
      <a href="${i}" class="btn" style="background:#DC2626;color:#fff !important;">${e.button}</a>
    </div>

    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${e.footer(a.companyName)}</p>
  `;return{subject:e.subject(a.daysLate,a.reserveTitle,a.companyName),html:t(k,e.preheader(a.reminderDays),b)}}},8335:()=>{}};