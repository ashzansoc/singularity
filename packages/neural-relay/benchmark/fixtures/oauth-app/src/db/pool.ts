export interface DbOptions {
  url: string;
  maxConnections: number;
}

export class ConnectionPool {
  private readonly options: DbOptions;
  private active = 0;

  constructor(options: DbOptions) {
    this.options = options;
  }

  async acquire(): Promise<string> {
    if (this.active >= this.options.maxConnections) {
      throw new Error('pool exhausted');
    }
    this.active += 1;
    return `conn-${this.active}`;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  usage(): number {
    return this.active;
  }
}

export function createPool(url: string, maxConnections = 10): ConnectionPool {
  return new ConnectionPool({ url, maxConnections });
}