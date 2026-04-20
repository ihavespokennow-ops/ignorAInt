# IgnorAInt — SEO Audit

**Audited:** 2026-04-20
**Scope:** ignoraint.com — homepage (index.html), past-sessions.html, blog index, first blog post

---

## Executive Summary

The site has a strong content foundation — warm voice, clear offer, a blog post with real substance — but it's missing a lot of the **basic SEO scaffolding** that search engines and social previews rely on. Three things matter most:

1. **Homepage has no `<h1>` and no meta description.** Google will improvise both, usually badly. This is the single highest-impact fix on the site.
2. **Zero social-preview tags anywhere.** When someone shares ignoraint.com in iMessage, LinkedIn, X, Slack, or email, you get a bare link with no image, no title card, no description. For a site trying to grow a masterclass and newsletter, this is a leak.
3. **No robots.txt, no sitemap.xml, no canonical URLs, no schema markup.** Search engines can still crawl the site, but they're doing it blind — you're leaving the easy signals on the floor.

None of these are hard to fix. You can knock the whole Quick Wins list out in an afternoon and it will measurably improve how the site shows up in search results and when shared.

---

## On-Page Issues

| Page | Issue | Severity | Recommended Fix |
|------|-------|----------|-----------------|
| index.html | No `<h1>` on the page — hero uses `<h2 class="hero-title">` | **Critical** | Change `<h2 class="hero-title">The AI Masterclass</h2>` to `<h1 class="hero-title">…</h1>`. Keep styling. |
| index.html | No `<meta name="description">` | **Critical** | Add: *"A hands-on, no-jargon AI Masterclass for everyday business owners. Two Saturdays. Seventeen topics. Zero fluff — built for people who learn by doing."* (156 chars) |
| index.html | Title tag is only 34 chars and doesn't mention core buyer keywords | High | Change to: *"AI Masterclass for Business Owners — IgnorAInt"* or *"Hands-on AI Training for Small Business Owners — IgnorAInt"* |
| index.html | No Open Graph / Twitter card tags | High | Add `og:title`, `og:description`, `og:image`, `og:url`, `og:type=website`, and Twitter card equivalents so shares don't show as bare links. |
| index.html | No canonical URL | Medium | `<link rel="canonical" href="https://ignoraint.com/">` |
| index.html | No structured data (Organization, Course, Event, Person) | Medium | Add JSON-LD for `Organization` (name, url, logo, sameAs) and `Course`/`Event` for the masterclass. These directly power rich results. |
| past-sessions.html | No Open Graph / Twitter tags | High | Same as homepage. |
| past-sessions.html | No canonical | Medium | Add canonical. |
| past-sessions.html | H1 is just "Past Sessions" — no keywords | Low | Consider *"Past AI Masterclass Sessions"* for clarity. |
| blog/index.html | No Open Graph / Twitter tags | High | Add OG tags so the blog hub previews nicely when shared. |
| blog/index.html | No canonical | Medium | Add canonical. |
| blog/index.html | No `Blog`/`WebSite` JSON-LD | Medium | Add `Blog` schema with `BlogPosting` entries or at least a `WebSite` + `SearchAction`. |
| blog/from-the-shadows-we-rise.html | **No `<meta name="description">`** | **Critical** | Add: *"For a lifetime I was the odd one out. Then AI collapsed the distance between imagining a thing and building it — and the thing that made me 'too much' started to look like the thing that made me useful."* (or similar, 150-160 chars) |
| blog/from-the-shadows-we-rise.html | No Open Graph / Twitter tags | **Critical** | Single most important SEO fix for blog growth. Blog posts live or die on social previews. |
| blog/from-the-shadows-we-rise.html | No `Article` JSON-LD | High | Add `BlogPosting` schema with headline, datePublished (2026-04-22), author (Addie Agarwal), image, publisher. |
| blog/from-the-shadows-we-rise.html | Publish date is visible text but not machine-readable | High | Wrap *"April 22, 2026"* in `<time datetime="2026-04-22">`. |
| blog/from-the-shadows-we-rise.html | 756-word post has **zero `<h2>` subheadings** inside the article (only the CTA heading at the bottom) | High | Add 3-5 `<h2>` subheadings inside the prose. Google rewards scannable structure, readers do too. |
| blog/from-the-shadows-we-rise.html | No author byline `<address>` or schema Person | Medium | Add `rel="author"` link or schema Person inside the Article JSON-LD. |
| All pages | No Twitter/X handle, no sameAs links | Low | Add to Organization schema once you decide what profiles to link. |
| All pages | Referring to `assets/mark.svg` instead of a rasterized `favicon.ico` | Low | Add a 32×32 `.ico` at the root for older browsers, and `apple-touch-icon` for iOS. |

---

## Technical SEO Checklist

| Check | Status | Details |
|-------|--------|---------|
| `robots.txt` at domain root | **Fail** | Missing. Add one that allows all crawlers and points at the sitemap. |
| `sitemap.xml` at domain root | **Fail** | Missing. Should list: `/`, `/past-sessions.html`, `/blog/`, `/blog/from-the-shadows-we-rise.html` with `<lastmod>` dates. |
| HTTPS | Pass (assumed) | You're on ignoraint.com with Resend-verified DKIM/SPF, so I'm assuming the site itself is behind HTTPS. Verify in a live browser. |
| `lang="en"` on `<html>` | Pass | All four pages have it. |
| Mobile viewport meta | Pass | All four pages have `width=device-width, initial-scale=1`. |
| Canonical tags | **Fail** | Zero pages declare a canonical URL. Add one per page. |
| Open Graph / social tags | **Fail** | Zero pages. This is the single biggest deliverability-adjacent miss — every share of your site today is an invisible link. |
| Structured data (schema.org) | **Fail** | Zero pages. Missing at minimum: Organization (homepage), Course/Event (homepage for the masterclass), Blog + BlogPosting (blog). |
| Heading hierarchy (one H1 per page) | **Warning** | Homepage has no H1 (uses H2 for hero). Blog post and past-sessions are fine. |
| Image alt text | Pass | All 5 homepage images have alt attributes. |
| Favicon | **Warning** | SVG-only favicon (`assets/mark.svg`). Add a `.ico` fallback at `/favicon.ico` for older clients and email previews. |
| Page speed — render-blocking assets | **Warning** | Homepage is 83 KB inline (1,629 lines of inline `<style>`). Inline CSS is fine for a single-page site, but the Google Fonts `@import` inside `<style>` blocks paint. Move fonts to `<link rel="preconnect">` + `<link rel="stylesheet">` in the `<head>` to shave ~300ms off LCP. |
| Font loading hints | **Warning** | No `preconnect` to `fonts.googleapis.com` or `fonts.gstatic.com`. |
| Broken links | Not tested | Run a link checker once robots.txt/sitemap are live. |
| Duplicate content | Pass | No duplicate pages detected. |

---

## Keyword Opportunities

IgnorAInt sits in a niche with surprisingly little sharp competition: "AI for small business owners, *taught by someone who isn't a tech bro*." The big AI education players (Coursera, DeepLearning.AI, Maven) target engineers and PMs. The small-business angle is under-served by anyone who writes with a human voice. That is your moat.

| Keyword | Est. Difficulty | Opportunity | Current Ranking | Intent | Recommended Content Type |
|---------|----------------|-------------|-----------------|--------|--------------------------|
| AI masterclass for business owners | Moderate | **High** | Not ranking | Commercial | Homepage hero + title |
| AI training for small business | Moderate | **High** | Not ranking | Commercial | Homepage + dedicated landing |
| AI for real estate agents | Easy-Moderate | **High** | Not ranking | Commercial | Dedicated landing page (you already serve this audience) |
| AI for multifamily syndicators | Easy | **High** | Not ranking | Commercial | Dedicated landing page |
| AI for healthcare professionals | Moderate | **High** | Not ranking | Commercial | Dedicated landing page |
| how to use AI for small business | Moderate | **High** | Not ranking | Informational | Blog pillar post + masterclass CTA |
| AI tools for entrepreneurs | Hard | Medium | Not ranking | Commercial | Blog post / comparison |
| AI for 1099 contractors | Easy | **High** | Not ranking | Commercial | Blog post + landing page |
| ChatGPT for small business | Hard | Medium | Not ranking | Informational | Blog post |
| AI workshop for non-technical | Easy | **High** | Not ranking | Commercial | Homepage variant / landing |
| how to learn AI without coding | Moderate | **High** | Not ranking | Informational | Blog post |
| AI for coaches and consultants | Easy | Medium | Not ranking | Commercial | Landing page |
| AI for contractors service business | Easy | Medium | Not ranking | Commercial | Blog post |
| AI for ecommerce owners | Moderate | Medium | Not ranking | Commercial | Blog post |
| from the shadows we rise | Easy | Low | (brand term) | Navigational | Existing post |
| Addie Agarwal AI | Easy | Medium | Not ranking | Navigational | About page + schema Person |
| IgnorAInt blog | Easy | High | (brand term) | Navigational | Existing — reinforce with schema |
| ADHD and AI productivity | Moderate | **High** | Not ranking | Informational | Natural follow-up post to your first essay |
| AI for people who learn by doing | Easy | Medium | Not ranking | Informational | Blog post / newsletter positioning |
| XSITE Capital AI | Easy | Low | Not ranking | Navigational | About/team page |

**Note on volume data:** I don't have an Ahrefs/Semrush MCP connected, so these are directional. To pin down actual search volume and difficulty, connect one and re-run this audit.

---

## Content Gap Recommendations

Your blog has one excellent essay. To build compounding organic traffic you need 8-12 more posts that each anchor a specific keyword or audience segment. Priorities:

- **AI for real estate agents — a practical primer** · *Why:* your audience page already calls them out; zero on-site content currently targets them. · *Format:* 1,500-2,000 word pillar post with 3-5 tool walkthroughs. · *Priority:* High · *Effort:* Substantial (multi-day)
- **AI for multifamily operators: 7 workflows that pay for themselves** · *Why:* your highest-value audience (XSITE connection), nearly-zero direct competition. · *Format:* Pillar post. · *Priority:* High · *Effort:* Substantial
- **"I have ADHD and I use AI like this"** · *Why:* your existing essay opens the door; this is the follow-up people will actively search for after reading the first. · *Format:* Practical essay, 1,200-1,500 words. · *Priority:* High · *Effort:* Moderate
- **The honest AI tool list: what I actually use and what I dropped** · *Why:* "AI tools for X" is one of the highest-volume queries on the web. An honest, curated list from a named person is the ranking-cheat code. · *Format:* Long-form comparison, evergreen, updated quarterly. · *Priority:* High · *Effort:* Substantial
- **A landing page per audience on the homepage's 8 segments** · *Why:* right now all 8 audiences share one homepage. A page each (e.g., `/for-contractors/`) can rank independently and dramatically increase your long-tail capture. · *Format:* Landing page, reusing homepage sections. · *Priority:* Medium · *Effort:* Moderate per page
- **A glossary: "AI terms for non-technical people"** · *Why:* "what is a prompt" / "what is an LLM" / "what is RAG" type queries get traffic forever. · *Format:* One long glossary page with anchor links per term. · *Priority:* Medium · *Effort:* Moderate
- **Behind-the-scenes of each masterclass session (post-event)** · *Why:* you already plan to publish past sessions; treat each recap as a keyword play. · *Format:* Summary + 3-5 takeaways + video embed. · *Priority:* Medium · *Effort:* Quick win per session
- **FAQ-schema'd section on the homepage** · *Why:* People Also Ask results are easy to capture with well-marked-up FAQ content. · *Format:* 6-8 Q&As at the bottom of the homepage, wrapped in `FAQPage` schema. · *Priority:* Medium · *Effort:* Quick win

---

## Competitor Snapshot

I don't have a live crawler connected, so this is directional from general market knowledge. To validate, connect an SEO tool or give me 2-3 specific competitors you want benchmarked.

| Dimension | Your Site | Typical Big-Player (Coursera, DeepLearning.AI) | Typical Niche Creator (1-person Substack/course) | Winner |
|-----------|-----------|-----------------------------------------------|---------------------------------------------------|--------|
| Audience focus | Very specific (small-business owners, non-tech) | Broad / technical | Varies | **You** |
| Content voice | Warm, personal, considered | Institutional | Often chatty but unfocused | **You** |
| On-page SEO scaffolding | Missing most of it | Fully built out | Often decent (Ghost/Substack templates do this for free) | Big players |
| Structured data | None | Course + Organization + BreadcrumbList | Usually Article schema at minimum | Competitors |
| Publishing cadence | 1 post so far | Industrial | 1-4 posts/week | Competitors |
| Social share previews | Broken (no OG tags) | Polished | Template-provided | Competitors |
| Backlink profile | Likely very low | Very strong | Medium | Big players |

The good news: the things where competitors beat you are almost entirely the cheap, mechanical stuff — scaffolding, markup, consistency. The things where you beat them — specificity of audience, voice, trust — are the things that are actually hard to build. Close the SEO gap and your moat becomes visible to search engines.

---

## Prioritized Action Plan

### Quick Wins (do this week — ~2 hours total)

1. **Add an `<h1>` to the homepage.** Change the hero `<h2 class="hero-title">` to `<h1 class="hero-title">`. Impact: **High.** Effort: 2 minutes.
2. **Write and install meta descriptions on index.html and the blog post.** Impact: **High** (they're what show up under your title in Google results). Effort: 15 minutes.
3. **Add Open Graph + Twitter card tags to all 4 pages.** You'll need one 1200×630 OG image — reuse `logo-reverse.svg` on a solid ink/ember background, exported as PNG, saved as `assets/og-default.png`. Impact: **High** (every share everywhere). Effort: 45 minutes including the image export.
4. **Add canonical tags to all 4 pages.** Impact: Medium. Effort: 5 minutes.
5. **Create `/robots.txt` and `/sitemap.xml`.** Impact: Medium. Effort: 15 minutes.
6. **Wrap the blog post publish date in `<time datetime="2026-04-22">`.** Impact: Medium. Effort: 2 minutes.
7. **Add 3-5 `<h2>` subheadings inside the blog post.** Impact: Medium. Effort: 15 minutes.
8. **Add `preconnect` hints for Google Fonts.** Impact: Low-Medium (LCP). Effort: 5 minutes.

### Strategic Investments (plan for this quarter)

1. **Ship Article + Organization + Course JSON-LD.** Rich-result eligibility. Impact: High. Effort: Half day.
2. **Publish 3 audience-specific landing pages** (real estate, multifamily, healthcare) before the next masterclass cycle. Reuse the homepage sections; change headlines and intro copy. Impact: High (each becomes a separate ranking entry point). Effort: 1 day per page.
3. **Commit to 1 blog post every 2 weeks through Q3.** Use the Content Gap list above as your backlog. Impact: High — compounding. Effort: Ongoing.
4. **Add an FAQ section to the homepage with `FAQPage` schema.** Impact: Medium (captures People Also Ask traffic). Effort: Half day.
5. **Build simple internal linking between blog posts as the archive grows.** At minimum, "related posts" under each essay. Impact: Medium. Effort: Small per post.
6. **Connect an SEO MCP (Ahrefs or Semrush) to make future audits data-grounded.** Impact: High for decision-making. Effort: 30 min setup.

---

## What I didn't test

- Live site response codes, HTTPS redirect behavior, actual Core Web Vitals from a real browser — these need the site served, not just the files. Run a PageSpeed Insights check on `https://ignoraint.com/` once these fixes land.
- Backlink profile (no crawler connected).
- Internal search ranking — you'd need Google Search Console data for this.
- CMS-side perf (cache headers, CDN, HTTP/2) — again, needs live server access.
