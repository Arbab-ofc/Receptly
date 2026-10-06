import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from './auth';
import { apiBase } from './api';
export function useRealtime() {
  const client = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let invalidation: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const token = await auth?.currentUser?.getIdToken(true);
        if (!token) return;
        const res = await fetch(`${apiBase}/api/v1/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error('Realtime unavailable');
        void client.invalidateQueries();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const pieces = buffer.split('\n\n');
            buffer = pieces.pop() || '';
            for (const piece of pieces) {
              if (piece.startsWith('data:')) {
                if (invalidation) clearTimeout(invalidation);
                invalidation = setTimeout(() => void client.invalidateQueries(), 150);
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch {
        /* Polling remains available when SSE reconnects. */
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void connect(), 5000 + Math.random() * 1000);
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(invalidation);
    };
  }, [client]);
}
