const store = new WeakMap<object, Map<string, unknown>>();

/** Cache derived results per parsed model object. */
export function memo<T>(model: object, key: string, fn: () => T): T {
  let m = store.get(model);
  if (!m) {
    m = new Map();
    store.set(model, m);
  }
  if (!m.has(key)) m.set(key, fn());
  return m.get(key) as T;
}
