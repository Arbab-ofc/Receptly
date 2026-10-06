import { Fragment } from 'react';
import { FileText, Zap, Check } from 'lucide-react';
import type { StoredMessage } from '@receptly/shared';
import { messageDay, messageDayLabel } from '../lib/presentation';
import { Empty } from './ui';

export function ChatHistory({
  messages,
  unreadCount = 0,
}: {
  messages: StoredMessage[];
  unreadCount?: number;
}) {
  const firstUnread =
    unreadCount > 0
      ? messages.filter((m) => m.direction === 'incoming').slice(-unreadCount)[0]?.id
      : undefined;
  if (!messages.length)
    return (
      <Empty
        title="No messages in this conversation"
        description="Send a reply to start the conversation."
      />
    );
  return (
    <>
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          {(index === 0 ||
            messageDay(message.timestamp) !== messageDay(messages[index - 1].timestamp)) && (
            <div className="message-date">
              <time dateTime={new Date(message.timestamp).toISOString()}>
                {messageDayLabel(message.timestamp)}
              </time>
            </div>
          )}
          {message.id === firstUnread && <div className="unread-divider">New messages</div>}
          <div className={`message ${message.direction} ${message.source}`}>
            <div>
              {message.direction === 'outgoing' && (
                <span className="message-source">
                  {message.source === 'receptly' ? (
                    <>
                      <Zap size={13} /> Receptly · automatic reply
                    </>
                  ) : (
                    'You · manual reply'
                  )}
                </span>
              )}
              {message.type !== 'text' && (
                <div className="media-message">
                  <FileText size={18} />
                  {message.mediaName || message.type}
                </div>
              )}
              {message.text && <p>{message.text}</p>}
              <small>
                <time dateTime={new Date(message.timestamp).toISOString()}>
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {message.direction === 'outgoing' && (
                  <span className={`delivery-status ${message.sendStatus || ''}`}>
                    {message.sendStatus === 'uncertain' ? (
                      'Delivery unconfirmed'
                    ) : message.sendStatus === 'failed' ? (
                      'Failed to send'
                    ) : message.sendStatus === 'pending' ? (
                      'Sending…'
                    ) : (
                      <>
                        <Check size={13} /> Sent
                      </>
                    )}
                  </span>
                )}
              </small>
            </div>
          </div>
        </Fragment>
      ))}
    </>
  );
}
