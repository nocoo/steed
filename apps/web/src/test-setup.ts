import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const storageBackingStores = new WeakMap<Storage, Map<string, string>>();

function ensureStore(instance: Storage): Map<string, string> {
  let store = storageBackingStores.get(instance);
  if (!store) {
    store = new Map();
    storageBackingStores.set(instance, store);
  }
  return store;
}

Storage.prototype.getItem = function (key: string) {
  const store = ensureStore(this);
  return store.has(key) ? store.get(key)! : null;
};
Storage.prototype.setItem = function (key: string, value: string) {
  ensureStore(this).set(key, String(value));
};
Storage.prototype.removeItem = function (key: string) {
  ensureStore(this).delete(key);
};
Storage.prototype.clear = function () {
  ensureStore(this).clear();
};
Storage.prototype.key = function (index: number) {
  return Array.from(ensureStore(this).keys())[index] ?? null;
};
Object.defineProperty(Storage.prototype, "length", {
  configurable: true,
  get(this: Storage) {
    return ensureStore(this).size;
  },
});

function createStorage(): Storage {
  return Object.create(Storage.prototype) as Storage;
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createStorage(),
});
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: createStorage(),
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
