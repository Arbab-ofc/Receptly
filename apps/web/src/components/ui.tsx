import {
  useEffect,
  useId,
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';
import {
  X,
  Search,
  MessageSquare,
  Check,
  ArrowUpRight,
  ChevronDown,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { connectionPresentation } from '../lib/presentation';
import { create } from 'zustand';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <MessageSquare size={19} strokeWidth={2.5} />
        <span />
      </span>
      receptly<span className="brand-period">.</span>
    </span>
  );
}
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
}) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Status({ active, label }: { active?: boolean; label: string }) {
  return (
    <span className="status">
      <i className={active ? 'live' : ''} />
      {label}
    </span>
  );
}
export function ConnectionStatus({
  status,
  failed = false,
}: {
  status?: string;
  failed?: boolean;
}) {
  const state = connectionPresentation(failed ? 'error' : status);
  return (
    <span
      className={`status connection-status ${state.tone}`}
      title={`WhatsApp: ${state.label}`}
      aria-label={`WhatsApp: ${state.label}`}
    >
      <i className={status === 'connected' && !failed ? 'live' : ''} />
      <span>{state.label}</span>
    </span>
  );
}
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  const generatedId = useId();
  const control = isValidElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }>(children)
    ? children
    : null;
  const id = control?.props.id || generatedId;
  const description = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control
        ? cloneElement(control, {
            id,
            'aria-describedby': description || undefined,
            'aria-invalid': Boolean(error),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-control">
      <input {...props} type={visible ? 'text' : 'password'} />
      <Button
        type="button"
        variant="ghost"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </Button>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
export function Avatar({ name, photoURL }: { name: string; photoURL?: string | null }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  return (
    <span className="avatar">
      {photoURL && failedPhoto !== photoURL ? (
        <img
          src={photoURL}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedPhoto(photoURL)}
        />
      ) : (
        name
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join('')
          .toUpperCase() || 'R'
      )}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <MessageSquare size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton({
  variant = 'list',
}: {
  variant?: 'list' | 'form' | 'chat' | 'dashboard' | 'chart';
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className={`skeleton-wrap skeleton-${variant}`}
    >
      {Array.from({ length: variant === 'form' ? 6 : variant === 'dashboard' ? 4 : 3 }, (_, i) => (
        <div key={i} className={`skeleton ${i === 2 ? 'short' : ''}`} />
      ))}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <strong>Unable to load this section</strong>
      <p>{error.message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title={title} onClose={onClose}>
      <p>{description}</p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Working…' : 'Confirm'}
        </Button>
      </div>
    </Dialog>
  );
}
const toastStore = create<{
  text: string;
  tone: 'success' | 'error';
  set: (text: string, tone?: 'success' | 'error') => void;
}>((set) => ({
  text: '',
  tone: 'success',
  set: (text, tone = 'success') => set({ text, tone }),
}));
export const toast = (text: string, tone: 'success' | 'error' = 'success') =>
  toastStore.getState().set(text, tone);
export function Toast() {
  const { text, tone, set } = toastStore();
  useEffect(() => {
    if (text) {
      const timer = setTimeout(() => set(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [text, set]);
  return text ? (
    <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}
      {text}
      <button aria-label="Dismiss notification" onClick={() => set('')}>
        <X size={16} />
      </button>
    </div>
  ) : null;
}
export function SaveBar({
  dirty,
  saving,
  savedAt,
  label,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="sticky-save" aria-live="polite">
      <span>
        {saving
          ? 'Saving your changes…'
          : dirty
            ? 'You have unsaved changes'
            : savedAt
              ? `Saved at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'No unsaved changes'}
      </span>
      <div className="save-actions">
        {children}
        <Button disabled={saving}>{saving ? 'Saving…' : label}</Button>
      </div>
    </div>
  );
}
export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-panel ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export { ArrowUpRight, ChevronDown };
