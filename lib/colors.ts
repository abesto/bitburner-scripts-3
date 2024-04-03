export const BLACK = "\u001b[30m";
export const RED = "\u001b[31m";
export const GREEN = "\u001b[32m";
export const YELLOW = "\u001b[33m";
export const BLUE = "\u001b[34m";
export const MAGENTA = "\u001b[35m";
export const CYAN = "\u001b[36m";
export const WHITE = "\u001b[37m";
export const RESET = "\u001b[0m";

export function black(text: string): string {
  return BLACK + text + RESET;
}
export function red(text: string): string {
  return RED + text + RESET;
}
export function green(text: string): string {
  return GREEN + text + RESET;
}
export function yellow(text: string): string {
  return YELLOW + text + RESET;
}
export function blue(text: string): string {
  return BLUE + text + RESET;
}
export function magenta(text: string): string {
  return MAGENTA + text + RESET;
}
export function cyan(text: string): string {
  return CYAN + text + RESET;
}
export function white(text: string): string {
  return WHITE + text + GREEN;
}

export const fg256 = (r: number, g: number, b: number) => (text: string) => {
  const color = 16 + r * 36 + g * 6 + b;
  return `\u001b[38;5;${color.toString()}m` + text + RESET;
};

export const darkYellow = fg256(4, 3, 0);
