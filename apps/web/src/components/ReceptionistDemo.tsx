import { useEffect, useState } from 'react';
import { CheckCheck, Hand, MessageSquare, Pause, Play, Zap } from 'lucide-react';

const steps = [
  {
    label: 'Customer asks',
    customer: 'Hi! What time do you close today?',
    reply: 'Hi! We’re open until 8 PM today. How can we help?',
    status: 'Answered automatically',
    icon: Zap,
  },
  {
    label: 'Receptly replies',
    customer: 'Great. Can I book an appointment?',
    reply:
      'Of course. Let us know your preferred day and time, and our team will confirm availability.',
    status: 'Interest captured as a lead',
    icon: MessageSquare,
  },
  {
    label: 'You take over',
    customer: 'Can I speak to someone first?',
    reply: 'Absolutely. A person will continue the conversation shortly.',
    status: 'Automation paused for a human',
    icon: Hand,
  },
];

export function ReceptionistDemo() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setStep((current) => (current + 1) % steps.length), 4500);
    return () => clearInterval(timer);
  }, [playing]);
  const current = steps[step];
  return (
    <div className="receptionist-demo" aria-label="Illustrative receptionist conversation">
      <div className="demo-heading">
        <span className="demo-avatar">
          <MessageSquare size={22} />
        </span>
        <div>
          <strong>Studio & Co.</strong>
          <span>Receptly receptionist · example</span>
        </div>
        <button
          type="button"
          className="button button--ghost"
          aria-label={playing ? 'Pause demo' : 'Play demo'}
          aria-pressed={playing}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
      </div>
      <div className="demo-messages" key={step} aria-live={playing ? 'off' : 'polite'}>
        <div className="demo-bubble demo-customer">
          <p>{current.customer}</p>
          <small>Customer · 10:42</small>
        </div>
        <div className="demo-bubble demo-reply">
          <span>
            <Zap size={13} /> Automatic reply
          </span>
          <p>{current.reply}</p>
          <small>
            10:42 <CheckCheck size={14} />
          </small>
        </div>
        <div className="demo-outcome">
          <current.icon size={16} />
          <span>{current.status}</span>
        </div>
      </div>
      <div className="demo-steps" aria-label="Conversation demo steps">
        {steps.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={step === index}
            onClick={() => {
              setStep(index);
              setPlaying(false);
            }}
          >
            <span>{index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function InboxPreview() {
  return (
    <div className="inbox-preview" aria-label="Illustrative unified inbox">
      <div className="inbox-preview-list">
        <strong>Inbox</strong>
        <span className="demo-preview-count">1 needs you</span>
        {['Ananya Sharma', 'Rahul Mehta', 'Priya Patel'].map((name, i) => (
          <div key={name} className={i === 0 ? 'preview-chat-active' : ''}>
            <span className="avatar">
              {name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </span>
            <div>
              <strong>{name}</strong>
              <p>
                {
                  [
                    'Can I speak to someone?',
                    'What are your opening hours?',
                    'Thanks for your help!',
                  ][i]
                }
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="inbox-preview-chat">
        <header>
          <strong>Ananya Sharma</strong>
          <span className="badge warm">Needs human</span>
        </header>
        <div className="demo-bubble demo-customer">
          <p>Can I speak to someone?</p>
        </div>
        <div className="demo-bubble demo-reply">
          <p>Of course. A person will continue the conversation shortly.</p>
        </div>
        <div className="preview-handover">
          <Hand size={18} />
          <div>
            <strong>Your turn to reply</strong>
            <p>Automatic replies are paused for this conversation.</p>
          </div>
        </div>
        <div className="preview-composer">
          Write your reply… <MessageSquare size={18} />
        </div>
      </div>
      <small className="inbox-preview-caption">Illustrative inbox · no live customer data</small>
    </div>
  );
}
