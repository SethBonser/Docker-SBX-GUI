// Strips ANSI escape sequences (CSI codes, OSC sequences, charset selection) from raw pty output.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\][^\x07]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][0-9A-Za-z]|\x1b[=>NOM]/g

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(ANSI_PATTERN, '').replace(/[\x00-\x08\x0e-\x1f]/g, '')
}
