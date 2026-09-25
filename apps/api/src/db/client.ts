import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const client = postgres(url, { connect_timeout: 3, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db,
    /** Resolves true if the database answers a trivial query. */
    async isReachable(): Promise<boolean> {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.end({ timeout: 5 }),
  };
}
