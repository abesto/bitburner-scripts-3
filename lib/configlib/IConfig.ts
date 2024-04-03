export default interface IConfig<D extends object> {
  get: <K extends keyof D>(key: K) => Promise<D[K]>;
  set: <K extends keyof D>(key: K, value: D[K]) => Promise<D[K]>;
}
