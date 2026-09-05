export interface NotifTarget {
  channel: 'push' | 'sms' | 'inapp';
  address: string;
}

const pending: NotifTarget[] = [];

export function registerDevice(channel: NotifTarget['channel'], address: string): void {
  pending.push({ channel, address });
}

export function broadcast(message: string): number {
  const recipients = pending.length || 1;
  // In production this fans out via FCM/SNS; fixture just counts.
  return recipients;
}

export function listDevices(): NotifTarget[] {
  return [...pending];
}

export function clearDevices(): void {
  pending.length = 0;
}