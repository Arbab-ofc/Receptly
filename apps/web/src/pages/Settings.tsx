import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsSchema, defaultSettings, modes, type Settings } from '@receptly/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  LogOut,
  ArrowUpRight,
  Plus,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, logout, changePassword } from '../lib/auth';
import { authErrorMessage } from '../lib/auth-errors';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import {
  Section,
  PageHeader,
  Field,
  Button,
  Toggle,
  Skeleton,
  ErrorState,
  toast,
  SaveBar,
  PasswordInput,
} from '../components/ui';
export default function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('settings') });
  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="WORKSPACE"
        title="Settings"
        description="Configure your business profile, receptionist behavior, replies, and account."
      />
      {query.isLoading ? (
        <Skeleton variant="form" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <SettingsForm settings={query.data || defaultSettings} />
      )}
    </div>
  );
}
const settingsTabs = [
  ['business', 'Business'],
  ['behavior', 'Receptionist'],
  ['replies', 'Replies & menu'],
  ['hours', 'Closed hours'],
  ['handover', 'Handover'],
  ['contacts', 'Contacts'],
  ['followups', 'Welcome & follow-ups'],
  ['account', 'Account'],
] as const;
const settingsCopy: Record<
  (typeof settingsTabs)[number][0],
  { group: string; description: string }
> = {
  business: { group: 'Workspace', description: 'Business identity and local time settings.' },
  behavior: {
    group: 'Automation',
    description: 'Control when the receptionist responds and how often.',
  },
  replies: {
    group: 'Automation',
    description: 'Set the default response and configure your WhatsApp menu.',
  },
  hours: { group: 'Automation', description: 'Choose what customers hear outside business hours.' },
  handover: { group: 'Automation', description: 'Route requests that need a person.' },
  contacts: {
    group: 'Customers',
    description: 'Choose how the receptionist treats contacts and groups.',
  },
  followups: {
    group: 'Customers',
    description: 'Configure welcome messages, lead capture, and follow-ups.',
  },
  account: { group: 'Account', description: 'Manage your signed-in account.' },
};
const settingSection = (field: string) =>
  field.startsWith('outOfHours')
    ? 'hours'
    : field.startsWith('human')
      ? 'handover'
      : ['groupsEnabled', 'vipBypass', 'unknownContactsOnly'].includes(field)
        ? 'contacts'
        : /^(welcome|lead|followUp)/.test(field)
          ? 'followups'
          : /^(fallback|menu)/.test(field)
            ? 'replies'
            : ['businessName', 'timezone'].includes(field)
              ? 'business'
              : 'behavior';
function SettingsForm({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const location = useLocation();
  const section = params.get('section') || 'business';
  const [active, setActive] = useState<(typeof settingsTabs)[number][0]>(
    settingsTabs.some(([id]) => id === section)
      ? (section as (typeof settingsTabs)[number][0])
      : 'business',
  );
  useEffect(() => {
    setActive(settingsTabs.find(([id]) => id === section)?.[0] || 'business');
  }, [section]);
  useEffect(() => {
    if (!location.hash) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, location.hash]);
  const user = useAuth((s) => s.user);
  const form = useForm<Settings, unknown, Settings>({
    resolver: zodResolver(settingsSchema) as Resolver<Settings>,
    defaultValues: {
      ...defaultSettings,
      ...settings,
      modeReplies: { ...defaultSettings.modeReplies, ...settings.modeReplies },
    },
  });
  const values = form.watch();
  const version = useRef((settings as Settings & { version?: number }).version);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { guard } = useUnsavedChanges(form.formState.isDirty, form.formState.isSubmitting);
  const [mode, setMode] = useState('Busy');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const googleLinked = Boolean(user?.providerData.some(({ providerId }) => providerId === 'google.com'));
  const passwordEnabled = Boolean(
    user?.email && user.providerData.some(({ providerId }) => providerId === 'password'),
  );
  type BooleanSetting = {
    [K in keyof Settings]: Settings[K] extends boolean ? K : never;
  }[keyof Settings];
  const toggle = (name: BooleanSetting, label: string, description: string) => (
    <div className="settings-toggle" key={name}>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <Toggle
        label={label}
        checked={Boolean(values[name])}
        onChange={(v) => form.setValue(name, v, { shouldDirty: true })}
      />
    </div>
  );
  const number = (
    name:
      | 'defaultCooldownMinutes'
      | 'pauseAfterManualReplyMinutes'
      | 'fallbackCooldownMinutes'
      | 'outOfHoursCooldownMinutes'
      | 'followUpHours',
    label: string,
  ) => (
    <Field label={label} error={form.formState.errors[name]?.message}>
      <input type="number" min={0} {...form.register(name, { valueAsNumber: true })} />
    </Field>
  );
  return (
    <form
      className="settings-form"
      onSubmit={form.handleSubmit(
        async (v) => {
          try {
            const saved = await api<Settings & { version?: number }>(
              'settings',
              'PATCH',
              v,
              version.current === undefined ? undefined : { 'If-Match': `"${version.current}"` },
            );
            version.current = saved.version;
            form.reset(v);
            setSavedAt(Date.now());
            void client.invalidateQueries({ queryKey: ['settings'] });
            toast('Settings saved');
          } catch (e) {
            form.setError('root', { message: (e as Error).message });
          }
        },
        (errors) => {
          const field = Object.keys(errors).find((key) => key !== 'root');
          if (field) setActive(settingSection(field));
        },
      )}
    >
      {params.has('onboarding') && (
        <div className="onboarding-banner">
          <strong>Welcome to Receptly.</strong>
          <p>
            Start with your business name and timezone. You can set up the rest at your own pace.
          </p>
          <Link to="/dashboard/whatsapp" className="text-link">
            Next: connect WhatsApp <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {['Workspace', 'Automation', 'Customers', 'Account'].map((group) => (
            <div className="settings-nav-group" key={group}>
              <span>{group}</span>
              {settingsTabs
                .filter(([id]) => settingsCopy[id].group === group)
                .map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={active === id ? 'page' : undefined}
                    aria-controls={`settings-${id}`}
                    onClick={() => setActive(id)}
                  >
                    {label}
                    {active === id && <ChevronRight size={15} aria-hidden="true" />}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <header className="settings-content-heading">
            <div>
              <span>{settingsCopy[active as keyof typeof settingsCopy].group}</span>
              <h2>{settingsTabs.find(([id]) => id === active)?.[1]}</h2>
              <p>{settingsCopy[active as keyof typeof settingsCopy].description}</p>
            </div>
            {form.formState.isDirty && <span className="settings-unsaved">Unsaved changes</span>}
          </header>
          <fieldset
            className="settings-group"
            hidden={active !== 'business'}
            id="settings-business"
          >
            <legend className="sr-only">Your business</legend>
            <Section title="Your business">
              <div className="form-grid">
                <Field
                  label="Business name"
                  hint="Used in replies containing {{business_name}}."
                  error={form.formState.errors.businessName?.message}
                >
                  <input {...form.register('businessName')} />
                </Field>
                <Field label="Business timezone" error={form.formState.errors.timezone?.message}>
                  <select {...form.register('timezone')}>
                    {Array.from(
                      new Set([values.timezone, ...Intl.supportedValuesOf('timeZone')]),
                    ).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </Section>
          </fieldset>
          <fieldset
            className="settings-group"
            hidden={active !== 'behavior'}
            id="settings-behavior"
          >
            <legend className="sr-only">Receptionist behavior</legend>
            <Section title="Receptionist behavior">
              {toggle(
                'automationEnabled',
                'Enable your receptionist',
                'Receive messages at any time. Send automatic replies when enabled.',
              )}
              <div className="form-grid">
                {number(
                  'defaultCooldownMinutes',
                  'Minimum time between automatic replies (minutes)',
                )}
                {number('pauseAfterManualReplyMinutes', 'Pause after a manual reply (minutes)')}
              </div>
              <Field label="Current mode">
                <select {...form.register('mode')}>
                  {modes.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Customize a mode reply">
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {modes
                    .filter((m) => m !== 'Available')
                    .map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                </select>
              </Field>
              <Field label={`${mode} reply`}>
                <textarea rows={3} {...form.register(`modeReplies.${mode}`)} />
              </Field>
            </Section>
          </fieldset>
          <fieldset className="settings-group" hidden={active !== 'replies'} id="settings-replies">
            <legend className="sr-only">When no rule matches</legend>
            <Section title="When no rule matches">
              {toggle(
                'fallbackEnabled',
                'Send a default reply',
                'Give customers a clear next step when their message does not match a rule.',
              )}
              <Field
                label="Default reply"
                hint="Your customer’s name and business name appear in a consistent greeting. Variables: {{name}}, {{business_name}}, {{current_time}}, {{business_hours}}."
              >
                <textarea rows={4} {...form.register('fallbackMessage')} />
              </Field>
              {number('fallbackCooldownMinutes', 'Default reply cooldown (minutes)')}
              {toggle(
                'menuEnabled',
                'Enable the WhatsApp menu',
                'Customers reply with a number or option name. Uses text options with your current WhatsApp connection.',
              )}
              {values.menuEnabled && (
                <>
                  <Field
                    label="Menu greeting"
                    hint="A customer greeting and formatted Receptly message card are added automatically."
                  >
                    <textarea rows={3} {...form.register('menuMessage')} />
                  </Field>
                  <p className="billing-note">
                    Sent automatically on each contact's first message of the day, including
                    existing contacts. One menu per chat per day in your business timezone. Every
                    menu includes “0. Stop for today”; this pauses only that chat until midnight.
                    Later messages use menu selections, keyword rules or your default reply.
                  </p>
                  {!values.menuOptions.length && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        form.setValue(
                          'menuOptions',
                          [
                            { label: 'Pricing', action: 'pricing', response: '' },
                            { label: 'Opening hours', action: 'opening_hours', response: '' },
                            { label: 'Closing hours', action: 'closing_hours', response: '' },
                          ],
                          { shouldDirty: true },
                        );
                      }}
                    >
                      Add pricing & hours menu
                    </Button>
                  )}
                </>
              )}
              <div className="menu-options">
                {values.menuOptions.map((option, i) => (
                  <div key={i}>
                    <Field label={`Option ${i + 1} label`}>
                      <input
                        value={option.label}
                        onChange={(e) =>
                          form.setValue(`menuOptions.${i}.label`, e.target.value, {
                            shouldDirty: true,
                          })
                        }
                      />
                    </Field>
                    <Field label={`Option ${i + 1} answer type`}>
                      <select
                        value={option.action || 'custom'}
                        onChange={(e) =>
                          form.setValue(
                            `menuOptions.${i}.action`,
                            e.target.value as Settings['menuOptions'][number]['action'],
                            { shouldDirty: true },
                          )
                        }
                      >
                        <option value="custom">Custom reply</option>
                        <option value="pricing">Pricing from product & service catalog</option>
                        <option value="opening_hours">Today's opening time</option>
                        <option value="closing_hours">Today's closing time</option>
                      </select>
                    </Field>
                    {(option.action || 'custom') === 'custom' ? (
                      <Field label="Reply">
                        <textarea
                          value={option.response}
                          onChange={(e) =>
                            form.setValue(`menuOptions.${i}.response`, e.target.value, {
                              shouldDirty: true,
                            })
                          }
                        />
                      </Field>
                    ) : (
                      <p className="billing-note">
                        {option.action === 'pricing'
                          ? 'Uses enabled catalog items and their prices. If your catalog is empty, asks the customer which item they need.'
                          : 'Uses your business timezone and schedule, including today’s holiday hours.'}
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="settings-remove-option"
                      aria-label="Remove menu option"
                      onClick={() =>
                        form.setValue(
                          'menuOptions',
                          values.menuOptions.filter((_, index) => index !== i),
                          { shouldDirty: true },
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </Button>
                  </div>
                ))}
              </div>
              {values.menuOptions.length < 9 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    form.setValue(
                      'menuOptions',
                      [...values.menuOptions, { label: '', response: '', action: 'custom' }],
                      {
                        shouldDirty: true,
                      },
                    )
                  }
                >
                  <Plus size={15} />
                  Add menu option
                </Button>
              )}
              {values.menuEnabled && values.menuOptions.length > 0 && (
                <div className="onboarding-banner" aria-label="WhatsApp menu preview">
                  <strong>WhatsApp menu preview</strong>
                  <p>
                    {values.menuMessage
                      .replace(/\{\{business_name\}\}/g, values.businessName)
                      .replace(/\{\{name\}\}/g, 'there')}
                  </p>
                  {values.menuOptions.map((option, index) => (
                    <p key={index}>
                      {index + 1}. {option.label || 'Option name'}
                    </p>
                  ))}
                  <p>0. Stop for today</p>
                  <p>
                    Reply with an option number or name. Reply 0 or Stop to pause this chat until
                    midnight.
                  </p>
                </div>
              )}
            </Section>
          </fieldset>
          <fieldset className="settings-group" hidden={active !== 'hours'} id="settings-hours">
            <legend className="sr-only">Outside business hours</legend>
            <Section title="Outside business hours">
              {toggle(
                'outOfHoursEnabled',
                'Send a closed-hours reply',
                'Your business schedule takes priority over normal rules.',
              )}
              <Field label="Closed-hours message">
                <textarea rows={4} {...form.register('outOfHoursMessage')} />
              </Field>
              {number('outOfHoursCooldownMinutes', 'Closed-hours cooldown (minutes)')}
            </Section>
          </fieldset>
          <fieldset
            className="settings-group"
            hidden={active !== 'handover'}
            id="settings-handover"
          >
            <legend className="sr-only">Human handover</legend>
            <Section title="Human handover">
              <Field label="Human request keywords" hint="Separate phrases with commas.">
                <input
                  value={values.humanKeywords.join(', ')}
                  onChange={(e) =>
                    form.setValue(
                      'humanKeywords',
                      e.target.value.split(',').map((s) => s.trim()),
                      { shouldDirty: true },
                    )
                  }
                />
              </Field>
              <Field label="Handover acknowledgement">
                <textarea rows={3} {...form.register('humanAcknowledgement')} />
              </Field>
            </Section>
          </fieldset>
          <fieldset
            className="settings-group"
            hidden={active !== 'contacts'}
            id="settings-contacts"
          >
            <legend className="sr-only">Contacts and WhatsApp</legend>
            <Section title="Contacts and WhatsApp">
              {toggle(
                'groupsEnabled',
                'Respond in groups',
                'Groups are ignored by default. Enable only when you have reviewed your replies.',
              )}
              {toggle(
                'vipBypass',
                'Skip automation for VIP contacts',
                'Give your VIPs a personal conversation.',
              )}
              {toggle(
                'unknownContactsOnly',
                'Only automate first-time contacts',
                'Existing contacts receive no automatic replies.',
              )}
              <Link to="/dashboard/whatsapp" className="text-link">
                Manage your connection <ArrowUpRight size={15} />
              </Link>
            </Section>
          </fieldset>
          <fieldset
            className="settings-group"
            hidden={active !== 'followups'}
            id="settings-followups"
          >
            <legend className="sr-only">Welcome, leads, and follow-ups</legend>
            <Section title="Welcome, leads, and follow-ups">
              {toggle(
                'welcomeEnabled',
                'Welcome new contacts',
                'Send a welcome reply if no rule or FAQ matched.',
              )}
              <div id="welcome">
                <Field label="Welcome message">
                  <textarea rows={3} {...form.register('welcomeMessage')} />
                </Field>
              </div>
              {toggle(
                'leadDetectionEnabled',
                'Capture leads automatically',
                'Create a lead when a customer mentions buying, pricing, or an appointment.',
              )}
              <div id="leads">
                <Field label="Lead keywords">
                  <input
                    value={values.leadKeywords.join(', ')}
                    onChange={(e) =>
                      form.setValue(
                        'leadKeywords',
                        e.target.value.split(',').map((s) => s.trim()),
                        { shouldDirty: true },
                      )
                    }
                  />
                </Field>
              </div>
              <div id="followup">
                {toggle(
                  'followUpEnabled',
                  'Follow up after a pricing conversation',
                  'One follow-up after a matched rule. A customer reply cancels it.',
                )}
                {number('followUpHours', 'Wait before follow-up (hours)')}
                <Field label="Follow-up message">
                  <textarea rows={3} {...form.register('followUpMessage')} />
                </Field>
              </div>
            </Section>
          </fieldset>
          <fieldset className="settings-group" hidden={active !== 'account'} id="settings-account">
            <legend className="sr-only">Your account</legend>
            <Section title="Your account">
              <div className="account-settings">
                <div>
                  <strong>{user?.displayName || 'My account'}</strong>
                  <p>{user?.email}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void logout().catch(() =>
                      toast('Unable to sign out. Please try again.', 'error'),
                    )
                  }
                >
                  <LogOut size={16} />
                  Sign out
                </Button>
              </div>
              {passwordEnabled && !googleLinked && (
                <div className="account-password">
                  <div className="account-password-heading">
                    <strong>Change password</strong>
                    <p>Confirm your current password before choosing a new one.</p>
                  </div>
                  <Field label="Current password">
                    <PasswordInput
                      autoComplete="current-password"
                      value={passwords.current}
                      onChange={(event) =>
                        setPasswords((current) => ({ ...current, current: event.target.value }))
                      }
                    />
                  </Field>
                  <div className="form-grid account-password-grid">
                    <Field label="New password" hint="Use at least 8 characters.">
                      <PasswordInput
                        autoComplete="new-password"
                        value={passwords.next}
                        onChange={(event) =>
                          setPasswords((current) => ({ ...current, next: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Confirm new password">
                      <PasswordInput
                        autoComplete="new-password"
                        value={passwords.confirm}
                        onChange={(event) =>
                          setPasswords((current) => ({ ...current, confirm: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  {passwordError && <p className="field-error" role="alert">{passwordError}</p>}
                  {passwordMessage && <p className="account-password-success" role="status">{passwordMessage}</p>}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={passwordBusy}
                    onClick={async () => {
                      setPasswordError('');
                      setPasswordMessage('');
                      if (!passwords.current) {
                        setPasswordError('Enter your current password.');
                        return;
                      }
                      if (passwords.next.length < 8) {
                        setPasswordError('Your new password must have at least 8 characters.');
                        return;
                      }
                      if (passwords.next !== passwords.confirm) {
                        setPasswordError('The new passwords do not match.');
                        return;
                      }
                      setPasswordBusy(true);
                      try {
                        await changePassword(passwords.current, passwords.next);
                        setPasswords({ current: '', next: '', confirm: '' });
                        setPasswordMessage('Your password has been changed.');
                      } catch (error) {
                        setPasswordError(authErrorMessage(error));
                      } finally {
                        setPasswordBusy(false);
                      }
                    }}
                  >
                    {passwordBusy ? 'Updating password…' : 'Update password'}
                  </Button>
                </div>
              )}
              {googleLinked && (
                <p className="account-password-note">
                  This account is linked to Google. Manage its password through your Google account.
                </p>
              )}
            </Section>
          </fieldset>
        </div>
      </div>
      {Object.keys(form.formState.errors).length > 0 && (
        <p className="field-error" role="alert">
          {form.formState.errors.root?.message ||
            'Please review the highlighted fields. Check that menu options have labels and replies, and keywords are not empty.'}
        </p>
      )}
      <SaveBar
        dirty={form.formState.isDirty}
        saving={form.formState.isSubmitting}
        savedAt={savedAt}
        label="Save settings"
      />
      {guard}
    </form>
  );
}
