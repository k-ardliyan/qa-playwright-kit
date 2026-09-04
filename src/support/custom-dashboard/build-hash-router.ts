/**
 * Hash-router for the custom dashboard's secondary views.
 *
 * Why hash, not real paths: the fragment endpoints reuse the same server-rendered
 * section builders (history/compare/detail) with zero extra deps, and the client
 * keeps ONE <head>/theme/script shell. Hash routes survive static `file://` open
 * (server not required for the primary dashboard) and stay deep-linkable.
 *
 * Routes:
 *   #/            → primary dashboard (table + accordion + in-page history tab)
 *   #/history     → dedicated history page (fetched from /fragment/history)
 *   #/compare     → compare form + results (/fragment/compare)
 *   #/detail/<id> → single-run detail (/fragment/detail/<id>)
 *
 * Layout contract (see build-dashboard-html.ts):
 *   <div id="primary-view">…full primary dashboard…</div>
 *   <div id="frag-host" hidden></div>
 * Router toggles visibility; it never re-renders primary (avoids breaking the
 * table/accordion toggle + filters that live in the primary body).
 */
export function renderHashNav(): string {
  return `
    <nav class="hash-nav" aria-label="Dashboard sections">
      <a class="hash-nav__link" data-hash-link="/" href="#/">Dashboard</a>
      <a class="hash-nav__link" data-hash-link="/history" href="#/history">History</a>
      <a class="hash-nav__link" data-hash-link="/compare" href="#/compare">Compare</a>
    </nav>
  `;
}

/** Client-side router + fragment loader, injected as inline JS in serve mode. */
export function buildHashRouterJs(): string {
  const lines: string[] = [
    '<script>',
    '(function(){',
    '  var host = document.getElementById("frag-host");',
    '  var primary = document.getElementById("primary-view");',
    '  if(!host || !primary){ return; }',
    '',
    '  function activeHash(){',
    '    var h = location.hash || "#/";',
    '    if(h === "#") h = "#/";',
    '    if(h.charAt(1) !== "/") h = "#/" + h.slice(1);',
    '    // Return path WITHOUT the leading "#" so comparisons are root-relative.',
    '    return h.slice(1);',
    '  }',
    '',
    '  // Query string for hash-routes lives INSIDE the hash (#/compare?x=1&y=2),',
    '  // not location.search. Extract it so fragment fetches carry params.',
    '  function hashQuery(){',
    '    var h = activeHash();',
    '    var qi = h.indexOf("?");',
    '    return qi === -1 ? "" : h.slice(qi);',
    '  }',
    '',
    '  function markNav(h){',
    '    var path = h.split("?")[0];',
    '    document.querySelectorAll(".hash-nav__link").forEach(function(a){',
    '      var target = a.getAttribute("data-hash-link");',
    '      a.classList.toggle("hash-nav__link--active", target === path);',
    '      a.setAttribute("aria-current", target === path ? "page" : "false");',
    '    });',
    '  }',
    '',
    '  function showPrimary(){',
    '    host.hidden = true;',
    '    host.innerHTML = "";',
    '    primary.hidden = false;',
    '  }',
    '',
    '  function showFragment(html){',
    '    primary.hidden = true;',
    '    host.innerHTML = html;',
    '    host.hidden = false;',
    '    wireCompareForm();',
    '  }',
    '',
    '  function showSpinner(){',
    '    var sp=document.getElementById("frag-spinner");if(sp)return;',
    '    host.innerHTML=\'<div id="frag-spinner" class="frag-spinner"><div class="frag-spinner__dot"></div><div class="frag-spinner__dot"></div><div class="frag-spinner__dot"></div><p class="muted">Loading…</p></div>\';',
    '    host.hidden=false;',
    '  }',
    '',
    '  // One in-flight fragment request at a time. Rapid hash changes abort the',
    '  // previous fetch so stale responses can never overwrite a newer view.',
    '  var fragController = null;',
    '  var fragSeq = 0;',
    '',
    '  function loadFragment(url){',
    '    if(fragController){ fragController.abort(); }',
    '    var ctrl = new AbortController();',
    '    fragController = ctrl;',
    '    var seq = ++fragSeq;',
    '    // Hard ceiling: never leave the spinner stuck on a wedged request.',
    '    var t = setTimeout(function(){ ctrl.abort(); }, 15000);',
    '    return fetch(url,{signal:ctrl.signal}).then(function(r){',
    '      if(!r.ok){ throw new Error("HTTP " + r.status); }',
    '      return r.text();',
    '    }).then(function(text){',
    '      clearTimeout(t);',
    '      if(seq !== fragSeq){ throw new Error("stale"); }',
    '      return text;',
    '    });',
    '  }',
    '',
    '  function renderHash(){',
    '    var h = activeHash();',
    '    markNav(h);',
    '    if(h === "/" || h.indexOf("/?") === 0){ showPrimary(); return; }',
    '',
    '    if(h.indexOf("/history") === 0){',
    '      showSpinner();',
    '      loadFragment("/fragment/history").then(showFragment)',
    '        .catch(function(e){ if(e && e.name==="AbortError"){ return; } if(e && e.message==="stale"){ return; } host.innerHTML = "<p class=muted>Failed to load history: " + e.message + "</p>"; host.hidden = false; primary.hidden = true; });',
    '      return;',
    '    }',
    '',
    '    if(h.indexOf("/compare") === 0){',
    '      showSpinner();',
    '      loadFragment("/fragment/compare" + hashQuery()).then(showFragment)',
    '        .catch(function(e){ if(e && e.name==="AbortError"){ return; } if(e && e.message==="stale"){ return; } host.innerHTML = "<p class=muted>Failed to load compare: " + e.message + "</p>"; host.hidden = false; primary.hidden = true; });',
    '      return;',
    '    }',
    '',
    '    if(h.indexOf("/detail/") === 0){',
    '      var id = h.slice("/detail/".length).split(/[?#]/)[0];',
    '      showSpinner();',
    '      loadFragment("/fragment/detail/" + encodeURIComponent(id)).then(showFragment)',
    '        .catch(function(e){ if(e && e.name==="AbortError"){ return; } if(e && e.message==="stale"){ return; } host.innerHTML = "<p class=muted>Failed to load detail: " + e.message + "</p>"; host.hidden = false; primary.hidden = true; });',
    '      return;',
    '    }',
    '',
    '    showPrimary();',
    '  }',
    '',
    '  // Guard against double-binding: store the last submit listener on the form',
    '  // element itself so wireCompareForm() can removeEventListener before re-adding.',
    '  function wireCompareForm(){',
    '    var form = document.querySelector("[data-compare-form]");',
    '    if(!form) return;',
    '    if(form._compareListener){ form.removeEventListener("submit", form._compareListener); }',
    '    form._compareListener = function(ev){',
    '      ev.preventDefault();',
    '      var b = form.elements["baseline"].value;',
    '      var c = form.elements["current"].value;',
    '      if(!b || !c) return;',
    '      window.history.replaceState(null, "", "#/compare?baseline=" + encodeURIComponent(b) + "&current=" + encodeURIComponent(c));',
    '      loadFragment("/fragment/compare?baseline=" + encodeURIComponent(b) + "&current=" + encodeURIComponent(c)).then(showFragment)',
    '        .catch(function(e){ host.innerHTML = "<p class=muted>Compare failed: " + e.message + "</p>"; });',
    '    };',
    '    form.addEventListener("submit", form._compareListener);',
    '  }',
    '',
    '  // Expose fragment helpers so buildHistoryJs refreshCurrentView() can call them.',
    '  window.__loadFragment__ = loadFragment;',
    '  window.__showFragment__ = showFragment;',
    '  // Detail-fragment expand rows call toggleDetailRow(idx). The fragment HTML',
    '  // is injected via innerHTML (scripts inside are NOT executed), so define it',
    '  // once here in the always-present shell.',
    '  window.toggleDetailRow = function(idx){',
    '    var row=document.getElementById("detail-expand-"+idx);',
    '    if(!row)return;',
    "    var main=document.querySelector('[data-idx=\"'+idx+'\"]');",
    '    var btn=main?main.querySelector(".detail-expand-btn"):null;',
    '    if(row.style.display==="none"){',
    '      row.style.display="";',
    '      if(btn){btn.textContent="\\u25be";btn.setAttribute("aria-expanded","true");}',
    '    }else{',
    '      row.style.display="none";',
    '      if(btn){btn.textContent="\\u25b8";btn.setAttribute("aria-expanded","false");}',
    '    }',
    '  };',
    '  window.addEventListener("hashchange", renderHash);',
    '  renderHash();',
    '})();',
    '</scr' + 'ipt>',
  ];
  return lines.join('\n');
}
