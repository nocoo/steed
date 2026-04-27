import { URLPattern } from "urlpattern-polyfill";

if (!globalThis.URLPattern) {
  (globalThis as unknown as { URLPattern: typeof URLPattern }).URLPattern =
    URLPattern;
}
