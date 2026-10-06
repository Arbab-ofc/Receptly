import { automationEntitled } from '../../services/billing.js';
import { randomUUID } from 'node:crypto';
import { acquire, finish, backoff, leaseMs, type Operation } from '../../services/operations.js';
import { withLock } from '../../services/locks.js';
import { monitoring } from '../../services/monitoring.js';
import { sendOnce } from '../../services/outbound.js';
import {
  defaultSettings,
  defaultHours,
  type Settings,
  type Holiday,
  type CatalogItem,
  catalogReply,
  holidayForDate,
  localDate,
  type Hours,
  type Rule,
  type Template,
  type Conversation,
  type NormalizedMessage,
  type StoredMessage,
  type Contact,
} from '@receptly/shared';
import { store, path, key, stableKey } from '../../services/store.js';
import { events } from '../../services/events.js';
import {
  matches,
  humanIntent,
  businessOpen,
  cooldownAllows,
  renderTemplate,
  formatClockTime,
} from './logic.js';
export type Sender = (uid: string, jid: string, text: string) => Promise<string>;
function formatDisplayName(value: string) {
  const cleaned = value
    .replace(/[\r\n\t\u0000-\u001f\u007f]/g, ' ')
    .replace(/[*_~`]/g, '')
    .trim();
  return (cleaned || 'there').slice(0, 80);
}
export class ReceptionistEngine {
  private queues = new Map<string, Promise<void>>();
  private activeInputs = new Map<string, string>();
  constructor(private send: Sender) {}
  withConversation<T>(uid: string, chatId: string, operation: () => Promise<T>): Promise<T> {
    const queueKey = `${uid}:${chatId}`;
    const next = (this.queues.get(queueKey) || Promise.resolve()).then(operation);
    const settled = next.then(
      () => {},
      () => {},
    );
    this.queues.set(queueKey, settled);
    void settled.then(() => {
      if (this.queues.get(queueKey) === settled) this.queues.delete(queueKey);
    });
    return next;
  }
  handle(message: NormalizedMessage) {
    return this.withConversation(message.userId, message.chatId, () => this.process(message));
  }
  async drain() {
    await Promise.all(this.queues.values());
  }
  async process(m: NormalizedMessage) {
    const uid = m.userId;
    if (await store.get(path('accountDeletion', uid))) return;
    await store.transaction(
      path('workspaceRegistry', uid),
      (current) => current || { createdAt: Date.now() },
    );
    const dedupe = key(`${m.chatId}:${m.id}`);
    const inputPath = path('processingInbox', uid, dedupe);
    if (await store.get(path('processedMessages', uid, dedupe))) return;
    // RTDB transactions reject nested undefined fields (unlike our JSON-serialized writes).
    const payload = JSON.parse(JSON.stringify(m)) as NormalizedMessage;
    await store.transaction<Operation & { payload: NormalizedMessage; stage?: string }>(
      inputPath,
      (current) => current || { payload, status: 'pending', attempts: 0, timestamp: Date.now() },
    );
    const claim = await acquire(inputPath);
    if (!claim) return;
    this.activeInputs.set(`${uid}:${m.chatId}`, dedupe);
    const renewal = setInterval(() => {
      void finish(inputPath, claim.owner, {
        leaseUntil: Date.now() + leaseMs,
        status: 'processing',
      }).catch(() => monitoring.alert('input_lease_renewal_failed'));
    }, leaseMs / 3);
    try {
      await this.processMessage(m, inputPath);
      await finish(inputPath, claim.owner, { status: 'completed' });
      monitoring.increment('messages.processed');
    } catch (error) {
      const code = (error as { code?: string }).code || 'PROCESSING_FAILED';
      await finish(inputPath, claim.owner, {
        status: 'failed',
        errorCode: code,
        nextAttemptAt: Date.now() + backoff(claim.attempts),
      });
      monitoring.alert('message_processing_failed', { code, attempts: claim.attempts });
      throw error;
    } finally {
      clearInterval(renewal);
      this.activeInputs.delete(`${uid}:${m.chatId}`);
    }
  }
  async recover(uid: string) {
    const records = (
      await Promise.all(
        ['pending', 'failed', 'processing'].map((status) =>
          store.findMany<Operation & { payload?: NormalizedMessage }>(
            path('processingInbox', uid),
            'status',
            status,
            100,
          ),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.timestamp - a.timestamp);
    for (const record of records.reverse()) {
      if (
        record.payload &&
        ['pending', 'failed', 'processing'].includes(record.status) &&
        (record.nextAttemptAt || 0) <= Date.now() &&
        (record.leaseUntil || 0) <= Date.now() &&
        record.attempts < 5
      ) {
        try {
          await this.handle(record.payload);
        } catch {
          /* Persisted state and alert retain the failure. */
        }
      }
    }
  }
  private async processMessage(m: NormalizedMessage, inputPath: string) {
    const uid = m.userId;
    const savedSettings = await store.get<Settings>(path('settings', uid));
    const settings = {
      ...defaultSettings,
      ...savedSettings,
      modeReplies: { ...defaultSettings.modeReplies, ...savedSettings?.modeReplies },
    };
    if (m.isGroup && !settings.groupsEnabled) return;
    const cid = key(m.chatId);
    const intake = await withLock(`workspace:${uid}`, async () => {
      if (await store.get(path('accountDeletion', uid))) return;
      const now = Date.now();
      const existing = await store.get<Conversation>(path('conversations', uid, cid));
      const suggestedContactId = key(m.senderJid);
      const previousContact =
        (await store.get<Contact>(path('contacts', uid, suggestedContactId))) ||
        (await store.find<Contact>(path('contacts', uid), 'number', m.senderNumber));
      const contactId = previousContact?.id || suggestedContactId;
      const contact: Contact = {
        id: contactId,
        name: m.senderName?.trim() || previousContact?.name || m.senderNumber,
        number: m.senderNumber,
        type: previousContact?.type || 'Normal',
        notes: previousContact?.notes || '',
        createdAt: previousContact?.createdAt || now,
        firstSeenAt: previousContact?.firstSeenAt || now,
        lastSeenAt: now,
        messageCount: (previousContact?.messageCount || 0) + 1,
      };
      const conversation: Conversation = existing
        ? { ...existing }
        : {
            id: cid,
            contactId,
            chatId: m.chatId,
            name: contact.name,
            number: m.senderNumber,
            lastMessageAt: now,
            unreadCount: 0,
            automationEnabled: true,
            needsHuman: false,
            createdAt: now,
            updatedAt: now,
          };
      conversation.name = contact.name;
      conversation.number = contact.number;
      conversation.lastMessageText = m.text || `[${m.type}]`;
      conversation.lastMessageAt = m.timestamp;
      conversation.updatedAt = now;
      const message: StoredMessage = {
        id: key(m.id),
        conversationId: cid,
        direction: m.fromMe ? 'outgoing' : 'incoming',
        type: m.type,
        text: m.text,
        timestamp: m.timestamp,
        source: m.fromMe ? 'manual' : 'customer',
        mediaName: m.mediaName,
        mimeType: m.mimeType,
      };
      if (m.fromMe) {
        if (await store.get(path(`messages/${uid}`, cid, key(m.id)))) return;
        conversation.lastManualReplyAt = now;
        conversation.pauseUntil = now + settings.pauseAfterManualReplyMinutes * 60000;
      } else {
        conversation.unreadCount++;
      }
      const checkpoint = await store.get<{ stage?: string; newContact?: boolean }>(inputPath);
      if (checkpoint?.stage !== 'stored') {
        await store.update({
          [path('contacts', uid, contactId)]: contact,
          [path(`messages/${uid}`, cid, key(m.id))]: message,
          [path('conversations', uid, cid)]: conversation,
          [`${inputPath}/stage`]: 'stored',
          [`${inputPath}/newContact`]: !previousContact,
          ...store.metricUpdates(
            uid,
            m.fromMe
              ? ['manualReplies', 'outgoing']
              : previousContact
                ? ['incoming']
                : ['incoming', 'newContacts'],
          ),
        });
      } else {
        Object.assign(conversation, existing);
      }
      return {
        contactId,
        previousContact: checkpoint?.newContact ? null : previousContact,
        contact,
        conversation,
        now,
      };
    });
    if (!intake) return;
    const { contactId, previousContact, contact, conversation, now } = intake;
    events.emit(uid, { type: 'message', conversationId: cid });
    if (m.fromMe) return;
    // Cancel pending follow-ups when a customer replies.
    const jobs = await store.findMany<{ id: string; chatId: string; status: string }>(
      path('jobs', uid),
      'chatId',
      m.chatId,
    );
    await Promise.all(
      jobs
        .filter((j) => j.chatId === m.chatId && j.status === 'pending')
        .map((j) => store.patch(path('jobs', uid, j.id), { status: 'cancelled', updatedAt: now })),
    );
    if (
      !settings.automationEnabled ||
      !(await automationEntitled(uid)) ||
      ['Ignore', 'Blocked'].includes(contact.type) ||
      (contact.type === 'VIP' && settings.vipBypass) ||
      (settings.unknownContactsOnly && !!previousContact)
    )
      return;
    const todayDate = localDate(settings.timezone, new Date(now));
    if (conversation.receptionistStoppedDate === todayDate) return;
    if (
      !m.isGroup &&
      settings.menuEnabled &&
      conversation.menuLastSentDate === todayDate &&
      ['0', 'stop', 'stop for today'].includes(m.text?.trim().toLocaleLowerCase() || '')
    ) {
      await store.patch(path('conversations', uid, cid), {
        receptionistStoppedDate: todayDate,
        state: null,
        stateData: null,
        stateExpiresAt: null,
      });
      conversation.receptionistStoppedDate = todayDate;
      await this.reply(
        uid,
        conversation,
        `The receptionist is paused for this chat for the rest of today. Automatic replies resume tomorrow at 00:00 (${settings.timezone}). You can still message our team.`,
        settings,
        defaultHours,
        'menu_stop',
        0,
      );
      events.emit(uid, { type: 'message', conversationId: cid });
      return;
    }
    if (
      settings.leadDetectionEnabled &&
      m.text &&
      matches(m.text, {
        caseSensitive: false,
        matchType: 'any_keyword',
        patterns: settings.leadKeywords,
      }) &&
      !conversation.leadId
    ) {
      const id = key(`lead:${m.chatId}:${m.id}`);
      conversation.leadId = id;
      await store.update({
        [path('leads', uid, id)]: {
          id,
          contactId,
          conversationId: cid,
          status: 'New',
          source: 'WhatsApp',
          interest: m.text.slice(0, 500),
          value: 0,
          notes: '',
          tags: [],
          createdAt: now,
          updatedAt: now,
          lastInteractionAt: now,
        },
        [`${path('conversations', uid, cid)}/leadId`]: id,
        ...store.metricUpdates(uid, ['leads']),
      });
      await store.log(uid, 'lead_created', 'New lead captured.', 'success', {
        conversationId: cid,
      });
    }
    const handover = await store.get<boolean>(`${inputPath}/handover`);
    if (
      !conversation.automationEnabled ||
      conversation.needsHuman ||
      (conversation.pauseUntil || 0) > now
    ) {
      if (handover && conversation.needsHuman) await this.metric(m, 'humanTakeovers');
      if (handover && conversation.needsHuman && settings.humanAcknowledgement)
        await this.reply(
          uid,
          conversation,
          settings.humanAcknowledgement,
          settings,
          defaultHours,
          'human',
          0,
        );
      return;
    }
    if (!m.isGroup && m.text && humanIntent(m.text, settings.humanKeywords)) {
      await store.update({
        [`${path('conversations', uid, cid)}/automationEnabled`]: false,
        [`${path('conversations', uid, cid)}/needsHuman`]: true,
        [`${path('conversations', uid, cid)}/state`]: null,
        [`${path('conversations', uid, cid)}/stateData`]: null,
        [`${path('conversations', uid, cid)}/stateExpiresAt`]: null,
        [`${inputPath}/handover`]: true,
      });
      await this.metric(m, 'humanTakeovers');
      await store.log(uid, 'human_takeover', 'A conversation needs human attention.', 'warning', {
        conversationId: cid,
      });
      if (settings.humanAcknowledgement)
        await this.reply(
          uid,
          conversation,
          settings.humanAcknowledgement,
          settings,
          defaultHours,
          'human',
          0,
        );
      return;
    }
    const hours = (await store.get<Hours>(path('businessHours', uid))) || defaultHours;
    const holidays = await store.list<Holiday>(path('holidays', uid), 200);
    const menuDay = localDate(settings.timezone, new Date(now));
    if (
      !m.isGroup &&
      settings.menuEnabled &&
      settings.menuOptions.length &&
      conversation.menuLastSentDate !== menuDay
    ) {
      await this.showMenu(uid, conversation, settings, hours, holidays, now);
      return;
    }
    if (!businessOpen(hours, settings.timezone, new Date(), holidays)) {
      if (!m.isGroup && settings.outOfHoursEnabled)
        await this.reply(
          uid,
          conversation,
          holidayForDate(holidays, settings.timezone)?.response || settings.outOfHoursMessage,
          settings,
          hours,
          'closed',
          settings.outOfHoursCooldownMinutes,
        );
      return;
    }
    if (settings.mode !== 'Available') {
      const response = settings.modeReplies[settings.mode];
      if (!m.isGroup && response)
        await this.reply(
          uid,
          conversation,
          response,
          settings,
          hours,
          `mode_${settings.mode}`,
          settings.defaultCooldownMinutes,
        );
      return;
    }
    if (!m.text) return;
    if (
      settings.menuEnabled &&
      conversation.state === 'AWAITING_MENU_SELECTION' &&
      (conversation.stateExpiresAt || 0) > now
    ) {
      const selection = m.text.trim().toLocaleLowerCase();
      const response =
        (/^[1-9]$/.test(selection) ? conversation.stateData?.[selection] : undefined) ||
        conversation.stateData?.[key(`label:${selection}`)];
      if (response) {
        await this.reply(uid, conversation, response, settings, hours, 'menu', 0);
        return;
      }
    }
    const rules = (await store.list<Rule>(path('rules', uid), 200, 'priority'))
      .filter((r) => r.enabled && (r.scope || 'direct') === (m.isGroup ? 'group' : 'direct'))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    let matched = false;
    for (const rule of rules) {
      if (!matches(m.text, rule)) continue;
      matched = true;
      const template = rule.replyTemplateId
        ? await store.get<Template>(path('templates', uid, rule.replyTemplateId))
        : null;
      const response = template?.enabled ? template.content : rule.response;
      if (
        response &&
        (await this.reply(
          uid,
          conversation,
          response,
          settings,
          hours,
          `rule_${rule.id}`,
          rule.cooldownMinutes ?? settings.defaultCooldownMinutes,
          rule.id,
        ))
      ) {
        await store.counterOnce(
          uid,
          key(`${m.chatId}:${m.id}:trigger:${rule.id}`),
          `${path('rules', uid, rule.id)}/triggerCount`,
        );
        await store.patch(path('rules', uid, rule.id), { lastTriggeredAt: now });
        if (template)
          await store.counterOnce(
            uid,
            key(`${m.chatId}:${m.id}:template:${template.id}`),
            `${path('templates', uid, template.id)}/usageCount`,
          );
        await this.metric(m, 'rulesTriggered', rule.id);
        await store.log(uid, 'rule_triggered', `Rule “${rule.name}” triggered.`, 'success', {
          ruleId: rule.id,
          conversationId: cid,
        });
        if (settings.followUpEnabled) {
          const id = stableKey(`followup:${m.chatId}:${m.id}:${rule.id}`);
          if (
            !(await store.get(path('jobs', uid, id))) &&
            !(await store.get(path('jobHistory', uid, id)))
          )
            await store.set(path('jobs', uid, id), {
              id,
              userId: uid,
              chatId: m.chatId,
              conversationId: cid,
              type: 'follow_up',
              payload: { text: settings.followUpMessage },
              status: 'pending',
              scheduledFor: now + settings.followUpHours * 3600000,
              createdAt: now,
            });
        }
      }
      if (rule.stopProcessing) return;
    }
    if (matched || m.isGroup) return;
    const catalog = catalogReply(m.text, await store.list<CatalogItem>(path('catalog', uid), 200));
    if (catalog) {
      await this.reply(
        uid,
        conversation,
        catalog,
        settings,
        hours,
        'catalog',
        settings.defaultCooldownMinutes,
      );
      return;
    }
    const faqs = await store.list<{ enabled: boolean; keywords: string[]; answer: string }>(
      path('knowledgeBase', uid),
      200,
    );
    const faq = faqs.find(
      (f) =>
        f.enabled &&
        matches(m.text!, { caseSensitive: false, matchType: 'any_keyword', patterns: f.keywords }),
    );
    if (faq) {
      await this.reply(
        uid,
        conversation,
        faq.answer,
        settings,
        hours,
        'faq',
        settings.defaultCooldownMinutes,
      );
      return;
    }
    if (!previousContact && settings.welcomeEnabled) {
      await this.reply(
        uid,
        conversation,
        settings.welcomeMessage,
        settings,
        hours,
        'welcome',
        settings.defaultCooldownMinutes,
      );
      return;
    }
    if (settings.fallbackEnabled) {
      await this.reply(
        uid,
        conversation,
        settings.fallbackMessage,
        settings,
        hours,
        'fallback',
        settings.fallbackCooldownMinutes,
      );
    }
  }
  private async showMenu(
    uid: string,
    conversation: Conversation,
    settings: Settings,
    hours: Hours,
    holidays: Holiday[],
    now: number,
  ) {
    const catalog = settings.menuOptions.some((option) => option.action === 'pricing')
      ? await store.list<CatalogItem>(path('catalog', uid), 200)
      : [];
    const holiday = holidayForDate(holidays, settings.timezone, new Date(now));
    const day = new Date(localDate(settings.timezone, new Date(now)) + 'T00:00:00Z').getUTCDay();
    const today = holiday
      ? { enabled: !holiday.closed, open: holiday.open, close: holiday.close }
      : hours.find((h) => h.day === day);
    const responses: Record<string, string> = {};
    settings.menuOptions.forEach((option, index) => {
      let response = option.response;
      if (option.action === 'pricing')
        response =
          catalogReply(
            'catalog',
            catalog.map((item) => ({ ...item, keywords: item.keywords || [] })),
          ) ||
          'Please tell us which product or service you are interested in, and our team will share the current pricing.';
      if (option.action === 'opening_hours' || option.action === 'closing_hours') {
        const time = option.action === 'opening_hours' ? today?.open : today?.close;
        response =
          today?.enabled && time
            ? `We ${option.action === 'opening_hours' ? 'open' : 'close'} at ${formatClockTime(time)} today (${settings.timezone}).\nBusiness hours: {{business_hours}}`
            : 'We are closed today. Business hours: {{business_hours}}';
      }
      responses[String(index + 1)] = response;
      responses[key(`label:${option.label.trim().toLocaleLowerCase()}`)] ||= response;
    });
    const text =
      settings.menuMessage +
      '\n\n' +
      settings.menuOptions.map((option, index) => `${index + 1}. ${option.label}`).join('\n') +
      '\n0. Stop for today\n\nReply with an option number or name. Reply 0 or Stop to pause the receptionist for this chat until midnight.';
    const menuDay = localDate(settings.timezone, new Date(now));
    if (
      await this.reply(
        uid,
        conversation,
        text,
        settings,
        hours,
        'menu',
        0,
        undefined,
        `daily-menu:${conversation.id}:${menuDay}`,
      )
    ) {
      await store.patch(path('conversations', uid, conversation.id), {
        menuLastSentDate: menuDay,
        state: 'AWAITING_MENU_SELECTION',
        stateData: responses,
        stateExpiresAt: now + 1800000,
      });
    }
  }
  private async metric(
    m: NormalizedMessage,
    name: 'humanTakeovers' | 'rulesTriggered',
    ruleId?: string,
  ) {
    const token = key(`${m.chatId}:${m.id}:${name}:${ruleId || ''}`);
    await store.metricOnce(m.userId, token, name, ruleId);
  }
  async reply(
    uid: string,
    c: Conversation,
    content: string,
    settings: Settings,
    hours: Hours,
    reason: string,
    minutes: number,
    ruleId?: string,
    operationKey?: string,
  ) {
    const now = Date.now();
    if (!(await automationEntitled(uid, now))) return false;
    const recipient = await store.get<Contact>(path('contacts', uid, c.contactId));
    if (recipient && ['Ignore', 'Blocked'].includes(recipient.type)) return false;
    if (
      reason !== 'menu_stop' &&
      c.receptionistStoppedDate === localDate(settings.timezone, new Date(now))
    )
      return false;
    const inputId = operationKey || this.activeInputs.get(`${uid}:${c.chatId}`);
    const requestId = inputId ? stableKey(`${inputId}:${reason}:${ruleId || ''}`) : randomUUID();
    const request = await store.get<{ status: string }>(path('sendRequests', uid, requestId));
    if (request?.status === 'completed') return true;
    if (request && ['sending', 'uncertain'].includes(request.status)) {
      await store.patch(path('sendRequests', uid, requestId), { status: 'uncertain' });
      await store.patch(path(`messages/${uid}`, c.id, requestId), { sendStatus: 'uncertain' });
      return false;
    }
    const previous = c.cooldowns?.[key(reason)] ?? c.cooldowns?.[reason];
    if (
      !cooldownAllows(previous, minutes, now) ||
      !cooldownAllows(
        c.lastAutoReplyAt,
        reason === 'human' || reason === 'menu' || reason === 'menu_stop'
          ? 0
          : settings.defaultCooldownMinutes,
        now,
      )
    )
      return false;
    const customerName = formatDisplayName(c.name || 'there');
    const businessName = formatDisplayName(settings.businessName || 'our business');
    let body = renderTemplate(
      content,
      settings,
      hours,
      customerName,
      new Date(),
      await store.list<Holiday>(path('holidays', uid), 200),
    ).trim();
    if (!body) return false;
    // Keep existing “Hi {{name}}” templates natural after adding the standard greeting.
    const escapedName = customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`^\\s*(?:hi|hello)\\s+${escapedName}[,!:?.]*\\s*`, 'i'), '');
    const text = [
      `*${businessName}*`,
      '━━━━━━━━━━━━━━━━━━',
      `Hi *${customerName}*,`,
      '',
      body,
      '',
      '━━━━━━━━━━━━━━━━━━',
    ].join('\n');
    try {
      await sendOnce(uid, c, text, requestId, this.send, {
        source: 'receptly',
        ruleId,
        cooldownReason: reason,
      });
      if (!['menu', 'menu_stop'].includes(reason)) c.lastAutoReplyAt = now;
      c.cooldowns = { ...c.cooldowns, [key(reason)]: now };
      events.emit(uid, { type: 'message', conversationId: c.id });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === 'DELIVERY_UNCERTAIN') {
        monitoring.alert('automatic_send_uncertain');
      }
      throw error;
    }
  }
}
