import { Pool } from 'pg';
import { hashPassword, validateNewPassword } from './auth/passwords.js';
import { loadConfig } from './config.js';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function fail(message: string): never {
  console.error(`admin:create: ${message}`);
  process.exit(1);
}

async function readLineFromStdin(hidden: boolean): Promise<string> {
  const stdin = process.stdin;
  stdin.resume();
  stdin.setEncoding('utf8');

  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) {
      data += chunk;
      const newline = data.search(/\r?\n/);
      if (newline !== -1) return data.slice(0, newline);
    }
    return data;
  }

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') {
          stdin.setRawMode(false);
          stdin.pause();
          reject(new Error('cancelled'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.setRawMode(true);
    process.stderr.write(hidden ? 'Password: ' : 'Input: ');
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fail('usage: npm run admin:create -- <username>  (password is read from stdin, never argv)');
  }
  const username = args[0]?.trim() ?? '';
  if (!USERNAME_PATTERN.test(username)) {
    fail('username must match ^[a-z0-9][a-z0-9._-]{2,31}$');
  }

  const password = await readLineFromStdin(true);
  const problem = validateNewPassword(password);
  if (problem) fail(problem);

  // Password appears only in this local variable; it is never logged or passed to argv.
  const pwHash = await hashPassword(password);
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await pool.query('INSERT INTO admin (username, pw_hash) VALUES ($1, $2)', [username, pwHash]);
    console.log(`admin:create: created ${username}`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') fail(`admin ${username} already exists`);
    throw error;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(`admin:create: failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
