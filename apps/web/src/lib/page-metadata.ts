export const publicPages: Record<string, [string, string]> = {
  '/': [
    'Your Smart WhatsApp Receptionist',
    'Answer common WhatsApp questions, manage business hours, capture leads, and take over conversations with Receptly.',
  ],
  '/pricing': [
    'Pricing',
    'Receptly plans: ₹59 monthly or ₹650 yearly. Compare plans and subscribe with manual payment verification.',
  ],
  '/features': [
    'Features',
    'Explore automatic replies, business hours, a unified inbox, lead capture, and human handover in Receptly.',
  ],
  '/contact': [
    'Contact & Availability',
    'Ask about Receptly setup, hosting, product availability, and pricing, or get help with your workspace.',
  ],
  '/login': ['Sign in', 'Sign in to your Receptly workspace to manage your WhatsApp receptionist.'],
  '/register': [
    'Create your workspace',
    'Create a Receptly workspace and set up your WhatsApp receptionist.',
  ],
  '/signup': [
    'Create your workspace',
    'Create a Receptly workspace and set up your WhatsApp receptionist.',
  ],
  '/documentation': [
    'Setup guide & API reference',
    'Set up Receptly and explore the complete API reference, including authentication, endpoints, request fields, responses, and live events.',
  ],
  '/privacy': [
    'Privacy policy',
    'Read how Receptly processes account information, conversations, and business settings.',
  ],
  '/terms': [
    'Terms of use',
    'Read the terms for using Receptly and its WhatsApp linked-device connection.',
  ],
};
const workspaceTitles: Record<string, string> = {
  billing: 'Billing & subscription',
  admin: 'Admin panel',
  inbox: 'Inbox',
  leads: 'Leads',
  rules: 'Auto reply rules',
  templates: 'Templates',
  'knowledge-base': 'Knowledge base',
  schedule: 'Business hours',
  catalog: 'Products and services',
  holidays: 'Holiday schedules',
  automations: 'Automations',
  analytics: 'Analytics',
  logs: 'Activity logs',
  whatsapp: 'WhatsApp connection',
  settings: 'Settings',
  contacts: 'Contacts',
};
export function updatePageMetadata(path: string) {
  path = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const workspace = path.startsWith('/dashboard');
  const [name, description] = workspace
    ? [workspaceTitles[path.split('/')[2]] || 'Overview', 'Your Receptly workspace.']
    : publicPages[path] || ['Page not found', 'Find your way back to Receptly.'];
  const title = `${name} — Receptly`;
  document.title = title;
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical)
    canonical.href = new URL(path, import.meta.env.VITE_SITE_URL || window.location.origin).href;
  const set = (key: string, content: string, property = false) => {
    const attribute = property ? 'property' : 'name';
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }
    element.content = content;
  };
  set('description', description);
  set(
    'robots',
    workspace || ['/login', '/register', '/signup'].includes(path) || !publicPages[path]
      ? 'noindex, nofollow'
      : 'index, follow',
  );
  set('og:title', title, true);
  set('og:description', description, true);
  set('og:type', 'website', true);
  set('og:url', new URL(path, window.location.origin).href, true);
  set('og:image', new URL('/social-preview.png', window.location.origin).href, true);
  set('og:image:alt', 'Receptly — Your smart WhatsApp receptionist', true);
  set('twitter:card', 'summary_large_image');
  set('twitter:title', title);
  set('twitter:description', description);
  set('twitter:image', new URL('/social-preview.png', window.location.origin).href);
}
