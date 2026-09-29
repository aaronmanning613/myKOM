import postgres from 'postgres';

/** Creates the database named in `url` if it doesn't exist yet, connecting through `postgres`. */
export async function ensureDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { connect_timeout: 3, onnotice: () => {} });
  try {
    const [existing] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!existing) await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } catch (error) {
    throw new Error(
      `Couldn't prepare the ${name} database. Is Postgres running (docker compose up -d --wait)?`,
      { cause: error },
    );
  } finally {
    await admin.end();
  }
}
