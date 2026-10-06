import { createHash } from 'node:crypto';
import { z } from 'zod';
export const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.number().finite().optional(),
    cursor: z.string().max(1200).optional(),
    page: z.enum(['true', 'false']).default('false'),
    search: z.string().trim().max(120).default(''),
    filter: z.enum(['all', 'unread', 'human', 'paused']).default('all'),
    paymentStatus: z.enum(['pending', 'submitted', 'approved', 'rejected', 'cancelled']).optional(),
    status: z.enum(['New', 'Interested', 'Follow Up', 'Converted', 'Closed']).optional(),
    type: z.enum(['Normal', 'VIP', 'Ignore', 'Blocked']).optional(),
  })
  .refine((q) => !(q.cursor && q.before !== undefined), {
    message: 'Use cursor or before, not both.',
  });
export type ListQuery = z.infer<typeof listQuery>;
export const scopeFor = (p: string, order: string, query: ListQuery) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        p,
        order,
        query.search,
        query.filter,
        query.status,
        query.type,
        query.paymentStatus,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
const cursorSchema = z.object({
  value: z.number().finite(),
  id: z.string().regex(/^[\w-]{1,200}$/),
  scope: z.string(),
});
export function decodeCursor(cursor: string, scope: string) {
  try {
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    if (decoded.scope !== scope) throw new Error();
    return decoded;
  } catch {
    throw Object.assign(new Error('Invalid cursor for this collection or filter.'), {
      statusCode: 400,
      code: 'INVALID_CURSOR',
    });
  }
}
export const encodeCursor = (value: number, id: string, scope: string) =>
  Buffer.from(JSON.stringify({ value, id, scope })).toString('base64url');
export function matchesFilter(record: Record<string, unknown>, q: ListQuery) {
  if (q.paymentStatus && record.status !== q.paymentStatus) return false;
  if (q.status && record.status !== q.status) return false;
  if (q.type && record.type !== q.type) return false;
  if (q.filter === 'unread' && !(Number(record.unreadCount) > 0)) return false;
  if (q.filter === 'human' && !record.needsHuman) return false;
  if (
    q.filter === 'paused' &&
    !(record.automationEnabled === false || Number(record.pauseUntil) > Date.now())
  )
    return false;
  const searchable = [
    'name',
    'number',
    'interest',
    'notes',
    'lastMessageText',
    'question',
    'answer',
    'content',
    'message',
    'text',
    'tags',
    'description',
    'category',
    'keywords',
    'date',
    'email',
    'subject',
    'action',
    'actorId',
    'targetId',
  ];
  return (
    !q.search ||
    searchable
      .map((k) =>
        Array.isArray(record[k]) ? (record[k] as unknown[]).join(' ') : String(record[k] || ''),
      )
      .join(' ')
      .toLocaleLowerCase()
      .includes(q.search.toLocaleLowerCase())
  );
}
