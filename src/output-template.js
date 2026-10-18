// A small, dependency-free subset of yt-dlp's output template syntax.
//
// Supported forms:
//   %(field)s                     -> field value or empty string
//   %(field|default)s             -> literal default when the field is empty
//   %(field>%Y-%m-%d)s            -> format a date field
//   %(field>%Y|default)s          -> format, then fall back to a default
//   %(field).100s                 -> limit to 100 characters
//   %(field).100B                 -> limit to 100 UTF-8 bytes
//   %(a,b|default)s               -> first non-empty of several alternatives
//
// Unknown fields are treated as empty so a template can rely on `|default`.

export const DEFAULT_OUTPUT_TEMPLATE = '%(title)s_%(resolution)s_%(upload_date>%Y-%m-%dT%H-%M-%S)s.%(ext)s';

const PLACEHOLDER = /^(?:\.(\d+))?([sB])/;

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatDate(date, format) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const tokens = {
    '%Y': String(year),
    '%y': pad(year % 100),
    '%m': pad(date.getUTCMonth() + 1),
    '%d': pad(date.getUTCDate()),
    '%H': pad(date.getUTCHours()),
    '%M': pad(date.getUTCMinutes()),
    '%S': pad(date.getUTCSeconds()),
    '%j': pad(Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate())
      - Date.UTC(year, 0, 0)) / 86_400_000), 3),
    '%%': '%',
  };
  return String(format).replace(/%[YymdHMSj%]/g, (token) => tokens[token] ?? token);
}

function truncateCharacters(value, limit) {
  return [...value].slice(0, limit).join('');
}

function truncateBytes(value, limit) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= limit) return value;
  let end = limit;
  // Do not split a multibyte sequence in the middle.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function resolveExpression(fields, expression) {
  const gt = expression.indexOf('>');
  const name = (gt >= 0 ? expression.slice(0, gt) : expression).trim();
  const format = gt >= 0 ? expression.slice(gt + 1) : null;
  const raw = fields[name];
  if (raw === undefined || raw === null) return '';
  if (raw instanceof Date) return formatDate(raw, format || '%Y%m%d');
  return String(raw);
}

function renderField(body, limit, fields) {
  const separator = body.indexOf('|');
  const expressions = separator >= 0 ? body.slice(0, separator) : body;
  const fallback = separator >= 0 ? body.slice(separator + 1) : null;

  let value = '';
  for (const alternative of expressions.split(',')) {
    value = resolveExpression(fields, alternative);
    if (value !== '') break;
  }
  if (value === '' && fallback !== null) value = fallback;
  if (value === '' || !limit) return value;
  return limit.bytes ? truncateBytes(value, limit.value) : truncateCharacters(value, limit.value);
}

export function renderTemplate(template, fields = {}) {
  const source = String(template ?? '');
  let output = '';
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('%(' , cursor);
    if (start < 0) {
      output += source.slice(cursor);
      break;
    }
    const end = source.indexOf(')', start + 2);
    if (end < 0) {
      output += source.slice(cursor);
      break;
    }
    const spec = PLACEHOLDER.exec(source.slice(end + 1));
    if (!spec) {
      // Not one of our placeholders: keep it verbatim and keep scanning.
      output += source.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }
    const limit = spec[1] ? { value: Number(spec[1]), bytes: spec[2] === 'B' } : null;
    output += source.slice(cursor, start);
    output += renderField(source.slice(start + 2, end), limit, fields);
    cursor = end + 1 + spec[0].length;
  }
  return output;
}