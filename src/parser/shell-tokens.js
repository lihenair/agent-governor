/**
 * Quote-aware argv tokenizer. Operators become `{ op }`; words are strings.
 * Covers the subset parseBash / bash-write need (quotes, pipes, &&, redirects).
 */

const OPERATORS = ['||', '&&', '|&', '>>', '>&', '<&', '<<', ';;', '|', ';', '&', '>', '<'];

function operatorAt(input, index) {
  for (const op of OPERATORS) {
    if (input.startsWith(op, index)) {
      return op;
    }
  }
  return null;
}

/**
 * @param {string} command
 * @returns {Array<string|{op:string}>}
 */
export function parseShell(command) {
  const input = String(command || '');
  const tokens = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    while (i < n && /[ \t\n]/.test(input[i])) {
      i += 1;
    }
    if (i >= n) {
      break;
    }
    if (input[i] === '#') {
      break;
    }

    const op = operatorAt(input, i);
    if (op) {
      tokens.push({ op });
      i += op.length;
      continue;
    }

    let out = '';
    while (i < n) {
      const c = input[i];
      if (/[ \t\n]/.test(c)) {
        break;
      }
      if (operatorAt(input, i)) {
        break;
      }
      if (c === "'") {
        i += 1;
        while (i < n && input[i] !== "'") {
          out += input[i];
          i += 1;
        }
        if (i < n) {
          i += 1;
        }
        continue;
      }
      if (c === '"') {
        i += 1;
        while (i < n && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < n) {
            i += 1;
            out += input[i];
            i += 1;
            continue;
          }
          out += input[i];
          i += 1;
        }
        if (i < n) {
          i += 1;
        }
        continue;
      }
      if (c === '\\' && i + 1 < n) {
        i += 1;
        out += input[i];
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    }
    if (out.length > 0) {
      tokens.push(out);
    }
  }

  return tokens;
}
