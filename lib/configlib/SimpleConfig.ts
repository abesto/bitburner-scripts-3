import cloneDeep from "clone-deep";
import IConfig from "./IConfig";

export default class SimpleConfig<D extends object> implements IConfig<D> {
  private data: D;

  constructor(data: D) {
    this.data = cloneDeep(data);
  }

  get<K extends keyof D>(key: K): Promise<D[K]> {
    return Promise.resolve(this.data[key]);
  }

  set<K extends keyof D>(key: K, value: D[K]): Promise<D[K]> {
    const oldValue = this.data[key];
    this.data[key] = value;
    return Promise.resolve(oldValue);
  }
}
