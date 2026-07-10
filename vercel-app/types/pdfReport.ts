export interface PdfReservePhoto {
  uri: string;
  // Annotations dessinées sur la photo (format partagé mobile/web, champ
  // annotations du JSONB reserves.photos) — rendues en surimpression SVG
  // dans les rapports PDF.
  annotations?: Array<Record<string, unknown>>;
}

export interface PdfReserveItem {
  id: string;
  num: number;
  title: string;
  company: string;
  building?: string;
  level?: string;
  status: string;
  priority: string;
  deadline?: string;
  description?: string;
  planId?: string;
  planX?: number;
  planY?: number;
  photos: PdfReservePhoto[];
}

export interface PdfPlanItem {
  id: string;
  name: string;
  building?: string;
  level?: string;
  uri?: string;
  fileType?: string;
}

export interface PdfReportPayload {
  chantierName: string;
  companyFilter: string | null;
  generatedAt: string;
  plans: PdfPlanItem[];
  reserves: PdfReserveItem[];
  recipients: string[];
  sendByEmail: boolean;
}
