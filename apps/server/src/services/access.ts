import { subscriptionActive, type Subscription, type AccessProfile } from '@receptly/shared';
import { store, path } from './store.js';
import { isPlatformAdmin } from './roles.js';
export interface AccessGrant {
  tier: 'free' | 'pro';
  version: number;
  updatedAt: number;
  updatedBy: string;
}
export async function accessProfile(uid: string, now = Date.now()): Promise<AccessProfile> {
  if (isPlatformAdmin(uid))
    return { tier: 'pro', source: 'platform_admin', expiresAt: null, version: 0 };
  const [grant, subscription] = await Promise.all([
    store.get<AccessGrant>(path('accessProfiles', uid)),
    store.get<Subscription>(path('subscriptions', uid)),
  ]);
  const complimentary = grant?.tier === 'pro';
  const paid = subscriptionActive(subscription, now);
  return {
    tier: complimentary || paid ? 'pro' : 'free',
    source: complimentary ? 'admin' : paid ? 'payment' : 'none',
    expiresAt: complimentary ? null : paid ? subscription!.expiresAt : null,
    version: grant?.version || 0,
  };
}
