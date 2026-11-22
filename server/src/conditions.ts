/** "Only if" conditions on a trigger's event, read by dot path (`repository.name`, `items.0.title`). */
export type Op = 'exists' | 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'greater_than' | 'less_than';
export interface Condition { field: string; op: Op; value?: string }

export function readPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const key of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const text = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function conditionHolds(c: Condition, data: unknown): boolean {
  const raw = readPath(data, c.field);
  const t = text(raw).toLowerCase();
  const want = (c.value ?? '').toLowerCase();
  switch (c.op) {
    case 'exists': return t !== '';
    case 'equals': return t === want;
    case 'not_equals': return t !== want;
    case 'contains': return t.includes(want);
    case 'not_contains': return !t.includes(want);
    case 'starts_with': return t.startsWith(want);
    case 'greater_than': return Number(raw) > Number(c.value);
    case 'less_than': return Number(raw) < Number(c.value);
    default: return false;
  }
}

/** All must hold; an empty list always passes. */
export const allHold = (list: Condition[] | undefined, data: unknown) => (list ?? []).every((c) => conditionHolds(c, data));

const OPS = new Set<Op>(['exists', 'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'greater_than', 'less_than']);
/** Validates conditions typed by the user or a bot; throws a readable error. */
export function parseConditions(raw: unknown): Condition[] {
  if (raw == null || raw === '') return [];
  if (!Array.isArray(raw)) throw new Error('conditions must be a list');
  return raw.map((c: any) => {
    if (!c || typeof c.field !== 'string' || !c.field.trim()) throw new Error('each condition needs a field');
    if (!OPS.has(c.op)) throw new Error(`unknown condition op "${c.op}"`);
    return { field: c.field.trim(), op: c.op, ...(c.value != null ? { value: String(c.value) } : {}) };
  });
}
