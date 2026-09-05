export interface OrderLine {
  sku: string;
  qty: number;
}

export interface Order {
  id: string;
  userId: string;
  lines: OrderLine[];
  totalCents: number;
}

const orders = new Map<string, Order>();

export class OrderService {
  place(userId: string, lines: OrderLine[]): Order {
    const id = `ord_${orders.size + 1}`;
    const totalCents = lines.reduce((sum, l) => sum + l.qty * 499, 0);
    const order: Order = { id, userId, lines, totalCents };
    orders.set(id, order);
    return order;
  }

  findById(id: string): Order | undefined {
    return orders.get(id);
  }

  listByUser(userId: string): Order[] {
    return [...orders.values()].filter((o) => o.userId === userId);
  }
}

export const ordersSvc = new OrderService();