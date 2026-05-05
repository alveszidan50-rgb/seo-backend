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
    if (apiKey) {
      try {
        const psRes = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=mobile`);
        const psData = await psRes.json();
        if (psData.lighthouseResult) {
          const audits = psData.lighthouseResult.audits;
          const score = Math.round((psData.lighthouseResult.categories?.performance?.score || 0) * 100);
          const issues = [];
          const recs = [];
          if (score < 50) issues.push("أداء الموقع ضعيف جداً على الجوال");
          else if (score < 80) issues.push("سرعة التحميل تحتاج تحسيناً");
          else issues.push("أداء الموقع جيد ✅");
          if (audits?.["uses-optimized-images"]?.score < 1) { issues.push("الصور غير محسّنة"); recs.push({ text: "ضغط الصور واستخدام WebP", priority: "عالي" }); }
          if (audits?.["render-blocking-resources"]?.score < 1) { issues.push("موارد تعيق التحميل"); recs.push({ text: "إزالة موارد تعيق العرض", priority: "عالي" }); }
          if (audits?.["uses-text-compression"]?.score < 1) recs.push({ text: "تفعيل Gzip أو Brotli", priority: "متوسط" });
          if (!recs.length) recs.push({ text: "السرعة في حالة جيدة 🎉", priority: "منخفض" });
          results.speed = { score, isReal: true, metrics: { lcp: audits?.["largest-contentful-paint"]?.displayValue || "—", cls: audits?.["cumulative-layout-shift"]?.displayValue || "—", fcp: audits?.["first-contentful-paint"]?.displayValue || "—", tbt: audits?.["total-blocking-time"]?.displayValue || "—" }, summary: `نتيجة الأداء الحقيقية: ${score}/100`, issues, recommendations: recs };
        }
      } catch(e) { results.speed = { score: 0, isReal: false, summary: "تعذّر PageSpeed API", issues: [e.message], recommendations: [] }; }
    }
    let htmlData = {};
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10000);
      const htmlRes = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" } });
      const html = await htmlRes.text();
      const getTag = (tag) => { const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").trim() : ""; };
      const getMeta = (name) => { const m = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i")) || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i")); return m ? m[1].trim() : ""; };
      const title = getTag("title");
      const description = getMeta("description");
      const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      const imgCount = (html.match(/<img/gi) || []).length;
      const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
      const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || "";
      const hasViewport = /name=["']viewport["']/i.test(html);
      const schemaTypes = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      htmlData = { title, description, h1s, h2s, imgCount, imgNoAlt, canonical, hasViewport, schemaTypes };
      const oi = [], or = [];
      if (!title) oi.push("لا يوجد Title"); else if (title.length < 30) oi.push(`Title قصير (${title.length} حرف)`); else if (title.length > 60) oi.push(`Title طويل (${title.length} حرف)`);
      if (!description) oi.push("لا توجد Meta Description"); else if (description.length < 100) oi.push(`Meta Description قصيرة (${description.length} حرف)`);
      if (h1s.length === 0) oi.push("لا يوجد H1"); else if (h1s.length > 1) oi.push(`يوجد ${h1s.length} عنوان H1 — يجب واحد فقط`);
      if (imgNoAlt > 0) oi.push(`${imgNoAlt} صورة بدون Alt Text`);
      if (!canonical) oi.push("لا يوجد Canonical URL");
      if (!title || title.length < 30) or.push({ text: "اكتب Title جذاب (50-60 حرف)", priority: "عالي" });
      if (!description) or.push({ text: "أضف Meta Description (150-160 حرف)", priority: "عالي" });
      if (imgNoAlt > 0) or.push({ text: `أضف Alt Text لـ ${imgNoAlt} صورة`, priority: "عالي" });
      if (!canonical) or.push({ text: "أضف Canonical URL", priority: "متوسط" });
      if (h2s.length === 0) or.push({ text: "أضف عناوين H2 لتنظيم المحتوى", priority: "متوسط" });
      results.structure = { score: Math.max(20, 100 - oi.length * 12), isReal: true, summary: `Title: "${title.substring(0,50) || "غير موجود"}" | H1: ${h1s.length} | صور بدون Alt: ${imgNoAlt}/${imgCount}`, issues: oi.length ? oi : ["بنية الصفحة جيدة ✅"], recommendations: or.length ? or : [{ text: "الصفحة في حالة جيدة", priority: "منخفض" }] };
      const si = [], sr = [];
      if (schemaTypes.length === 0) { si.push("لا يوجد Schema Markup"); sr.push({ text: "أضف LocalBusiness Schema", priority: "عالي" }); sr.push({ text: "أضف Product/Service Schema", priority: "عالي" }); sr.push({ text: "فعّل AggregateRating للنجوم", priority: "متوسط" }); }
      else { si.push(`Schema الموجود: ${schemaTypes.join(", ")}`); if (!schemaTypes.includes("AggregateRating")) sr.push({ text: "أضف AggregateRating للتقييمات", priority: "عالي" }); if (!schemaTypes.includes("BreadcrumbList")) sr.push({ text: "أضف BreadcrumbList", priority: "متوسط" }); }
      results.schema = { score: schemaTypes.length > 2 ? 75 : schemaTypes.length > 0 ? 50 : 20, isReal: true, summary: schemaTypes.length > 0 ? `وُجد ${schemaTypes.length} نوع Schema` : "لا يوجد Schema في الموقع", issues: si, recommendations: sr };
    } catch(e) { htmlData = { error: e.message }; }
    try {
      const base = new URL(url).origin;
      const [rb, sm] = await Promise.allSettled([fetch(`${base}/robots.txt`), fetch(`${base}/sitemap.xml`)]);
      const hasRobots = rb.status === "fulfilled" && rb.value.ok;
      const hasSitemap = sm.status === "fulfilled" && sm.value.ok;
      const isHttps = url.startsWith("https://");
      const ti = [], tr = [];
      if (!hasRobots) { ti.push("robots.txt غير موجود"); tr.push({ text: "أنشئ ملف robots.txt", priority: "عالي" }); } else ti.push("✅ robots.txt موجود");
      if (!hasSitemap) { ti.push("sitemap.xml غير موجود"); tr.push({ text: "أنشئ sitemap.xml وأرسله لـ Google", priority: "عالي" }); } else ti.push("✅ sitemap.xml موجود");
      if (!isHttps) { ti.push("الموقع لا يستخدم HTTPS"); tr.push({ text: "فعّل SSL/HTTPS", priority: "عالي" }); } else ti.push("✅ HTTPS مفعّل");
      if (!tr.length) tr.push({ text: "الجانب التقني جيد ✅", priority: "منخفض" });
      results.technical = { score: 40 + [hasRobots, hasSitemap, isHttps].filter(Boolean).length * 20, isReal: true, summary: `HTTPS: ${isHttps?"✅":"❌"} | robots.txt: ${hasRobots?"✅":"❌"} | sitemap.xml: ${hasSitemap?"✅":"❌"}`, issues: ti, recommendations: tr };
    } catch(e) { results.technical = { score: 50, isReal: false, summary: "تعذّر الفحص التقني", issues: [], recommendations: [] }; }
    return res.status(200).json({ success: true, results, htmlData });
  } catch(error) { return res.status(500).json({ error: error.message }); }
                                                           }
