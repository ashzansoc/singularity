export interface Invoice {
  id: string;
  userId: string;
  amountUsd: number;
  status: 'draft' | 'issued' | 'paid';
}

const invoices = new Map<string, Invoice>();

export class BillingService {
  createInvoice(userId: string, amountUsd: number): Invoice {
    const inv: Invoice = {
      id: `inv_${invoices.size + 1}`,
      userId,
      amountUsd,
      status: 'issued',
    };
    invoices.set(inv.id, inv);
    return inv;
  }

  applyPromoCode(userId: string, code: string): number {
    return code.startsWith('SAVE') ? 10 : 0;
  }

  markPaid(id: string): void {
    const inv = invoices.get(id);
    if (inv) {
      inv.status = 'paid';
    }
  }

  listForUser(userId: string): Invoice[] {
    return [...invoices.values()].filter((i) => i.userId === userId);
  }
}

export const billing = new BillingService();