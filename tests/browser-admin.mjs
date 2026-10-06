export default async (page) => {
  const fixtures = /*FIXTURE*/ {};
  let allowed = true;
  let adminReads = 0;
  const workspace = {
    businessName: 'Alice Studio',
    timezone: 'Asia/Kolkata',
    automationEnabled: true,
    mode: 'Available',
    version: 3,
    connectionStatus: 'connected',
    deletionStatus: null,
    access: { tier: 'free', source: 'none', expiresAt: null, version: 0 },
  };
  const user = {
    uid: 'alice',
    email: 'alice@example.test',
    displayName: 'Alice',
    disabled: false,
    emailVerified: true,
    createdAt: '2026-10-01T00:00:00Z',
    lastSignInAt: '2026-10-06T00:00:00Z',
    admin: false,
    workspace,
  };
  const enquiries = [
    {
      id: 'request-one',
      name: 'Customer',
      email: 'customer@example.test',
      subject: 'Setup help',
      message: 'How do I connect my workspace?',
      status: 'new',
      version: 0,
      createdAt: Date.now(),
    },
  ];
  const audit = [];
  await page.unrouteAll();
  await page.route('**/api/v1/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (endpoint === 'events')
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: ready\ndata: {}\n\n',
      });
    let data = fixtures[endpoint] || {};
    if (endpoint === 'account/access') data = { admin: allowed };
    if (endpoint === 'billing')
      data = {
        plans: [],
        payments: [],
        subscription: null,
        active: true,
        access: workspace.access,
        enforcementEnabled: true,
        paymentConfigured: false,
      };
    if (endpoint === 'billing/payments') data = { items: [], nextCursor: null };
    if (endpoint.startsWith('admin/')) {
      adminReads++;
      if (!allowed)
        return route.fulfill({
          status: 403,
          json: {
            success: false,
            error: { code: 'FORBIDDEN', message: 'Administrator access required' },
          },
        });
      if (endpoint === 'admin/users') data = { items: [user], nextCursor: null };
      if (endpoint === 'admin/users/alice')
        data = {
          ...user,
          analytics: [{ date: '2026-10-06', incoming: 10, autoReplies: 7, leads: 2 }],
        };
      if (endpoint === 'admin/system')
        data = {
          ready: true,
          uptimeSeconds: 3600,
          lastSchedulerAt: Date.now(),
          activeStreams: 2,
          counters: { 'api.requests': 20 },
        };
      if (endpoint === 'admin/enquiries') data = { items: enquiries, nextCursor: null };
      if (endpoint === 'admin/audit') data = { items: audit, nextCursor: null };
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        if (endpoint === 'admin/users/alice/plan') {
          if (body.expectedVersion !== workspace.access.version)
            throw new Error('Wrong access version');
          workspace.access = {
            tier: body.tier,
            source: body.tier === 'pro' ? 'admin' : 'none',
            expiresAt: null,
            version: workspace.access.version + 1,
          };
          data = workspace.access;
        }
        if (endpoint === 'admin/users/alice/automation') {
          workspace.automationEnabled = body.enabled;
          workspace.version++;
          data = workspace;
          audit.push({
            id: 'audit-one',
            actorId: 'qa-user',
            targetId: 'alice',
            action: 'automation_paused',
            createdAt: Date.now(),
          });
        }
        if (endpoint === 'admin/enquiries/request-one') {
          enquiries[0].status = body.status;
          enquiries[0].version++;
          data = enquiries[0];
        }
      }
    }
    await route.fulfill({ json: { success: true, data } });
  });
  const signIn = async () => {
    await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
    await page.evaluate(async () => {
      const { useAuth } = await import('/src/lib/auth.ts');
      useAuth.setState({
        user: { uid: 'qa-user', email: 'qa@example.invalid', displayName: 'Admin' },
        ready: true,
      });
    });
    await page.waitForURL('**/dashboard');
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5173/login');
  await signIn();
  await page
    .locator('.desktop-sidebar')
    .getByRole('link', { name: 'Admin panel', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Alice Studio', exact: true }).waitFor();
  const proToggle = page.getByRole('switch', { name: 'Pro access for alice@example.test' });
  await proToggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="switch"][aria-label="Pro access for alice@example.test"]')
        ?.getAttribute('aria-checked') === 'true',
  );
  await page.getByText('Pro', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await page.getByRole('dialog').getByText('Recent activity · UTC days').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Pause automation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Enable automation', exact: true }).waitFor();
  if (workspace.automationEnabled !== false) throw new Error('Automation action was not saved');
  await page.screenshot({ path: 'output/playwright/admin-desktop.png', fullPage: true });
  await page.getByRole('tab', { name: 'Support enquiries', exact: true }).click();
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Audit log', exact: true }).click();
  await page.getByRole('heading', { name: 'automation paused', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'System health', exact: true }).click();
  await page.getByText('60 minutes', { exact: true }).waitFor();
  const checks = [];
  for (const tab of ['Users & workspaces', 'Support enquiries', 'Audit log', 'System health']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const size = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      if (size.document > width) throw new Error(`${tab} overflows at ${width}px`);
      checks.push({ tab, width, pass: true });
      if (tab === 'Users & workspaces' && width === 320)
        await page.screenshot({ path: 'output/playwright/admin-mobile.png', fullPage: true });
    }
  }
  await page.getByRole('tab', { name: 'Users & workspaces', exact: true }).click();
  await page.getByRole('switch', { name: 'Pro access for alice@example.test' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="switch"][aria-label="Pro access for alice@example.test"]')
        ?.getAttribute('aria-checked') === 'false',
  );
  if (workspace.access.tier !== 'free' || workspace.access.version !== 2)
    throw new Error('Pro revocation failed');
  user.admin = true;
  workspace.access = { tier: 'pro', source: 'platform_admin', expiresAt: null, version: 0 };
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Admin · always Pro', { exact: true }).waitFor();
  if (!(await page.getByRole('switch', { name: 'Pro access for alice@example.test' }).isDisabled()))
    throw new Error('Admin plan switch is not locked');
  await page.evaluate(() => {
    history.pushState({}, '', '/dashboard/billing');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('heading', { name: 'Your Pro access is active', exact: true }).waitFor();
  await page
    .getByText('Your admin account always includes Pro. No payment or renewal required.', {
      exact: true,
    })
    .waitFor();
  if (await page.getByRole('button', { name: 'Continue to payment' }).count())
    throw new Error('Admin was prompted to buy access');
  allowed = false;
  await page.reload();
  await signIn();
  const before = adminReads;
  await page.evaluate(() => {
    history.pushState({}, '', '/dashboard/admin');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByText('Administrator access required', { exact: true }).waitFor();
  if (adminReads !== before) throw new Error('Denied user requested platform data');
  return {
    pass: true,
    checks,
    accessDenied: true,
    proGrantedAndRevoked: true,
    adminAlwaysPro: true,
    automationPaused: true,
    enquiryResolved: enquiries[0].status === 'resolved',
  };
};
