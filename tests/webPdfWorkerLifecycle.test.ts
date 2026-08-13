import { describe, expect, it, vi } from 'vitest';

import {
  configurePdfJsWorker,
  createDedicatedPdfLoadingTask,
} from '../vercel-app/app/web/plan-reserve-workspace/pdfjs-client';

describe('BuildTrack web PDF worker lifecycle', () => {
  it('clears the shared worker port and configures the bundled worker URL', () => {
    const sharedWorker = { shared: true };
    const pdfjs = {
      GlobalWorkerOptions: {
        workerPort: sharedWorker,
        workerSrc: '',
      },
    };

    configurePdfJsWorker(pdfjs, '/_next/static/pdf.worker.test.mjs');

    expect(pdfjs.GlobalWorkerOptions.workerPort).toBeNull();
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/_next/static/pdf.worker.test.mjs');
  });

  it('opens successive plans with isolated workers and destroys each session once', async () => {
    const workers: Array<{ id: number; destroyed: boolean; destroy: ReturnType<typeof vi.fn> }> = [];
    const loadingTasks: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    class FakePdfWorker {
      id = workers.length + 1;
      destroyed = false;
      destroy = vi.fn(() => {
        this.destroyed = true;
      });

      constructor() {
        workers.push(this);
      }
    }
    const getDocument = vi.fn(({ worker }: { worker: FakePdfWorker }) => {
      const loadingTask = {
        promise: Promise.resolve({}),
        destroy: vi.fn(async () => undefined),
        worker,
      };
      loadingTasks.push(loadingTask);
      return loadingTask;
    });
    const pdfjs = {
      GlobalWorkerOptions: { workerPort: null, workerSrc: '/worker.mjs' },
      PDFWorker: FakePdfWorker,
      getDocument,
    };

    const firstPlan = createDedicatedPdfLoadingTask(pdfjs, { url: '/plans/first.pdf' });
    const secondPlan = createDedicatedPdfLoadingTask(pdfjs, { url: '/plans/second.pdf' });

    expect(getDocument).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: '/plans/first.pdf',
      worker: workers[0],
    }));
    expect(getDocument).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: '/plans/second.pdf',
      worker: workers[1],
    }));
    expect(workers[0]).not.toBe(workers[1]);

    await firstPlan.destroy();
    await firstPlan.destroy();
    expect(loadingTasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(workers[0].destroy).toHaveBeenCalledTimes(1);
    expect(workers[0].destroyed).toBe(true);
    expect(workers[1].destroyed).toBe(false);

    await secondPlan.destroy();
    expect(loadingTasks[1].destroy).toHaveBeenCalledTimes(1);
    expect(workers[1].destroy).toHaveBeenCalledTimes(1);
    expect(workers[1].destroyed).toBe(true);
  });
});
