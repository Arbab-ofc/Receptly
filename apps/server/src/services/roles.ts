import { env } from '../config/env.js';
export const isPlatformAdmin = (uid: string) =>
  env.ADMIN_UIDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(uid);
