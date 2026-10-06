import { store } from '../apps/server/src/services/store.js';
import {
  decodeCursor,
  encodeCursor,
  matchesFilter,
  scopeFor,
} from '../apps/server/src/services/pagination.js';
export function memoryStore(options: { strictTransactions?: boolean } = {}) {
  const data: Record<string, unknown> = {};
  const get = (p: string): unknown =>
    p
      .split('/')
      .reduce<unknown>(
        (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
        data,
      ) ?? null;
  const set = (p: string, value: unknown) => {
    const parts = p.split('/');
    let node = data;
    for (const part of parts.slice(0, -1)) {
      if (!node[part] || typeof node[part] !== 'object') node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    if (value === null) delete node[parts.at(-1)!];
    else node[parts.at(-1)!] = JSON.parse(JSON.stringify(value));
  };
  store.get = async <T>(p: string) => get(p) as T | null;
  store.transaction = async <T>(
    p: string,
    transform: (current: T | null) => T | null | undefined,
  ) => {
    const value = transform(get(p) as T | null);
    if (value === undefined) return { committed: false, value: get(p) as T | null };
    if (options.strictTransactions) {
      const validate = (node: unknown, at: string) => {
        if (node === undefined) throw new Error(`Firebase transaction contains undefined at ${at}`);
        if (node && typeof node === 'object')
          for (const [key, child] of Object.entries(node)) validate(child, `${at}/${key}`);
      };
      validate(value, p);
    }
    set(p, value);
    return { committed: true, value };
  };
  store.update = async (writes) => {
    for (const [p, raw] of Object.entries(writes)) {
      const delta = (raw as { '.sv'?: { increment?: number } } | null)?.['.sv']?.increment;
      set(p, delta !== undefined ? Number(get(p) || 0) + delta : raw);
    }
  };
  store.keys = async (p) => Object.keys(get(p) || {});
  store.page = async <T extends Record<string, unknown>>(
    p: string,
    order: string,
    options: Parameters<typeof store.page>[2],
  ) => {
    const scope = scopeFor(p, order, options);
    const anchor = options.cursor ? decodeCursor(options.cursor, scope) : undefined;
    const records = Object.entries(get(p) || {})
      .map(([id, value]) => ({ id, value: value as T }))
      .sort(
        (a, b) =>
          Number(b.value[order] || 0) - Number(a.value[order] || 0) || b.id.localeCompare(a.id),
      )
      .filter(
        (r) =>
          (!anchor ||
            Number(r.value[order]) < anchor.value ||
            (Number(r.value[order]) === anchor.value && r.id < anchor.id)) &&
          (options.before === undefined || Number(r.value[order]) < options.before) &&
          matchesFilter(r.value, options),
      );
    const selected = records.slice(0, options.limit);
    const last = selected.at(-1);
    return {
      items: selected.map((r) => r.value),
      nextCursor:
        records.length > selected.length && last
          ? encodeCursor(Number(last.value[order] || 0), last.id, scope)
          : null,
    };
  };
  store.set = async (p, v) => set(p, v);
  store.patch = async (p, v) => {
    for (const [k, value] of Object.entries(v)) set(`${p}/${k}`, value);
  };
  store.remove = async (p) => set(p, null);
  store.list = async <T>(p: string, limit = 100, order = 'createdAt', before?: number) =>
    Object.values(get(p) || {})
      .filter((v) => before === undefined || Number((v as Record<string, unknown>)[order]) < before)
      .sort(
        (a, b) =>
          Number((b as Record<string, unknown>)[order] || 0) -
          Number((a as Record<string, unknown>)[order] || 0),
      )
      .slice(0, limit) as T[];
  store.find = async <T>(p: string, field: string, value: string) =>
    (Object.values(get(p) || {}).find((v) => (v as Record<string, unknown>)[field] === value) ||
      null) as T | null;
  store.findMany = async <T>(p: string, field: string, value: string, limit = 100) =>
    Object.values(get(p) || {})
      .filter((v) => (v as Record<string, unknown>)[field] === value)
      .slice(0, limit) as T[];
  store.due = async <T>(p: string, now: number, limit = 200, field = 'scheduledFor') =>
    Object.entries(get(p) || {})
      .map(([id, value]) => ({ ...(value as object), id }))
      .filter(
        (v) =>
          Number((v as Record<string, unknown>)[field]) > 0 &&
          Number((v as Record<string, unknown>)[field]) <= now,
      )
      .sort(
        (a, b) =>
          Number((a as Record<string, unknown>)[field]) -
          Number((b as Record<string, unknown>)[field]),
      )
      .slice(0, limit) as T[];
  store.claim = async (p) => {
    if (get(p)) return false;
    set(p, { timestamp: Date.now() });
    return true;
  };
  store.increment = async (p, delta = 1) => set(p, Number(get(p) || 0) + delta);
  return { data, get, set };
}
