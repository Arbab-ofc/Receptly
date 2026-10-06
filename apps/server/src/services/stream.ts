import type { FastifyRequest, FastifyReply } from 'fastify';
import { events } from './events.js';
import { env } from '../config/env.js';
import { monitoring } from './monitoring.js';
const connections = new Map<string, number>();
export function openEventStream(req: FastifyRequest, reply: FastifyReply) {
  const count = connections.get(req.uid) || 0;
  if (count >= env.SSE_MAX_CONNECTIONS_PER_USER)
    throw Object.assign(new Error('Too many live connections. Close another workspace tab.'), {
      statusCode: 429,
      code: 'STREAM_LIMIT',
    });
  connections.set(req.uid, count + 1);
  monitoring.stream(1);
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders()))
    if (value !== undefined)
      reply.raw.setHeader(name, Array.isArray(value) ? value.map(String) : String(value));
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  const write = (content: string) => {
    if (closed) return;
    if (!reply.raw.write(content)) {
      monitoring.alert('slow_stream_client');
      reply.raw.destroy();
    }
  };
  const listener = (event: unknown) => write(`data: ${JSON.stringify(event)}\n\n`);
  const close = () => {
    if (!closed) reply.raw.end();
  };
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), 20000);
  const expiration = setTimeout(
    () => {
      write('event: reconnect\ndata: {}\n\n');
      close();
    },
    Math.max(1, Math.min(45 * 60000, req.tokenExpiresAt - Date.now() - 5000)),
  );
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(expiration);
    events.off(req.uid, listener);
    events.off('shutdown', close);
    events.off(`logout:${req.uid}`, close);
    const remaining = (connections.get(req.uid) || 1) - 1;
    if (remaining > 0) connections.set(req.uid, remaining);
    else connections.delete(req.uid);
    monitoring.stream(-1);
  };
  reply.raw.once('close', cleanup);
  reply.raw.once('error', cleanup);
  events.on(req.uid, listener);
  events.on('shutdown', close);
  events.on(`logout:${req.uid}`, close);
  write('event: ready\ndata: {}\n\n');
}
