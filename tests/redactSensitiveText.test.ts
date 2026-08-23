import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../lib/redactSensitiveText';

/**
 * Ces textes finissent dans `lastError`, persiste dans la file d'attente, puis
 * dans l'export de diagnostic que l'utilisateur colle dans un ticket support.
 */
describe('secrets never survive', () => {
  it.each([
    ['JWT signe', 'echec eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.SIGNATURE_SECRETE ici', 'SIGNATURE_SECRETE'],
    ['JWT non signe', 'jeton eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1MSJ9 rejete', 'eyJhbGciOiJub25lIn0'],
    ['en-tete Bearer', 'Authorization: Bearer sbp_0123456789abcdef refuse', 'sbp_0123456789abcdef'],
    ['jeton en parametre', 'GET https://x.co/o?token=SECRET_SIGNE&w=1', 'SECRET_SIGNE'],
    ['cle en texte libre', 'reessayer avec apikey=CLE_PRIVEE', 'CLE_PRIVEE'],
    ['mot de passe', 'password: MotDePasse123!', 'MotDePasse123!'],
    ['identifiants dans l URL', 'https://admin:MotDePasse@db.exemple.co/x', 'MotDePasse'],
    ['chemin file://', 'upload de file:///data/user/0/photos/IMG_0042.jpg', 'IMG_0042'],
    ['chemin Android', 'ENOENT /data/user/0/cache/session.json', 'session.json'],
    ['chemin Windows', 'echec C:\\Users\\Adrien\\photos\\chantier.jpg', 'chantier.jpg'],
    ['adresse e-mail', 'compte jean.dupont@exemple.fr introuvable', 'jean.dupont@exemple.fr'],
    ['cle autonome Supabase', 'Invalid API key sb_secret_ABCDEF0123456789', 'sb_secret_ABCDEF0123456789'],
    ['cle publiable', 'utilise sb_publishable_LEAKED0123 par erreur', 'sb_publishable_LEAKED0123'],
    ['cle Stripe', 'refus sk_live_0123456789abcdef', 'sk_live_0123456789abcdef'],
  ])('removes a %s', (_label, input, canary) => {
    expect(redactSensitiveText(input)).not.toContain(canary);
  });

  it('keeps what a support ticket actually needs', () => {
    const output = redactSensitiveText(
      'HTTP 403 sur https://exemple.supabase.co/rest/v1/rpc/record_inventory_movement?apikey=SECRET',
    );

    // L'hote et la route ne sont pas des secrets : sans eux le message ne
    // permet plus de diagnostiquer quoi que ce soit.
    expect(output).toContain('exemple.supabase.co');
    expect(output).toContain('record_inventory_movement');
    expect(output).toContain('HTTP 403');
    expect(output).not.toContain('SECRET');
  });

  it('leaves an ordinary business message untouched', () => {
    // Sur-expurger detruirait la valeur de diagnostic aussi surement qu une fuite.
    for (const message of [
      'stock insuffisant pour le produit demande',
      'duplicate key value violates unique constraint "inventory_movements_pkey"',
      'permission denied for function record_inventory_movement',
      'HTTP 429 — trop de requetes',
    ]) {
      expect(redactSensitiveText(message)).toBe(message);
    }
  });

  it('does not throw on hostile or degenerate input', () => {
    for (const input of ['', ' ', '@', '?token=', 'Bearer ', 'x'.repeat(20_000)]) {
      expect(() => redactSensitiveText(input)).not.toThrow();
    }
  });
});
