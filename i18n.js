// Popup language: English / 日本語, picked from the header (stored in
// localStorage `philter_lang`, mirrored to chrome.storage.local `lang` for
// the in-page zapper). Loads before first paint like theme.js. Static text
// carries data-i18n (textContent), data-i18n-html (trusted markup from this
// file only), data-i18n-title and data-i18n-aria; scripts call T(key, vars).
// Picking a language reloads the popup, so every rendered string follows.

const LANGS = [
  { id: 'en', name: 'English', short: 'EN' },
  { id: 'ja', name: '日本語', short: 'JA' },
];

const STRINGS = {
  en: {
    'mascot.aria': 'Sip, the PhilterAds potion',
    'mascot.title': 'Boop!',
    'master.aria': 'PhilterAds on or off',
    'master.off': 'Turn PhilterAds off',
    'master.on': 'Turn PhilterAds on',
    'lang.aria': 'Language',
    'tabs.aria': 'PhilterAds sections',
    'tab.home': 'Home', 'tab.stats': 'Stats', 'tab.filters': 'Filters', 'tab.settings': 'Settings', 'tab.ai': 'AI MCP',
    'tab.settingsDot': 'Settings, update available',

    'hero.caption': 'ads dissolved on this page',
    'hero.corked': 'Corked', 'hero.corkedCap': 'PhilterAds is off everywhere.',
    'hero.paused': 'Paused', 'hero.pausedCap': 'Ads walk free on this site.',
    'hero.none': 'Nothing to dissolve on this page.',
    'chips.aria': 'What got blocked',
    'chips.empty': 'Clean page. Sip is bored.',
    'chip.ads': 'Ads', 'chip.trackers': 'Trackers', 'chip.malware': 'Malware', 'chip.cookies': 'Cookies',
    'chip.annoyances': 'Annoyances', 'chip.popups': 'Pop-ups', 'chip.zapped': 'Zapped',
    'chip.ads.t': 'Ad requests blocked', 'chip.cookies.t': 'Cookie-banner requests blocked',
    'chip.popups.t': 'Pop-up ad tabs closed from this page', 'chip.zapped.t': 'Ads you zapped on this site',

    'site.this': 'this site',
    'site.pause': 'Pause on this site',
    'site.pauseOn': 'Pause on {host}',
    'site.paused': 'Paused — flip to resume',
    'site.off': 'PhilterAds is off',
    'site.notWeb': 'Not a web page',
    'site.nothing': 'Nothing to pause here',

    'zap.label': 'Zap a missed ad',
    'zap.title': 'Pick an ad on this page and POOF, it is gone for good',
    'zap.titleOff': 'Turn PhilterAds on to zap',
    'zap.titlePaused': 'Unpause this site to zap',
    'zap.titleNone': 'Nothing to zap here',
    'zap.opening': 'Opening the zapper…',
    'zap.cant': "Can't zap on this page",
    'unzap.label': 'Undo {n}',
    'unzap.back': 'Back!',
    'unzap.title': (v) => `Bring back the ${v.count === 1 ? 'ad' : `${v.n} ads`} you zapped on ${v.site}`,

    'stats.period': 'Period',
    'stats.today': 'Today', 'stats.lifetime': 'Lifetime', 'stats.zapped': 'Zapped',
    'stats.capToday': 'dissolved today', 'stats.capTodayZero': 'dissolved today. Quiet so far.',
    'stats.capAll': 'dissolved all time', 'stats.capAllZero': 'dissolved all time. Fresh flask, go browse.',
    'stats.since': 'since {date}',
    'row.ads': 'Ads', 'row.trackers': 'Trackers', 'row.malware': 'Malware', 'row.popups': 'Pop-ups closed',
    'row.youtubeSkipped': 'YouTube ads skipped', 'row.zapped': 'Zapped by you',

    'zv.cap': (v) => `zapped on ${v.hosts} ${v.count === 1 ? 'site' : 'sites'}`,
    'zv.capZero': 'zapped by you',
    'zv.hint': 'Undo any one',
    'zv.clearAll': 'Clear all',
    'zv.here': 'this site',
    'zv.undoAll': 'Undo all',
    'zv.undoAllT': (v) => `Bring back all ${v.count === 1 ? 'the ad' : `${v.n} ads`} you zapped on ${v.site}`,
    'zv.undoOneT': 'Bring this one back on {site}',
    'zv.empty': 'Nothing zapped yet. Spot an ad the lists missed? Home &rarr; <b>Zap a missed ad</b>.',

    'list.ads': 'Ads', 'list.trackers': 'Trackers', 'list.malware': 'Malware',
    'list.cookies': 'Cookie banners', 'list.annoyances': 'Annoyances',
    'list.wholeSites': 'whole sites',
    'list.rules': '{n} rules',
    'list.active': '{n} rules active',
    'info.aria': 'About {list}',
    'info.ads': '<b>Recommended.</b> Removes ads across the web. Built to never break a page, so keep it on.',
    'info.trackers': '<b>Recommended.</b> Stops scripts that follow you from site to site. Very rarely, a login or checkout needs one: pause that site.',
    'info.malware': '<b>Recommended.</b> Blocks whole sites known to spread malware before they load. Keep it on.',
    'info.cookies': '<b>Optional.</b> Hides cookie pop-ups. A few sites lock scrolling until you answer, so a page can freeze. Off by default.',
    'info.annoyances': '<b>Strongest.</b> Hides comments, chat bubbles, share bars and newsletter pop-ups. It can hide things you want, so it starts off.',

    'set.updates': 'Updates', 'set.check': 'Check', 'set.updateNow': 'Update now',
    'news.title': 'New in 1.6:', 'news.body': 'Zapped list in Stats, languages, theme', 'news.ok': 'Got it',
    'set.updateNowN': 'Update now · {n} new', 'set.updateNowV': 'Update now · v{v}', 'set.reloading': 'Loading the new version…',
    'set.hint': 'Reload open tabs to use the new version everywhere.',
    'set.checking': 'Checking…', 'set.updating': 'Updating…',
    'set.upToDate': 'Up to date · {sha}',
    'set.updated': 'Updated to {sha} — reloading…',
    'set.setup': 'One-time setup: run `npm run install-updater` in the PhilterAds folder, then reload the extension. (id {id})',
    'set.dirty': 'The PhilterAds folder has uncommitted changes — commit them first.',
    'set.diverged': 'The folder and GitHub have diverged — merge by hand in a terminal.',
    'set.notMain': 'The PhilterAds folder is not on the main branch.',
    'set.offline': "Couldn't reach GitHub: {error}",
    'set.theme': 'Theme', 'set.auto': 'Auto', 'set.autoT': 'Match your browser', 'set.light': 'Light', 'set.dark': 'Dark',
    'links.aria': 'PhilterAds links',
    'link.web': 'Website', 'link.github': 'GitHub', 'link.code': 'Code', 'link.support': 'Support',
    'link.githubT': 'Code on GitHub', 'link.codeT': 'Want to contribute? Come brew code with us',
    'link.supportT': 'Buy Sip a refill: become a supporter',
    'about': 'We never let ads through for money. Nothing is collected.',

    'ai.title': 'AI control', 'ai.soon': 'Soon',
    'ai.sub': 'Connect your AI assistant over MCP, then just ask:',
    'ai.ask1': '“This site is broken. Fix it.”',
    'ai.ask2': '“What got blocked here?”',
    'ai.ask3': '“Turn on cookie-banner blocking.”',
    'ai.foot': 'For any MCP app, like Claude Desktop or Cursor. Runs on your computer; nothing leaves it.',

    'love.lead': 'Loving it?', 'love.share': 'Share the love', 'love.shareT': 'Copy a link to PhilterAds',
    'love.support': 'Support Sip ♥', 'love.copied': 'Link copied ✨',
    'love.shareText': 'PhilterAds: one sip, ads vanish. Free, private ad blocker. https://philterads.com',
    'rem.ready': 'Update ready', 'rem.now': 'Update now', 'rem.later': 'Later',
    'rem.done': 'Updated ✨ reloading…', 'rem.fail': "Couldn't update. See Settings.",
  },

  ja: {
    'mascot.aria': 'PhilterAdsのポーション、シップちゃん',
    'mascot.title': 'ツンッ！',
    'master.aria': 'PhilterAdsのオン・オフ',
    'master.off': 'PhilterAdsをオフにする',
    'master.on': 'PhilterAdsをオンにする',
    'lang.aria': '言語',
    'tabs.aria': 'PhilterAdsのメニュー',
    'tab.home': 'ホーム', 'tab.stats': '統計', 'tab.filters': 'フィルター', 'tab.settings': '設定', 'tab.ai': 'AI MCP',
    'tab.settingsDot': '設定（アップデートあり）',

    'hero.caption': 'このページで消した広告',
    'hero.corked': 'おやすみ中', 'hero.corkedCap': 'PhilterAdsはすべてのサイトでオフです。',
    'hero.paused': '一時停止中', 'hero.pausedCap': 'このサイトでは広告をブロックしていません。',
    'hero.none': 'このページには消すものがありません。',
    'chips.aria': 'ブロックした内容',
    'chips.empty': 'きれいなページ。シップちゃんは退屈そう。',
    'chip.ads': '広告', 'chip.trackers': 'トラッカー', 'chip.malware': 'マルウェア', 'chip.cookies': 'Cookie',
    'chip.annoyances': '迷惑要素', 'chip.popups': 'ポップアップ', 'chip.zapped': 'ザップ',
    'chip.ads.t': 'ブロックした広告リクエスト', 'chip.cookies.t': 'ブロックしたCookieバナーのリクエスト',
    'chip.popups.t': 'このページから開いて閉じたポップアップ広告タブ', 'chip.zapped.t': 'このサイトであなたがザップした広告',

    'site.this': 'このサイト',
    'site.pause': 'このサイトで一時停止',
    'site.pauseOn': '{host} で一時停止',
    'site.paused': '一時停止中。戻すにはオフに',
    'site.off': 'PhilterAdsはオフです',
    'site.notWeb': 'Webページではありません',
    'site.nothing': 'ここでは一時停止できません',

    'zap.label': '見逃した広告をザップ',
    'zap.title': 'このページの広告をクリックすると、ポン！と消えて二度と出ません',
    'zap.titleOff': 'ザップするにはPhilterAdsをオンに',
    'zap.titlePaused': 'ザップするには一時停止を解除',
    'zap.titleNone': 'ここにはザップするものがありません',
    'zap.opening': 'ザッパーを準備中…',
    'zap.cant': 'このページではザップできません',
    'unzap.label': '元に戻す {n}',
    'unzap.back': '戻りました！',
    'unzap.title': (v) => `${v.site} でザップした${v.n}件の広告を元に戻す`,

    'stats.period': '期間',
    'stats.today': '今日', 'stats.lifetime': 'これまで', 'stats.zapped': 'ザップ',
    'stats.capToday': '今日消した数', 'stats.capTodayZero': '今日消した数。まだ静かです。',
    'stats.capAll': 'これまでに消した数', 'stats.capAllZero': 'これまでに消した数。さあ、ブラウズしよう。',
    'stats.since': '{date}から',
    'row.ads': '広告', 'row.trackers': 'トラッカー', 'row.malware': 'マルウェア', 'row.popups': '閉じたポップアップ',
    'row.youtubeSkipped': 'スキップしたYouTube広告', 'row.zapped': 'あなたがザップ',

    'zv.cap': (v) => `${v.hosts}サイトでザップ`,
    'zv.capZero': 'あなたがザップした数',
    'zv.hint': '1件ずつ戻せます',
    'zv.clearAll': 'すべて消去',
    'zv.here': 'このサイト',
    'zv.undoAll': 'すべて戻す',
    'zv.undoAllT': (v) => `${v.site} でザップした${v.n}件をすべて元に戻す`,
    'zv.undoOneT': '{site} でこの1件を元に戻す',
    'zv.empty': 'まだザップしていません。リストがすり抜けた広告を見つけたら、ホーム &rarr; <b>「見逃した広告をザップ」</b>。',

    'list.ads': '広告', 'list.trackers': 'トラッカー', 'list.malware': 'マルウェア',
    'list.cookies': 'Cookieバナー', 'list.annoyances': '迷惑要素',
    'list.wholeSites': 'サイト全体',
    'list.rules': '{n}件のルール',
    'list.active': '{n}件のルールが有効',
    'info.aria': '{list}について',
    'info.ads': '<b>おすすめ。</b>ウェブ全体の広告を消します。ページを壊さないよう作られているので、オンのままで。',
    'info.trackers': '<b>おすすめ。</b>サイトをまたいであなたを追うスクリプトを止めます。まれにログインや決済で必要な場合は、そのサイトを一時停止してください。',
    'info.malware': '<b>おすすめ。</b>マルウェアを広めるサイトを、読み込む前にまるごとブロックします。オンのままで。',
    'info.cookies': '<b>お好みで。</b>Cookieの同意ポップアップを隠します。答えるまでスクロールできないサイトでは、ページが固まることがあるため初期設定はオフ。',
    'info.annoyances': '<b>いちばん強力。</b>コメント欄、チャット、共有ボタン、メルマガのポップアップを隠します。見たいものまで隠れることがあるため、初期設定はオフ。',

    'set.updates': 'アップデート', 'set.check': '確認', 'set.updateNow': '今すぐアップデート',
    'news.title': '1.6の新機能:', 'news.body': 'Statsにザップ一覧、言語、テーマ', 'news.ok': 'OK',
    'set.updateNowN': '今すぐアップデート · 新着{n}件', 'set.updateNowV': '今すぐアップデート · v{v}', 'set.reloading': '新しいバージョンを読み込み中…',
    'set.hint': '開いているタブを再読み込みすると、どこでも新しいバージョンになります。',
    'set.checking': '確認中…', 'set.updating': 'アップデート中…',
    'set.upToDate': '最新です · {sha}',
    'set.updated': '{sha} にアップデートしました。再読み込み中…',
    'set.setup': '初回のみ：PhilterAdsフォルダで `npm run install-updater` を実行し、拡張機能を再読み込みしてください。(id {id})',
    'set.dirty': 'PhilterAdsフォルダに未コミットの変更があります。先にコミットしてください。',
    'set.diverged': 'フォルダとGitHubの内容が分岐しています。ターミナルで手動マージしてください。',
    'set.notMain': 'PhilterAdsフォルダがmainブランチではありません。',
    'set.offline': 'GitHubに接続できませんでした：{error}',
    'set.theme': 'テーマ', 'set.auto': '自動', 'set.autoT': 'ブラウザに合わせる', 'set.light': 'ライト', 'set.dark': 'ダーク',
    'links.aria': 'PhilterAdsのリンク',
    'link.web': 'サイト', 'link.github': 'GitHub', 'link.code': 'コード', 'link.support': '応援',
    'link.githubT': 'GitHubのコード', 'link.codeT': '開発に参加しませんか？一緒にコードを煮込もう',
    'link.supportT': 'シップちゃんにおかわりを：サポーターになる',
    'about': 'お金で広告を通すことはしません。データは集めません。',

    'ai.title': 'AIコントロール', 'ai.soon': '近日公開',
    'ai.sub': 'AIアシスタントをMCPでつないで、話しかけるだけ：',
    'ai.ask1': '「このサイト壊れてる。直して。」',
    'ai.ask2': '「ここで何をブロックした？」',
    'ai.ask3': '「Cookieバナーのブロックをオンにして。」',
    'ai.foot': 'Claude DesktopやCursorなど、MCP対応アプリならどれでも。すべてあなたのPCで動き、外には出ません。',

    'love.lead': '気に入った？', 'love.share': '友だちに教える', 'love.shareT': 'PhilterAdsのリンクをコピー',
    'love.support': 'シップちゃんを応援 ♥', 'love.copied': 'コピーしました ✨',
    'love.shareText': 'PhilterAds：ひと口で広告が消える。無料・プライバシー重視の広告ブロッカー。https://philterads.com',
    'rem.ready': 'アップデートあり', 'rem.now': '今すぐ', 'rem.later': 'あとで',
    'rem.done': 'アップデート完了 ✨ 再読み込み中…', 'rem.fail': 'アップデートできませんでした。設定を見てね。',
  },
};

const LANG = (() => {
  let pick = null;
  try { pick = localStorage.getItem('philter_lang'); } catch {}
  if (!STRINGS[pick]) {
    const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || 'en').toLowerCase();
    pick = ui.startsWith('ja') ? 'ja' : 'en';
  }
  return pick;
})();
document.documentElement.lang = LANG;

// T('key') or T('key', { n: '3', site: 'x.com' }); a missing JA key falls back to English
function T(key, vars = {}) {
  const v = STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
  if (typeof v === 'function') return v(vars);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = T(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = T(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = T(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', T(el.dataset.i18nAria));
}

function setLang(id) {
  if (!STRINGS[id] || id === LANG) return;
  try { localStorage.setItem('philter_lang', id); } catch {}
  chrome.storage.local.set({ lang: id }).finally(() => location.reload());
}
