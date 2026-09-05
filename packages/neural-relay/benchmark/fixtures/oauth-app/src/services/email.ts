export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

const transport = { queue: [] as EmailPayload[] };

export async function sendWelcomeEmail(addr: string): Promise<void> {
  transport.queue.push({
    to: addr,
    subject: 'Welcome',
    body: `Hi ${addr}, thanks for joining.`,
  });
}

export async function sendPasswordReset(addr: string, code: string): Promise<void> {
  transport.queue.push({
    to: addr,
    subject: 'Password reset',
    body: `Use code ${code} to reset your password.`,
  });
}

export function flushEmailQueue(): EmailPayload[] {
  const out = transport.queue.splice(0);
  return out;
}