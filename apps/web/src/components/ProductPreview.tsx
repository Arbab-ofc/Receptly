import {
  MessageSquare,
  LayoutDashboard,
  Users,
  Zap,
  FileText,
  BarChart3,
  Settings,
  ArrowUpRight,
  Check,
  Clock,
  ArrowUp,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { Brand, Status, Avatar, Badge } from './ui';
const conversations = [
  {
    name: 'Ananya Sharma',
    text: 'Perfect, I’d like to book an appointment.',
    time: 'Just now',
    type: 'New lead',
  },
  {
    name: 'Rahul Mehta',
    text: 'What time does your store close?',
    time: '2 min',
    type: 'Auto replied',
  },
  {
    name: 'Priya Patel',
    text: 'Thanks! That’s exactly what I needed.',
    time: '8 min',
    type: 'Auto replied',
  },
];
export function ProductPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`product-preview ${compact ? 'compact' : ''}`}
      aria-label="Illustrative Receptly dashboard preview"
    >
      <div className="preview-top">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>your workspace, always on</span>
        <ShieldCheck size={13} />
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <Brand />
          <small>WORKSPACE</small>
          {[
            [LayoutDashboard, 'Overview'],
            [MessageSquare, 'Inbox'],
            [Users, 'Leads'],
            [Zap, 'Auto replies'],
            [FileText, 'Templates'],
            [BarChart3, 'Analytics'],
          ].map(([Icon, label], i) => {
            const I = Icon as typeof MessageSquare;
            return (
              <div key={String(label)} className={i === 0 ? 'selected' : ''}>
                <I size={15} />
                <span>{String(label)}</span>
                {i === 1 && <b>3</b>}
              </div>
            );
          })}
          <div className="preview-bottom">
            <Settings size={15} />
            Settings
          </div>
        </aside>
        <div className="preview-main">
          <div className="preview-header">
            <span>Overview</span>
            <Status active label="WhatsApp connected" />
          </div>
          <div className="preview-greeting">
            <div>
              <h3>
                A little less busy.
                <br />A lot more responsive.
              </h3>
              <p>Your receptionist is taking care of things.</p>
            </div>
            <span className="preview-date">
              Today <Clock size={12} />
            </span>
          </div>
          <div className="preview-metrics">
            {[
              ['128', 'Messages received'],
              ['96', 'Automatic replies'],
              ['12', 'New leads'],
            ].map(([value, label]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>
                  {value}
                  <span>
                    <ArrowUp size={10} />
                    12%
                  </span>
                </strong>
              </div>
            ))}
          </div>
          <div className="preview-chart-head">
            <strong>Message activity</strong>
            <div>
              <i />
              Received <i />
              Auto replies
            </div>
          </div>
          <div className="preview-chart">
            <svg
              viewBox="0 0 500 115"
              preserveAspectRatio="none"
              role="img"
              aria-label="Illustrative message activity"
            >
              <defs>
                <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dcece6" />
                  <stop offset="100%" stopColor="#fff" />
                </linearGradient>
              </defs>
              {[20, 55, 90].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="500"
                  y1={y}
                  y2={y}
                  stroke="#eceeeb"
                  strokeDasharray="3 5"
                />
              ))}
              <path
                d="M0 95 C25 95 25 80 50 82 S90 105 125 65 S170 50 200 66 S230 78 260 40 S310 78 340 32 S385 42 410 17 S450 43 500 18 L500 115 L0 115Z"
                fill="url(#area)"
              />
              <path
                d="M0 95 C25 95 25 80 50 82 S90 105 125 65 S170 50 200 66 S230 78 260 40 S310 78 340 32 S385 42 410 17 S450 43 500 18"
                fill="none"
                stroke="#427b67"
                strokeWidth="2.5"
              />
              <path
                d="M0 104 C40 102 45 95 70 98 S115 85 140 89 S200 77 230 80 S280 60 310 67 S370 51 410 55 S460 36 500 41"
                fill="none"
                stroke="#a0afa7"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
            </svg>
            <div>
              <span>9 AM</span>
              <span>12 PM</span>
              <span>3 PM</span>
              <span>6 PM</span>
            </div>
          </div>
          <div className="preview-list-heading">
            <strong>Recent conversations</strong>
            <ArrowUpRight size={14} />
          </div>
          {conversations.map((c) => (
            <div className="preview-conversation" key={c.name}>
              <Avatar name={c.name} />
              <div>
                <strong>{c.name}</strong>
                <p>{c.text}</p>
              </div>
              <div>
                <small>{c.time}</small>
                <Badge tone={c.type === 'New lead' ? 'warm' : 'green'}>{c.type}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="preview-active">
        <span className="preview-active-icon">
          <Zap size={19} />
        </span>
        <div>
          <strong>Your receptionist is active</strong>
          <span>Good conversations start with a quick reply.</span>
        </div>
        <span className="check-circle">
          <Check size={17} />
        </span>
      </div>
      <div className="preview-reply">
        <span>
          <MessageSquare size={14} /> RECEPTLY REPLIED
        </span>
        <p>
          Hi Rahul! We’re open until 8 PM today.
          <br />
          Happy to help if you need anything else.
        </p>
        <small>
          <Check size={12} />
          Sent automatically · just now
        </small>
      </div>
      <span className="preview-disclaimer">Illustrative product preview</span>
    </div>
  );
}
export function ConversationMicro() {
  return (
    <div className="micro-chat">
      <div className="micro-incoming">
        Hi! What are your opening hours?<small>10:42 AM</small>
      </div>
      <div className="micro-outgoing">
        <span>
          <Zap size={12} /> Receptly
        </span>
        We’re here Monday–Saturday,
        <br />
        10 AM to 8 PM. Come say hello!
        <small>
          10:42 AM <Check size={12} />
        </small>
      </div>
      <div className="micro-composer">
        Always ready with the right answer <Send size={15} />
      </div>
    </div>
  );
}
