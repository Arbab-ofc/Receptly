export default async (page) => {
  const checks = [];
  const widths = [320, 360, 375, 390, 430, 640, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920, 2560];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
    const measured = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    checks.push({ page: 'home', ...measured, pass: measured.document <= width });
    if ([320, 768, 1440].includes(width))
      await page.screenshot({ path: `output/playwright/home-${width}.png`, fullPage: true });
  }
  for (const url of [
    '/features',
    '/contact',
    '/login',
    '/register',
    '/privacy',
    '/terms',
    '/documentation',
    '/missing',
    '/dashboard',
  ]) {
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://localhost:5173${url}`);
      await page.waitForLoadState('networkidle');
      const measured = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      checks.push({ page: url, ...measured, pass: measured.document <= width, route: page.url() });
    }
  }
  await page.goto('http://localhost:5173/contact');
  await page.getByRole('button', { name: 'Send message' }).click();
  const errors = await page.locator('[role="alert"]').count();
  checks.push({ test: 'Contact validation', pass: errors === 4, errors });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  checks.push({
    test: 'Mobile menu',
    pass: await page.getByRole('link', { name: 'Contact', exact: true }).first().isVisible(),
  });
  await page.screenshot({ path: 'output/playwright/mobile-navigation.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, target] of [
      ['Product', 'product'],
      ['How it works', 'how-it-works'],
    ]) {
      await page.goto('http://localhost:5173/features');
      if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name, exact: true })
        .click();
      await page.waitForFunction((id) => {
        const rect = document.getElementById(id)?.getBoundingClientRect();
        return rect && rect.top >= 0 && rect.top < 150 && window.scrollY > 0;
      }, target);
      // Clicking the same hash again must restore the section after manually scrolling away.
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name, exact: true })
        .click();
      await page.waitForFunction(() => window.scrollY > 0);
      checks.push({ test: `${name} navigation and repeat click at ${width}px`, pass: true });
    }
    if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Features', exact: true })
      .click();
    await page.waitForURL('**/features');
    await page.waitForFunction(() => window.scrollY === 0);
    checks.push({ test: `Features navigation at ${width}px`, pass: true });
  }
  return checks;
};
