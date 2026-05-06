export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, market, apiKey } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const results = {};

    // ── 1. Google PageSpeed ───────────────────────────────────────────
    if (apiKey) {
      try {
        const psRes = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=mobile`);
        const psData = await psRes.json();
        if (psData.lighthouseResult) {
          const audits = psData.lighthouseResult.audits;
          const score = Math.round((psData.lighthouseResult.categories?.performance?.score || 0) * 100);
          const issues = [], recs = [];
          if (score < 50) issues.push("أداء الموقع ضعيف جداً على الجوال");
          else if (score < 80) issues.push("سرعة التحميل تحتاج تحسيناً");
          else issues.push("أداء الموقع جيد على الجوال ✅");
          if (audits?.["uses-optimized-images"]?.score < 1) { issues.push("الصور غير محسّنة"); recs.push({ text: "ضغط الصور واستخدام WebP", priority: "عالي" }); }
          if (audits?.["render-blocking-resources"]?.score < 1) { issues.push("موارد تعيق التحميل"); recs.push({ text: "إزالة موارد تعيق العرض", priority: "عالي" }); }
          if (audits?.["uses-text-compression"]?.score < 1) recs.push({ text: "تفعيل Gzip أو Brotli", priority: "متوسط" });
          if (!recs.length) recs.push({ text: "السرعة في حالة جيدة 🎉", priority: "منخفض" });
          results.speed = {
            score, isReal: true,
            metrics: {
              lcp: audits?.["largest-contentful-paint"]?.displayValue || "—",
              cls: audits?.["cumulative-layout-shift"]?.displayValue || "—",
              fcp: audits?.["first-contentful-paint"]?.displayValue || "—",
              tbt: audits?.["total-blocking-time"]?.displayValue || "—",
              si: audits?.["speed-index"]?.displayValue || "—",
            },
            summary: `نتيجة الأداء الحقيقية على الجوال: ${score}/100`,
            issues, recommendations: recs,
          };
        }
      } catch (e) {
        results.speed = { score: 0, isReal: false, summary: "تعذّر PageSpeed API", issues: [e.message], recommendations: [] };
      }
    }

    // ── 2. Scrape & Analyze HTML ──────────────────────────────────────
    let html = "";
    let htmlData = {};
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const htmlRes = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" } });
      html = await htmlRes.text();

      const getTag = (tag) => { const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").trim() : ""; };
      const getMeta = (name) => { const m = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i")) || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i")); return m ? m[1].trim() : ""; };

      const title = getTag("title");
      const description = getMeta("description");
      const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      const imgCount = (html.match(/<img/gi) || []).length;
      const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
      const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || "";
      const hasViewport = /name=["']viewport["']/i.test(html);
      const schemaTypes = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      const hasVideo = /<video|youtube\.com|vimeo\.com/i.test(html);
      const internalLinks = (html.match(/href=["'][^"'#]*["']/gi) || []).length;
      const langAttr = (html.match(/lang=["']([^"']+)["']/i) || [])[1] || "";
      const robotsMeta = getMeta("robots");

      const plainText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const wordCount = plainText.split(/\s+/).filter(w => w.length > 2).length;

      htmlData = { title, description, h1s, h2s, h3s, imgCount, imgNoAlt, canonical, hasViewport, schemaTypes, hasVideo, internalLinks, wordCount, langAttr, robotsMeta };

      // ── Structure ──
      const oi = [], or_ = [];
      if (!title) oi.push("❌ لا يوجد Title");
      else if (title.length < 30) oi.push(`❌ Title قصير (${title.length} حرف) — المثالي 50-60`);
      else if (title.length > 60) oi.push(`⚠️ Title طويل (${title.length} حرف) — سيُقطع`);
      else oi.push(`✅ Title مناسب (${title.length} حرف)`);

      if (!description) oi.push("❌ لا توجد Meta Description");
      else if (description.length < 100) oi.push(`⚠️ Meta Description قصيرة (${description.length} حرف)`);
      else oi.push(`✅ Meta Description جيدة (${description.length} حرف)`);

      if (h1s.length === 0) oi.push("❌ لا يوجد H1");
      else if (h1s.length > 1) oi.push(`⚠️ يوجد ${h1s.length} H1 — يجب واحد فقط`);
      else oi.push(`✅ H1: "${h1s[0].substring(0,50)}"`);

      if (imgNoAlt > 0) oi.push(`⚠️ ${imgNoAlt}/${imgCount} صورة بدون Alt Text`);
      else if (imgCount > 0) oi.push(`✅ كل الصور (${imgCount}) لها Alt Text`);

      if (!canonical) oi.push("⚠️ لا يوجد Canonical URL");
      else oi.push("✅ Canonical URL موجود");

      if (h2s.length === 0) oi.push("⚠️ لا توجد عناوين H2");
      else oi.push(`✅ ${h2s.length} عنوان H2`);

      if (!title || title.length < 30) or_.push({ text: "اكتب Title يحتوي الكلمة المفتاحية (50-60 حرف)", priority: "عالي" });
      if (!description) or_.push({ text: "أضف Meta Description جذابة (150-160 حرف)", priority: "عالي" });
      if (imgNoAlt > 0) or_.push({ text: `أضف Alt Text لـ ${imgNoAlt} صورة`, priority: "عالي" });
      if (!canonical) or_.push({ text: "أضف Canonical URL", priority: "متوسط" });
      if (h2s.length === 0) or_.push({ text: "أضف عناوين H2 لتنظيم المحتوى", priority: "متوسط" });
      if (!or_.length) or_.push({ text: "بنية الصفحة ممتازة ✅", priority: "منخفض" });

      results.structure = {
        score: Math.max(20, 100 - (oi.filter(i => i.startsWith("❌")).length * 15) - (oi.filter(i => i.startsWith("⚠️")).length * 8)),
        isReal: true,
        summary: `Title: ${title.length || 0} حرف | H1: ${h1s.length} | H2: ${h2s.length} | صور بدون Alt: ${imgNoAlt}/${imgCount}`,
        issues: oi, recommendations: or_
      };

      // ── Schema ──
      const si = [], sr = [];
      if (schemaTypes.length === 0) {
        si.push("❌ لا يوجد Schema Markup في الموقع");
        sr.push({ text: "أضف LocalBusiness أو Organization Schema", priority: "عالي" });
        sr.push({ text: "أضف Product/Service Schema لكل خدمة", priority: "عالي" });
        sr.push({ text: "فعّل AggregateRating لعرض النجوم في البحث", priority: "متوسط" });
      } else {
        si.push(`✅ Schema موجود: ${schemaTypes.slice(0,5).join(", ")}`);
        if (!schemaTypes.some(t => ["AggregateRating","Rating"].includes(t))) sr.push({ text: "أضف AggregateRating للتقييمات", priority: "عالي" });
        if (!schemaTypes.includes("BreadcrumbList")) sr.push({ text: "أضف BreadcrumbList Schema", priority: "متوسط" });
        if (!schemaTypes.some(t => ["FAQPage","Question"].includes(t))) sr.push({ text: "أضف FAQPage Schema", priority: "متوسط" });
        if (!sr.length) sr.push({ text: "Schema في حالة جيدة", priority: "منخفض" });
      }
      results.schema = {
        score: schemaTypes.length > 3 ? 80 : schemaTypes.length > 1 ? 60 : schemaTypes.length > 0 ? 40 : 15,
        isReal: true,
        summary: schemaTypes.length > 0 ? `✅ وُجد ${schemaTypes.length} نوع Schema: ${schemaTypes.slice(0,3).join(", ")}` : "❌ لا يوجد Schema في الموقع",
        issues: si, recommendations: sr
      };

      // ── Content Quality (100% Real) ──
      const ci = [], cr = [];
      let contentScore = 50;

      if (wordCount < 200) { ci.push(`❌ محتوى قليل جداً (${wordCount} كلمة) — المثالي 500+`); contentScore -= 20; }
      else if (wordCount < 500) { ci.push(`⚠️ محتوى متوسط (${wordCount} كلمة) — يُفضل 1000+`); contentScore -= 5; }
      else { ci.push(`✅ محتوى جيد (${wordCount} كلمة)`); contentScore += 15; }

      if (h2s.length === 0) { ci.push("❌ لا توجد H2 — المحتوى غير منظم"); contentScore -= 10; }
      else if (h2s.length < 3) { ci.push(`⚠️ عدد H2 قليل (${h2s.length}) — يُفضل 3+`); }
      else { ci.push(`✅ ${h2s.length} عنوان H2 لتنظيم المحتوى`); contentScore += 10; }

      if (imgCount === 0) { ci.push("❌ لا توجد صور"); contentScore -= 10; }
      else if (imgNoAlt > imgCount / 2) { ci.push(`⚠️ ${imgNoAlt} صورة بدون Alt Text`); contentScore -= 5; }
      else { ci.push(`✅ ${imgCount} صورة في الصفحة`); contentScore += 5; }

      if (hasVideo) { ci.push("✅ يوجد فيديو — يزيد وقت البقاء"); contentScore += 10; }
      else ci.push("⚠️ لا يوجد فيديو");

      if (internalLinks < 3) { ci.push(`⚠️ روابط داخلية قليلة (${internalLinks})`); contentScore -= 5; }
      else { ci.push(`✅ ${internalLinks} رابط داخلي`); contentScore += 5; }

      if (wordCount < 500) cr.push({ text: `زد المحتوى من ${wordCount} إلى 500+ كلمة`, priority: "عالي" });
      if (h2s.length < 3) cr.push({ text: "أضف عناوين H2 لتقسيم المحتوى", priority: "عالي" });
      if (imgNoAlt > 0) cr.push({ text: `أضف Alt Text لـ ${imgNoAlt} صورة`, priority: "عالي" });
      if (!hasVideo) cr.push({ text: "أضف فيديو توضيحي لزيادة وقت البقاء", priority: "متوسط" });
      if (internalLinks < 5) cr.push({ text: "أضف روابط داخلية لصفحات ذات صلة", priority: "متوسط" });
      cr.push({ text: "أضف قسم أسئلة شائعة (FAQ)", priority: "منخفض" });

      results.content = {
        score: Math.min(100, Math.max(10, contentScore)),
        isReal: true,
        summary: `${wordCount} كلمة | ${h2s.length} عنوان H2 | ${imgCount} صورة | ${internalLinks} رابط داخلي`,
        issues: ci, recommendations: cr
      };

      // ── Keywords (Real from HTML) ──
      const kwIssues = [], kwRecs = [];
      const allText = [title, ...h1s, ...h2s, ...h3s, description].filter(Boolean).join(" ");
      const words = allText.toLowerCase().replace(/[^\u0600-\u06FFa-zA-Z\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      const topWords = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,8).map(([w]) => w);

      if (topWords.length > 0) kwIssues.push(`✅ الكلمات الأبرز في الصفحة: ${topWords.slice(0,5).join("، ")}`);
      else kwIssues.push("❌ تعذّر استخراج كلمات مفتاحية — المحتوى قليل");

      if (title && h1s.length > 0) {
        const tw = title.toLowerCase().split(/\s+/);
        const hw = h1s[0].toLowerCase().split(/\s+/);
        const shared = tw.filter(w => hw.includes(w) && w.length > 3);
        if (shared.length > 0) kwIssues.push(`✅ تطابق كلمات بين Title وH1: ${shared.join("، ")}`);
        else kwIssues.push("⚠️ لا تطابق بين Title وH1 — وحّد الكلمة المفتاحية");
      }

      if (!description) kwIssues.push("❌ لا توجد Meta Description — فرصة ضائعة للكلمات المفتاحية");
      if (wordCount < 300) kwIssues.push("⚠️ المحتوى قليل — صعب استهداف كلمات متعددة");
      if (h2s.length === 0) kwIssues.push("⚠️ لا H2 — استخدمها لاستهداف كلمات إضافية");

      kwRecs.push({ text: "ضع الكلمة المفتاحية في: Title + H1 + أول 100 كلمة + Meta Description", priority: "عالي" });
      kwRecs.push({ text: "استخدم Google Keyword Planner لكلمات مفتاحية محلية", priority: "عالي" });
      kwRecs.push({ text: "استهدف Long-tail keywords في H2 و H3", priority: "متوسط" });
      kwRecs.push({ text: "أضف كلمات مفتاحية في Alt Text الصور", priority: "متوسط" });
      kwRecs.push({ text: "راجع Google Search Console لمعرفة ما تظهر به فعلاً", priority: "منخفض" });

      const kwScore = Math.min(85, Math.max(15,
        (topWords.length > 5 ? 30 : 15) +
        (title && h1s.length > 0 ? 20 : 0) +
        (description ? 20 : 0) +
        (h2s.length > 2 ? 15 : 0)
      ));

      results.keywords = {
        score: kwScore, isReal: true,
        summary: `${topWords.length} كلمة مفتاحية من الصفحة | أبرزها: ${topWords.slice(0,3).join("، ") || "—"}`,
        issues: kwIssues, recommendations: kwRecs
      };

      // ── Crawl (Real) ──
      const crawlIssues = [], crawlRecs = [];
      let crawlScore = 60;

      if (robotsMeta) {
        if (robotsMeta.includes("noindex")) { crawlIssues.push("🚨 noindex موجود — الصفحة لن تظهر في البحث!"); crawlScore -= 40; }
        else { crawlIssues.push(`✅ Robots meta: ${robotsMeta}`); crawlScore += 5; }
      } else crawlIssues.push("⚠️ لا يوجد Robots meta tag");

      if (canonical) { crawlIssues.push(`✅ Canonical URL موجود`); crawlScore += 10; }
      else { crawlIssues.push("⚠️ لا يوجد Canonical — خطر تكرار المحتوى"); crawlScore -= 10; }

      if (hasViewport) { crawlIssues.push("✅ Mobile-friendly"); crawlScore += 10; }
      else { crawlIssues.push("❌ لا يوجد Viewport — مشكلة للجوال"); crawlScore -= 15; }

      if (langAttr) { crawlIssues.push(`✅ Language: ${langAttr}`); crawlScore += 5; }
      else crawlIssues.push("⚠️ لا يوجد lang attribute في HTML");

      if (robotsMeta?.includes("noindex")) crawlRecs.push({ text: "احذف noindex فوراً من الصفحة الرئيسية", priority: "عالي" });
      if (!canonical) crawlRecs.push({ text: "أضف Canonical URL لكل صفحة", priority: "عالي" });
      crawlRecs.push({ text: "أرسل sitemap.xml لـ Google Search Console", priority: "عالي" });
      crawlRecs.push({ text: "افحص Coverage Report في Google Search Console", priority: "متوسط" });
      if (!langAttr) crawlRecs.push({ text: 'أضف lang="ar" لعلامة HTML الرئيسية', priority: "منخفض" });

      results.crawl = {
        score: Math.min(100, Math.max(10, crawlScore)), isReal: true,
        summary: `Canonical: ${canonical?"✅":"❌"} | Viewport: ${hasViewport?"✅":"❌"} | Lang: ${langAttr||"غير محدد"} | noindex: ${robotsMeta?.includes("noindex")?"🚨 نعم":"✅ لا"}`,
        issues: crawlIssues, recommendations: crawlRecs
      };

    } catch (e) {
      const errMsg = `تعذّر قراءة الموقع: ${e.message}`;
      results.content = { score: 0, isReal: false, summary: errMsg, issues: [errMsg], recommendations: [] };
      results.crawl = { score: 0, isReal: false, summary: errMsg, issues: [errMsg], recommendations: [] };
      results.keywords = { score: 0, isReal: false, summary: errMsg, issues: [errMsg], recommendations: [] };
    }

    // ── 3. Technical ─────────────────────────────────────────────────
    try {
      const base = new URL(url).origin;
      const [rb, sm] = await Promise.allSettled([fetch(`${base}/robots.txt`), fetch(`${base}/sitemap.xml`)]);
      const hasRobots = rb.status === "fulfilled" && rb.value.ok;
      const hasSitemap = sm.status === "fulfilled" && sm.value.ok;
      const isHttps = url.startsWith("https://");
      const ti = [], tr = [];
      if (!hasRobots) { ti.push("❌ robots.txt غير موجود"); tr.push({ text: "أنشئ robots.txt", priority: "عالي" }); } else ti.push("✅ robots.txt موجود");
      if (!hasSitemap) { ti.push("❌ sitemap.xml غير موجود"); tr.push({ text: "أنشئ sitemap.xml وأرسله لـ Google", priority: "عالي" }); } else ti.push("✅ sitemap.xml موجود");
      if (!isHttps) { ti.push("❌ لا يستخدم HTTPS"); tr.push({ text: "فعّل SSL/HTTPS فوراً", priority: "عالي" }); } else ti.push("✅ HTTPS مفعّل");
      if (!htmlData.hasViewport) tr.push({ text: "أضف viewport meta tag", priority: "عالي" });
      if (!tr.length) tr.push({ text: "الجانب التقني ممتاز ✅", priority: "منخفض" });
      results.technical = {
        score: 40 + [hasRobots, hasSitemap, isHttps].filter(Boolean).length * 20,
        isReal: true,
        summary: `HTTPS: ${isHttps?"✅":"❌"} | robots.txt: ${hasRobots?"✅":"❌"} | sitemap.xml: ${hasSitemap?"✅":"❌"}`,
        issues: ti, recommendations: tr
      };
    } catch (e) {
      results.technical = { score: 50, isReal: false, summary: "تعذّر الفحص التقني", issues: [], recommendations: [] };
    }

    return res.status(200).json({ success: true, results, htmlData });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
