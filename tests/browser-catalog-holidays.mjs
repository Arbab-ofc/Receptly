export default async (page) => {
  const fixtures = /*FIXTURE*/ {};
  const writes = [];
  fixtures.catalog = [];
  fixtures.holidays = [];
  await page.unrouteAll();
  await page.route('**/api/v1/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (endpoint === 'events')
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: ready\ndata: {}\n\n',
      });
    let data = fixtures[endpoint] || {};
    if (route.request().method() === 'POST' && ['catalog', 'holidays'].includes(endpoint)) {
      const body = route.request().postDataJSON();
      writes.push({ endpoint, body });
      data = {
        ...body,
        id: `${endpoint}-${writes.length}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };
      fixtures[endpoint].push(data);
    }
    await route.fulfill({ json: { success: true, data } });
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
  await page
    .locator('.desktop-sidebar')
    .getByRole('link', { name: 'Catalog', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Products and services', exact: true }).waitFor();
  await page
    .locator('.page-heading')
    .getByRole('button', { name: /Create catalog item/i })
    .click();
  await page.getByLabel('Item name', { exact: true }).fill('Haircut');
  await page.getByLabel('Type', { exact: true }).selectOption('Service');
  await page.getByLabel('Price', { exact: true }).fill('499.50');
  await page.getByLabel('Additional matching keywords', { exact: true }).fill('trim, styling');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Create|Save/ })
    .click();
  await page.getByRole('heading', { name: 'Haircut', exact: true }).waitFor();
  if (
    writes[0].body.price !== 499.5 ||
    writes[0].body.currency !== 'INR' ||
    writes[0].body.keywords.length !== 2
  )
    throw new Error('Catalog form payload is incorrect');
  await page.screenshot({ path: 'output/playwright/catalog-desktop.png', fullPage: true });
  await page
    .locator('.desktop-sidebar')
    .getByRole('link', { name: 'Holidays', exact: true })
    .click();
  await page
    .locator('.page-heading')
    .getByRole('button', { name: /Create holiday schedule/i })
    .click();
  await page.getByLabel('Holiday or occasion', { exact: true }).fill('Festival');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-20');
  if (await page.getByLabel('Opening time', { exact: true }).count())
    throw new Error('Closed holiday exposes special hours');
  await page.getByRole('switch', { name: 'Closed all day', exact: true }).click();
  await page.getByLabel('Opening time', { exact: true }).fill('11:00');
  await page.getByLabel('Closing time', { exact: true }).fill('15:00');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Create|Save/ })
    .click();
  await page.getByRole('heading', { name: 'Festival', exact: true }).waitFor();
  if (writes[1].body.closed !== false || writes[1].body.open !== '11:00')
    throw new Error('Holiday form payload is incorrect');
  await page.screenshot({ path: 'output/playwright/holidays-desktop.png', fullPage: true });
  const checks = [];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    checks.push({ width, pass: size.document <= width });
    if (size.document > width) throw new Error(`Holiday page overflows at ${width}px`);
    if (width === 320)
      await page.screenshot({ path: 'output/playwright/holidays-mobile.png', fullPage: true });
  }
  return { checks, writes, pass: checks.every((c) => c.pass) };
};
