(function () {
  window.mpToggleCoreVersion = '2.11.0-beta';

  // Auto-loads mp-toggle-geo.js if a geo config is present and it isn't
  // already loaded. Assumes geo.js is hosted alongside this file; override
  // with window.mpToggleGeoScriptPath if not.
  if (window.mpToggleGeoWorkerUrl && !window.mpToggleGeo) {
    var geoScriptTag = document.createElement('script');
    geoScriptTag.src = window.mpToggleGeoScriptPath || 'mp-toggle-geo.js';
    (document.head || document.documentElement).appendChild(geoScriptTag);
  }

  // First comma-separated value only — the canonical destination for a key.
  function primaryDomain(siteValue) {
    return (siteValue || '').split(',')[0].trim();
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Host pattern matcher supporting a "{env}" placeholder (e.g.
  // 'es{env}.humana.com'). test(hostname) returns the captured env string,
  // or null if no match.
  function buildHostMatcher(hostPattern) {
    var idx = hostPattern.indexOf('{env}');
    if (idx === -1) {
      return { test: function (hostname) { return hostname === hostPattern ? '' : null; } };
    }
    var before = hostPattern.slice(0, idx);
    var after = hostPattern.slice(idx + 5);
    var regex = new RegExp('^' + escapeRegex(before) + '(.*?)' + escapeRegex(after) + '$');
    return {
      test: function (hostname) {
        var m = hostname.match(regex);
        return m ? m[1] : null;
      },
    };
  }

  function resolveEnvInAlias(alias, env) {
    if (alias.indexOf('{env}') === -1) return alias;
    return alias.split('{env}').join(env || '');
  }

  function splitHostAndPath(alias) {
    var withoutProtocol = alias.replace(/^https?:\/\//, '');
    var slashIdx = withoutProtocol.indexOf('/');
    return {
      host: slashIdx === -1 ? withoutProtocol : withoutProtocol.slice(0, slashIdx),
      path: slashIdx === -1 ? '' : withoutProtocol.slice(slashIdx),
    };
  }

  // data-href wins if present; otherwise resolves data-lang against
  // window.mpToggleSites, substituting the current environment for "{env}".
  function resolveBase(el) {
    var href = el.getAttribute('data-href');
    if (href) return href;

    var lang = el.getAttribute('data-lang');
    if (lang && window.mpToggleSites && window.mpToggleSites[lang]) {
      var pattern = primaryDomain(window.mpToggleSites[lang]);
      if (pattern.indexOf('{env}') !== -1) {
        var current = matchCurrentSite();
        pattern = resolveEnvInAlias(pattern, current ? current.env : '');
      }
      return /^https?:\/\//.test(pattern) ? pattern : 'https://' + pattern;
    }

    return null;
  }

  // Which mpToggleSites entry matches a given host+path? Checks all
  // comma-separated aliases of all keys; host match + longest path prefix
  // wins. Returns the key's primary alias, resolved to the current env.
  function matchSiteForUrl(hostname, pathname) {
    var sites = window.mpToggleSites;
    if (!sites) return null;

    var currentPath = pathname || '/';
    var bestKey = null;
    var bestPrefix = '';
    var bestMatchLen = -1;
    var bestEnv = '';

    for (var key in sites) {
      var aliases = (sites[key] || '').split(',');
      for (var i = 0; i < aliases.length; i++) {
        var alias = aliases[i].trim();
        if (!alias) continue;
        var parts = splitHostAndPath(alias);
        var env = buildHostMatcher(parts.host).test(hostname);
        if (env === null) continue;
        if (parts.path && currentPath.indexOf(parts.path) !== 0) continue;
        if (parts.path.length > bestMatchLen) { bestKey = key; bestPrefix = parts.path; bestMatchLen = parts.path.length; bestEnv = env; }
      }
    }

    if (bestKey === null) return null;
    return { key: bestKey, base: resolveEnvInAlias(primaryDomain(sites[bestKey]), bestEnv), prefix: bestPrefix, env: bestEnv };
  }

  function matchCurrentSite() {
    return matchSiteForUrl(window.location.hostname, window.location.pathname || '/');
  }

  function deriveCurrentPrefix() {
    var match = matchCurrentSite();
    return (match && match.prefix) ? match.prefix : '';
  }

  // Appends current pathname+search onto baseHref, stripping the current
  // directory-forwarded prefix first. data-mp-current-prefix on <html>
  // overrides the auto-derived value.
  function buildDestination(baseHref, preservePath) {
    if (preservePath === false) return baseHref;

    var base = baseHref.replace(/\/+$/, '');
    var path = window.location.pathname || '/';
    var currentPrefix = document.documentElement.getAttribute('data-mp-current-prefix') || deriveCurrentPrefix();

    if (currentPrefix) {
      var prefix = currentPrefix.replace(/\/+$/, '');
      if (prefix && path.indexOf(prefix) === 0) {
        path = path.slice(prefix.length) || '/';
      }
    }

    var search = window.location.search || '';
    return base + path + search;
  }

  // Preference persistence: first-party cookie, 365-day max-age.
  // Cross-subdomain sharing needs window.mpToggleCookieDomain set.
  var PREF_COOKIE = 'mpLangPref';
  var PREF_MAX_AGE_DAYS = 365;

  function savePref(baseHref) {
    var maxAge = '; Max-Age=' + (PREF_MAX_AGE_DAYS * 24 * 60 * 60);
    var valueAndAttrs = PREF_COOKIE + '=' + encodeURIComponent(baseHref) + '; Path=/' + maxAge + '; SameSite=Lax';
    if (window.mpToggleCookieDomain) {
      document.cookie = valueAndAttrs + '; Domain=' + window.mpToggleCookieDomain;
      document.cookie = PREF_COOKIE + '=; Path=/; Max-Age=0';
    } else {
      document.cookie = valueAndAttrs;
    }
  }

  function getPref() {
    var match = document.cookie.match(new RegExp('(?:^|; )' + PREF_COOKIE + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function clearPref() {
    document.cookie = PREF_COOKIE + '=; Path=/; Max-Age=0';
    if (window.mpToggleCookieDomain) {
      document.cookie = PREF_COOKIE + '=; Path=/; Domain=' + window.mpToggleCookieDomain + '; Max-Age=0';
    }
  }

  // Fires mp:beforeswitch (cancelable) before navigating.
  function switchTo(href) {
    var event = new CustomEvent('mp:beforeswitch', {
      detail: { href: href },
      cancelable: true,
    });
    var proceed = document.dispatchEvent(event);
    if (proceed) window.location.href = href;
  }

  // Tracks whether this visitor has been here before at all, independent
  // of language toggling. Suppresses the modal's "Welcome" title on repeat.
  var VISITED_COOKIE = 'mpHasVisited';
  var VISITED_MAX_AGE_DAYS = 365;

  function hasVisitedBefore() {
    return document.cookie.indexOf(VISITED_COOKIE + '=1') !== -1;
  }

  function markVisited() {
    var domain = window.mpToggleCookieDomain ? '; Domain=' + window.mpToggleCookieDomain : '';
    var maxAge = '; Max-Age=' + (VISITED_MAX_AGE_DAYS * 24 * 60 * 60);
    document.cookie = VISITED_COOKIE + '=1; Path=/' + domain + maxAge + '; SameSite=Lax';
  }

  // Hides "Welcome" title for returning visitors; fills in per-language
  // modal text from window.mpToggleModalText if defined. Runs on every
  // modal open.
  function applyModalWelcomeState(modalEl) {
    if (!modalEl) return;

    var current = matchCurrentSite();
    var text = (current && window.mpToggleModalText) ? window.mpToggleModalText[current.key] : null;

    var titles = modalEl.querySelectorAll('.mp-modal-title');
    var subtitles = modalEl.querySelectorAll('.mp-modal-subtitle');

    var returning = hasVisitedBefore();
    for (var i = 0; i < titles.length; i++) {
      if (text && text.title) titles[i].textContent = text.title;
      titles[i].style.display = returning ? 'none' : '';
    }
    for (var j = 0; j < subtitles.length; j++) {
      if (text && text.subtitle) subtitles[j].textContent = text.subtitle;
    }

    markVisited();
  }

  // Event delegation for .mp-lang-toggle/.mp-lang-select/modal triggers —
  // one listener on document, so markup added after init() still works.
  var delegatedHandlersBound = false;

  function ensureDelegatedHandlers() {
    if (delegatedHandlersBound) return;
    delegatedHandlersBound = true;

    document.addEventListener('click', function (e) {
      var toggle = e.target.closest && e.target.closest('.mp-lang-toggle');
      if (toggle) {
        e.preventDefault();
        var base = resolveBase(toggle);
        if (!base) {
          if (window.console) console.warn('mp-toggle-core: could not resolve destination for', toggle);
          return;
        }
        var preservePath = toggle.getAttribute('data-preserve-path') !== 'false';
        if (toggle.getAttribute('data-save-pref') !== 'false') savePref(base);
        switchTo(buildDestination(base, preservePath));
        return;
      }

      var opener = e.target.closest && e.target.closest('[data-mp-modal-open]');
      if (opener) {
        e.preventDefault();
        var modalTarget = document.querySelector(opener.getAttribute('data-mp-modal-open'));
        if (modalTarget) {
          applyModalWelcomeState(modalTarget);
          modalTarget.style.display = 'flex';
        }
        return;
      }

      var closer = e.target.closest && e.target.closest('[data-mp-modal-close]');
      if (closer) {
        e.preventDefault();
        var modal = closer.closest('[data-mp-modal]');
        if (modal) modal.style.display = 'none';
      }
    });

    document.addEventListener('change', function (e) {
      if (!e.target || !e.target.matches || !e.target.matches('.mp-lang-select')) return;
      var select = e.target;
      var opt = select.options[select.selectedIndex];
      if (!opt) return;
      var base = resolveBase(opt);
      if (!base) {
        if (window.console) console.warn('mp-toggle-core: could not resolve destination for', opt);
        return;
      }
      var preservePath = opt.getAttribute('data-preserve-path') !== 'false';
      if (opt.getAttribute('data-save-pref') !== 'false') savePref(base);
      switchTo(buildDestination(base, preservePath));
    });
  }

  var toggleStylesInjected = false;

  function injectToggleStyles() {
    if (toggleStylesInjected || !document.head) return;
    toggleStylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-mp-toggle-styles', '');
    style.textContent = '.mp-lang-toggle{cursor:pointer;}';
    document.head.appendChild(style);
  }

  // Placeholder auto-render: if a client adds one of these container IDs
  // to the page, this injects the matching markup automatically — no
  // manual body snippet needed. window.mpToggleAnchorHTML/DropdownHTML/
  // ModalHTML are generated by the builder tool. #mp-toggle-modal acts as
  // the modal's trigger element (any tag); the modal overlay itself is
  // appended to document.body. Guarded against duplicate injection if
  // init() runs more than once.
  function autoRenderPlaceholders() {
    var anchorEl = document.getElementById('mp-toggle-anchor');
    if (anchorEl && window.mpToggleAnchorHTML && !anchorEl.querySelector('.mp-lang-toggle')) {
      anchorEl.insertAdjacentHTML('beforeend', window.mpToggleAnchorHTML);
    }

    var dropdownEl = document.getElementById('mp-toggle-dropdown');
    if (dropdownEl && window.mpToggleDropdownHTML && !dropdownEl.querySelector('.mp-lang-select')) {
      dropdownEl.insertAdjacentHTML('beforeend', window.mpToggleDropdownHTML);
    }

    var modalTriggerEl = document.getElementById('mp-toggle-modal');
    if (modalTriggerEl && window.mpToggleModalHTML) {
      if (!modalTriggerEl.hasAttribute('data-mp-modal-open')) {
        modalTriggerEl.setAttribute('data-mp-modal-open', '#mp-lang-modal');
      }
      if (!document.getElementById('mp-lang-modal')) {
        document.body.insertAdjacentHTML('beforeend', window.mpToggleModalHTML);
      }
    }
  }

  function bindToggles(root) {
    injectToggleStyles();
    ensureDelegatedHandlers();

    var toggles = (root || document).querySelectorAll('.mp-lang-toggle');
    for (var i = 0; i < toggles.length; i++) {
      var el = toggles[i];
      if (el.tagName === 'A' && !el.getAttribute('href')) el.setAttribute('href', '#');
    }
  }

  function markCurrentLanguage(root) {
    var match = matchCurrentSite();
    if (!match) return;
    var currentLang = match.key;

    var toggles = (root || document).querySelectorAll('.mp-lang-toggle');
    for (var i = 0; i < toggles.length; i++) {
      if (toggles[i].getAttribute('data-lang') === currentLang) {
        toggles[i].classList.add('mp-lang-current');
      }
    }

    var selects = (root || document).querySelectorAll('.mp-lang-select');
    for (var j = 0; j < selects.length; j++) {
      selects[j].value = currentLang;
    }
  }

  function bindModals() {
    ensureDelegatedHandlers();
  }

  function parseUrlParts(url) {
    var withoutProtocol = (url || '').replace(/^https?:\/\//, '');
    var slashIdx = withoutProtocol.indexOf('/');
    return {
      hostname: slashIdx === -1 ? withoutProtocol : withoutProtocol.slice(0, slashIdx),
      pathname: slashIdx === -1 ? '/' : withoutProtocol.slice(slashIdx),
    };
  }

  // Opt-in via window.mpToggleRevisitRedirect. If the stored preference
  // points elsewhere, shows a countdown modal offering to redirect.
  function checkReturnVisitorRedirect(options) {
    options = options || {};
    var countdownSeconds = options.countdownSeconds || 10;

    var stored = getPref();
    if (!stored) return;

    var current = matchCurrentSite();
    if (!current) return;

    var storedParts = parseUrlParts(stored);
    var storedMatch = matchSiteForUrl(storedParts.hostname, storedParts.pathname);
    if (!storedMatch) return;

    if (storedMatch.key === current.key) return;

    var destinationPattern = primaryDomain(window.mpToggleSites[storedMatch.key]);
    var destinationBaseRaw = resolveEnvInAlias(destinationPattern, current.env);
    var destinationBase = /^https?:\/\//.test(destinationBaseRaw) ? destinationBaseRaw : 'https://' + destinationBaseRaw;
    var destination = buildDestination(destinationBase, options.preservePath !== false);

    var event = new CustomEvent('mp:revisitprompt', {
      detail: {
        destination: destination,
        currentKey: current.key,
        targetKey: storedMatch.key,
        countdownSeconds: countdownSeconds,
      },
      cancelable: true,
    });

    var proceed = document.dispatchEvent(event);
    if (!proceed) return;

    showReturnVisitorModal(destination, current, storedMatch.key, countdownSeconds, options);
  }

  // Countdown-modal UI, shared by return-visitor redirect and the
  // geo-prompt feature (mp-toggle-geo.js). Styling lives in mp-modal.css
  // via .mp-revisit-* classes — this function builds structure only.
  function showReturnVisitorModal(destination, current, targetKey, countdownSeconds, options) {
    var labels = options.labels || {};
    var targetLabel = (targetKey && labels[targetKey]) || (targetKey ? targetKey.toUpperCase() : 'your preferred site');

    var buildMessage = options.message || function (label, seconds) {
      return 'You previously viewed this site in ' + label + '. Redirecting in ' + seconds + 's.';
    };
    var onStay = options.onStay || function () { savePref(current.base); };
    var onConfirm = options.onConfirm || function () {};

    var overlay = document.createElement('div');
    overlay.className = 'mp-revisit-modal';
    overlay.setAttribute('data-mp-revisit-prompt', '');

    var card = document.createElement('div');
    card.className = 'mp-revisit-modal-card';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'mp-revisit-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Close');

    var text = document.createElement('p');
    text.className = 'mp-revisit-message';
    var secondsLeft = countdownSeconds;
    text.textContent = buildMessage(targetLabel, secondsLeft);

    var buttonRow = document.createElement('div');
    buttonRow.className = 'mp-revisit-buttons';

    var stayBtn = document.createElement('button');
    stayBtn.className = 'mp-revisit-cancel';
    stayBtn.textContent = 'Stay on this page';

    var goBtn = document.createElement('button');
    goBtn.className = 'mp-revisit-confirm';
    goBtn.textContent = 'Continue now';

    buttonRow.appendChild(stayBtn);
    buttonRow.appendChild(goBtn);
    card.appendChild(closeBtn);
    card.appendChild(text);
    card.appendChild(buttonRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var timer = setInterval(function () {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(timer);
        onConfirm();
        switchTo(destination);
        return;
      }
      text.textContent = buildMessage(targetLabel, secondsLeft);
    }, 1000);

    function stay() {
      clearInterval(timer);
      onStay();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    stayBtn.addEventListener('click', stay);
    closeBtn.addEventListener('click', stay);

    goBtn.addEventListener('click', function () {
      clearInterval(timer);
      onConfirm();
      switchTo(destination);
    });
  }

  // Diagnostic summary for troubleshooting a live site. Run
  // window.mpToggle.debugInfo() in console.
  function debugInfo() {
    var sites = window.mpToggleSites;
    var siteKeys = sites ? Object.keys(sites) : [];
    var hosts = siteKeys.map(function (k) {
      var v = primaryDomain(sites[k]);
      return v.replace(/^https?:\/\//, '').split('/')[0];
    });
    var uniqueHosts = hosts.filter(function (h, i) { return h && hosts.indexOf(h) === i; });
    var current = matchCurrentSite();
    var storedPref = getPref();

    var togglesFound = document.querySelectorAll('.mp-lang-toggle').length;
    var selectsFound = document.querySelectorAll('.mp-lang-select').length;
    var modalsFound = document.querySelectorAll('[data-mp-modal]').length;

    var geoLoaded = Boolean(window.mpToggleGeo);
    var geoFunctions = geoLoaded ? Object.keys(window.mpToggleGeo) : [];
    var geoExpectedFunctions = ['checkWorkerGeo', 'regionOf', 'siteFor', 'decideGeoAction', 'autoPrompt'];
    var geoMissingFunctions = geoLoaded ? geoExpectedFunctions.filter(function (f) { return geoFunctions.indexOf(f) === -1; }) : [];

    var warnings = [];
    if (!sites) {
      warnings.push('window.mpToggleSites is not defined — nothing will resolve. Check it loads before mp-toggle-core.js.');
    }
    if (sites && !current) {
      warnings.push('Current page (' + window.location.hostname + window.location.pathname + ') does not match any entry in mpToggleSites — toggle links may not resolve correctly here.');
    }
    if (uniqueHosts.length > 1 && !window.mpToggleCookieDomain) {
      warnings.push('Multiple hosts detected in mpToggleSites (' + uniqueHosts.join(', ') + ') but window.mpToggleCookieDomain is not set — the preference cookie will NOT sync across them.');
    }
    if (togglesFound === 0 && selectsFound === 0 && modalsFound === 0) {
      warnings.push('No .mp-lang-toggle, .mp-lang-select, or [data-mp-modal] elements found on this page — nothing for this script to bind.');
    }
    if (geoLoaded && geoMissingFunctions.length) {
      warnings.push('mp-toggle-geo.js is loaded but missing: ' + geoMissingFunctions.join(', ') + '. Check window.mpToggleGeoVersion against the latest.');
    }

    var summary = {
      coreVersion: window.mpToggleCoreVersion,
      geoVersion: window.mpToggleGeoVersion || '(mp-toggle-geo.js not loaded)',
      geoLoaded: geoLoaded,
      geoFunctionsAvailable: geoFunctions,
      currentUrl: window.location.href,
      mpToggleSitesKeys: siteKeys,
      cookieDomain: window.mpToggleCookieDomain || '(not set — host-only cookie)',
      revisitRedirectEnabled: Boolean(window.mpToggleRevisitRedirect),
      storedPref: storedPref,
      hasVisitedBefore: hasVisitedBefore(),
      currentSiteMatch: current || null,
      elementsFound: { toggles: togglesFound, selects: selectsFound, modals: modalsFound },
      warnings: warnings,
    };

    if (window.console) {
      console.log('%c[mp-toggle debug]', 'font-weight:bold;color:#1c7293;', summary);
      if (warnings.length) {
        warnings.forEach(function (w) { console.warn('[mp-toggle debug]', w); });
      } else {
        console.log('[mp-toggle debug] No issues detected.');
      }
    }

    return summary;
  }

  function init() {
    autoRenderPlaceholders();
    bindToggles();
    bindModals();
    markCurrentLanguage();

    if (window.mpToggleCookieDomain) {
      var existingPref = getPref();
      if (existingPref) savePref(existingPref);
    }

    if (window.mpToggleRevisitRedirect) {
      checkReturnVisitorRedirect(typeof window.mpToggleRevisitRedirect === 'object' ? window.mpToggleRevisitRedirect : {});
    }

    // Bounded retry handles mp-toggle-geo.js not having finished loading
    // yet at this exact moment (e.g. document.readyState already
    // 'complete' when init() runs).
    if (window.mpToggleGeoWorkerUrl) {
      var geoRetries = 0;
      (function tryGeoAutoPrompt() {
        if (window.mpToggleGeo && window.mpToggleGeo.autoPrompt) {
          window.mpToggleGeo.autoPrompt();
        } else if (geoRetries < 20) {
          geoRetries++;
          setTimeout(tryGeoAutoPrompt, 50);
        } else if (window.console) {
          console.warn('mp-toggle-geo: window.mpToggleGeoWorkerUrl is set but mp-toggle-geo.js never loaded — check it is included after mp-toggle-core.js.');
        }
      })();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.mpToggleInit = init;
  window.mpToggle = {
    switchTo: switchTo,
    buildDestination: buildDestination,
    resolveBase: resolveBase,
    getPref: getPref,
    savePref: savePref,
    clearPref: clearPref,
    markCurrentLanguage: markCurrentLanguage,
    checkReturnVisitorRedirect: checkReturnVisitorRedirect,
    hasVisitedBefore: hasVisitedBefore,
    applyModalWelcomeState: applyModalWelcomeState,
    showCountdownModal: showReturnVisitorModal,
    debugInfo: debugInfo,
  };
})();
