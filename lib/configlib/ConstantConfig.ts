import IConfig from "./IConfig";

export class ConstantConfig<D extends object> implements IConfig<D> {
  private data: D;

  constructor(data: D) {
    this.data = data;
  }

  get<K extends keyof D>(key: K): Promise<D[K]> {
    return Promise.resolve(this.data[key]);
  }

  set<K extends keyof D>(): Promise<D[K]> {
    throw new Error("Cannot set values in a ConstantConfig");
  }
}
