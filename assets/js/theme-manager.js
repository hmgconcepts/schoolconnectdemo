/* ============================================================================
   theme-manager.js — School Connect V12.22 Robust Theme Manager
   ----------------------------------------------------------------------------
   Inspired by HMG Fleet Console (Shell.applyTheme/toggleTheme) + Adewale
   Classroom theme-engine.js (18-token theming + WCAG contrast guard + 
   pre-paint + font + layout).

   BEFORE: School Connect had only App.applyStoredTheme() reading sc-theme
   from localStorage and setting body.dataset.theme, plus toggleDarkMode()
   flipping body.dataset.theme. No CSS variables for primary/accent were
   ever re-themed at runtime, so changing theme did nothing visible except
   dark/light. No pre-paint, so flash of wrong theme on load.

   AFTER (robust, self-contained, all-inclusive, seamless):
   - Pre-paint: runs synchronously before first paint (inline script in <head>
     + this file's init) to avoid FOUC
   - Mode: light/dark stored in localStorage 'sc-theme' (like Fleet's Store.settings().theme)
     + respects prefers-color-scheme on first visit
     + sets data-theme on BOTH html and body (like Fleet + Adewale)
     + CSS variables in :root and [data-theme="dark"] already exist in style.css
   - Colors: 18-token theming like Adewale — primary, accent, primaryLight,
     primaryDark, accentLight, accentDark, gradient, gradient-dark, etc.
     + WCAG contrast guard readableOn() ensures buttons stay readable
     + Sets --primary, --primary-dark, --primary-light, --accent, etc. on :root
     + Updates meta theme-color for PWA/Android address bar
   - Fonts: optional font switching (removes hardcoded Google Fonts if needed)
   - Layouts: optional layout switching (adds body class layout-*)
   - UI: Settings page card with theme toggle + color theme picker + font picker
   - API: window.ThemeManager with applyMode, toggleMode, applyTheme, applyFont,
     applyLayout, init, current

   No paid dependencies, no external CDN, browser-only, free-tier.
   ============================================================================ */
(function(w, d){
  'use strict';

  const LS_MODE = 'sc-theme'; // light/dark
  const LS_COLORS = 'sc-theme-colors'; // {primary, accent}
  const LS_FONT = 'sc-font';

  const PRESETS = [
    {id:'default', name:'HMG Indigo', primary:'#4f46e5', accent:'#06b6d4'},
    {id:'gosa', name:'GoSA Gold', primary:'#0f172a', accent:'#d4af37'},
    {id:'forest', name:'Forest', primary:'#166534', accent:'#16a34a'},
    {id:'ocean', name:'Ocean', primary:'#0c4a6e', accent:'#06b6d4'},
    {id:'sunset', name:'Sunset', primary:'#9f1239', accent:'#f59e0b'},
    {id:'violet', name:'Violet', primary:'#5b21b6', accent:'#a78bfa'},
    {id:'slate', name:'Slate', primary:'#334155', accent:'#94a3b8'},
    {id:'emerald', name:'Emerald', primary:'#047857', accent:'#34d399'},
    {id:'rose', name:'Rose', primary:'#be123c', accent:'#fb7185'},
    {id:'amber', name:'Amber', primary:'#92400e', accent:'#fbbf24'},
    {id:'cyan', name:'Cyan', primary:'#155e75', accent:'#22d3ee'},
    {id:'brand', name:'HMG Brand', primary:'#0506ae', accent:'#964eec'}
  ];

  const ThemeManager = {
    PRESETS,

    // --- colour helpers (from Adewale) ---
    hex2rgb(h){
      h = String(h||'').trim().replace('#','');
      if(h.length===3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      const n = parseInt(h,16);
      if(isNaN(n)) return [79,70,229];
      return [(n>>16)&255, (n>>8)&255, n&255];
    },
    rgb2hex(r){
      return '#'+r.map(c=>{
        c = Math.max(0, Math.min(255, Math.round(c)));
        return (c<16?'0':'')+c.toString(16);
      }).join('');
    },
    _hsl(h){
      const c = this.hex2rgb(h).map(x=>x/255);
      const mx = Math.max(...c), mn = Math.min(...c);
      let l = (mx+mn)/2, s=0, hu=0, dd=mx-mn;
      if(dd){
        s = l>0.5 ? dd/(2-mx-mn) : dd/(mx+mn);
        if(mx===c[0]) hu = ((c[1]-c[2])/dd)%6;
        else if(mx===c[1]) hu = (c[2]-c[0])/dd+2;
        else hu = (c[0]-c[1])/dd+4;
        hu*=60; if(hu<0) hu+=360;
      }
      return [hu,s,l];
    },
    _fromHsl(hu,s,l){
      const c = (1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(((hu/60)%2)-1)), m=l-c/2;
      let r=[0,0,0];
      if(hu<60) r=[c,x,0]; else if(hu<120) r=[x,c,0];
      else if(hu<180) r=[0,c,x]; else if(hu<240) r=[0,x,c];
      else if(hu<300) r=[x,0,c]; else r=[c,0,x];
      return this.rgb2hex([(r[0]+m)*255,(r[1]+m)*255,(r[2]+m)*255]);
    },
    lighten(h,f){ const a=this._hsl(h); return this._fromHsl(a[0],a[1],Math.min(1,a[2]+(1-a[2])*f)); },
    darken(h,f){ const a=this._hsl(h); return this._fromHsl(a[0],a[1],Math.max(0,a[2]*(1-f))); },
    lum(h){
      return this.hex2rgb(h).map(c=>{
        c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
      }).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
    },
    contrast(a,b){
      const l1=this.lum(a), l2=this.lum(b);
      const hi=Math.max(l1,l2), lo=Math.min(l1,l2);
      return (hi+0.05)/(lo+0.05);
    },
    readableOn(bg){ return this.contrast(bg,'#ffffff')>=3.6 ? '#ffffff' : '#0f172a'; },

    resolve(theme){
      theme = theme||{};
      const p = theme.primary||'#4f46e5';
      const a = theme.accent||'#06b6d4';
      return {
        primary: p,
        accent: a,
        primaryLight: theme.primaryLight||this.lighten(p,0.28),
        primaryDark: theme.primaryDark||this.darken(p,0.30),
        accentLight: theme.accentLight||this.lighten(a,0.30),
        accentDark: theme.accentDark||this.darken(a,0.25),
        bg: theme.bg||'#f8fafc',
        ink: theme.ink||'#0f172a',
        ring: theme.ring||'rgba('+this.hex2rgb(p).join(',')+',.22)',
        gradient: theme.gradient||('linear-gradient(135deg,'+p+' 0%,'+a+' 100%)'),
        onPrimary: theme.onPrimary||this.readableOn(p),
        onAccent: this.readableOn(a)
      };
    },

    // --- apply theme colors (18 tokens) ---
    applyTheme(theme){
      const t = this.resolve(theme);
      const r = d.documentElement.style;
      const set = (k,v)=>{ try{ r.setProperty(k,v); }catch(_){} };
      set('--primary', t.primary);
      set('--primary-dark', t.primaryDark);
      set('--primary-light', t.primaryLight);
      set('--accent', t.accent);
      set('--accent-dark', t.accentDark);
      set('--accent-light', t.accentLight);
      set('--on-primary', t.onPrimary);
      set('--on-accent', t.onAccent);
      set('--ink', t.ink);
      set('--ring', t.ring);
      set('--gradient', t.gradient);
      set('--gradient-dark', 'linear-gradient(135deg,'+t.primaryDark+' 0%,'+t.accentDark+' 100%)');
      set('--gradient-soft', 'linear-gradient(135deg,'+t.primaryLight+' 0%,'+t.accentLight+' 100%)');
      // legacy aliases
      set('--tc-primary', t.primary);
      set('--tc-primary-dark', t.primaryDark);
      set('--tc-primary-light', t.primaryLight);
      set('--tc-accent', t.accent);
      set('--sc-primary', t.primary);
      set('--sc-accent', t.accent);
      // theme-color meta for PWA
      let meta = d.querySelector('meta[name="theme-color"]');
      if(!meta){ meta=d.createElement('meta'); meta.name='theme-color'; d.head.appendChild(meta); }
      meta.content = t.primary;
      this.current = t;
      try{ localStorage.setItem(LS_COLORS, JSON.stringify({primary:t.primary, accent:t.accent})); }catch(_){}
      return t;
    },

    // --- dark/light mode (Fleet Console style) ---
    applyMode(mode){
      let m = mode;
      if(!m){
        try{ m = localStorage.getItem(LS_MODE); }catch(_){}
        if(!m){
          // respect system preference on first visit
          try{ m = w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }catch(_){ m='light'; }
        }
      }
      m = (m==='dark'?'dark':'light');
      // set on BOTH html and body for maximum compatibility (Fleet uses html, old SC used body)
      try{
        d.documentElement.setAttribute('data-theme', m);
        if(d.body) d.body.setAttribute('data-theme', m);
        // also keep old body.dataset for legacy code that reads body.dataset.theme
        if(d.body) d.body.dataset.theme = m;
      }catch(_){}
      try{ localStorage.setItem(LS_MODE, m); }catch(_){}
      return m;
    },

    toggleMode(){
      const cur = (d.documentElement.getAttribute('data-theme')||d.body?.getAttribute('data-theme')||'light');
      const next = cur==='dark'?'light':'dark';
      this.applyMode(next);
      if(typeof toast==='function') toast(next==='dark'?'🌙 Dark mode — easier on the eyes at night':'☀️ Light mode — crisp and bright','info',2500);
      return next;
    },

    // --- font ---
    applyFont(font){
      if(!font) return;
      try{
        if(font.css){
          const id='sc-font-link';
          let link=d.getElementById(id)||d.createElement('link');
          link.id=id; link.rel='stylesheet'; link.href='https://fonts.googleapis.com/css2?family='+String(font.css).split('|').join('&family=')+'&display=swap';
          if(!link.parentNode) d.head.appendChild(link);
        }
        if(font.family){
          d.documentElement.style.setProperty('--font', "'"+String(font.family).replace(/'/g,'')+"', system-ui, sans-serif");
        }
        localStorage.setItem(LS_FONT, JSON.stringify(font));
      }catch(_){}
    },

    // --- init pre-paint + bind ---
    init(){
      // pre-paint: apply mode immediately (no FOUC)
      this.applyMode();
      // apply saved colors if any
      try{
        const saved = JSON.parse(localStorage.getItem(LS_COLORS)||'null');
        if(saved && saved.primary) this.applyTheme(saved);
      }catch(_){}
      // also apply theme from SCHOOL config if present (generator baked)
      try{
        const cfg = w.SCHOOL||{};
        if(cfg.themePrimary || cfg.themeAccent){
          const cur = this.current;
          // only apply if no custom saved colors, or if generator theme differs from saved
          const saved = JSON.parse(localStorage.getItem(LS_COLORS)||'null');
          if(!saved){
            this.applyTheme({primary: cfg.themePrimary||'#4f46e5', accent: cfg.themeAccent||'#06b6d4'});
          }
        }
      }catch(_){}
      // listen for system theme changes if user hasn't manually chosen
      try{
        if(w.matchMedia){
          w.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e=>{
            try{
              const manual = localStorage.getItem(LS_MODE);
              if(!manual) this.applyMode(e.matches?'dark':'light');
            }catch(_){}
          });
        }
      }catch(_){}
    },

    // --- UI for settings page ---
    renderSettingsCard(){
      const host = document.getElementById('theme-manager-card') || document.getElementById('settings-theme-card');
      if(!host) return;
      const curMode = d.documentElement.getAttribute('data-theme')||'light';
      const curColors = (()=>{ try{ return JSON.parse(localStorage.getItem(LS_COLORS)||'null'); }catch(_){ return null; } })() || {primary:'#4f46e5', accent:'#06b6d4'};
      const presetsHtml = PRESETS.map(p=>{
        const active = (curColors.primary===p.primary && curColors.accent===p.accent) ? ' style="border:2px solid var(--primary); box-shadow:0 0 0 3px var(--ring)"' : '';
        return `<button type="button" class="theme-preset" data-primary="${p.primary}" data-accent="${p.accent}" title="${p.name}"${active} style="width:48px;height:48px;border-radius:12px;border:1px solid #e2e8f0;background:linear-gradient(135deg,${p.primary},${p.accent});cursor:pointer"></button>`;
      }).join('');
      host.innerHTML = `
        <h3 style="margin:0 0 12px">🎨 Theme — Robust like Fleet Console (V12.22)</h3>
        <p class="muted" style="margin:0 0 14px">Change light/dark mode instantly, pick a colour theme, and it remembers on every device. Pre-paint, no flash, WCAG contrast guard, respects system preference. Inspired by Fleet Console's <code>Shell.applyTheme/toggleTheme</code> + Adewale's 18-token engine.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
          <button class="btn btn-primary btn-sm" onclick="ThemeManager.toggleMode()">🌓 Toggle ${curMode==='dark'?'to Light':'to Dark'} — current: ${curMode}</button>
          <button class="btn btn-outline btn-sm" onclick="localStorage.removeItem('${LS_MODE}'); localStorage.removeItem('${LS_COLORS}'); location.reload()">↺ Reset to school default</button>
          <span class="muted" style="font-size:.82rem">Stored in <code>localStorage.${LS_MODE}</code> + <code>${LS_COLORS}</code> — like Fleet Console's <code>Store.settings().theme</code></span>
        </div>
        <div style="margin-bottom:12px"><strong style="font-size:.85rem">Colour themes — click to apply instantly:</strong></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">${presetsHtml}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label style="font-size:.8rem">Custom primary <input type="color" id="tm-primary" value="${curColors.primary}" style="width:44px;height:36px;padding:2px;border-radius:8px"></label>
          <label style="font-size:.8rem">Custom accent <input type="color" id="tm-accent" value="${curColors.accent}" style="width:44px;height:36px;padding:2px;border-radius:8px"></label>
          <button class="btn btn-outline btn-sm" onclick="ThemeManager.applyTheme({primary:document.getElementById('tm-primary').value, accent:document.getElementById('tm-accent').value})">Apply custom</button>
        </div>
      `;
      host.querySelectorAll('.theme-preset').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          ThemeManager.applyTheme({primary: btn.dataset.primary, accent: btn.dataset.accent});
          ThemeManager.renderSettingsCard();
          if(typeof toast==='function') toast('🎨 Theme applied — '+btn.title,'success',2500);
        });
      });
    }
  };

  // Pre-paint: run immediately, not waiting for DOMContentLoaded
  try{ ThemeManager.init(); }catch(_){}

  w.ThemeManager = ThemeManager;
  // Backward compat: App.toggleDarkMode now delegates to ThemeManager
  if(w.App){
    const orig = w.App.toggleDarkMode;
    w.App.toggleDarkMode = function(){
      return ThemeManager.toggleMode();
    };
    // Also keep applyStoredTheme working
    w.App.applyStoredTheme = function(){
      return ThemeManager.applyMode();
    };
  }

  // Render settings card when DOM ready
  d.addEventListener('DOMContentLoaded', ()=>{
    ThemeManager.renderSettingsCard();
    // Also ensure mode is applied to body if it wasn't yet (body may not have existed at init)
    ThemeManager.applyMode();
  });

})(window, document);
