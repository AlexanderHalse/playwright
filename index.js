const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper service running' });
});

// Versatile full-page scrape
app.post('/scrape-full', async (req, res) => {
  const { url, options = {} } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url"' });
  }

  const {
    waitUntil = 'networkidle',
    maxLinks = 1000,
    maxImages = 500,
    includeText = false,
  } = options;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    // Reasonable defaults for many sites
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    await page.goto(url, {
      waitUntil,
      timeout: 60000,
    });

    // IMPORTANT: single argument object only
    const data = await page.evaluate(({ maxLinks, maxImages, includeText }) => {
      const out = {
        url: window.location.href,
        title: document.title || null,
        meta: [],
        openGraph: [],
        jsonLd: [],
        headings: [],
        links: [],
        images: [],
        scripts: [],
        stylesheets: [],
        textBlocks: [],
      };

      // meta tags
      out.meta = Array.from(document.querySelectorAll('meta')).map((m) => ({
        name: m.getAttribute('name'),
        property: m.getAttribute('property'),
        content: m.getAttribute('content'),
      }));

      // Open Graph tags
      out.openGraph = Array.from(
        document.querySelectorAll('meta[property^="og:"]'),
      ).map((m) => ({
        property: m.getAttribute('property'),
        content: m.getAttribute('content'),
      }));

      // JSON-LD
      out.jsonLd = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      ).map((s) => {
        const raw = s.textContent || '';
        try {
          return JSON.parse(raw);
        } catch {
          return raw.trim();
        }
      });

      // Headings
      out.headings = Array.from(
        document.querySelectorAll('h1, h2, h3, h4'),
      ).map((h) => ({
        tag: h.tagName.toLowerCase(),
        text: (h.innerText || '').trim(),
      }));

      // Links (limited)
      out.links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, maxLinks)
        .map((a) => ({
          href: a.href,
          text: (a.innerText || '').trim(),
        }));

      // Images (limited)
      out.images = Array.from(document.querySelectorAll('img[src]'))
        .slice(0, maxImages)
        .map((img) => ({
          src: img.src,
          alt: img.alt || null,
        }));

      // Script URLs
      out.scripts = Array.from(document.querySelectorAll('script[src]')).map(
        (s) => s.src,
      );

      // Stylesheet URLs
      out.stylesheets = Array.from(
        document.querySelectorAll('link[rel="stylesheet"]'),
      ).map((l) => l.href);

      // Optional text blocks
      if (includeText) {
        out.textBlocks = Array.from(document.querySelectorAll('p'))
          .map((p) => (p.innerText || '').trim())
          .filter((t) => t.length > 0)
          .slice(0, 500);
      }

      return out;
    }, { maxLinks, maxImages, includeText });

    res.json({
      scrapedAt: new Date().toISOString(),
      data,
    });
  } catch (err) {
    console.error('SCRAPE ERROR:', err);
    res.status(500).json({
      error: 'Scrape failed',
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
