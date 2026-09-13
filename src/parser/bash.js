import path from 'node:path';
import { parse } from 'shell-quote';
import { capabilitiesFor } from './capabilities.js';

function safeParse(command) {
  try {
    return parse(String(command || ''));
  } catch {
    return String(command || '').split(/\s+/).filter(Boolean);
  }
}

function flushArgv(argv, sink) {
  if (argv.length === 0) {
    return;
  }
  sink.push(toNode(argv));
}

function toNode(argv) {
  const program = argv[0] || '';
  const args = argv.slice(1);
  const name = path.basename(program);
  const children = [];
  const payloads = [];

  const dashC = args.indexOf('-c');
  if ((name === 'bash' || name === 'sh' || name === 'zsh') && dashC >= 0 && args[dashC + 1]) {
    payloads.push(args[dashC + 1]);
    children.push(...parseBash(args[dashC + 1]));
  }

  if ((name === 'python' || name === 'python3' || name === 'pypy') && dashC >= 0 && args[dashC + 1]) {
    payloads.push(args[dashC + 1]);
  }

  const dashE = args.findIndex((arg) => arg === '-e' || arg === '--eval');
  if (name === 'node' && dashE >= 0 && args[dashE + 1]) {
    payloads.push(args[dashE + 1]);
  }

  return {
    program,
    args,
    capabilities: capabilitiesFor(program, args, { payloads }),
    children,
  };
}

/**
 * Split a shell command into structured nodes.
 *
 * @param {string} command
 * @returns {{program:string, args:string[], capabilities:string[], children:object[]}[]}
 */
export function parseBash(command) {
  const tokens = safeParse(command);
  const nodes = [];
  let argv = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && typeof token === 'object' && token.op) {
      if (token.op === '>' || token.op === '>>') {
        const dest = tokens[index + 1];
        if (typeof dest === 'string') {
          argv.push(token.op, dest);
          index += 1;
        }
        continue;
      }
      flushArgv(argv, nodes);
      argv = [];
      continue;
    }
    if (typeof token === 'string' && token.length > 0) {
      argv.push(token);
    }
  }
  flushArgv(argv, nodes);
  return nodes;
}

/**
 * @param {{capabilities?: string[], children?: object[]}[]} nodes
 * @returns {string[]}
 */
export function collectCapabilities(nodes) {
  const caps = new Set();
  function walk(list) {
    for (const node of list || []) {
      for (const cap of node.capabilities || []) {
        caps.add(cap);
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return [...caps];
}
