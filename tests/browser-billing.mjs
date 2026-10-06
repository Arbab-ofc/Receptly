export default async (page) => {
  const fixtures = /*FIXTURE*/ {};
  const payments = [];
  let subscription = null;
  let configured = true;
  let paymentConnection = { status: 'disconnected', recipientNumber: '919876543210' };
  let automationMutations = 0;
  const checks = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/v1/', '');
    const method = route.request().method();
    if (
      route.request().headers()['content-type']?.includes('application/json') &&
      !route.request().postData()
    ) {
      return route.fulfill({
        status: 400,
        json: {
          success: false,
          error: {
            code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
            message: 'Body cannot be empty when content-type is set to application/json',
          },
        },
      });
    }

    if (endpoint === 'events')
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: ready\ndata: {}\n\n',
      });
    let data = fixtures[endpoint] || {};
    if (endpoint.startsWith('whatsapp/') && method === 'POST') automationMutations++;
    if (endpoint === 'admin/payment-whatsapp/status') data = paymentConnection;
    if (endpoint.startsWith('admin/payment-whatsapp/') && method === 'POST') {
      const action = endpoint.split('/').at(-1);
      paymentConnection =
        action === 'connect' || action === 'reconnect'
          ? {
              status: 'qr_required',
              qr: fixtures.billingQr,
              qrExpiresAt: Date.now() + 60000,
              recipientNumber: '919876543210',
            }
          : { status: 'disconnected', recipientNumber: '919876543210' };
      data = paymentConnection;
    }

    if (endpoint === 'account/access') data = { admin: true };
    if (endpoint === 'billing')
      data = {
        plans: [],
        paymentConfigured: configured,
        enforcementEnabled: true,
        active: !!subscription,
        subscription,
        payments,
      };
    if (endpoint === 'billing/payments' && method === 'GET')
      data = { items: payments, nextCursor: null };
    if (endpoint === 'billing/payments' && method === 'POST') {
      const body = route.request().postDataJSON();
      data = {
        id: `payment-${payments.length}`,
        userId: 'qa-user',
        planId: body.planId,
        amountPaise: body.planId === 'yearly' ? 65000 : 5900,
        currency: 'INR',
        status: 'pending',
        payeeName: 'QA Recipient',
        upiId: 'qa@upi',
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      payments.unshift(data);
    }
    if (endpoint.startsWith('billing/payments/')) {
      const payment = payments.find((p) => p.id === endpoint.split('/').at(-1));
      if (method === 'PATCH') {
        payment.status = 'submitted';
        payment.notificationStatus = 'completed';
        payment.reference = route.request().postDataJSON().reference;
        payment.version++;
      }
      data = {
        ...payment,
        qrDataUrl: fixtures.billingQr,
        upiLink: 'upi://pay?pa=qa%40upi&am=650.00&cu=INR',
      };
    }
    if (endpoint === 'admin/users' || endpoint === 'admin/audit' || endpoint === 'admin/enquiries')
      data = { items: [], nextCursor: null };
    if (endpoint === 'admin/payments')
      data = {
        items: payments.filter(
          (p) =>
            !url.searchParams.get('paymentStatus') ||
            p.status === url.searchParams.get('paymentStatus'),
        ),
        nextCursor: null,
      };
    if (endpoint.startsWith('admin/payments/') && method === 'PATCH') {
      const body = route.request().postDataJSON();
      const payment = payments.find((p) => p.id === endpoint.split('/').at(-1));
      if (!body.bankCreditVerified || body.verifiedAmountPaise !== payment.amountPaise)
        throw new Error('Invalid review payload');
      payment.status = 'approved';
      payment.version++;
      subscription = {
        planId: payment.planId,
        startsAt: Date.now(),
        expiresAt: Date.now() + 365 * 86400000,
      };
      data = payment;
    }
    await route.fulfill({ json: { success: true, data } });
  });
  const navigate = async (path) =>
    page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  const responsive = async (screen) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`${screen} overflows at ${width}px`);
      checks.push({ screen, width, pass: true });
      if (width === 390 || width === 1440)
        await page.screenshot({ path: `output/playwright/${screen}-${width}.png`, fullPage: true });
    }
  };
  await page.goto('http://localhost:5173/pricing');
  await page.getByRole('heading', { name: 'A small price. A calmer inbox.' }).waitFor();
  await responsive('pricing');
  await page.getByRole('link', { name: 'Choose yearly', exact: true }).click();
  await page.waitForURL('**/register?next=*');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useAuth } = await import('/src/lib/auth.ts');
    useAuth.setState({
      user: { uid: 'qa-user', email: 'qa@example.invalid', displayName: 'Alex' },
      ready: true,
    });
  });
  await page.waitForURL('**/dashboard/billing?plan=yearly');
  await page.getByRole('button', { name: 'Continue to payment' }).waitFor();
  if (!(await page.locator('input[value="yearly"]').isChecked()))
    throw new Error('Yearly selection lost after sign in');
  await page.locator('input[value="monthly"]').check();
  await page.locator('input[value="yearly"]').check();
  await responsive('billing-plans');
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('heading', { name: 'Pay ₹650 for your yearly plan' }).waitFor();
  await page.getByRole('img', { name: 'Scan to pay ₹650 to QA Recipient' }).waitFor();
  await responsive('billing-payment');
  await page.getByRole('textbox', { name: 'Transaction reference / UTR' }).fill('UTR123456789');
  await page.getByRole('button', { name: 'I have paid — submit reference' }).click();
  await page.getByRole('heading', { name: 'Awaiting bank verification' }).waitFor();
  if (subscription) throw new Error('Reference submission activated access');
  await navigate('/dashboard/admin');
  await page.getByRole('tab', { name: 'Subscription payments', exact: true }).click();
  await page.getByRole('button', { name: 'Connect payment WhatsApp', exact: true }).click();
  await page
    .getByRole('img', {
      name: 'Scan to connect the separate payment notification WhatsApp',
      exact: true,
    })
    .waitFor();
  await page.waitForTimeout(3500);
  await responsive('payment-sender-qr');
  paymentConnection = {
    status: 'connected',
    displayName: 'Payment alerts',
    phoneNumber: '918888888888',
    recipientNumber: '919876543210',
  };
  await page
    .getByText('Sender connected: Payment alerts · 918888888888', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Disconnect payment WhatsApp', exact: true }).click();
  await page.getByRole('button', { name: 'Connect payment WhatsApp', exact: true }).waitFor();
  if (automationMutations !== 0) throw new Error('Payment linking changed automation connection');
  await page.getByRole('button', { name: 'Review payment' }).waitFor();
  await page.getByText('WhatsApp alert: Sent', { exact: true }).waitFor();
  await responsive('admin-payments');
  await page.getByRole('button', { name: 'Review payment' }).click();
  const dialog = page.getByRole('dialog');
  if (!(await dialog.getByRole('button', { name: 'Approve & activate' }).isDisabled()))
    throw new Error('Verification requirement missing');
  await dialog.getByRole('spinbutton', { name: 'Amount received in bank (INR)' }).fill('650');
  await dialog.getByRole('switch', { name: 'Bank credit verified' }).click();
  await responsive('payment-review');
  await dialog.getByRole('button', { name: 'Approve & activate' }).click();
  await page.getByText('No payments in this view.', { exact: true }).waitFor();
  await navigate('/dashboard/billing');
  await page.getByRole('heading', { name: 'Your subscription is active' }).waitFor();
  await page.getByText('Approved', { exact: true }).waitFor();
  if (!(await page.locator('input[value="yearly"]').isDisabled()))
    throw new Error('Current plan can still be purchased');
  await page.locator('input[value="monthly"]').check();
  if (await page.getByRole('button', { name: 'Continue to payment' }).isDisabled())
    throw new Error('Other plan cannot be scheduled');
  configured = false;
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
  await navigate('/dashboard/billing');
  await page
    .getByText('Payment details are being set up. Please contact support before sending any money.')
    .waitFor();
  if (!(await page.getByRole('button', { name: 'Continue to payment' }).isDisabled()))
    throw new Error('Unconfigured payment remained available');
  return {
    pass: true,
    checks,
    yearlyRedirect: true,
    referenceSubmitted: true,
    adminApproval: true,
    separatePaymentConnection: true,
    unavailableDisabled: true,
  };
};
