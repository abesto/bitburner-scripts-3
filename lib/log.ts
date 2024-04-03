import * as colors from "./colors";
import { formatKeyvalue } from "./fmt";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export class Log {
  constructor(private readonly ns: NS, private readonly name: string) {
    ns.disableLog("ALL");
  }

  scope(name: string): Log {
    return new Log(this.ns, `${this.name}.${name}`);
  }

  timestampField(): string {
    const date = new Date();
    const str = `[${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}]`;
    return colors.black(str);
  }

  levelField(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return colors.black("debug");
      case LogLevel.INFO:
        return colors.green(" info");
      case LogLevel.WARN:
        return colors.yellow(" warn");
      case LogLevel.ERROR:
        return colors.red("error");
    }
  }

  nameField(): string {
    return "[" + this.name.padStart(10, " ") + "]";
  }

  format(
    level: LogLevel,
    message: string,
    keyvalue: Record<string, unknown>
  ): string {
    return `${this.timestampField()} ${this.levelField(
      level
    )} ${this.nameField()} ${colors.white(message)} ${formatKeyvalue(
      keyvalue
    )}`;
  }

  log(
    level: LogLevel,
    message: string,
    keyvalue: Record<string, unknown>
  ): void {
    this.ns.printf("%s", this.format(level, message, keyvalue));
  }

  debug(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.log(LogLevel.DEBUG, message, keyvalue);
  }

  info(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.log(LogLevel.INFO, message, keyvalue);
  }

  warn(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.log(LogLevel.WARN, message, keyvalue);
  }

  error(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.log(LogLevel.ERROR, message, keyvalue);
  }

  tlog(
    level: LogLevel,
    message: string,
    keyvalue: Record<string, unknown>
  ): void {
    this.ns.tprintf("%s", this.format(level, message, keyvalue));
  }

  tdebug(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.tlog(LogLevel.DEBUG, message, keyvalue);
  }

  tinfo(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.tlog(LogLevel.INFO, message, keyvalue);
  }

  twarn(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.tlog(LogLevel.WARN, message, keyvalue);
  }

  terror(message: string, keyvalue: Record<string, unknown> = {}): void {
    this.tlog(LogLevel.ERROR, message, keyvalue);
  }
}
