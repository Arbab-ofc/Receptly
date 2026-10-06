import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  MessageSquare,
  Zap,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Hand,
  BarChart3,
  FileText,
  Radio,
  Mail,
  LifeBuoy,
  ChevronRight,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contactRequestSchema } from '@receptly/shared';
import type { infer as Infer } from 'zod';
import { Brand, Button, Field, Badge } from '../components/ui';
import { ConversationMicro, ProductPreview } from '../components/ProductPreview';
import { InboxPreview } from '../components/ReceptionistDemo';
import { ApiDocumentation, apiContents } from '../components/ApiDocumentation';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
export function PublicLayout() {
  const { user, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    const frame = window.requestAnimationFrame(() => {
      const target = location.hash
        ? document.getElementById(decodeURIComponent(location.hash.slice(1)))
        : null;
      if (target) {
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        });
      } else {
        window.scrollTo(0, 0);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, location.key]);
  return (
    <div className="public-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className={`public-header ${open ? 'navigation-open' : ''}`} onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          event.currentTarget.querySelector<HTMLButtonElement>('.mobile-menu')?.focus();
        }
      }}>
        <div className="container nav-inner">
          <Link to="/" aria-label="Receptly home">
            <Brand />
          </Link>
          <nav id="public-navigation" className={open ? 'public-nav open' : 'public-nav'} aria-label="Main navigation">
            <span className="public-nav-heading">Explore Receptly</span>
            {[
              ['Product', '/#product'],
              ['Features', '/features'],
              ['Pricing', '/pricing'],
              ['How it works', '/#how-it-works'],
              ['Contact', '/contact'],
            ].map(([label, path], index) => (
              <Link key={path} to={path} onClick={() => setOpen(false)}>
                <span className="public-nav-number">0{index + 1}</span>
                <span>{label}</span>
                <ArrowUpRight className="public-nav-arrow" size={19} aria-hidden="true" />
              </Link>
            ))}
            <Link className="public-nav-account" to={user ? '/dashboard' : '/login'} onClick={() => setOpen(false)}>
              <span>{user ? 'Open your workspace' : 'Sign in to your workspace'}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </nav>
          <div className="nav-actions">
            {ready &&
              (user ? (
                <Link className="button button--primary" to="/dashboard">
                  Dashboard <ArrowUpRight size={15} />
                </Link>
              ) : (
                <>
                  <Link className="sign-in" to="/login">
                    Sign in
                  </Link>
                  <Link className="button button--primary" to="/register">
                    Get started <ArrowUpRight size={15} />
                  </Link>
                </>
              ))}
            <Button
              className="mobile-menu"
              variant="ghost"
              aria-label={open ? 'Close navigation' : 'Open navigation'}
              aria-expanded={open}
              aria-controls="public-navigation"
              onClick={() => setOpen(!open)}
            >
              <span className="navigation-toggle-lines" aria-hidden="true"><i /><i /></span>
            </Button>
          </div>
        </div>
      </header>
      <button type="button" className={`public-navigation-backdrop ${open ? 'is-open' : ''}`} aria-label="Close navigation" tabIndex={-1} onClick={() => setOpen(false)} />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Link to="/">
            <Brand />
          </Link>
          <p>
            Your Smart WhatsApp Receptionist.
            <br /> More present. Less busy.
          </p>
        </div>
        {[
          [
            'Product',
            ['Features', '/features'],
            ['Pricing', '/pricing'],
            ['How it works', '/#how-it-works'],
            ['Dashboard', '/dashboard'],
          ],
          ['Company', ['Contact', '/contact'], ['Privacy', '/privacy'], ['Terms', '/terms']],
          ['Support', ['Help', '/contact'], ['Documentation', '/documentation']],
        ].map(([label, ...links]) => (
          <div key={String(label)}>
            <strong>{String(label)}</strong>
            {(links as string[][]).map(([name, url]) => (
              <Link key={name} to={url}>
                {name}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="container footer-bottom">
        <span>© 2026 Receptly. All rights reserved.</span>
        <span>
          <i /> Built for better conversations
        </span>
      </div>
    </footer>
  );
}
export function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="hero-kicker">
              <span />
              <span>A smarter front desk. Right in WhatsApp.</span>
            </span>
            <h1>
              Your WhatsApp, <br /> always ready
              <br /> to <span>respond.</span>
            </h1>
            <p>
              Answer common questions, capture customer interest, and step in when a conversation
              needs you. All with your existing WhatsApp number.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="button button--primary large">
                Get started <ArrowUpRight size={17} />
              </Link>
              <Link to="/#how-it-works" className="text-link">
                See how it works <ArrowRight size={17} />
              </Link>
            </div>
            <div className="hero-note">
              <ShieldCheck size={15} />
              Your number. Your conversations. You’re in control.
            </div>
          </div>
          <div className="hero-visual">
            <ProductPreview />
            <div className="hero-visual-caption">
              <span className="caption-line" /> A little automation. A lot more peace of mind.
            </div>
          </div>
        </div>
        <div className="container value-strip">
          {[
            [Zap, 'Instant replies'],
            [Clock, 'Business hours'],
            [SlidersHorizontal, 'Smart rules'],
            [Radio, 'Realtime dashboard'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Zap;
            return (
              <div key={String(label)}>
                <I size={18} />
                {String(label)}
              </div>
            );
          })}
          <span>Less missed messages. More possibilities.</span>
        </div>
      </section>
      <section className="statement container" id="product">
        <span className="eyebrow">YOUR FRONT DESK, REIMAGINED</span>
        <h2>
          You run the business.
          <br /> <span>We’ll start the conversation.</span>
        </h2>
        <p>
          From the first “hello” to the next big opportunity, Receptly handles
          <br className="desktop-break" /> the everyday messages so you can focus on what matters.
        </p>
      </section>
      <FeaturesSection />
      <HowItWorks />
      <section className="product-section container">
        <div className="section-intro">
          <div>
            <span className="eyebrow">ONE CALM WORKSPACE</span>
            <h2>
              Every conversation.
              <br /> A clearer picture.
            </h2>
          </div>
          <p>
            Know who needs you, what’s been answered,
            <br /> and where your next opportunity is.
          </p>
        </div>
        <div className="wide-product">
          <InboxPreview />
        </div>
        <div className="preview-values">
          <span>
            <Check size={16} /> One unified inbox
          </span>
          <span>
            <Check size={16} /> Human takeover, anytime
          </span>
          <span>
            <Check size={16} /> Activity you can actually understand
          </span>
        </div>
      </section>
      <VisitorQuestions />
      <FinalCTA />
    </>
  );
}
export function FeaturesSection() {
  return (
    <section className="features-section container" id="features">
      <div className="section-intro">
        <div>
          <span className="eyebrow">THOUGHTFULLY AUTOMATED</span>
          <h2>
            Answer everyday questions.
            <br /> Keep customers moving.
          </h2>
        </div>
        <Link to="/register" className="text-link">
          Meet your new receptionist <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="feature-bento">
        <article className="feature feature-replies">
          <div className="feature-label">
            <Zap size={19} />
            <span>ALWAYS A GOOD FIRST IMPRESSION</span>
          </div>
          <h3>
            Answer common questions
            <br /> automatically.
          </h3>
          <p>
            Pricing, location, appointments. Answer the everyday
            <br /> questions instantly with replies that sound like you.
          </p>
          <ConversationMicro />
        </article>
        <article className="feature feature-hours">
          <div className="feature-label">
            <Clock size={19} />
            <span>ON YOUR SCHEDULE</span>
          </div>
          <h3>
            Set your hours.
            <br /> Reply when you’re closed.
          </h3>
          <p>
            Set business hours and let customers know
            <br /> when you’ll be back.
          </p>
          <div className="hours-micro">
            <div>
              <span>Business hours</span>
              <Badge tone="green">Open now</Badge>
            </div>
            {[
              ['Mon – Fri', '10:00 AM — 8:00 PM'],
              ['Saturday', '10:00 AM — 6:00 PM'],
              ['Sunday', 'Taking a little break'],
            ].map(([day, time]) => (
              <div key={day}>
                <span>{day}</span>
                <strong>{time}</strong>
              </div>
            ))}
            <small>
              <Check size={12} />
              Timezone-aware. Always accurate.
            </small>
          </div>
        </article>
        <article className="feature feature-rules">
          <SlidersHorizontal size={21} />
          <h3>Your business. Your rules.</h3>
          <p>
            Create replies for keywords and common questions.
            <br /> No complicated workflows. No coding required.
          </p>
          <div className="rule-micro">
            <span>Message contains</span>
            <div>
              <Badge>price</Badge>
              <Badge>cost</Badge>
              <Badge>pricing</Badge>
              <ArrowRight size={16} />
              <Badge tone="green">Send pricing reply</Badge>
            </div>
          </div>
        </article>
        <article className="feature feature-human">
          <Hand size={22} />
          <h3>Take over any conversation.</h3>
          <p>
            Step in whenever a conversation needs you.
            <br /> Your receptionist knows when to step back.
          </p>
          <div className="human-micro">
            <AvatarMini />
            <div>
              <strong>“Can I speak to someone?”</strong>
              <span>
                <i />
                Handed over to you
              </span>
            </div>
            <Badge tone="warm">Needs human</Badge>
          </div>
        </article>
      </div>
      <div className="feature-inline">
        {[
          [MessageSquare, 'Unified inbox', 'Every message, in one place.'],
          [Users, 'Lead management', 'Turn interest into opportunity.'],
          [FileText, 'Reusable templates', 'The right words, ready to go.'],
          [BarChart3, 'Useful analytics', 'See what’s working.'],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Users;
          return (
            <div key={String(title)}>
              <I size={20} />
              <h4>{String(title)}</h4>
              <p>{String(desc)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function AvatarMini() {
  return <span className="avatar">AS</span>;
}
export function HowItWorks() {
  return (
    <section className="how-section" id="how-it-works">
      <div className="container">
        <div className="center-heading">
          <span className="eyebrow">READY IN A FEW MINUTES</span>
          <h2>
            A simple setup.
            <br /> A smarter day.
          </h2>
        </div>
        <div className="steps">
          {[
            [
              '01',
              'Connect your WhatsApp',
              'Scan a QR code using Linked Devices. Keep your number and your existing conversations.',
              'Scan. Connect. Done.',
            ],
            [
              '02',
              'Make it yours',
              'Set your hours, write your replies, and choose when your receptionist should step in.',
              'Your voice. Your rules.',
            ],
            [
              '03',
              'Get on with your day',
              'Receptly keeps working on your server, even when your dashboard is closed.',
              'Always ready to respond.',
            ],
          ].map(([number, title, text, note]) => (
            <article key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="step-note">
                <Check size={14} />
                {note}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
function FinalCTA() {
  return (
    <section className="final-cta container">
      <div className="cta-mark">
        <MessageSquare size={26} />
        <span />
      </div>
      <span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
      <h2>
        Let Receptly handle
        <br /> the first conversation.
      </h2>
      <p>Stay responsive. Be more present. Get a little time back.</p>
      <Link className="button button--primary large" to="/register">
        Connect WhatsApp <ArrowUpRight size={17} />
      </Link>
      <small>Your smart receptionist is a few clicks away.</small>
    </section>
  );
}
export function Features() {
  return (
    <>
      <section className="inner-hero container">
        <span className="eyebrow">BUILT AROUND YOUR BUSINESS</span>
        <h1>
          Replies, hours, and handover.
          <br /> One WhatsApp workspace.
        </h1>
        <p>Everything you need to stay responsive, without being always available.</p>
      </section>
      <FeaturesSection />
      <section className="container detail-grid">
        {[
          [
            'Realtime monitoring',
            'Connection changes, new messages, leads, and human requests appear as they happen.',
          ],
          [
            'A lightweight knowledge base',
            'Add answers to your most common questions. No external AI subscription required.',
          ],
          [
            'Contact preferences',
            'Give VIPs a personal experience and exclude contacts from automation.',
          ],
          [
            'Your conversations, your control',
            'Pause any conversation, reply yourself, and resume automation when you’re ready.',
          ],
        ].map(([title, description]) => (
          <article key={title}>
            <Check size={18} />
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <FinalCTA />
    </>
  );
}
export function Contact() {
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
  type Values = Infer<typeof contactRequestSchema>;
  const form = useForm<Values>({ resolver: zodResolver(contactRequestSchema) });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="container contact-layout">
      <div>
        <span className="eyebrow">LET’S TALK</span>
        <h1>
          Good conversations
          <br /> start here.
        </h1>
        <p>
          Have a question about Receptly? Need a hand getting
          <br className="desktop-break" /> set up? We’re happy to help.
        </p>
        <div className="contact-info">
          <Mail size={21} />
          <div>
            <strong>Drop us a message</strong>
            <p>
              {supportEmail ? (
                <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              ) : (
                'Use the form for product and support questions.'
              )}
            </p>
          </div>
        </div>
        <div className="contact-info">
          <Clock size={21} />
          <div>
            <strong>Support hours</strong>
            <p>
              Monday–Friday, 10 AM–6 PM IST.
              <br /> We aim to respond within two business days.
            </p>
          </div>
        </div>
        <div className="contact-footnote">
          <LifeBuoy size={18} />
          <span>
            Getting started?{' '}
            <Link to="/documentation">
              Read the setup guide <ArrowUpRight size={13} />
            </Link>
          </span>
        </div>
      </div>
      <div className="contact-form section-panel">
        {done ? (
          <div className="contact-success">
            <div className="contact-success-summary" role="status" aria-live="polite">
              <div className="contact-success-icon" aria-hidden="true">
                <Mail size={36} strokeWidth={1.5} />
                <span>
                  <Check size={16} strokeWidth={2.5} />
                </span>
              </div>
              <span className="contact-success-label">REQUEST SENT</span>
              <h2>Message received.</h2>
              <p>
                Thanks for reaching out. Your message is saved and ready for our team to review.
              </p>
              <div className="contact-success-next">
                <span>We’ll reply to</span>
                <strong>{form.getValues('email')}</strong>
                <small>In the meantime, explore the setup guide to get a head start.</small>
              </div>
            </div>
            <div className="contact-success-actions">
              <Button
                variant="primary"
                onClick={() => {
                  setDone(false);
                  form.reset();
                }}
              >
                Send another message
                <ArrowUpRight size={16} />
              </Button>
              <Link to="/documentation" className="text-link">
                Explore setup guide <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit(async (values) => {
              setError('');
              try {
                await api('contact', 'POST', values);
                setDone(true);
              } catch (e) {
                setError((e as Error).message);
              }
            })}
          >
            <h2>Send us a message</h2>
            <p>A few details, and we’ll take it from there.</p>
            {(['name', 'email', 'subject', 'message'] as const).map((name) => (
              <Field
                key={name}
                label={
                  {
                    name: 'Your name',
                    email: 'Email address',
                    subject: 'Subject',
                    message: 'How can we help?',
                  }[name]
                }
                error={form.formState.errors[name]?.message}
              >
                {name === 'message' ? (
                  <textarea rows={5} {...form.register(name)} />
                ) : (
                  <input
                    type={name === 'email' ? 'email' : 'text'}
                    autoComplete={name === 'name' ? 'name' : name === 'email' ? 'email' : 'off'}
                    {...form.register(name)}
                  />
                )}
              </Field>
            ))}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending…' : 'Send message'}
              <ArrowUpRight size={16} />
            </Button>
            <small>We’ll only use your details to respond to your request.</small>
          </form>
        )}
      </div>
    </section>
  );
}
export function Legal({ type }: { type: 'privacy' | 'terms' }) {
  return (
    <article className="container prose">
      <span className="eyebrow">LAST UPDATED · OCTOBER 5, 2026</span>
      <h1>{type === 'privacy' ? 'Privacy policy' : 'Terms of use'}</h1>
      {(type === 'privacy'
        ? [
            [
              'Your information',
              'Receptly processes your account details, business settings, contacts, normalized messages, and activity data to operate your receptionist. WhatsApp session credentials remain on the server and are never delivered to the dashboard.',
            ],
            [
              'How information is used',
              'Your data powers replies, conversation history, lead management, analytics, and support. Receptly does not require an external AI service. You can manage your receptionist preferences in your workspace.',
            ],
            [
              'Access and security',
              'Authentication limits dashboard access to your account. Server credentials and linked-device sessions must be protected by the deployment operator. Contact support to request access to or deletion of your account data.',
            ],
            [
              'Retention and third parties',
              'Conversation records remain until deleted by the operator. Firebase provides authentication and database storage; WhatsApp provides messaging transport. Their terms and privacy policies also apply.',
            ],
            [
              'Contact',
              'Send privacy questions through our contact form. We will review your request and explain the available next steps.',
            ],
          ]
        : [
            [
              'Using Receptly',
              'Use Receptly only with WhatsApp accounts you own or are authorized to manage. You are responsible for your automation settings, message content, customer consent, and complying with applicable messaging and privacy requirements.',
            ],
            [
              'Linked-device connection',
              'Receptly uses a third-party linked-device library and is not affiliated with or endorsed by WhatsApp or Meta. Connectivity depends on external services and may be interrupted or changed.',
            ],
            [
              'Your responsibilities',
              'Keep account credentials secure. Do not use the service for unsolicited bulk messaging, harassment, or unlawful purposes. Review automatic replies and provide appropriate customer support.',
            ],
            [
              'Availability',
              'The service is provided subject to infrastructure and transport availability. You should maintain backups and a manual communication channel. Pricing, subscriptions, and service commitments require separate agreed terms.',
            ],
            [
              'Questions',
              'Contact the operator through our contact page for support or questions about these terms. We will help clarify how the service works and the responsibilities described here.',
            ],
          ]
      ).map(([title, content]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{content}</p>
        </section>
      ))}
      <Link className="text-link" to="/contact">
        Contact us <ArrowRight size={16} />
      </Link>
    </article>
  );
}
const guideSteps = [
  [
    'business',
    'Create your workspace',
    'Create an account, then save your business name and timezone in Settings. Your timezone controls business hours.',
    '/dashboard/settings?section=business&onboarding=1',
  ],
  [
    'link-whatsapp',
    'Link WhatsApp',
    'Open WhatsApp in your workspace and choose Connect WhatsApp. On your phone, open Settings (iPhone) or the three-dot menu (Android), choose Linked Devices, then Link a Device. Scan the code displayed in your workspace.',
    '/dashboard/whatsapp',
  ],
  [
    'business-hours',
    'Set your availability',
    'Choose working days and opening and closing times in Schedule. Copy Monday to weekdays if the times match. Review your closed-hours reply in Settings. Overnight hours are supported.',
    '/dashboard/schedule',
  ],
  [
    'first-reply',
    'Write and test your first reply',
    'Choose a starter rule for opening hours or location, fill in your business details, and try a customer message in the preview. Review the reply before saving and enabling it.',
    '/dashboard/rules?starter=1',
  ],
  [
    'activate',
    'Activate your receptionist',
    'Check your connection and setup checklist in Overview, then enable your receptionist. New messages and replies will appear in the inbox.',
    '/dashboard',
  ],
  [
    'handover',
    'Take over a conversation',
    'Open the inbox and choose Needs human. Reply yourself when a customer asks for a person. Manual replies pause automation; resume it when you are ready.',
    '/dashboard/inbox',
  ],
];
export function Documentation() {
  return (
    <div className="container documentation-layout">
      <aside className="guide-contents">
        <strong>Documentation</strong>
        <nav aria-label="Guide contents">
          {guideSteps.map(([id, title], i) => (
            <a key={id} href={`#${id}`}>
              {i + 1}. {title}
            </a>
          ))}
          <a href="#troubleshooting">Troubleshooting</a>
          <span className="guide-contents-label">API REFERENCE</span>
          {apiContents.map(([id, title]) => (
            <a key={id} href={`#${id}`}>
              {title}
            </a>
          ))}
        </nav>
      </aside>
      <article className="prose guide-article">
        <span className="eyebrow">GETTING STARTED</span>
        <h1>Set up your WhatsApp receptionist.</h1>
        <p>Connect your number, review your replies, and turn on automation when you’re ready.</p>
        {guideSteps.map(([id, title, text, url], i) => (
          <section id={id} key={id}>
            <Badge>{String(i + 1).padStart(2, '0')}</Badge>
            <h2>{title}</h2>
            <p>{text}</p>
            {id === 'link-whatsapp' && <LinkingGuide />}
            <Link className="text-link" to={url}>
              Open {id === 'link-whatsapp' ? 'WhatsApp connection' : title.toLowerCase()}{' '}
              <ArrowUpRight size={15} />
            </Link>
          </section>
        ))}
        <section id="troubleshooting">
          <h2>Troubleshooting</h2>
          {[
            [
              'QR code expired?',
              'Keep the connection page open for a fresh code, or choose Get a new code. Scan from WhatsApp Linked Devices rather than your camera app.',
            ],
            [
              'Using Receptly on the same phone?',
              'Open Receptly on a computer or another screen so your phone can scan the QR code.',
            ],
            [
              'No automatic reply?',
              'Check that WhatsApp is connected, the receptionist is enabled, the rule is active, and the conversation is not paused. Business hours, contact preferences, and reply cooldowns also affect replies.',
            ],
            [
              'Connection interrupted?',
              'Try Reconnect on the WhatsApp page. If WhatsApp has unlinked the session, link it again. Keep your hosting service running.',
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
          <Link className="text-link" to="/contact">
            Get setup help <ArrowRight size={16} />
          </Link>
        </section>
        <ApiDocumentation />
      </article>
    </div>
  );
}
function LinkingGuide() {
  return (
    <figure className="linking-guide">
      <div className="guide-phone">
        <span>On your phone</span>
        <strong>WhatsApp</strong>
        <div>
          Settings / menu <ChevronRight size={15} />
        </div>
        <div className="guide-selected">
          Linked Devices <ChevronRight size={15} />
        </div>
        <div>
          Link a Device <ArrowRight size={15} />
        </div>
      </div>
      <ArrowRight className="guide-arrow" size={24} />
      <div className="guide-qr">
        <span>In your workspace</span>
        <strong>WhatsApp connection</strong>
        <img
          src="/whatsapp-linking.png"
          loading="lazy"
          alt="Example Receptly connection screen showing where to scan your QR code"
        />
        <p>Scan the live code shown here.</p>
      </div>
      <figcaption>
        Example workspace screen with an illustrated QR area. Scan the live code shown in your own
        workspace after choosing Connect WhatsApp.
      </figcaption>
    </figure>
  );
}
function VisitorQuestions() {
  return (
    <section className="container visitor-questions" id="questions">
      <div className="section-intro">
        <div>
          <span className="eyebrow">BEFORE YOU START</span>
          <h2>Your questions, answered.</h2>
        </div>
        <Link className="text-link" to="/documentation">
          Read the setup guide <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="visitor-question-grid">
        <div>
          {[
            [
              'Can I use my existing WhatsApp number?',
              'Yes. Receptly links through WhatsApp Linked Devices, so you can keep your existing number. The connection uses a third-party library and is not affiliated with WhatsApp or Meta.',
            ],
            [
              'What does it reply to?',
              'You choose keywords, templates, answers, and business hours. Receptly sends the replies you configure; no external AI subscription is required.',
            ],
            [
              'Can I reply myself?',
              'Yes. Pause any conversation or take over when a customer requests a person. Manual replies pause automation so you can continue the conversation.',
            ],
            [
              'Does it work when I close the dashboard?',
              'Yes, while the backend hosting service is running and WhatsApp remains connected. Closing the browser does not stop the receptionist.',
            ],
            [
              'How do I set it up?',
              'Create a workspace, link WhatsApp, set business hours, and review your first rule. The setup guide walks you through each step.',
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
        <aside className="availability-note">
          <span className="eyebrow">SETUP & AVAILABILITY</span>
          <h3>Find the right setup for your business.</h3>
          <p>
            Contact us to confirm hosting options, availability, and pricing before getting started.
            Subscription plans are not currently listed on this site.
          </p>
          <Link className="button button--primary" to="/contact">
            Ask about availability <ArrowUpRight size={16} />
          </Link>
          <small>Already setting up? The guide covers linking and configuration.</small>
        </aside>
      </div>
    </section>
  );
}
