(function () {
  'use strict';

  window.mpToggleGeoVersion = '2.2.0-beta';

  var GEO_LANG_COOKIE = 'mpGeoLangPref';
  var GEO_REGION_COOKIE = 'mpGeoRegionPref';
  var GEO_MAX_AGE_DAYS = 365;

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Domain-shared via window.mpToggleCookieDomain (same global
  // mp-toggle-core.js uses), so a preference confirmed on one subdomain
  // is visible on others too. Self-heals any stale host-only cookie.
  function setCookie(name, value) {
    var maxAge = '; Max-Age=' + (GEO_MAX_AGE_DAYS * 24 * 60 * 60);
    var valueAndAttrs = name + '=' + encodeURIComponent(value) + '; Path=/' + maxAge + '; SameSite=Lax';
    if (window.mpToggleCookieDomain) {
      document.cookie = valueAndAttrs + '; Domain=' + window.mpToggleCookieDomain;
      document.cookie = name + '=; Path=/; Max-Age=0';
    } else {
      document.cookie = valueAndAttrs;
    }
  }

  function getStoredGeoPrefs() {
    return { lang: getCookie(GEO_LANG_COOKIE), region: getCookie(GEO_REGION_COOKIE) };
  }

  function confirmGeoChoice(lang, region) {
    setCookie(GEO_LANG_COOKIE, lang);
    setCookie(GEO_REGION_COOKIE, region);
  }

  // Resolves a country code to a region key via window.mpToggleGeoRegions.
  // Normalized to lowercase before matching, since real geo endpoints
  // (e.g. Cloudflare) return uppercase country codes.
  function regionOf(countryCode) {
    var regions = window.mpToggleGeoRegions || {};
    var normalized = (countryCode || '').toLowerCase();
    for (var region in regions) {
      var list = regions[region] || [];
      for (var i = 0; i < list.length; i++) {
        if ((list[i] || '').toLowerCase() === normalized) return region;
      }
    }
    return null;
  }

  // Resolves a lang+region pair to a destination site via
  // window.mpToggleGeoSites. Returns null if that combination has no
  // real site — an expected gap, not an error.
  function siteFor(lang, region) {
    var sites = window.mpToggleGeoSites || {};
    return sites[lang + '-' + region] || null;
  }

  function matchCurrentGeoSite() {
    var sites = window.mpToggleGeoSites || {};
    var currentHost = window.location.hostname;
    var currentPath = window.location.pathname || '/';
    var bestKey = null;
    var bestPrefix = '';
    var bestMatchLen = -1;

    for (var key in sites) {
      var value = sites[key] || '';
      var withoutProtocol = value.replace(/^https?:\/\//, '');
      var slashIdx = withoutProtocol.indexOf('/');
      var siteHost = slashIdx === -1 ? withoutProtocol : withoutProtocol.slice(0, slashIdx);
      var sitePath = slashIdx === -1 ? '' : withoutProtocol.slice(slashIdx);

      if (siteHost !== currentHost) continue;
      if (sitePath && currentPath.indexOf(sitePath) !== 0) continue;
      if (sitePath.length > bestMatchLen) { bestKey = key; bestPrefix = sitePath; bestMatchLen = sitePath.length; }
    }

    if (bestKey === null) return null;
    var dashIdx = bestKey.indexOf('-');
    return { key: bestKey, lang: bestKey.slice(0, dashIdx), region: bestKey.slice(dashIdx + 1), prefix: bestPrefix };
  }

  // Fetches { country, region, city } from a lightweight geo endpoint
  // (e.g. a Cloudflare Worker reading request.cf.country).
  function checkWorkerGeo(workerUrl, callback, timeoutMs) {
    timeoutMs = timeoutMs || 3000;
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      callback(null, new Error('geo endpoint request timed out'));
    }, timeoutMs);

    fetch(workerUrl)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        callback(data, null);
      })
      .catch(function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        callback(null, err);
      });
  }

  // Returning visitor (stored lang+region) resolves silently. First-time
  // visitor (live browser-language + IP-country) only ever prompts.
  function decideGeoAction(input) {
    var current = input.current; // { key, lang, region } or null
    var currentSiteValue = current && window.mpToggleGeoSites ? window.mpToggleGeoSites[current.key] : null;

    if (input.storedLang && input.storedRegion) {
      var storedTarget = siteFor(input.storedLang, input.storedRegion);
      if (storedTarget && storedTarget !== currentSiteValue) {
        return { action: 'redirect', targetSite: storedTarget, lang: input.storedLang, region: input.storedRegion };
      }
    }

    if (input.liveLang && input.liveRegion) {
      var liveTarget = siteFor(input.liveLang, input.liveRegion);
      if (liveTarget && liveTarget !== currentSiteValue) {
        return { action: 'prompt', targetSite: liveTarget, lang: input.liveLang, region: input.liveRegion };
      }
    }

    return { action: 'none' };
  }

  function autoPrompt(options) {
    options = options || {};
    var workerUrl = options.workerUrl || window.mpToggleGeoWorkerUrl;
    if (!workerUrl) {
      if (window.console) console.warn('mp-toggle-geo: no geo endpoint configured (window.mpToggleGeoWorkerUrl or options.workerUrl)');
      return;
    }

    var current = matchCurrentGeoSite();
    var stored = getStoredGeoPrefs();
    var countdownSeconds = options.countdownSeconds || window.mpToggleGeoCountdownSeconds || 10;

    checkWorkerGeo(workerUrl, function (geoData, err) {
      if (err) {
        if (window.console) console.warn('mp-toggle-geo: geo endpoint request failed', err);
        return;
      }

      var liveRegion = regionOf(geoData.country);
      var liveLang = (navigator.language || '').slice(0, 2).toLowerCase();

      var decision = decideGeoAction({
        storedLang: stored.lang,
        storedRegion: stored.region,
        liveLang: liveLang,
        liveRegion: liveRegion,
        current: current,
      });

      var destBase = decision.targetSite ? (/^https?:\/\//.test(decision.targetSite) ? decision.targetSite : 'https://' + decision.targetSite) : null;
      var destination = destBase && window.mpToggle && window.mpToggle.buildDestination
        ? window.mpToggle.buildDestination(destBase, options.preservePath !== false)
        : destBase;

      if (decision.action === 'redirect') {
        confirmGeoChoice(decision.lang, decision.region);
        window.location.href = destination;
        return;
      }

      if (decision.action === 'prompt') {
        var event = new CustomEvent('mp:geoprompt', {
          detail: { destination: destination, targetSite: decision.targetSite, lang: decision.lang, region: decision.region, country: geoData.country },
          cancelable: true,
        });
        var proceed = document.dispatchEvent(event);
        if (!proceed) return;

        if (window.mpToggle && window.mpToggle.showCountdownModal) {
          var labels = options.labels || window.mpToggleGeoLabels || {};
          window.mpToggle.showCountdownModal(destination, current, decision.lang, countdownSeconds, {
            labels: labels,
            message: function (label, seconds) {
              return 'It looks like you might prefer ' + label + '. Continuing in ' + seconds + 's.';
            },
            onStay: function () {
              if (current) confirmGeoChoice(current.lang, current.region);
            },
            onConfirm: function () {
              confirmGeoChoice(decision.lang, decision.region);
            },
          });
        } else if (window.console) {
          console.warn('mp-toggle-geo: mp-toggle-core.js (2.7.0-beta or later) is required to show the geo prompt modal.');
        }
        return;
      }

      // No rule matched — silently confirm current page as the stored preference.
      if (current) confirmGeoChoice(current.lang, current.region);
    });
  }

  window.mpToggleGeo = {
    checkWorkerGeo: checkWorkerGeo,
    regionOf: regionOf,
    siteFor: siteFor,
    matchCurrentGeoSite: matchCurrentGeoSite,
    decideGeoAction: decideGeoAction,
    autoPrompt: autoPrompt,
    confirmGeoChoice: confirmGeoChoice,
    getStoredGeoPrefs: getStoredGeoPrefs,
  };
})();
