export interface PdfReservePhoto {
  uri: string;
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
