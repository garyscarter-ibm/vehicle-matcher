// Inline event attributes only exist in markup: .html/.svg files and inline Angular `template:` strings.
// TypeScript code is not scanned, so identifiers such as `const only =` pass.
const event = /\son[a-z]+\s*=/i;
const template = /\btemplate\s*:\s*(`(?:\\[\s\S]|[^\\`])*`|'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*")/g;
export function hasInlineEvent(path, source) {
  if (/\.(?:html|svg)$/i.test(path)) return event.test(source);
  if (path.endsWith('.ts')) return [...source.matchAll(template)].some(([, markup]) => event.test(markup));
  return false;
}
