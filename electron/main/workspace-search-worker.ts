import { parentPort } from 'node:worker_threads';
import {
  WorkspaceSearchError,
  WorkspaceSearchService,
  type WorkspaceSearchWorkerRequest,
  type WorkspaceSearchWorkerResponse,
} from './workspace-search';

const port = parentPort;
if (!port) throw new Error('The workspace search worker must run inside a worker thread.');

const service = new WorkspaceSearchService();
const operations = new Map<string, AbortController>();

function post(response: WorkspaceSearchWorkerResponse): void {
  port!.postMessage(response);
}

port.on('message', (message: WorkspaceSearchWorkerRequest) => {
  if (message.kind === 'cancel') {
    operations.get(message.operationId)?.abort();
    return;
  }
  if (message.kind === 'discard-preview') {
    post({
      kind: 'result',
      operationId: message.operationId,
      result: service.discardReplacePreview(message.previewToken),
    });
    return;
  }
  if (operations.has(message.operationId)) {
    post({
      kind: 'error',
      operationId: message.operationId,
      error: {
        name: 'WorkspaceSearchError',
        code: 'INVALID_REQUEST',
        message: 'The workspace operation identifier is already active.',
      },
    });
    return;
  }

  const controller = new AbortController();
  operations.set(message.operationId, controller);
  void (async () => {
    try {
      if (message.kind === 'search') {
        const result = await service.search({
          ...message.request,
          signal: controller.signal,
          onProgress: (progress) =>
            post({ kind: 'progress', operationId: message.operationId, progress }),
        });
        post({ kind: 'result', operationId: message.operationId, result });
      } else if (message.kind === 'preview') {
        const result = await service.createReplacePreview({
          ...message.request,
          search: { ...message.request.search, signal: controller.signal },
        });
        post({ kind: 'result', operationId: message.operationId, result });
      } else {
        const result = await service.applyReplacePreview({
          ...message.request,
          signal: controller.signal,
        });
        post({ kind: 'result', operationId: message.operationId, result });
      }
    } catch (error) {
      post({
        kind: 'error',
        operationId: message.operationId,
        error:
          error instanceof WorkspaceSearchError
            ? error.toJSON()
            : {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : 'Workspace operation failed.',
              },
      });
    } finally {
      operations.delete(message.operationId);
    }
  })();
});
