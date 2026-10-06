export default async (page) => {
  const fixtures = /*FIXTURE*/ {};
  let state = 'populated';
  await page.unrouteAll();
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/v1/', '');
    if (endpoint === 'events') {
      await route.fulfill({ contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' });
      return;
    }
    if (state === 'error') {
      await route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: 'TEST_ERROR', message: 'Test-only temporary service error' },
        },
      });
      return;
    }
    let data;
    if (endpoint.includes('/messages')) data = state === 'empty' ? [] : fixtures.messages;
    else if (endpoint.startsWith('conversations/'))
      data =
        fixtures.conversations.find((c) => c.id === endpoint.split('/')[1]) ||
        fixtures.conversations[0];
    else if (endpoint.startsWith('whatsapp/')) data = fixtures.whatsapp;
    else data = fixtures[endpoint];
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON() || {};
      if (endpoint === 'settings') fixtures.settings = { ...fixtures.settings, ...body };
      if (endpoint === 'rules') {
        data = { ...body, id: 'new-test-rule', createdAt: Date.now(), updatedAt: Date.now() };
        fixtures.rules.push(data);
      }
      if (endpoint === 'contact') data = { id: 'contact-test-request' };
      else data = data || body;
    }
    if (state === 'empty' && Array.isArray(data)) data = [];
    if (state === 'empty' && endpoint === 'analytics') data = { totals: {}, daily: {} };
    await route.fulfill({ json: { success: true, data: data || {} } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'qa-user', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ }).waitFor();
  await page.screenshot({ path: 'output/playwright/dashboard-desktop.png', fullPage: true });
  const checks = [];
  const routes = [
    ['Overview', '/dashboard'],
    ['Inbox', '/dashboard/inbox'],
    ['Leads', '/dashboard/leads'],
    ['Auto replies', '/dashboard/rules'],
    ['Automations', '/dashboard/automations'],
    ['Templates', '/dashboard/templates'],
    ['Knowledge base', '/dashboard/knowledge-base'],
    ['Schedule', '/dashboard/schedule'],
    ['Contacts', '/dashboard/contacts'],
    ['Analytics', '/dashboard/analytics'],
    ['Activity logs', '/dashboard/logs'],
    ['WhatsApp', '/dashboard/whatsapp'],
    ['Settings', '/dashboard/settings'],
  ];
  const navigate = async (label, url) => {
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (page.viewportSize().width < 768) {
      await menu.waitFor();
      await menu.click();
    }
    const navigation =
      page.viewportSize().width < 768 ? page.getByRole('dialog') : page.locator('.desktop-sidebar');
    await navigation.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(`**${url}`);
    await page.waitForLoadState('networkidle');
  };
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [label, url] of routes) {
      await navigate(label, url);
      const measured = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      checks.push({ page: url, ...measured, pass: measured.document <= width });
      if (width === 320 && ['Overview', 'Schedule', 'WhatsApp'].includes(label))
        await page.screenshot({
          path: `output/playwright/${label.toLowerCase()}-mobile.png`,
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate('Auto replies', '/dashboard/rules');
  await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  await page.getByLabel('Rule name', { exact: true }).fill('QA pricing');
  await page.getByLabel('Keywords or patterns', { exact: true }).fill('price, cost');
  await page.getByLabel('Reply message', { exact: true }).fill('Packages start at ₹499.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'QA pricing', exact: true }).waitFor();
  checks.push({ test: 'Rule form save', pass: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await navigate('Inbox', '/dashboard/inbox');
  await page.getByRole('button', { name: /Ananya Sharma/ }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  const measured = await page.evaluate(() => document.documentElement.scrollWidth);
  checks.push({ test: 'Mobile inbox screen', pass: measured === 320 });
  await page.screenshot({ path: 'output/playwright/inbox-mobile.png' });
  await page.getByRole('button', { name: 'Customer details', exact: true }).click();
  checks.push({ test: 'Mobile customer sheet', pass: await page.getByRole('dialog').isVisible() });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
  await navigate('Auto replies', '/dashboard/rules');
  state = 'empty';
  await navigate('Overview', '/dashboard');
  await navigate('Auto replies', '/dashboard/rules');
  // Force only the canonical query to refresh for isolated empty/error state checks.
  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'qa-user', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await navigate(
    state === 'empty' ? 'Auto replies' : 'Schedule',
    state === 'empty' ? '/dashboard/rules' : '/dashboard/schedule',
  );
  await page.getByRole('heading', { name: 'No auto reply rules yet.' }).waitFor();
  checks.push({ test: 'Rules empty state', pass: true });
  state = 'error';
  await navigate('Schedule', '/dashboard/schedule');
  await page.goto('http://localhost:5173/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'qa-user', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard');
  await navigate(
    state === 'empty' ? 'Auto replies' : 'Schedule',
    state === 'empty' ? '/dashboard/rules' : '/dashboard/schedule',
  );
  await page.getByRole('alert').first().waitFor();
  checks.push({ test: 'API error state', pass: true });
  return checks;
};
