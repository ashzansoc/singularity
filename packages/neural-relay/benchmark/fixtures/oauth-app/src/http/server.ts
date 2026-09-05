import { json, type HttpRequest, type HttpResponse } from './types.js';
import { logger } from '../telemetry/logger.js';

const routes = new Map<string, (req: HttpRequest) => Promise<HttpResponse>>();

export function register(method: string, path: string, handler: (req: HttpRequest) => Promise<HttpResponse>): void {
  routes.set(`${method} ${path}`, handler);
}

export async function dispatch(req: HttpRequest): Promise<HttpResponse> {
  const handler = routes.get(`${req.method} ${req.path}`);
  if (!handler) {
    return json(404, { error: 'not_found' });
  }
  try {
    return await handler(req);
  } catch (err) {
    logger.error('handler failed', { path: req.path, err: String(err) });
    return json(500, { error: 'internal_error' });
  }
}