-- ============================================================
-- Insertion des 38 entreprises pour l'organisation
-- id : 00000000-0000-0000-0000-000000000002
-- ============================================================

INSERT INTO public.companies (
  id, name, short_name, color,
  planned_workers, actual_workers, hours_worked,
  zone, contact, organization_id
)
VALUES
  (gen_random_uuid()::text, 'CIVIL & STEEL',                    'C&S',     '#3B82F6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'THERRESTRA - Hgon y Panete',       'TH-HP',   '#10B981', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'THERRESTRA - Saneam.',             'TH-S',    '#F59E0B', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ACUARIO',                          'ACU',     '#EF4444', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'BASICORP',                         'BAS',     '#8B5CF6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'INICA',                            'INI',     '#06B6D4', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'SYMANTEL',                         'SYM',     '#F97316', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ADIPISO',                          'ADI',     '#EC4899', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'AISLANTE y TECHOS',                'A&T',     '#14B8A6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ALUGAV',                           'ALU',     '#84CC16', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ARKEO - Pintura',                  'ARK-P',   '#3B82F6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ARKEO - Fachada',                  'ARK-F',   '#10B981', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'AWCO',                             'AWC',     '#F59E0B', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'BCRD Albanil TH',                  'BCRD-A',  '#EF4444', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'BCRD Carpintero TH',               'BCRD-CT', '#8B5CF6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'BCRD Carpintero BY',               'BCRD-CB', '#06B6D4', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'BYB',                              'BYB',     '#F97316', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'COBIAN',                           'COB',     '#EC4899', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'GRUPO EMCARO - Brick Veener',      'GE-BV',   '#14B8A6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'GRUPO EMCARO - Tiles & Stones',    'GE-TS',   '#84CC16', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'HACHE',                            'HAC',     '#3B82F6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'IMPER GROUP',                      'IMG',     '#10B981', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'INDIMAP',                          'IND',     '#F59E0B', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'J NIVAR',                          'JNI',     '#EF4444', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'MAESTROSOL - Fantom screen',       'MS-FS',   '#8B5CF6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'MAESTROSOL - Hurrican net',        'MS-HN',   '#06B6D4', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'MARMOTEC',                         'MAR',     '#F97316', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'NOBRIRA',                          'NOB',     '#EC4899', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ROCA ATL. - Drywall',              'RA-DW',   '#14B8A6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ROCA ATL. - Prepiso',              'RA-PR',   '#84CC16', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ROCA ATL. - T&S',                  'RA-TS',   '#3B82F6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'Los Colombianos',                  'LCO',     '#10B981', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'TRIPOINT',                         'TRI',     '#F59E0B', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'VENTALIA',                         'VEN',     '#EF4444', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'GRUPO ELEC',                       'GEL',     '#8B5CF6', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'INCA',                             'INC',     '#06B6D4', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'KONE',                             'KON',     '#F97316', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid()::text, 'ACUARIUM',                         'ACM',     '#EC4899', 0, 0, 0, '', '', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;
