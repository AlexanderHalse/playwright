const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper service running' });
});

// Screenshot endpoint: scroll page, then full-page PNG screenshot
app.post('/scrape-full', async (req, res) => {
  const { url, options = {} } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url"' });
  }

  const {
    waitUntil = 'domcontentloaded',
    cookieHeader = null,
  } = options;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 1) Turn your header into real cookies
    if (cookieHeader) {
      const cookies = headerToCookies(cookieHeader, url);
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // 2) Navigate
    await page.goto(url, {
      waitUntil,
      timeout: 60000,
    });

    // Optional: log what cookies Playwright sees (for debugging)
    // console.log(await context.cookies());

    // 3) Let it render + scroll, same as before
    await page.waitForTimeout(3000);

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 800;
        const timer = setInterval(() => {
          const { scrollHeight } = document.body;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 400);
      });
    });

    await page.waitForTimeout(2000);

    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: true,
    });

    res.set('Content-Type', 'image/png');
    res.send(screenshotBuffer);
  } catch (err) {
    console.error('SCREENSHOT ERROR:', err);
    res.status(500).json({
      error: 'Screenshot failed',
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Put the helper function outside the route
function headerToCookies(cookieHeader, url) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      return { name, value, url };
    });
}


// Render / Docker PORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper service listening on port ${port}`);
});
