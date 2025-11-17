const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper service running' });
});

// Screenshot-tiles endpoint: fixed viewport, multiple PNGs
app.post('/scrape-full', async (req, res) => {
  const { url, options = {} } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url"' });
  }

  const {
    waitUntil = 'domcontentloaded',
    cookieHeader = null,

    // viewport config (fixed size for all screenshots)
    viewportWidth = 1366,
    viewportHeight = 768,

    // safety limits
    maxShots = 30,       // maximum number of tiles to capture
    scrollOverlap = 0,   // pixels of overlap between shots (0 = none)
  } = options;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil,
      timeout: 60000,
    });

    // Let initial content render
    await page.waitForTimeout(3000);

    // Ensure everything lazy-loads at least once by scrolling to bottom
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

    // Small pause for final content
    await page.waitForTimeout(2000);

    // Now calculate how many viewport-sized shots we need
    const totalHeight = await page.evaluate(() => document.body.scrollHeight);
    const effectiveStep = Math.max(1, viewportHeight - scrollOverlap);
    const rawShots = Math.ceil(totalHeight / effectiveStep);
    const numShots = Math.min(rawShots, maxShots);

    const imagesBase64 = [];

    for (let i = 0; i < numShots; i++) {
      const y = i * effectiveStep;

      await page.evaluate((scrollY) => {
        window.scrollTo(0, scrollY);
      }, y);

      // wait a bit after each scroll
      await page.waitForTimeout(600);

      const buffer = await page.screenshot({
        type: 'png',
        fullPage: false, // viewport only
      });

      imagesBase64.push(buffer.toString('base64'));
    }

    res.json({
      scrapedAt: new Date().toISOString(),
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
      totalHeight,
      numShots,
      images: imagesBase64, // each item is a base64 PNG for one tile
    });
  } catch (err) {
    console.error('SCREENSHOT TILES ERROR:', err);
    res.status(500).json({
      error: 'Screenshot tiles failed',
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

// Render / Docker PORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper service listening on port ${port}`);
});
