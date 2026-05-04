/* InputManager — unified keyboard + touch input layer.
 *
 * Load before game.js. Provides:
 *   InputManager.isHeld('left'|'right'|'up'|'down')  — polling API
 *   InputManager.onTap(fn) / offTap(fn)              — event API
 *   InputManager.mode / InputManager.setMode(m)      — 'auto'|'keyboard'|'touch'
 *
 * Mode is saved to localStorage and can be toggled via the floating button
 * injected into the page automatically.
 */

window.InputManager = (function () {
  const PREF_KEY = 'tenten_inputMode';
  let mode = localStorage.getItem(PREF_KEY) || 'auto';

  function effectiveMode() {
    if (mode !== 'auto') return mode;
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'touch' : 'keyboard';
  }

  // Direction state — updated by both keyboard and touch
  const held = { up: false, down: false, left: false, right: false };

  const tapHandlers = [];
  function fireTap() { tapHandlers.forEach(fn => fn()); }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  // Don't hijack arrows/space when the user is typing in a form field.
  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  window.addEventListener('keydown', e => {
    if (isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); held.left  = true; break;
      case 'ArrowRight': e.preventDefault(); held.right = true; break;
      case 'ArrowUp':    e.preventDefault(); held.up    = true; break;
      case 'ArrowDown':  e.preventDefault(); held.down  = true; break;
    }
    if (e.code === 'Space') { e.preventDefault(); fireTap(); }
  });

  window.addEventListener('keyup', e => {
    if (isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'ArrowLeft':  held.left  = false; break;
      case 'ArrowRight': held.right = false; break;
      case 'ArrowUp':    held.up    = false; break;
      case 'ArrowDown':  held.down  = false; break;
    }
  });

  // ── Touch — drag for direction, short tap for action ────────────────────────

  const DEADZONE = 14;
  let tx0 = null, ty0 = null;

  window.addEventListener('touchstart', e => {
    tx0 = e.touches[0].clientX;
    ty0 = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (tx0 === null) return;
    const dx = e.touches[0].clientX - tx0;
    const dy = e.touches[0].clientY - ty0;
    held.left  = dx < -DEADZONE;
    held.right = dx >  DEADZONE;
    held.up    = dy < -DEADZONE;
    held.down  = dy >  DEADZONE;
  }, { passive: true });

  window.addEventListener('touchend', e => {
    const dx = Math.abs((e.changedTouches[0]?.clientX ?? tx0) - tx0);
    const dy = Math.abs((e.changedTouches[0]?.clientY ?? ty0) - ty0);
    if (dx < DEADZONE && dy < DEADZONE) fireTap();
    tx0 = null; ty0 = null;
    held.left = held.right = held.up = held.down = false;
  }, { passive: true });

  // ── Mode toggle UI ───────────────────────────────────────────────────────────

  function buildToggle() {
    const btn = document.createElement('button');
    btn.id = 'input-mode-toggle';
    btn.setAttribute('aria-label', '입력 방식 전환');
    Object.assign(btn.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: '9999',
      border: 'none', borderRadius: '999px',
      background: 'rgba(24,35,56,0.75)', color: '#fff',
      fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: '700',
      padding: '6px 12px', cursor: 'pointer', backdropFilter: 'blur(6px)',
      transition: 'opacity 0.2s',
    });

    function updateLabel() {
      btn.textContent = effectiveMode() === 'touch' ? '⌨ 키보드' : '👆 터치';
    }
    updateLabel();

    btn.addEventListener('click', () => {
      setMode(effectiveMode() === 'touch' ? 'keyboard' : 'touch');
      updateLabel();
    });

    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildToggle);
  } else {
    buildToggle();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  function setMode(m) {
    if (['auto', 'keyboard', 'touch'].includes(m)) {
      mode = m;
      localStorage.setItem(PREF_KEY, m);
    }
  }

  return {
    get mode() { return mode; },
    get effectiveMode() { return effectiveMode(); },
    setMode,
    isHeld: dir => held[dir] || false,
    onTap:  fn => tapHandlers.push(fn),
    offTap: fn => { const i = tapHandlers.indexOf(fn); if (i >= 0) tapHandlers.splice(i, 1); },
  };
})();
