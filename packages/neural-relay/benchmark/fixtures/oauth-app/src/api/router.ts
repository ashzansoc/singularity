import { listUsers, createUser } from './users.js';

export function handleApi(path: string, body?: { email?: string }) {
  if (path === '/api/users' && !body) {
    return listUsers();
  }
  if (path === '/api/users' && body?.email) {
    return createUser(body.email);
  }
  throw new Error(`unknown api ${path}`);
}
