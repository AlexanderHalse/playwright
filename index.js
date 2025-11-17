const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scraper service running' });
});

// POST /scrape-full
// Body: { url: string, options?: {...} }
// Returns many fields by default.
app.post('/scrape-full', async (req, res) => {
  const { url, options = {} } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url"' });
  }

  // Defaults for options
  const {
    waitUntil = 'networkidle',
    maxLinks = 1000,
    maxImages = 500,
    includeText = false
  } = options;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil, timeout: 60000 });

    const data = await page.evaluate((maxLinks, maxImages, includeText) => {
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
        textBlocks: []
      };

      // meta tags
      out.meta = Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.getAttribute('name'),
        property: m.getAttribute('property'),
        content: m.getAttribute('content')
      }));

      // open graph
      out.openGraph = Array.from(document.querySelectorAll('meta[property^="og:"]')).map(m => ({
        property: m.getAttribute('property'),
        content: m.getAttribute('content')
      }));

      // json-ld
      out.jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(s => {
          try {
            return JSON.parse(s.textContent);
          } catch {
            return s.textContent.trim();
          }
        });

      // headings
      out.headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
        .map(h => ({
          tag: h.tagName.toLowerCase(),
          text: (h.innerText || '').trim()
        }));

      // links
      out.links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, maxLinks)
        .map(a => ({
          href: a.href,
          text: (a.innerText || '').trim()
        }));

      // images
      out.images = Array.from(document.querySelectorAll('img[src]'))
        .slice(0, maxImages)
        .map(img => ({
          src: img.src,
          alt: img.alt || null
        }));

      // scripts
      out.scripts = Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.src);

      // stylesheets
      out.stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => l.href);

      if (includeText) {
        out.textBlocks = Array.from(document.querySelectorAll('p'))
          .map(p => (p.innerText || '').trim())
          .filter(t => t.length > 0)
          .slice(0, 500);
      }

      return out;
    }, maxLinks, maxImages, includeText);

    res.json({ scrapedAt: new Date().toISOString(), data });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: 'Scrape failed', details: String(err) });
  } finally {
    if (browser) await browser.close();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper service listening on port ${port}`);
});
