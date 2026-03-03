export let VERBOSE = false;

export function setVerbose(v: boolean): void {
  VERBOSE = v;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function vlog(label: string, ...args: any[]): void {
  if (!VERBOSE) return;
  const msg = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ');
  console.log(dim(`  ${magenta(`[${ts()}]`)} ${label}: ${msg}`));
}
