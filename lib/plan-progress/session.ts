import { emptyProgress, overlayProgress, progressDiff, readProgress, type ProgressDocument, type ProgressOperation } from './core';

export type ProgressSessionPorts = {
  planId: string; sourceRef: string;
  cacheRead: () => Promise<string | null>;
  cacheWrite: (value: string) => Promise<void>;
  read: () => Promise<unknown>;
  pending: () => Promise<ProgressOperation[]>;
  enqueue: (operation: ProgressOperation) => Promise<void>;
  newId: () => string;
  owned: () => boolean;
  online?: () => boolean;
};
/** Host-owned session. The embedded editor never receives a Supabase client or token. */
export class ProgressSession {
  document: ProgressDocument = emptyProgress();
  history: Record<string, unknown>[] = [];
  fresh = false;
  private busy = false;
  constructor(private ports: ProgressSessionPorts) {}
  async open() {
    const p = this.ports;
    const cached = await p.cacheRead();
    let document: ProgressDocument | null = null;
    if (cached) { try { const parsed = JSON.parse(cached); document = readProgress(parsed); this.history = Array.isArray(parsed.history) ? parsed.history : []; } catch { /* A malformed cache cannot become authoritative. */ } }
    let pending = await p.pending();
    // Preserve the local snapshot throughout an in-flight replay. A later reopening
    // with an empty queue reads the server again, including other users' changes.
    if (!document || (pending.length === 0 && p.online?.() !== false)) {
      try { const value = await p.read(); document = readProgress(value); this.fresh = p.online?.() !== false; this.history = Array.isArray((value as any)?.history) ? (value as any).history : []; }
      catch (error) {
        const problem = error as { code?: string; status?: number };
        if (!document || problem?.code === '42501' || problem?.status === 401 || problem?.status === 403) throw error;
      }
    }
    pending = await p.pending();
    if (pending.length) this.fresh = false;
    for (const operation of pending) document = overlayProgress(document ?? emptyProgress(), operation.changes);
    if (!p.owned()) throw new Error('Le compte a changé.');
    this.document = document ?? emptyProgress();
    // Profiles without financial access receive no prices; the renderer uses 0
    // locally, but field-level patches never write those placeholders back.
    this.document.elements = this.document.elements.map(el => ({ ...el, price: el.price ?? 0 }));
    await p.cacheWrite(JSON.stringify({ ...this.document,history:this.history }));
    return this.document;
  }
  async save(value: unknown) {
    if (this.busy || !this.ports.owned()) throw new Error('Enregistrement déjà en cours ou session modifiée.');
    const next = readProgress(value);
    if (next.elements.some(el => el.docId !== this.ports.planId)) throw new Error('Le plan de l’ouvrage a changé.');
    const changes = progressDiff(this.document, next);
    if (!changes.length) return;
    if (changes.length > 500 || JSON.stringify(changes).length > 1_000_000) throw new Error('Modification trop volumineuse.');
    this.busy = true;
    try {
      await this.ports.enqueue({ id: this.ports.newId(), planId: this.ports.planId, sourceRef: this.ports.sourceRef, changes });
      this.document = JSON.parse(JSON.stringify(next));
      // The queue is the durable source of pending intent; a secondary cache
      // failure must not report a rejected save after enqueue has succeeded.
      await this.ports.cacheWrite(JSON.stringify({ ...this.document,history:this.history })).catch(() => {});
    } finally { this.busy = false; }
  }
  /** Called only while the editor has locked its controls and has no draft. */
  async refresh() {
    const p = this.ports;
    if (this.busy || !p.owned() || p.online?.() === false || (await p.pending()).length) return null;
    this.busy = true;
    try {
      const value = await p.read();
      if (!p.owned() || (await p.pending()).length) return null;
      const document = readProgress(value);
      document.elements = document.elements.map(el => ({ ...el,price:el.price ?? 0 }));
      this.document = document;
      this.history = Array.isArray((value as any)?.history) ? (value as any).history : [];
      await p.cacheWrite(JSON.stringify({ ...document,history:this.history })).catch(() => {});
      return { document,history:this.history };
    } finally { this.busy = false; }
  }
}
