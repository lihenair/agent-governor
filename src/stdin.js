export async function readStdin(stream = process.stdin) {
  if (stream.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      data += chunk;
    });
    stream.on('end', () => {
      const trimmed = data.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        resolve(null);
      }
    });
    stream.on('error', () => resolve(null));
  });
}

export function emitBlock(message) {
  process.stderr.write(`${message}\n`);
}

export function exitAllow() {
  process.exit(0);
}

export function exitBlock() {
  process.exit(2);
}
