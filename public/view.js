(function () {
  const root = document.getElementById('root');
  const WORLD = window.WORLD;
  const COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffa726'];
  const LETTERS = ['A', 'B', 'C', 'D'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (name, ...args) => parent.postMessage({ type: 'move', name, args }, '*');
  const $ = (id) => document.getElementById(id);
  const put = (el, html) => { if (el && el.__h !== html) { el.__h = html; el.innerHTML = html; } };

  let last = null; // the latest message from the platform
  let myID = null;
  let layoutKey = null;
  let greeted = false;
  let sel = null; // the holder's tentative pick
  let selKey = '';
  let nudgeAt = 0;
  let awayAt = 0; // when we first noticed the holder was away
  let intent = null; // a move we keep re-sending until the server's state shows it landed
  const started = {}; // result id -> local start time of its animation

  const qkey = (S) => S.stops + ':' + S.tries;
  function want(name, args, until) {
    const S = last.state.G, key = qkey(S);
    intent = { name, args, key, at: 0, until: (T) => T.phase !== 'clue' || qkey(T) !== key || until(T) };
    pump();
  }
  function pump() {
    if (!intent || !last) return;
    const S = last.state.G;
    if (S.phase === 'gameover' || intent.until(S)) { intent = null; return; }
    if (Date.now() - intent.at >= 900) { intent.at = Date.now(); send(intent.name, ...intent.args); }
  }

  const nm = (names, id) => esc((names && names[id]) || 'Agent ' + (Number(id) + 1));
  const proj = (lat, lon) => [
    ((lon + 180) / 360) * WORLD.W,
    ((WORLD.top - lat) / (WORLD.top - WORLD.bottom)) * WORLD.H,
  ];

  // ---------- shared pieces ----------
  function caseHTML(S) {
    return `<div class="case"><img src="villains/${esc(S.villain.id)}.jpg" alt="" onerror="this.style.visibility='hidden'">
      <div><strong>${esc(S.villain.name)}</strong><br><span>stole ${esc(S.item)}</span></div></div>`;
  }
  function pipsHTML(S) {
    let h = '';
    for (let i = 0; i < S.goal; i++) h += `<span class="pip${i < S.firstTry ? ' on' : ''}">${i < S.firstTry ? '✓' : i + 1}</span>`;
    h += `<span class="pip fin${S.final ? ' now' : ''}">🎯</span>`;
    return `<div class="pips">${h}</div>`;
  }
  function whoHTML(S, names, i) {
    return S.votes.by[i].map((id) => nm(names, id)).join(', ');
  }
  function rank(misses) {
    if (misses === 0) return 'Flawless! Not a single wrong turn.';
    if (misses <= 3) return 'Sharp detectives. Barely broke a sweat.';
    if (misses <= 8) return 'Solid sleuthing with a few detours.';
    return 'Messy, but a catch is a catch!';
  }
  function overHTML(S) {
    return `<div class="win"><img src="villains/${esc(S.villain.id)}.jpg" alt="">
      <h1>🚔 ${esc(S.villain.name)} CAUGHT!</h1>
      <p>${esc(S.item.charAt(0).toUpperCase() + S.item.slice(1))} has been returned.</p>
      <div class="stats"><div class="stat"><b>${S.firstTry}</b>first-try stops</div>
      <div class="stat"><b>${S.misses}</b>wrong turns</div></div>
      <p class="gold">${rank(S.misses)}</p></div>`;
  }

  // ---------- track the result animation clock ----------
  function track(S) {
    if (S.result && started[S.result.id] === undefined) started[S.result.id] = Date.now() - S.result.elapsed;
  }

  // ====================================================
  //  TV
  // ====================================================
  function grid() {
    let g = '';
    for (let lon = -150; lon <= 150; lon += 30) { const x = proj(0, lon)[0]; g += `M${x} 0V${WORLD.H}`; }
    for (let lat = -30; lat <= 60; lat += 30) { const y = proj(lat, 0)[1]; g += `M0 ${y}H${WORLD.W}`; }
    return g;
  }
  function buildTV() {
    root.innerHTML = `
      <div class="tvtop"><div id="tcase"></div><div id="tpips"></div><div id="tturn" class="tvturn"></div></div>
      <div class="mapwrap">
        <svg id="map" viewBox="0 0 ${WORLD.W} ${WORLD.H}">
          <path d="${grid()}" stroke="#ffffff" stroke-opacity=".07" stroke-width=".6" fill="none"/>
          <path d="${WORLD.land}" fill="#355e45" stroke="#4f8a64" stroke-width=".6" stroke-linejoin="round"/>
          <path d="${WORLD.borders}" fill="none" stroke="#244433" stroke-width=".35"/>
          <g id="trail"></g>
          <path id="route" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 5"/>
          <g id="pins"></g>
          <g id="team"><circle r="13" fill="#fff" stroke="#ffd54f" stroke-width="3"/>
            <text y="6" font-size="17" text-anchor="middle">🕵️</text></g>
        </svg>
        <div id="banner"></div>
      </div>
      <div class="tvbottom"><div id="tclue"></div><div id="topts" class="tvopts"></div></div>`;
  }

  // Spread out badges that would sit on top of each other
  function spread(pts) {
    const d = pts.map((p) => [p[0], p[1]]);
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
        let dx = d[j][0] - d[i][0], dy = d[j][1] - d[i][1];
        let dist = Math.hypot(dx, dy);
        if (dist < 20) {
          if (dist < 0.01) { dx = Math.cos(i * 2); dy = Math.sin(i * 2); dist = 1; }
          const push = (20 - dist) / 2;
          d[i][0] -= (dx / dist) * push; d[i][1] -= (dy / dist) * push;
          d[j][0] += (dx / dist) * push; d[j][1] += (dy / dist) * push;
        }
      }
    }
    return d;
  }

  function curve(a, b) {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.22;
    return (u) => {
      const v = 1 - u;
      return [v * v * a[0] + 2 * v * u * mx + u * u * b[0], v * v * a[1] + 2 * v * u * my + u * u * b[1]];
    };
  }
  function arc(f, u, move) {
    let d = '';
    const n = Math.max(2, Math.round(u * 40));
    for (let i = 0; i <= n; i++) {
      const p = f((u * i) / n);
      d += (i === 0 && move !== false ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }
    return d;
  }
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

  function renderTV(msg) {
    const S = msg.state.G, names = msg.names;
    if (S.phase === 'gameover') {
      if (layoutKey !== 'over') { layoutKey = 'over'; root.innerHTML = ''; }
      put(root, overHTML(S));
      return;
    }
    if (layoutKey !== 'tv') { layoutKey = 'tv'; buildTV(); }

    put($('tcase'), caseHTML(S));
    put($('tpips'), pipsHTML(S) + (S.final ? '<div class="finalbadge">🚨 FINAL CHASE</div>' : ''));

    let turn;
    if (!S.holder) turn = '<span class="dim">Waiting for the first agent to report in…</span>';
    else {
      const v = S.votes;
      turn = `🎯 <span class="gold">${nm(names, S.holder)}</span> has the call<br>` +
        (S.holderAway ? '<small>Looks like they’re away. Someone will take over…</small>'
          : v.needed === 0 ? '<small>Solo mission. It’s all on you!</small>'
          : `<small>${v.voted} of ${v.needed} votes in</small>`);
    }
    put($('tturn'), turn);

    const lead = Math.max(...S.votes.by.map((b) => b.length));
    put($('tclue'), `<div class="clue"><b>${S.final ? 'FINAL CLUE' : 'THE CLUE'}</b>${esc(S.clue)}</div>`);
    put($('topts'), S.options.map((o, i) => {
      const n = S.votes.by[i].length;
      const pct = S.votes.needed ? Math.round((n / S.votes.needed) * 100) : 0;
      return `<div class="tvopt${o.out ? ' out' : ''}${lead > 0 && n === lead && !o.out ? ' hot' : ''}">
        <b class="badge" style="background:${COLORS[i]}">${LETTERS[i]}</b><span>${esc(o.name)}</span>
        <span class="cnt">${n || ''}</span>
        <div class="bar"><i style="width:${pct}%;background:${COLORS[i]}"></i></div>
        <div class="who">${whoHTML(S, names, i)}</div></div>`;
    }).join(''));

    // trail (where the team has been)
    const pts = S.trail.map((p) => proj(p.lat, p.lon));
    let tr = '';
    for (let i = 1; i < pts.length; i++) {
      tr += `<path d="${arc(curve(pts[i - 1], pts[i]), 1)}" fill="none" stroke="#ffd54f" stroke-opacity=".35" stroke-width="1.4" stroke-dasharray="2 4"/>`;
    }
    pts.forEach((p) => { tr += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#ffd54f" fill-opacity=".6"/>`; });
    put($('trail'), tr);

    // the four pins
    const real = S.options.map((o) => proj(o.lat, o.lon));
    const shown = spread(real);
    put($('pins'), S.options.map((o, i) => {
      const [rx, ry] = real[i], [sx, sy] = shown[i];
      const moved = Math.hypot(rx - sx, ry - sy) > 2;
      return `<g opacity="${o.out ? 0.4 : 1}">${moved ? `<line x1="${rx}" y1="${ry}" x2="${sx}" y2="${sy}" stroke="#fff" stroke-width="1"/>` : ''}
        <circle cx="${rx}" cy="${ry}" r="2.4" fill="#fff"/>
        <circle cx="${sx}" cy="${sy}" r="10" fill="${COLORS[i]}" stroke="#fff" stroke-width="2"/>
        <text x="${sx}" y="${sy + 4.5}" font-size="13" font-weight="bold" text-anchor="middle" fill="#111">${o.out ? '✕' : LETTERS[i]}</text></g>`;
    }).join(''));

    // banner text for results (shown by the animation loop once the team arrives)
    const b = $('banner');
    if (S.phase === 'result' && S.result) {
      const r = S.result;
      put(b, r.catch
        ? `🚔 <b>${esc(S.villain.name)}</b> is cornered in ${esc(r.to.name)}!<small>${esc(r.line)}</small>`
        : r.ok
          ? `✅ <b>${esc(r.to.name)}</b>. ${esc(S.villain.name)} was here!<small>${esc(r.line)}${r.first ? ' (+1 first try!)' : ''}</small>`
          : `❌ <b>${esc(r.to.name)}</b>. Wrong place!<small>${esc(r.line)}</small>`);
      b.className = r.ok ? 'ok' : 'miss';
    } else {
      b.className = '';
    }
  }

  // Runs all the time: moves the team marker and draws the flight path
  function frame() {
    requestAnimationFrame(frame);
    if (!last || last.view !== 'public' || layoutKey !== 'tv' || !$('team')) return;
    const S = last.state.G;
    let pos = proj(S.at.lat, S.at.lon);
    let route = '', color = '#ffd54f', showBanner = false;
    if (S.phase === 'result' && S.result && started[S.result.id] !== undefined) {
      const r = S.result, t = Date.now() - started[r.id];
      const a = proj(r.from.lat, r.from.lon), b = proj(r.to.lat, r.to.lon);
      const go = 2800, hold = 1600;
      color = r.ok ? '#81c784' : '#ef5350';
      const out = curve(a, b);
      if (t < go) { const u = ease(t / go); pos = out(u); route = arc(out, Math.max(u, 0.01)); }
      else {
        route = arc(out, 1);
        pos = b;
        showBanner = true;
        if (!r.ok && t >= go + hold) {
          const back = proj(r.back.lat, r.back.lon), ret = curve(b, back);
          const u = ease(Math.min(1, (t - go - hold) / go));
          pos = ret(u);
          route += arc(ret, Math.max(u, 0.01));
        }
      }
    }
    $('team').setAttribute('transform', `translate(${pos[0].toFixed(1)} ${pos[1].toFixed(1)})`);
    const rt = $('route');
    rt.setAttribute('d', route);
    rt.setAttribute('stroke', color);
    $('banner').classList.toggle('show', showBanner);
  }

  // ====================================================
  //  Phones
  // ====================================================
  function phoneHTML(S, names) {
    const head = `<div class="mini">${caseHTML(S)}${pipsHTML(S)}</div>`;
    const me = myID;
    const holderName = S.holder ? nm(names, S.holder) : '…';

    if (S.phase === 'gameover') return overHTML(S);

    if (S.phase === 'result' && S.result) {
      const r = S.result;
      const icon = r.catch ? '🚔' : r.ok ? '✅' : '❌';
      const title = r.catch ? `${esc(S.villain.name)} is caught!`
        : r.ok ? `${esc(r.to.name)}: ${r.first ? 'first try!' : 'found a lead!'}`
        : `${esc(r.to.name)}: wrong way!`;
      const sub = r.ok && !r.catch ? 'Next clue coming up…' : r.ok ? '' : 'Back to the clue…';
      return head + `<div class="result"><div class="icon">${icon}</div><h2 class="${r.ok ? 'good' : 'bad'}">${title}</h2>
        <p class="line">${esc(r.line)}</p><p class="dim">${sub}</p></div>`;
    }

    const key = qkey(S);
    if (key !== selKey) { selKey = key; sel = null; }
    const banner = S.final ? `<div class="finalbadge">🚨 FINAL CHASE: ${esc(S.villain.name)} is cornered somewhere!</div>` : '';
    const clue = `<div class="clue"><b>${S.final ? 'FINAL CLUE' : 'THE CLUE'}</b>${esc(S.clue)}</div>`;
    const isHolder = me !== null && me === S.holder;

    if (isHolder) {
      const opts = S.options.map((o, i) => {
        const n = S.votes.by[i].length;
        return `<button class="opt${o.out ? ' out' : ''}${sel === i ? ' sel' : ''}" data-sel="${i}">
          <b class="badge" style="background:${COLORS[i]}">${LETTERS[i]}</b><span>${esc(o.name)}</span>
          <span class="cnt">${n ? '🗳️ ' + n : ''}</span>
          <span class="who">${whoHTML(S, names, i)}</span></button>`;
      }).join('');
      const pick = sel !== null ? S.options[sel] : null;
      const done = !!intent && intent.name === 'choose';
      return head + banner + `<div class="turn">🎯 It’s your call!</div>
        <p class="dim">${S.votes.needed ? `${S.votes.voted} of ${S.votes.needed} teammates have voted. ` : ''}Tap a place, then send the team.</p>
        ${clue}<div class="opts">${opts}</div>
        <button class="big" data-go ${pick && !done ? '' : 'disabled'}>${done ? 'Sending…' : pick ? '🛫 Fly to ' + esc(pick.name) : 'Pick a place'}</button>
        ${S.present.length > 1 ? '<p><button class="secondary" data-pass>Pass the turn</button></p>' : ''}`;
    }

    // everybody else votes
    const opts = S.options.map((o, i) => {
      const n = S.votes.by[i].length;
      return `<button class="opt${o.out ? ' out' : ''}${S.votes.mine === i ? ' mine' : ''}" data-vote="${i}">
        <b class="badge" style="background:${COLORS[i]}">${LETTERS[i]}</b><span>${esc(o.name)}</span>
        <span class="cnt">${S.votes.mine === i ? '✓ ' : ''}${n || ''}</span>
        <span class="who">${whoHTML(S, names, i)}</span></button>`;
    }).join('');
    return head + banner + `<div class="waiting">${S.holderAway ? `${holderName} seems to be away…` : `🎯 <span class="gold">${holderName}</span> makes the call. Vote to help them!`}</div>
      ${clue}<div class="opts">${opts}</div>
      <p class="dim">${S.votes.mine === null ? 'Tap a place to cast your vote.' : 'Vote cast. You can change it any time.'}</p>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !last || last.view !== 'player' || b.disabled) return;
    const S = last.state.G;
    if (b.dataset.vote !== undefined) {
      const i = Number(b.dataset.vote);
      want('vote', [i], (T) => T.votes.mine === i);
    } else if (b.dataset.sel !== undefined) { sel = Number(b.dataset.sel); render(last); }
    else if (b.dataset.go !== undefined && sel !== null) {
      want('choose', [sel], () => false);
      render(last);
    } else if (b.dataset.pass !== undefined) {
      const h = S.holder;
      want('pass', [], (T) => T.holder !== h);
    }
  });

  // ====================================================
  //  Main
  // ====================================================
  function render(msg) {
    last = msg;
    const S = msg.state.G;
    track(S);
    if (msg.view === 'player') {
      pump();
      myID = msg.playerID;
      if (!greeted) { greeted = true; send('here'); }
      if (layoutKey !== 'phone') { layoutKey = 'phone'; root.innerHTML = ''; root.__h = null; }
      put(root, phoneHTML(S, msg.names));
    } else {
      greeted = false; // report in again when this phone goes back to its own screen
      renderTV(msg);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const msg = e.data;
    if (msg && msg.type === 'state' && msg.state && msg.state.G) render(msg);
  });

  // Heartbeat and nudges: the server only moves on when a phone asks it to
  setInterval(() => {
    if (!last || last.view !== 'player' || last.state.G.phase === 'gameover') return;
    send('here');
  }, 6000);

  setInterval(() => {
    if (!last || last.view !== 'player') return;
    pump();
    const S = last.state.G;
    if (S.phase === 'gameover' || Date.now() < nudgeAt) return;
    if (S.holderAway) { if (!awayAt) awayAt = Date.now(); } else awayAt = 0;
    const slot = Math.max(0, S.present.indexOf(myID)) * 300;
    if (S.phase === 'result' && S.result && started[S.result.id] !== undefined &&
        Date.now() - started[S.result.id] >= S.result.total + slot) {
      nudgeAt = Date.now() + 2500;
      send('next', S.result.id);
    } else if (S.phase === 'clue' && S.holderAway && myID !== S.holder && S.present.includes(myID) &&
               awayAt && Date.now() - awayAt >= slot) {
      nudgeAt = Date.now() + 2500;
      send('takeTurn');
    }
  }, 400);

  requestAnimationFrame(frame);
  parent.postMessage({ type: 'ready' }, '*');
})();
