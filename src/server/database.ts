import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface DatabaseOptions {
  connectionString: string;
  maxConnections: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  ssl: boolean;
}

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export class Database {
  private readonly pool: Pool;

  constructor(options: DatabaseOptions) {
    const poolConfig: PoolConfig = {
      connectionString: options.connectionString,
      max: options.maxConnections,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      idleTimeoutMillis: options.idleTimeoutMs,
      application_name: "phaseone-barcode-fulfillment",
      ssl: options.ssl,
    };
    this.pool = new Pool(poolConfig);
    this.pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error", error);
    });
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch((rollbackError: unknown) => {
        console.error("PostgreSQL rollback failed", rollbackError);
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    const result = await this.pool.query<{ healthy: number }>("SELECT 1 AS healthy");
    return result.rows[0]?.healthy === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
