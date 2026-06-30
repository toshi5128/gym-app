#!/usr/bin/env bash
# ATLAS デプロイ補助スクリプト
# 使い方:  bash deploy.sh "コミットメッセージ"
#   - sw.js の atlas-vN を自動で +1（キャッシュ更新）
#   - 全変更をコミットして GitHub(main) へ push → GitHub Pages に公開
set -e
cd "$(dirname "$0")"
msg="${1:-update}"

# 構文チェック（<script> を抜き出して node --check）
node -e "
const fs=require('fs');const s=fs.readFileSync('index.html','utf8');
const m=s.match(/<script>([\s\S]*?)<\/script>/);
if(!m){console.error('script tag not found');process.exit(1);}
fs.writeFileSync(process.env.TEMP+'/_atlaschk.js',m[1]);
"
node --check "$TEMP/_atlaschk.js"

# キャッシュ版を +1
cur=$(grep -o "atlas-v[0-9]*" sw.js | head -1 | grep -o "[0-9]*")
next=$((cur+1))
sed -i "s/atlas-v${cur}/atlas-v${next}/" sw.js

git add -A
git commit -q -m "${msg} (v${next})

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin main
echo "=== deployed atlas-v${next} ==="
