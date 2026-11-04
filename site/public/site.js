/* Smart Route site: OS detection, download list from the latest GitHub release, copy buttons, the route sequence.
   Nothing is stored, no cookie, no third-party script. The only requests are to GitHub: the public API
   (releases/latest of Yolea-Hub/smart-route, no token) and, when the browser allows it, the SHA256SUMS file of that release.
   Without this file the page is complete: the download area says "Bientôt disponible / Coming soon" and the constellation is static.

   Files are recognised by the names electron-builder writes (artifactName "Smart-Route-<version>-<os>-<arch>.<ext>"):
   Smart-Route-0.1.0-linux-x86_64.AppImage, -linux-amd64.deb, -win-x64.exe, -mac-arm64.dmg, -mac-x64.dmg.
   Only links under https://github.com/Yolea-Hub/smart-route/releases/download/ are accepted. */
(function () {
  'use strict';
  var API_LATEST = 'https://api.github.com/repos/Yolea-Hub/smart-route/releases/latest';
  var RELEASES_PAGE = 'https://github.com/Yolea-Hub/smart-route/releases';
  var DL_PREFIX = 'https://github.com/Yolea-Hub/smart-route/releases/download/';
  var SUMS_NAME = 'SHA256SUMS';
  var doc = document;
  var lang = (doc.documentElement.lang || 'fr').slice(0, 2) === 'en' ? 'en' : 'fr';
  var TEXT = {
    fr: {
      os: { linux: 'Linux', windows: 'Windows', mac: 'macOS' },
      hero: 'Télécharger pour ',
      primary: 'Télécharger pour ',
      version: 'Version ',
      ready: 'Choisissez votre système ci-dessous.',
      soon: 'Bientôt disponible. Les fichiers ne sont pas encore publiés.',
      unknownOs: 'Smart Route est un programme pour ordinateur. Choisissez un système ci-dessous.',
      detected: 'Votre système',
      download: 'Télécharger',
      sha: 'SHA-256 : ',
      sums: 'Somme de contrôle SHA-256 (fichier SHA256SUMS)',
      releases: 'Voir les versions sur GitHub',
      soonLimit: 'Bientôt disponible. GitHub limite les requêtes pour le moment.',
      mb: ' Mo',
      kind: { AppImage: 'AppImage, toutes distributions', deb: 'Paquet .deb, Debian et Ubuntu', exe: 'Installeur .exe, Windows 64 bits' },
      dmg: { arm64: 'Image disque .dmg, Apple Silicon', x64: 'Image disque .dmg, Intel' },
      macChoose: 'Télécharger pour macOS',
      copied: 'Copié'
    },
    en: {
      os: { linux: 'Linux', windows: 'Windows', mac: 'macOS' },
      hero: 'Download for ',
      primary: 'Download for ',
      version: 'Version ',
      ready: 'Choose your system below.',
      soon: 'Coming soon. The files are not published yet.',
      unknownOs: 'Smart Route is a desktop program. Choose a system below.',
      detected: 'Your system',
      download: 'Download',
      sha: 'SHA-256: ',
      sums: 'SHA-256 checksums (SHA256SUMS file)',
      releases: 'See the releases on GitHub',
      soonLimit: 'Coming soon. GitHub is limiting requests right now.',
      mb: ' MB',
      kind: { AppImage: 'AppImage, any distribution', deb: '.deb package, Debian and Ubuntu', exe: '.exe installer, 64-bit Windows' },
      dmg: { arm64: 'Disk image .dmg, Apple Silicon', x64: 'Disk image .dmg, Intel' },
      macChoose: 'Download for macOS',
      copied: 'Copied'
    }
  }[lang];
  var OS_KINDS = { linux: ['AppImage', 'deb'], windows: ['exe'], mac: ['dmg'] };

  function detectOs() {
    var nav = window.navigator || {};
    var s = (((nav.userAgentData && nav.userAgentData.platform) || '') + ' ' + (nav.platform || '') + ' ' + (nav.userAgent || '')).toLowerCase();
    if (/android|iphone|ipad|ipod/.test(s)) return 'other';
    if (/windows|win32|win64/.test(s)) return 'windows';
    if (/macintosh|macintel|mac os|macos/.test(s)) return 'mac';
    if (/linux|x11|cros/.test(s)) return 'linux';
    return 'other';
  }

  var NAME_RE = /^Smart-Route-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)-(linux|win|mac)-(x86_64|amd64|x64|arm64)\.(AppImage|deb|exe|dmg)$/;
  var OS_OF = { linux: 'linux', win: 'windows', mac: 'mac' };

  function safeUrl(u) {
    if (typeof u !== 'string' || u.indexOf(DL_PREFIX) !== 0) return false;
    var p;
    try { p = new URL(u); } catch (e) { return false; }
    return p.protocol === 'https:' && p.hostname === 'github.com' && !p.username && !p.password && !p.search && !p.hash;
  }

  function assetFile(a) {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string') return null;
    var m = NAME_RE.exec(a.name);
    if (!m) return null;
    var os = OS_OF[m[2]];
    var kind = m[4];
    if (OS_KINDS[os].indexOf(kind) < 0) return null;
    var arch = m[3] === 'arm64' ? 'arm64' : 'x64';
    if (typeof a.size !== 'number' || !isFinite(a.size) || a.size <= 0 || a.size > 4e9) return null;
    if (!safeUrl(a.browser_download_url)) return null;
    return { os: os, arch: arch, kind: kind, name: a.name, url: a.browser_download_url, size: a.size, version: m[1], sha256: '' };
  }

  // Release JSON from the GitHub API -> { version, date, files, sums }, or null when it has no usable installer.
  function validData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.assets)) return null;
    if (d.draft === true || d.prerelease === true) return null;
    var files = [];
    var sums = '';
    d.assets.forEach(function (a) {
      var f = assetFile(a);
      if (f) files.push(f);
      else if (a && a.name === SUMS_NAME && safeUrl(a.browser_download_url)) sums = a.browser_download_url;
    });
    if (!files.length) return null;
    var version = files[0].version;
    files = files.filter(function (f) { return f.version === version; });
    var date = typeof d.published_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.published_at) ? d.published_at.slice(0, 10) : '';
    return { version: version, date: date, files: files, sums: sums };
  }

  // "<64 hex>  <name>" lines (sha256sum output) -> { name: hex }
  function parseSums(text) {
    var out = {};
    String(text).split(/\r?\n/).forEach(function (line) {
      var m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
      if (m) out[m[2]] = m[1].toLowerCase();
    });
    return out;
  }

  function size(bytes) {
    var mb = bytes / 1048576;
    var txt;
    try { txt = new Intl.NumberFormat(lang, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb); } catch (e) { txt = String(Math.round(mb)); }
    return txt + TEXT.mb;
  }

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function labelOf(f) {
    return f.kind === 'dmg' ? TEXT.dmg[f.arch] : TEXT.kind[f.kind];
  }

  function copyButton(targetId) {
    var b = el('button', 'sr-copy', lang === 'en' ? 'Copy' : 'Copier');
    b.type = 'button';
    b.setAttribute('data-copy-target', targetId);
    b.setAttribute('aria-describedby', targetId); // « Copy » / « Copier » repeats: what it copies describes it
    return b;
  }

  var shaCount = 0;
  var fileCount = 0;
  function fileItem(f, sums) {
    var li = el('li', 'sr-file');
    var nameNode = el('span', 'sr-file-name', labelOf(f));
    nameNode.id = 'sr-file-' + (fileCount += 1);
    li.appendChild(nameNode);
    li.appendChild(el('span', 'sr-file-meta', f.name + ', ' + size(f.size)));
    var a = el('a', 'sg-button', TEXT.download);
    a.setAttribute('aria-describedby', nameNode.id); // the same word on every file: the file it belongs to describes it
    a.href = f.url;
    a.setAttribute('download', f.name);
    a.rel = 'noopener';
    li.appendChild(a);
    var row = el('div', 'sr-sha');
    row.setAttribute('data-sha-row', f.name);
    if (sums) {
      var link = el('a', '', TEXT.sums);
      link.href = sums;
      link.rel = 'noopener';
      row.appendChild(link);
    }
    li.appendChild(row);
    return li;
  }

  function fillSums(data) {
    if (!data.sums || !window.fetch) return;
    fetch(data.sums, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.text(); })
      .then(function (text) {
        var map = parseSums(text);
        data.files.forEach(function (f) {
          var hex = map[f.name];
          if (!hex) return;
          var rows = doc.querySelectorAll('[data-sha-row]');
          for (var i = 0; i < rows.length; i += 1) {
            if (rows[i].getAttribute('data-sha-row') !== f.name) continue;
            while (rows[i].firstChild) rows[i].removeChild(rows[i].firstChild);
            var id = 'sr-sha-' + (shaCount += 1);
            rows[i].appendChild(el('span', 'sr-sha-label', TEXT.sha));
            var code = el('code', '', hex);
            code.id = id;
            rows[i].appendChild(code);
            rows[i].appendChild(copyButton(id));
          }
        });
      })
      .catch(function () { /* CORS or network: the link to SHA256SUMS stays */ });
  }

  function renderDownloads(data, os) {
    var root = doc.querySelector('[data-dl]');
    if (!root) return;
    var status = root.querySelector('[data-dl-status]');
    ['linux', 'windows', 'mac'].forEach(function (name) {
      var card = root.querySelector('[data-os="' + name + '"]');
      if (!card) return;
      var list = card.querySelector('[data-files]');
      var soon = card.querySelector('[data-soon]');
      var mine = data.files.filter(function (f) { return f.os === name; });
      if (mine.length) {
        mine.forEach(function (f) { list.appendChild(fileItem(f, data.sums)); });
        if (soon) soon.hidden = true;
      }
      if (name === os) {
        card.setAttribute('data-detected', '');
        var tag = card.querySelector('[data-tag]');
        if (tag) { tag.textContent = TEXT.detected; tag.hidden = false; }
      }
    });
    var meta = TEXT.version + data.version;
    if (data.date) {
      try {
        meta += ', ' + new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(data.date + 'T00:00:00Z'));
      } catch (e) { /* the version alone is enough */ }
    }
    var metaNode = root.querySelector('[data-dl-meta]');
    if (metaNode) metaNode.textContent = meta;
    var primary = root.querySelector('[data-dl-primary]');
    var heroBtn = doc.querySelector('[data-dl-hero]');
    var pick = null;
    if (os === 'linux') pick = data.files.filter(function (f) { return f.os === 'linux' && f.kind === 'AppImage'; })[0];
    if (os === 'windows') pick = data.files.filter(function (f) { return f.os === 'windows'; })[0];
    if (primary && pick) {
      primary.href = pick.url;
      primary.setAttribute('download', pick.name);
      primary.textContent = TEXT.primary + TEXT.os[os] + ' (' + size(pick.size) + ')';
      root.setAttribute('data-ready', '');
    } else if (primary && os === 'mac' && data.files.some(function (f) { return f.os === 'mac'; })) {
      primary.href = '#download-mac';
      primary.removeAttribute('download');
      primary.textContent = TEXT.macChoose;
      root.setAttribute('data-ready', '');
    }
    if (heroBtn && TEXT.os[os]) heroBtn.textContent = TEXT.hero + TEXT.os[os];
    if (status) status.textContent = os === 'other' ? TEXT.unknownOs : TEXT.ready;
    fillSums(data);
  }

  function showSoon(root, limited) {
    var status = root.querySelector('[data-dl-status]');
    if (!status) return;
    status.textContent = limited ? TEXT.soonLimit : TEXT.soon;
    if (limited) {
      status.appendChild(doc.createTextNode(' '));
      var a = el('a', '', TEXT.releases);
      a.href = RELEASES_PAGE;
      a.rel = 'noopener';
      status.appendChild(a);
    }
  }

  function loadDownloads() {
    var os = detectOs();
    var root = doc.querySelector('[data-dl]');
    if (!root || !window.fetch) return;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(API_LATEST, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (r.status === 403 || r.status === 429) { var e = new Error('limit'); e.limited = true; throw e; }
        if (!r.ok) throw new Error('http'); // 404: no release yet
        return r.json();
      })
      .then(function (d) {
        clearTimeout(timer);
        var data = validData(d);
        if (!data) throw new Error('shape');
        renderDownloads(data, os);
      })
      .catch(function (e) {
        clearTimeout(timer);
        showSoon(root, !!(e && e.limited));
      });
  }

  function copyText(text) {
    if (window.navigator.clipboard && window.isSecureContext) return window.navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var t = doc.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.className = 'sg-visually-hidden';
      doc.body.appendChild(t);
      t.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(t);
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  function onCopyClick(event) {
    var b = event.target.closest ? event.target.closest('[data-copy-target]') : null;
    if (!b) return;
    var target = doc.getElementById(b.getAttribute('data-copy-target'));
    if (!target) return;
    var live = doc.querySelector('[data-sr-live]');
    var label = b.textContent;
    copyText(target.textContent.trim()).then(function () {
      b.textContent = TEXT.copied;
      if (live) live.textContent = TEXT.copied;
      setTimeout(function () { b.textContent = label; if (live) live.textContent = ''; }, 2000);
    }, function () { /* the text stays selectable by hand */ });
  }

  // The small-screen menu: Escape closes it and gives the focus back to its button; following a link of it closes it (WCAG 2.1.1, 3.2.2).
  function setupMenu() {
    var menu = doc.querySelector('details.sr-menu');
    if (!menu) return;
    menu.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && menu.open) {
        e.stopPropagation();
        menu.open = false;
        var summary = menu.querySelector('summary');
        if (summary) summary.focus();
      }
    });
    menu.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && menu.contains(a)) menu.open = false;
    });
  }

  function setupConstellation() {
    var rc = doc.querySelector('.rc');
    if (!rc) return;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq && mq.matches) return;
    var replay = doc.querySelector('[data-replay]');
    function run() {
      rc.removeAttribute('data-run');
      void rc.offsetWidth;
      rc.setAttribute('data-run', '');
    }
    rc.setAttribute('data-armed', '');
    if (replay) {
      replay.hidden = false;
      replay.addEventListener('click', run);
    }
    if (!('IntersectionObserver' in window)) { run(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); }
    }, { threshold: 0.45 });
    io.observe(rc);
  }

  if (window.__SR_TEST__) window.__SR_TEST__.hooks = { validData: validData, parseSums: parseSums, safeUrl: safeUrl };
  doc.addEventListener('click', onCopyClick);
  loadDownloads();
  setupMenu();
  setupConstellation();
})();
