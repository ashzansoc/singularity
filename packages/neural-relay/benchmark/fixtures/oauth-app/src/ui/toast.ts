export interface ToastMessage {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

let nextId = 1;
const toasts: ToastMessage[] = [];

export function toast(kind: ToastMessage['kind'], text: string): void {
  toasts.push({ id: nextId++, kind, text });
}

export function dismiss(id: number): void {
  const ix = toasts.findIndex((t) => t.id === id);
  if (ix >= 0) {
    toasts.splice(ix, 1);
  }
}

export function pendingToasts(): ToastMessage[] {
  return [...toasts];
}