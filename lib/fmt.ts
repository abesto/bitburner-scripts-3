import * as colors from "./colors";

const MoneySuffixes: Record<string, number> = {
  k: 3,
  m: 6,
  b: 9,
  t: 12,
};

export class Fmt {
  constructor(private ns: NS) {}

  money(n: number): string {
    return "$" + this.ns.formatNumber(n, 3, 10000);
  }

  moneyShort(n: number): string {
    return "$" + this.ns.formatNumber(n, 1);
  }

  float(n: number): string {
    return this.ns.formatNumber(n, 3, Infinity);
  }

  int(n: number): string {
    return this.ns.formatNumber(n, 0, Infinity);
  }

  intShort(n: number): string {
    return this.ns.formatNumber(n, 0, 10000);
  }

  time(t: number, milliPrecition?: boolean): string {
    return this.ns.tFormat(t, milliPrecition);
  }

  timeSeconds(t: number): string {
    return this.ns.formatNumber(t / 1000, 3, Infinity) + "s";
  }

  timeMs(t: number): string {
    return this.int(t) + "ms";
  }

  timestamp(ms: number): string {
    const date = new Date(ms);
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}`;
  }

  memory(t: number): string {
    return this.ns.formatRam(t);
  }

  keyValue(...items: [string, string][]): string {
    return items.map(([key, value]) => `${key}=${value}`).join(" ");
  }

  keyValueTabulated(...rows: [string, ...[string, string][]][]): string[] {
    const strRows: [string, string[]][] = rows.map(([prefix, ...fields]) => [
      prefix,
      fields.map(([key, value]) => `${key}=${value}`),
    ]);

    const maxColumnLengths: number[] = strRows.reduce<number[]>(
      (acc, [, fields]) => {
        fields.forEach((field, i) => {
          acc[i] = Math.max(acc[i] || 0, field.length);
        });
        return acc;
      },
      []
    );

    const maxPrefixLength = rows.reduce(
      (acc, [prefix]) => Math.max(acc, prefix.length),
      0
    );

    const lines: string[] = [];
    for (const [prefix, fields] of strRows) {
      lines.push(
        `[${prefix.padStart(maxPrefixLength)}] ${fields
          .map((field, i) => field.padEnd(maxColumnLengths[i] ?? 0))
          .join(" ")}`
      );
    }

    return lines;
  }

  table(headers: string[], ...rows: string[][]): string[] {
    const maxColumnLengths = headers.map((header, i) =>
      Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0))
    );

    return [
      headers
        .map((header, i) =>
          colors.white(header.padEnd(maxColumnLengths[i] ?? 0))
        )
        .join("\t"),
      ...rows.map((row) =>
        row.map((field, i) => field.padEnd(maxColumnLengths[i] ?? 0)).join("\t")
      ),
    ];
  }

  parseMoney(x: string | number): number {
    if (typeof x === "string") {
      const [, num, suffix] = x.match(/^\$?([0-9.]+)([a-z]?)$/i) || [];
      if (!num) throw new Error(`invalid money: ${x}`);
      return parseFloat(num) * 10 ** (suffix ? MoneySuffixes[suffix] ?? 0 : 0);
    }
    return x;
  }

  percent(x: number): string {
    return `${Math.round(x * 100).toString()}%`;
  }
}

export function highlightValue(value: unknown): string {
  if (typeof value === "string") {
    return colors.green(value);
  } else if (typeof value === "number" && isNaN(value)) {
    return colors.red("NaN");
  } else if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  } else if (typeof value === "undefined" || value === null) {
    return colors.black(value === null ? "null" : "undefined");
  } else {
    return highlightJSON(value);
  }
}

export function highlightJSON(value: unknown): string {
  if (typeof value === "string") {
    return colors.green(`"${value.replaceAll('"', '\\"')}"`);
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined" ||
    value === null
  ) {
    return highlightValue(value);
  } else if (value instanceof Map) {
    return `Map(${value.size.toString()})${highlightJSON(
      Object.fromEntries(value.entries())
    )}`;
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      const parts = value.map((value) => highlightJSON(value));
      return "[" + parts.join(",") + "]";
    }
    const parts = Object.entries(value).map(([key, value]) => {
      return `${colors.cyan(
        '"' + key.replaceAll('"', '\\"') + '"'
      )}:${highlightJSON(value)}`;
    });

    return "{" + parts.join(",") + "}";
  } else if (typeof value === "function") {
    return colors.blue(value.toString());
  }
  throw new Error(`unreachable: ${typeof value}`);
}

export function formatKeyvalue(keyvalue: Record<string, unknown>): string {
  const parts = [];
  for (const [key, value] of Object.entries(keyvalue)) {
    parts.push(`${colors.cyan(key)}=${highlightValue(value)}`);
  }
  return parts.join(" ");
}
