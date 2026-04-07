#!/usr/bin/env node
// Test d'envoi d'email via l'API Vercel
// Usage: node scripts/test-email.js ton@email.fr

const email = process.argv[2];

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/test-email.js ton@email.fr');
  process.exit(1);
}

const API_URL = 'https://buildtrack-mobile.vercel.app/api/send-email';

async function test() {
  console.log(`\n📧 Test d'envoi email BuildTrack`);
  console.log(`   Destinataire : ${email}`);
  console.log(`   API          : ${API_URL}\n`);

  const payload = {
    type: 'invitation',
    email,
    invitedByName: 'Jean Dupont (Test)',
    organizationName: 'Bouygues Construction',
    role: 'conducteur',
    token: 'TEST-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      console.log('✅ Email envoyé avec succès !');
      if (data.simulated) {
        console.log('⚠️  Mode simulation (RESEND_API_KEY absent sur Vercel)');
      }
    } else {
      console.error('❌ Échec :', data?.error ?? res.statusText);
      console.error('   Status HTTP :', res.status);
    }
  } catch (err) {
    console.error('❌ Erreur réseau :', err.message);
    console.error('   Vérifie que le projet Vercel est bien déployé.');
  }
}

test();
