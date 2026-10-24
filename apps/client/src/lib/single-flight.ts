// - Share only pending work within an opaque session scope without caching completed responses
export function createSingleFlight<T>() {
  const scopes = new WeakMap<object, Map<string, Promise<T>>>();
  return (scope: object, key: string, request: () => Promise<T>): Promise<T> => {
    let requests = scopes.get(scope);
    if (!requests) {
      requests = new Map();
      scopes.set(scope, requests);
    }
    const current = requests.get(key);
    if (current) return current;
    const pending = Promise.resolve().then(request);
    requests.set(key, pending);
    const clear = () => {
      if (requests.get(key) === pending) requests.delete(key);
    };
    void pending.then(clear, clear);
    return pending;
  };
}
