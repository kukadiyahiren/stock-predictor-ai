#!/bin/bash

# Configuration
SITEMAP_URL="https://kukadiyahiren.github.io/stock-predictor-ai/sitemap.xml"

echo "🚀 Starting SEO Force Indexing (Instant Trigger)..."

# 1. Google (Note: Google officially deprecated this ping service in late 2023, 
# but it still often triggers a crawl if the sitemap is new/changed. 
# The best way now is Google Search Console API or manual submission.)
echo "📡 Pinging Google..."
curl -s "https://www.google.com/ping?sitemap=${SITEMAP_URL}" > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Google ping sent."
else
    echo "❌ Google ping failed."
fi

# 2. Bing & Yahoo
echo "📡 Pinging Bing..."
curl -s "https://www.bing.com/ping?sitemap=${SITEMAP_URL}" > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Bing ping sent."
else
    echo "❌ Bing ping failed."
fi

# 3. IndexNow (Supported by Bing, Yandex, Seznam.cz, etc.)
# This requires a key. I'll provide the command but comment it out.
# echo "📡 Pinging IndexNow..."
# KEY="your_indexnow_key"
# curl -s "https://www.bing.com/indexnow?url=${SITEMAP_URL}&key=${KEY}" > /dev/null

echo "✨ All pings dispatched. Please ensure your site is live at: ${SITEMAP_URL%/*}"
echo "📝 Note: Real 'Instant' indexing works best when done through Google Search Console's 'URL Inspection' tool."
