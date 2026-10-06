export default async (page) => {
  const fixtures = /*FIXTURE*/ {};
  const checks = [];
  const check = (name, pass) => {
    checks.push({ test: name, pass });
    if (!pass) throw new Error(name);
  };
  fixtures.rules = [];
  fixtures.onboarding.hasRules = false;
  fixtures.settings.automationEnabled = false;
  // Firebase removes empty lists from stored objects; legacy API responses can omit these.
  delete fixtures.settings.menuOptions;
  delete fixtures.settings.humanKeywords;
  delete fixtures.settings.leadKeywords;
  const messages = Array.from({ length: 50 }, (_, i) => ({
    id: `message-${i}`,
    conversationId: 'chat-one',
    direction: 'incoming',
    source: 'customer',
    type: 'text',
    text: `Customer message ${i}`,
    timestamp: Date.now() - (50 - i) * 60000,
  }));
  const older = Array.from({ length: 3 }, (_, i) => ({
    ...messages[0],
    id: `older-${i}`,
    text: `Earlier message ${i}`,
    timestamp: messages[0].timestamp - (3 - i) * 60000,
  }));
  let analyticsError = false;
  let savedSettings;
  await page.unrouteAll();
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/v1/', '');
    if (endpoint === 'events') {
      await route.fulfill({ contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' });
      return;
    }
    if (endpoint === 'analytics' && analyticsError) {
      await route.fulfill({
        status: 503,
        json: { success: false, error: { message: 'Analytics unavailable in this test' } },
      });
      return;
    }
    let data;
    if (endpoint.endsWith('/messages')) data = url.searchParams.has('before') ? older : messages;
    else if (endpoint.startsWith('conversations/'))
      data = fixtures.conversations.find((c) => c.id === endpoint.split('/')[1]);
    else if (endpoint.startsWith('whatsapp/')) data = fixtures.whatsapp;
    else if (endpoint === 'receptionist/status') data = { businessOpen: true };
    else data = fixtures[endpoint];
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON() || {};
      if (endpoint === 'settings') {
        savedSettings = body;
        fixtures.settings = { ...fixtures.settings, ...body };
        data = fixtures.settings;
      }
      if (endpoint === 'rules') {
        data = { ...body, id: 'starter-rule', createdAt: Date.now(), updatedAt: Date.now() };
        fixtures.rules.push(data);
        fixtures.onboarding.hasRules = true;
      }
    }
    await route.fulfill({ json: { success: true, data: data || {} } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5173/');
  check(
    'Hero shows the dashboard activity preview',
    await page.locator('.hero-visual .product-preview .preview-chart').isVisible(),
  );
  await page.getByText('Can I reply myself?', { exact: true }).click();
  check('FAQ expands', (await page.locator('.visitor-questions details[open]').count()) === 1);
  await page.goto('http://localhost:5173/documentation');
  check('Distinct documentation title', (await page.title()).startsWith('Setup guide'));
  check(
    'Linking illustration present',
    await page.getByRole('img', { name: /Example Receptly connection screen/ }).isVisible(),
  );

  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'enhancement-test', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await page.getByText('YOUR NEXT STEP', { exact: true }).waitFor();
  check(
    'Onboarding highlights first incomplete step',
    (await page.locator('.setup-next h3').innerText()) === 'Create your first reply rule',
  );
  const navigate = async (label) => {
    await page.getByRole('link', { name: label, exact: true }).click();
  };
  await navigate('Settings');
  await page.getByLabel('Business name', { exact: true }).fill('Updated studio');
  await page.getByRole('button', { name: 'Replies & menu', exact: true }).click();
  check(
    'Settings groups hide unrelated controls',
    !(await page.getByLabel('Business name', { exact: true }).isVisible()),
  );
  await page.getByRole('switch', { name: 'Enable the WhatsApp menu', exact: true }).click();
  await page.getByRole('button', { name: 'Add pricing & hours menu', exact: true }).click();
  check(
    'Starter menu has pricing and schedule actions',
    (await page.getByLabel('Option 1 answer type', { exact: true }).inputValue()) === 'pricing' &&
      (await page.getByLabel('Option 2 answer type', { exact: true }).inputValue()) ===
        'opening_hours' &&
      (await page.getByLabel('Option 3 answer type', { exact: true }).inputValue()) ===
        'closing_hours',
  );
  check(
    'Menu preview includes daily stop option',
    await page.getByText('0. Stop for today', { exact: true }).isVisible(),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  check(
    'Menu editor fits mobile',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.screenshot({ path: 'output/playwright/whatsapp-menu-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  check(
    'Settings preserves edits between groups',
    (await page.getByLabel('Business name', { exact: true }).inputValue()) === 'Updated studio',
  );
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved', { exact: true }).waitFor();
  check(
    'Settings saves controls from hidden groups',
    savedSettings.businessName === 'Updated studio' &&
      savedSettings.fallbackMessage === fixtures.settings.fallbackMessage &&
      savedSettings.followUpHours === 6 &&
      savedSettings.menuEnabled &&
      savedSettings.menuOptions.length === 3 &&
      Array.isArray(savedSettings.menuOptions) &&
      Array.isArray(savedSettings.humanKeywords) &&
      Array.isArray(savedSettings.leadKeywords),
  );
  await navigate('Automations');
  await page
    .locator('.automation-list article')
    .filter({ hasText: 'Out-of-hours reply' })
    .getByRole('link', { name: 'Configure' })
    .click();
  await page.getByLabel('Closed-hours message').waitFor();
  check(
    'Configure opens the relevant settings group',
    await page.getByLabel('Closed-hours message').isVisible(),
  );

  await page.screenshot({
    path: 'output/playwright/settings-enhanced-desktop.png',
    fullPage: true,
  });
  await navigate('Auto replies');
  await page.getByRole('button', { name: 'Opening hours', exact: false }).click();
  check(
    'Starter is disabled until reviewed',
    (await page.getByRole('switch', { name: 'Enable this rule' }).getAttribute('aria-checked')) ===
      'false',
  );
  check(
    'Advanced rule controls initially collapsed',
    !(await page.getByLabel('Priority', { exact: true }).isVisible()),
  );
  await page.getByText('Advanced options', { exact: true }).click();
  check(
    'Advanced rule controls expand',
    await page.getByLabel('Priority', { exact: true }).isVisible(),
  );
  check(
    'Reply preview resolves business variables',
    !(await page.locator('.rule-preview .demo-bubble').innerText()).includes('{{'),
  );
  await page.screenshot({ path: 'output/playwright/rule-editor-enhanced.png' });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Opening hours', exact: true }).waitFor();
  check(
    'Starter rule saves as a new record',
    fixtures.rules[0].enabled === false && fixtures.rules[0].scope === 'direct',
  );

  await navigate('Leads');
  await page.getByRole('cell', { name: /^Ananya Sharma/ }).waitFor();
  check(
    'Lead table shows customer and value',
    (await page.getByRole('cell', { name: /^Ananya Sharma/ }).isVisible()) &&
      (await page.getByRole('cell', { name: '499', exact: true }).isVisible()),
  );
  await page.setViewportSize({ width: 375, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  check(
    'Mobile leads fit the viewport',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.screenshot({ path: 'output/playwright/leads-enhanced-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate('Inbox');
  await page.getByRole('button', { name: 'Needs human 1', exact: true }).click();
  check(
    'Human filter shows relevant chats',
    (await page.getByRole('button', { name: /Rahul Mehta/ }).count()) === 1 &&
      (await page.getByRole('button', { name: /Ananya Sharma/ }).count()) === 0,
  );
  await page.getByRole('button', { name: 'All 2', exact: true }).click();
  await page.getByRole('button', { name: /Ananya Sharma/ }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft for Ananya');
  await page.getByRole('button', { name: /Rahul Mehta/ }).click();
  await page.waitForFunction(() => document.querySelector('.chat-composer textarea')?.value === '');
  check(
    'Another chat starts with its own draft',
    (await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue()) === '',
  );
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft for Rahul');
  await page.getByRole('button', { name: /Ananya Sharma/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.chat-composer textarea')?.value === 'Draft for Ananya',
  );
  check(
    'Draft restored on chat switch',
    (await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue()) ===
      'Draft for Ananya',
  );
  await page.getByText('Customer message 49', { exact: true }).waitFor();
  await page.locator('.chat-messages').evaluate((el) => {
    el.scrollTop = 0;
  });
  const before = await page
    .locator('.message')
    .filter({ hasText: 'Customer message 5' })
    .boundingBox();
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await page.getByText('Earlier message 0', { exact: true }).waitFor();
  const after = await page
    .locator('.message')
    .filter({ hasText: 'Customer message 5' })
    .boundingBox();
  check('Loading earlier messages preserves reading position', Math.abs(after.y - before.y) < 60);
  await page.screenshot({ path: 'output/playwright/inbox-enhanced-desktop.png' });
  await navigate('Templates');
  await navigate('Inbox');
  await page.getByRole('button', { name: /Ananya Sharma/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.chat-composer textarea')?.value === 'Draft for Ananya',
  );
  check(
    'Draft survives navigation within the workspace',
    (await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue()) ===
      'Draft for Ananya',
  );

  fixtures.whatsapp = {
    status: 'qr_required',
    qrExpiresAt: Date.now() + 60000,
    qr:
      'data:image/svg+xml;base64,' +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#f1f5ee"/><rect x="18" y="18" width="54" height="54" rx="6" fill="#285c49"/><rect x="148" y="18" width="54" height="54" rx="6" fill="#285c49"/><rect x="18" y="148" width="54" height="54" rx="6" fill="#285c49"/><text x="110" y="113" text-anchor="middle" font-family="Arial" fill="#285c49" font-size="16">Example QR area</text><text x="110" y="135" text-anchor="middle" font-family="Arial" fill="#56634f" font-size="12">Illustration only</text></svg>',
      ).toString('base64'),
  };
  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'enhancement-test', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await navigate('WhatsApp');
  await page.locator('.qr-image').waitFor();
  await page
    .locator('.connection-state')
    .screenshot({ path: 'apps/web/public/whatsapp-linking.png' });
  check('Connection guide screenshot generated from the app', true);
  analyticsError = true;
  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'enhancement-test', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await page.locator('.overview-grid .error-state').waitFor();
  check(
    'Analytics failure does not display a zero chart',
    (await page.locator('.overview-grid .recharts-wrapper').count()) === 0,
  );
  return checks;
};
