import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  MessageSquare,
  CalendarDays,
  Hand,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { subscriptionPlans, type PlanId } from '@receptly/shared';
import { useAuth } from '../lib/auth';
export function PlanChoices({
  selected,
  onSelect,
  disabledPlans = [],
}: {
  disabledPlans?: PlanId[];
  selected: PlanId;
  onSelect: (plan: PlanId) => void;
}) {
  return (
    <fieldset className="plan-choices">
      <legend className="sr-only">Choose your subscription plan</legend>
      {subscriptionPlans.map((plan) => (
        <label key={plan.id} className={`plan-choice ${selected === plan.id ? 'selected' : ''}`}>
          <input
            type="radio"
            name="subscription-plan"
            value={plan.id}
            disabled={disabledPlans.includes(plan.id)}
            checked={selected === plan.id}
            onChange={() => onSelect(plan.id)}
          />
          <span className="plan-choice-top">
            {plan.name}
            <span>{plan.id === 'yearly' ? 'Save ₹58 a year' : 'Pay month by month'}</span>
          </span>
          <span className="plan-choice-price">
            ₹{plan.amountPaise / 100}
            <small>/{plan.id === 'monthly' ? 'month' : 'year'}</small>
          </span>
          <span className="plan-choice-note">
            {plan.id === 'yearly'
              ? '₹650 paid once. One year of access.'
              : '₹59 paid once. One month of access.'}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
export default function Pricing() {
  const user = useAuth((s) => s.user);
  const destination = (id: PlanId) =>
    user
      ? `/dashboard/billing?plan=${id}`
      : `/register?next=${encodeURIComponent(`/dashboard/billing?plan=${id}`)}`;
  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <div className="container">
          <span className="eyebrow">RECEPTLY · SIMPLE PRICING</span>
          <h1>
            A small price.
            <br />
            <span>A calmer inbox.</span>
          </h1>
          <p>
            Your WhatsApp receptionist, with every feature included.
            <br className="desktop-break" /> Choose the rhythm that works for your business.
          </p>
          <div className="pricing-assurance">
            <span>
              <Check size={15} /> Same features, both plans
            </span>
            <span>
              <Check size={15} /> No automatic renewals
            </span>
          </div>
        </div>
      </section>
      <section className="container pricing-plans" aria-label="Subscription plans">
        {subscriptionPlans.map((plan) => (
          <article key={plan.id} className={`pricing-plan ${plan.id === 'yearly' ? 'annual' : ''}`}>
            <div className="pricing-plan-top">
              <span>{plan.name}</span>
              {plan.id === 'yearly' && <span className="pricing-save">SAVE ₹58 / YEAR</span>}
            </div>
            <h2>
              ₹{plan.amountPaise / 100}
              <span>/{plan.id === 'monthly' ? 'month' : 'year'}</span>
            </h2>
            <p>
              {plan.id === 'monthly'
                ? 'Start small. Renew when you need.'
                : 'Settle in for a year of better conversations.'}
            </p>
            <Link
              className={`button ${plan.id === 'yearly' ? 'button--primary' : 'button--outline'}`}
              to={destination(plan.id)}
            >
              Choose {plan.id}
              <ArrowUpRight size={17} />
            </Link>
            <div className="pricing-plan-detail">
              {plan.id === 'yearly'
                ? 'About ₹54.17/month, paid ₹650 yearly.'
                : '₹59 per calendar month.'}
              <br />
              Manual payment. Access starts after approval.
            </div>
          </article>
        ))}
      </section>
      <section className="container pricing-included">
        <div>
          <span className="eyebrow">BUILT INTO BOTH PLANS</span>
          <h2>
            Your front desk,
            <br />
            fully equipped.
          </h2>
          <p>
            One workspace for the replies, schedules and conversations that keep your business
            moving.
          </p>
        </div>
        <div className="pricing-feature-list">
          {[
            [
              MessageSquare,
              'Automatic replies',
              'Answer common questions with your own rules and templates.',
            ],
            [
              CalendarDays,
              'Hours & holidays',
              'Keep replies aligned with your weekly hours and special dates.',
            ],
            [
              BookOpen,
              'Catalog & knowledge base',
              'Share your products, services and answers to everyday questions.',
            ],
            [
              Hand,
              'Human handover & leads',
              'Step into conversations and keep track of interested customers.',
            ],
          ].map(([Icon, title, description]) => {
            const I = Icon as typeof Check;
            return (
              <div key={String(title)}>
                <I size={22} />
                <div>
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="container pricing-how">
        <span className="eyebrow">FROM PLAN TO PAYMENT</span>
        <h2>Three steps. Then you’re ready.</h2>
        <div>
          {[
            ['01', 'Choose your plan', 'Pick monthly or yearly and sign in to your workspace.'],
            [
              '02',
              'Pay & submit your reference',
              'Use the payment details shown in Billing, then enter your transaction reference.',
            ],
            [
              '03',
              'We verify your payment',
              'An admin confirms the bank credit and activates your subscription.',
            ],
          ].map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="container pricing-faq">
        <div>
          <span className="eyebrow">A FEW GOOD QUESTIONS</span>
          <h2>Clear from the start.</h2>
        </div>
        <div>
          {[
            [
              'When does my subscription start?',
              'Your subscription starts when an admin verifies and approves your payment. Sending a payment reference alone does not activate access.',
            ],
            [
              'Will I be charged automatically?',
              'No. Payments and renewals are manual. You choose when to make the next payment.',
            ],
            [
              'What happens if I renew early?',
              'Your new period is added after your current expiry, so you keep the access you have already paid for.',
            ],
            [
              'How do I check payment status?',
              'Open Billing in your dashboard to see payment requests, approval status and your subscription expiry.',
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span>+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="pricing-final">
        <div className="container">
          <h2>Make room for better conversations.</h2>
          <Link to={destination('monthly')} className="button button--primary">
            Start with monthly
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </div>
  );
}
