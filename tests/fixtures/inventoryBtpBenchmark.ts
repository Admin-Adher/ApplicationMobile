import type { WebSearchResult } from '../../lib/inventoryBarcodeCore';

export interface InventoryBtpBenchmarkCase {
  gtin: string;
  brand: string;
  category: string;
  expectedTokens: string[];
  officialSource: string;
  results: WebSearchResult[];
}

/**
 * Search-result snapshots for real construction products. Every GTIN and
 * expected variant was checked against the manufacturer's page or catalogue.
 * The fixtures deliberately include a generic catalogue result for Bosch so
 * the selector must prefer the precise product result instead of claiming a
 * false success from a year number.
 */
export const inventoryBtpBenchmark: InventoryBtpBenchmarkCase[] = [
  {
    gtin: '3245064079709',
    brand: 'Legrand',
    category: 'Electricite - disjoncteur',
    expectedTokens: ['DX3', '13A', '407970'],
    officialSource: 'https://www.legrand.com/ecatalogue/en/catalog/products/mcb-dx3-6000a-1-pole-13a-curve-407970',
    results: [{
      title: 'MCB DX3 6000A 1 pole 13A curve D | 407970 | 3245064079709 | LEGRAND',
      description: 'DX3 LEGRAND. REF. 407970 EAN. 3245064079709. Thermal magnetic circuit-breaker, rated current 13 A, 230 V, IP20.',
      url: 'https://www.legrand.com/ecatalogue/en/catalog/products/mcb-dx3-6000a-1-pole-13a-curve-407970',
      profile: { long_name: 'Legrand' },
    }],
  },
  {
    gtin: '3250614435225',
    brand: 'Hager',
    category: 'Electricite - protection moteur',
    expectedTokens: ['MM509N', '4.0-6.3A', '3P'],
    officialSource: 'https://hager.com/intl-en/products/information/mm509n-motor-starter-4-0-6-3a-2-5m',
    results: [{
      title: 'Motor starter 4.0-6.3A 2.5M • MM509N | Hager',
      description: 'EAN 3250614435225. Motor protection circuit breaker 3P 4-6.3A; 1.1/2.2 kW at 230/415V. Packaging 1 Piece.',
      url: 'https://hager.com/intl-en/products/information/mm509n-motor-starter-4-0-6-3a-2-5m',
      profile: { long_name: 'Hager' },
    }],
  },
  {
    gtin: '4005176465468',
    brand: 'GROHE',
    category: 'Plomberie - robinetterie',
    expectedTokens: ['Essence', '24057001', '1 sortie'],
    officialSource: 'https://www.grohe.fr/fr_fr/essence-mitigeur-monocommande-1-sortie-24057001.html',
    results: [{
      title: 'Essence Mitigeur monocommande 1 sortie | GROHE',
      description: 'Reference du produit 24057001. EAN 4005176465468. Finition chrome. Mitigeur de douche monocommande GROHE Essence.',
      url: 'https://www.grohe.fr/fr_fr/essence-mitigeur-monocommande-1-sortie-24057001.html',
      profile: { long_name: 'GROHE' },
    }],
  },
  {
    gtin: '4003773033837',
    brand: 'KNIPEX',
    category: 'Outillage a main - pince-cle',
    expectedTokens: ['Pliers Wrench', '86 03 250', '250 x 53 x 18 mm'],
    officialSource: 'https://www.knipex.com/fr-fr/produits/pinces-multiprises-et-cles-serre-tubes/pinces-cles-pince-et-cle-a-la-fois/pinces-cles-pince-et-cle-a-la-fois/8603250',
    results: [{
      title: 'Pliers Wrench - pliers and a wrench in a single tool | KNIPEX',
      description: 'Part No. 86 03 250. EAN 4003773033837. Chrome-plated pliers with plastic coated handles. Dimensions 250 x 53 x 18 mm.',
      url: 'https://www.knipex.com/fr-fr/produits/pinces-multiprises-et-cles-serre-tubes/pinces-cles-pince-et-cle-a-la-fois/pinces-cles-pince-et-cle-a-la-fois/8603250',
      profile: { long_name: 'KNIPEX' },
    }],
  },
  {
    gtin: '4010995008802',
    brand: 'Wiha',
    category: 'Outillage electricien - tournevis VDE',
    expectedTokens: ['SoftFinish', 'PZ3', '00880', '150 mm'],
    officialSource: 'https://wiha.com/tools/screwdrivers/vde-screwdrivers/softfinish-electric/pozidriv/screwdriver-softfinish-electric/00880',
    results: [{
      title: 'Screwdriver SoftFinish electric | PZ3 | 150 mm | 00880',
      description: 'Order number 00880. EAN 4010995008802. Pozidriv PZ3, visible blade length 150 mm, overall length 324 mm, VDE 1000 V AC.',
      url: 'https://wiha.com/tools/screwdrivers/vde-screwdrivers/softfinish-electric/pozidriv/screwdriver-softfinish-electric/00880',
      profile: { long_name: 'Wiha' },
    }],
  },
  {
    gtin: '0088381367004',
    brand: 'Makita',
    category: 'Electroportatif - batterie',
    expectedTokens: ['BL1830', '193533-3', '18 V', '3,0 Ah'],
    officialSource: 'https://www.makita.fr/data/sr/productinfo/generated/193533-3_fiche_produit.pdf',
    results: [{
      title: 'BATTERIE BL1830 LI-ION 18V 3A',
      description: 'Reference 193533-3. BATTERIE BL1830 LI-ION 18V 3A. Capacite de la batterie 3,0 Ah, 54 Wh. Code EAN 0088381367004.',
      url: 'https://www.makita.fr/data/sr/productinfo/generated/193533-3_fiche_produit.pdf',
      profile: { long_name: 'Makita France' },
    }],
  },
  {
    gtin: '4059952650234',
    brand: 'Bosch Professional',
    category: 'Consommable - foret beton',
    expectedTokens: ['PRO HEX-5', '2608706968', '3x50x100 mm'],
    officialSource: 'https://www.bosch-professional.com/ch/media/service_relaunch/downloads/kataloge/2026_t1/ac_ch_fr-web.pdf',
    results: [
      {
        title: 'ACCESSOIRES 2026',
        description: 'Caracteristiques du produit: 3 mm, longueur utile 50 mm, longueur totale 100 mm. Barcode 4059952650234. Part number 2 608 706 968.',
        url: 'https://www.bosch-professional.com/ch/media/service_relaunch/downloads/kataloge/2026_t1/ac_ch_fr-web.pdf',
        profile: { long_name: 'Bosch Professional' },
      },
      {
        title: 'Bosch PRO HEX-5 foret beton 3x50x100 mm - 2608706968',
        description: 'EAN 4059952650234. Bosch Professional PRO HEX-5, diametre 3 mm, longueur utile 50 mm et longueur totale 100 mm.',
        url: 'https://www.toolnation.example/bosch-2608706968-pro-hex-5-3x50x100',
      },
    ],
  },
  {
    gtin: '4013288017772',
    brand: 'Wera',
    category: 'Outillage a main - tournevis a frapper',
    expectedTokens: ['918 SPZ', 'PZ 1', '80 mm', '05017050001'],
    officialSource: 'https://hybris-media.wera.de/download/pdfgenerator-datasheets/en/05017050001.pdf',
    results: [{
      title: '918 SPZ Screwdriver for Pozidriv screws, PZ 1 x 80 mm',
      description: 'EAN 4013288017772. Part number 05017050001. Article number 918 SPZ. Chiseldriver with impact cap.',
      url: 'https://hybris-media.wera.de/download/pdfgenerator-datasheets/en/05017050001.pdf',
      profile: { long_name: 'Wera' },
    }],
  },
  {
    gtin: '4031026479880',
    brand: 'HellermannTyton',
    category: 'Consommable electrique - ruban isolant',
    expectedTokens: ['HTAPE-FLEX15', '710-00155', '19x20'],
    officialSource: 'https://www.hellermanntyton.com/ar/productos/cintas-aislantes/htape-flex15-19x20/710-00155',
    results: [{
      title: 'HTAPE-FLEX15-19x20 (710-00155) | HellermannTyton',
      description: 'EAN / GTIN 4031026479880. Electrical insulation tape, black, width 19 mm, length 20 m. Article No. 710-00155.',
      url: 'https://www.hellermanntyton.com/ar/productos/cintas-aislantes/htape-flex15-19x20/710-00155',
      profile: { long_name: 'HellermannTyton' },
    }],
  },
  {
    gtin: '5906675001050',
    brand: 'Rawlplug',
    category: 'Fixation - cheville a frapper',
    expectedTokens: ['FX-C', '5x30 mm', '200 pcs'],
    officialSource: 'https://rawlplug.com/global/en/p/fx-05c030',
    results: [{
      title: 'FX-C Hammer-in fixing with cylindrical head 5x30 mm - cardboard box - 200 pcs.',
      description: 'Product code FX-05C030. Bar code 5906675001050. Plug diameter 5 mm, length 30 mm, box 200 pcs.',
      url: 'https://rawlplug.com/global/en/p/fx-05c030',
      profile: { long_name: 'Rawlplug' },
    }],
  },
];
