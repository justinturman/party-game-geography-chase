import { PLACES, QUESTIONS, VILLAINS, ITEMS, WITNESS, TAUNTS, CATCH } from './bank.js';

export { PLACES, QUESTIONS, VILLAINS, ITEMS };

const INVALID = 'INVALID_MOVE';

// Timings (tests shorten these)
export const config = {
  resultOkMs: 6500, // how long a correct arrival is shown
  resultMissMs: 8500, // a wrong turn: fly there, shrug, fly back
  presenceMs: 25000, // a phone not heard from for this long counts as away
};

export const GOAL = 10; // first-try stops needed before the final chase
const HQ = 'dc'; // where the team starts

// ---------- helpers ----------
const isSeat = (ctx, id) =>
  typeof id === 'string' && /^\d+$/.test(id) && Number(id) < ctx.numPlayers;

const place = (id) => ({ name: PLACES[id][0], lat: PLACES[id][1], lon: PLACES[id][2] });
const fill = (line, G) => line.replace(/\{v\}/g, VILLAINS[G.villain].name);

// Seats we have heard from lately, in the order they first showed up
const presentIds = (G) => {
  const now = Date.now();
  return G.order.filter((id) => now - (G.seen[id] || 0) < config.presenceMs);
};

// The next present player after `after` (wrapping around)
function nextHolder(G, after) {
  const here = presentIds(G);
  if (here.length === 0) return null;
  const start = G.order.indexOf(after);
  for (let k = 1; k <= G.order.length; k++) {
    const id = G.order[(start + k) % G.order.length];
    if (here.includes(id)) return id;
  }
  return here[0];
}

function rotate(G) {
  G.holder = nextHolder(G, G.holder);
  if (G.holder !== null) delete G.votes[G.holder];
}

// Every move calls this: records that the seat is alive, and
// hands the very first player the turn.
function touch(G, ctx, id) {
  if (!isSeat(ctx, id)) return false;
  G.seen[id] = Date.now();
  if (!G.order.includes(id)) G.order.push(id);
  if (G.holder === null) {
    G.holder = id;
    delete G.votes[id];
  }
  return true;
}

function newQuestion(G, random) {
  let qi;
  do {
    if (G.deck.length === 0) G.deck = random.Shuffle(QUESTIONS.map((_, i) => i));
    qi = G.deck.pop();
  } while (QUESTIONS[qi][0] === G.at);
  const q = QUESTIONS[qi];
  const opts = random.Shuffle([q[0], q[1], q[2], q[3]]);
  G.q = { qi, opts, correct: opts.indexOf(q[0]) };
  G.out = [];
  G.votes = {};
  G.tries = 0;
  G.final = G.firstTry >= GOAL;
  G.phase = 'clue';
}

const validPick = (G, idx) =>
  Number.isInteger(idx) && idx >= 0 && idx < 4 && !G.out.includes(idx);

// ---------- the game ----------
export const game = {
  name: 'geography-chase',
  minPlayers: 16, // seats are created up front; people simply fill them
  maxPlayers: 16, // as they join (the platform's "Start" button, openJoin)

  setup: ({ random }) => {
    const G = {
      phase: 'clue', // clue -> result -> clue ... -> gameover
      villain: random.Shuffle(VILLAINS.map((_, i) => i))[0],
      item: random.Shuffle(ITEMS.map((_, i) => i))[0],
      order: [], // seats in the order they first reported in
      seen: {}, // seat -> last time we heard from it
      holder: null, // whose turn it is to decide
      at: HQ,
      trail: [HQ],
      firstTry: 0,
      stops: 0,
      misses: 0,
      attempts: 0,
      tries: 0,
      deck: random.Shuffle(QUESTIONS.map((_, i) => i)),
      q: null,
      out: [],
      votes: {},
      final: false,
      result: null,
    };
    newQuestion(G, random);
    return G;
  },

  turn: { activePlayers: { all: null } },

  moves: {
    // Heartbeat: "this phone is still here"
    here: {
      client: false,
      move: ({ G, ctx, playerID }) => {
        if (!touch(G, ctx, playerID)) return INVALID;
      },
    },

    // Everyone except the holder votes. Votes can be changed freely.
    vote: {
      client: false,
      move: ({ G, ctx, playerID }, idx) => {
        if (G.phase !== 'clue' || !touch(G, ctx, playerID)) return INVALID;
        if (playerID === G.holder || !validPick(G, idx)) return INVALID;
        G.votes[playerID] = idx;
      },
    },

    // The holder makes the call
    choose: {
      client: false,
      move: ({ G, ctx, playerID }, idx) => {
        if (G.phase !== 'clue' || !touch(G, ctx, playerID)) return INVALID;
        if (playerID !== G.holder || !validPick(G, idx)) return INVALID;
        const ok = idx === G.q.correct;
        G.attempts += 1;
        const r = {
          id: G.attempts,
          ok,
          pick: idx,
          from: G.at,
          to: G.q.opts[idx],
          at: Date.now(),
          first: false,
          catch: false,
          line: '',
        };
        if (ok) {
          G.stops += 1;
          if (G.final) {
            r.catch = true;
            r.line = fill(CATCH[G.attempts % CATCH.length], G);
          } else {
            if (G.tries === 0) {
              G.firstTry += 1;
              r.first = true;
            }
            r.line = fill(WITNESS[G.attempts % WITNESS.length], G);
          }
        } else {
          G.misses += 1;
          G.tries += 1;
          G.out.push(idx);
          r.line = fill(TAUNTS[G.attempts % TAUNTS.length], G);
        }
        G.result = r;
        G.phase = 'result';
      },
    },

    // Move on once the result has been shown. Anyone can do this,
    // so a missing holder never stalls the game.
    next: {
      client: false,
      move: ({ G, ctx, random, playerID }, id) => {
        if (G.phase !== 'result' || !touch(G, ctx, playerID)) return INVALID;
        const r = G.result;
        if (id !== r.id) return INVALID;
        const need = r.ok ? config.resultOkMs : config.resultMissMs;
        if (Date.now() - r.at < need) return INVALID;
        if (r.ok) {
          G.at = r.to;
          G.trail = [...G.trail, r.to].slice(-12);
          if (r.catch) {
            G.phase = 'gameover';
            return;
          }
          newQuestion(G, random);
        } else {
          G.votes = {};
          G.phase = 'clue';
        }
        rotate(G);
      },
    },

    // The holder hands the turn to the next player
    pass: {
      client: false,
      move: ({ G, ctx, playerID }) => {
        if (G.phase !== 'clue' || !touch(G, ctx, playerID)) return INVALID;
        if (playerID !== G.holder || presentIds(G).length < 2) return INVALID;
        rotate(G);
      },
    },

    // Anyone can take over when the holder has wandered off
    takeTurn: {
      client: false,
      move: ({ G, ctx, playerID }) => {
        if (G.phase !== 'clue' || !touch(G, ctx, playerID)) return INVALID;
        if (playerID === G.holder) return INVALID;
        const away = Date.now() - (G.seen[G.holder] || 0) >= config.presenceMs;
        if (!away) return INVALID;
        rotate(G);
      },
    },
  },

  endIf: ({ G }) =>
    G.phase === 'gameover'
      ? { caught: true, firstTry: G.firstTry, misses: G.misses }
      : undefined,

  // What each screen is allowed to know. The right answer is never sent
  // until the team has actually gone there.
  playerView: ({ G, playerID }) => {
    const here = presentIds(G);
    const v = VILLAINS[G.villain];
    const voters = here.filter((id) => id !== G.holder);
    const by = [0, 1, 2, 3].map((i) => voters.filter((id) => G.votes[id] === i));
    let result = null;
    if (G.phase === 'result' && G.result) {
      const r = G.result;
      const total = r.ok ? config.resultOkMs : config.resultMissMs;
      const elapsed = Date.now() - r.at;
      result = {
        id: r.id,
        ok: r.ok,
        pick: r.pick,
        first: r.first,
        catch: r.catch,
        line: r.line,
        from: place(r.from),
        to: place(r.to),
        back: r.ok ? null : place(G.at),
        total,
        elapsed,
        left: Math.max(0, total - elapsed),
      };
    }
    return {
      phase: G.phase,
      role: playerID === null || playerID === undefined ? 'spectator' : playerID === G.holder ? 'holder' : 'voter',
      holder: G.holder,
      holderAway: G.holder !== null && !here.includes(G.holder),
      present: here,
      goal: GOAL,
      villain: { id: v.id, name: v.name, tagline: v.tagline, color: v.color },
      item: ITEMS[G.item],
      firstTry: G.firstTry,
      misses: G.misses,
      stops: G.stops,
      tries: G.tries,
      final: G.final,
      at: place(G.at),
      trail: G.trail.map(place),
      clue: QUESTIONS[G.q.qi][4],
      options: G.q.opts.map((id, i) => ({ ...place(id), out: G.out.includes(i) })),
      votes: {
        by,
        mine: playerID != null && G.votes[playerID] !== undefined ? G.votes[playerID] : null,
        voted: voters.filter((id) => G.votes[id] !== undefined).length,
        needed: voters.length,
      },
      result,
    };
  },
};
