export const SECRET_PATTERNS = [
  /([A-Za-z0-9_]*(?:token|key|secret|password|authorization)[A-Za-z0-9_]*\s*[:=]\s*)(['"]?)[^\s'"]+\2/gi,
  /ghp_[A-Za-z0-9]+/g,
  /sk-[A-Za-z0-9]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/**
 * Redact secrets. Patterns are built-in and not user-configurable.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function redact(value) {
  let text = value == null ? '' : String(value);
  text = text.replace(SECRET_PATTERNS[3], 'Bearer ***');
  text = text.replace(SECRET_PATTERNS[1], 'ghp_***');
  text = text.replace(SECRET_PATTERNS[2], 'sk-***');
  text = text.replace(SECRET_PATTERNS[0], '$1$2***$2');
  return text;
}

/**
 * @param {unknown} input
 * @param {number} [limit]
 */
export function previewInput(input, limit = 200) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  const redacted = redact(raw);
  return redacted.length > limit ? redacted.slice(0, limit) : redacted;
}
