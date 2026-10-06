import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowUpRight, ShieldCheck, Check } from 'lucide-react';
import { Brand, Button, Field, Skeleton, PasswordInput } from '../components/ui';
import { GoogleAuthButton } from '../components/GoogleAuthButton';
import {
  login,
  loginWithGoogle,
  register,
  resetPassword,
  useAuth,
  authConfigured,
} from '../lib/auth';
import { authErrorMessage } from '../lib/auth-errors';
const schema = z.object({
  name: z.string().max(120).default(''),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(128),
});
export function AuthPage({ signup = false }: { signup?: boolean }) {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('next') || '';
  const destination = /^\/dashboard\/billing(?:\?plan=(monthly|yearly))?$/.test(requested)
    ? requested
    : '/dashboard';
  const [error, setError] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });
  async function continueWithGoogle() {
    if (googleBusy || form.formState.isSubmitting) return;
    setError('');
    setGoogleBusy(true);
    try {
      const result = await loginWithGoogle();
      if (result) navigate(destination, { replace: true });
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  }
  if (!ready) return <Skeleton />;
  if (user) return <Navigate to={destination} replace />;
  return (
    <section className="container auth-layout">
      <div className="auth-story">
        <Link to="/" aria-label="Receptly home">
          <Brand />
        </Link>
        <span className="eyebrow">YOUR SMART WHATSAPP RECEPTIONIST</span>
        <h1>
          More present.
          <br />
          Less busy.
        </h1>
        <p>
          Make room for the work you love.
          <br />
          We’ll take care of the first hello.
        </p>
        {[
          'Your existing WhatsApp number',
          'Automatic replies that sound like you',
          'Human takeover, whenever you need it',
        ].map((v) => (
          <span className="auth-benefit" key={v}>
            <Check size={17} />
            {v}
          </span>
        ))}
        <div className="auth-story-bottom">
          <ShieldCheck size={19} />
          Your conversations stay in your workspace.
        </div>
      </div>
      <div className="auth-form">
        <span className="eyebrow">{signup ? 'LET’S GET YOU STARTED' : 'WELCOME BACK'}</span>
        <h2>{signup ? 'Create your workspace.' : 'Good to see you again.'}</h2>
        <p>
          {signup ? 'A smarter front desk starts here.' : 'Sign in to your Receptly workspace.'}
        </p>
        {!authConfigured && (
          <div className="setup-note">
            Firebase authentication hasn’t been configured yet. Add the frontend Firebase values to
            your environment to enable sign-in.
          </div>
        )}
        <form
          onSubmit={form.handleSubmit(async (values) => {
            if (googleBusy) return;
            setError('');
            try {
              if (signup) {
                if (!values.name.trim()) {
                  form.setError('name', { message: 'Enter your name.' });
                  return;
                }
                await register(values.name, values.email, values.password);
              } else await login(values.email, values.password);
              navigate(
                destination !== '/dashboard'
                  ? destination
                  : signup
                    ? '/dashboard/settings?onboarding=1'
                    : '/dashboard',
              );
            } catch (e) {
              setError(authErrorMessage(e));
            }
          })}
        >
          {signup && (
            <Field label="Your name" error={form.formState.errors.name?.message}>
              <input autoComplete="name" {...form.register('name')} />
            </Field>
          )}
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field
            label="Password"
            hint={signup ? 'Use at least 8 characters.' : undefined}
            error={form.formState.errors.password?.message}
          >
            <PasswordInput
              autoComplete={signup ? 'new-password' : 'current-password'}
              {...form.register('password')}
            />
          </Field>
          {!signup && (
            <div className="auth-forgot-row">
              <button
                className="auth-forgot-button"
                type="button"
                disabled={!authConfigured || resetBusy || form.formState.isSubmitting}
                onClick={async () => {
                  setError('');
                  setResetMessage('');
                  if (!(await form.trigger('email'))) return;
                  setResetBusy(true);
                  try {
                    await resetPassword(form.getValues('email'));
                    setResetMessage('If an email/password account exists for this address, a password reset link is on its way.');
                  } catch (e) {
                    setError(authErrorMessage(e));
                  } finally {
                    setResetBusy(false);
                  }
                }}
              >
                {resetBusy ? 'Sending reset link…' : 'Forgot password?'}
              </button>
            </div>
          )}
          {resetMessage && (
            <p className="auth-reset-message" role="status">
              {resetMessage}
            </p>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button
            className="full-width"
            disabled={!authConfigured || googleBusy || form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
            <ArrowUpRight size={16} />
          </Button>
        </form>
        <div className="auth-divider">
          <span>{signup ? 'or sign up with' : 'or continue with'}</span>
        </div>
        <GoogleAuthButton
          busy={googleBusy}
          disabled={!authConfigured || form.formState.isSubmitting}
          onClick={() => void continueWithGoogle()}
        />
        <p className="auth-alternate">
          {signup ? 'Already have an account?' : 'New to Receptly?'}{' '}
          <Link
            to={`${signup ? '/login' : '/register'}${destination !== '/dashboard' ? `?next=${encodeURIComponent(destination)}` : ''}`}
          >
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        {signup && (
          <small>
            By creating an account, you agree to our <Link to="/terms">Terms</Link> and{' '}
            <Link to="/privacy">Privacy Policy</Link>.
          </small>
        )}
      </div>
    </section>
  );
}
