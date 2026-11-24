import fs from 'node:fs';
import { game, config, GOAL, PLACES, QUESTIONS, VILLAINS, ITEMS } from './server.js';
import { WITNESS, TAUNTS, CATCH } from './bank.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};
const REJECT = 'INVALID_MOVE';
const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

function newGame(n = 16) {
  const ctx = { numPlayers: n, currentPlayer: '0' };
  const G = game.setup({ ctx, random });
  const g = {
    G,
    play: (name, id, ...args) => game.moves[name].move({ G, ctx, playerID: id, random }, ...args),
    view: (id) => game.playerView({ G, ctx, playerID: id }),
    over: () => game.endIf({ G, ctx }),
    // pretend the result has been on screen long enough
    wait: () => { G.result.at = Date.now() - 60000; },
    next: (id = '0') => { g.wait(); return g.play('next', id, G.result.id); },
    right: () => G.q.correct,
    wrong: () => [0, 1, 2, 3].find((i) => i !== G.q.correct && !G.out.includes(i)),
  };
  return g;
}

// ---- The content bank ----
{
  const ids = Object.keys(PLACES);
  check('there are plenty of places', ids.length >= 120);
  check('every place has a name and sane coordinates',
    ids.every((id) => { const [n, la, lo] = PLACES[id]; return n && la >= -60 && la <= 85 && lo >= -180 && lo <= 180; }));
  check('there are plenty of questions', QUESTIONS.length >= 100);
  check('every question has 4 different, known places and a clue',
    QUESTIONS.every((q) => q.length === 5 && new Set(q.slice(0, 4)).size === 4 &&
      q.slice(0, 4).every((id) => PLACES[id]) && typeof q[4] === 'string' && q[4].length > 15));
  const answers = QUESTIONS.map((q) => q[0]);
  check('no place is the right answer twice', new Set(answers).size === answers.length);
  check('the clue never names the answer outright',
    QUESTIONS.every((q) => !q[4].toLowerCase().includes(PLACES[q[0]][0].split(',')[0].toLowerCase())));
  check('the villains are unique and each has an avatar',
    new Set(VILLAINS.map((v) => v.id)).size === VILLAINS.length && VILLAINS.length >= 10 &&
    VILLAINS.every((v) => fs.existsSync(`./public/villains/${v.id}.jpg`) && /^#[0-9a-f]{6}$/i.test(v.color)));
  check('there are stolen items and flavor lines', ITEMS.length >= 10 && WITNESS.length && TAUNTS.length && CATCH.length);
}

// ---- Setup ----
{
  const g = newGame();
  check('16 seats, started with nobody present yet', game.minPlayers === 16 && game.maxPlayers === 16 && g.G.holder === null);
  check('the team starts at headquarters with four options',
    g.view('0').options.length === 4 && g.view(null).at.name.includes('Washington'));
  check('nobody present at first', g.view(null).present.length === 0);
  g.play('here', '3');
  check('the first player to show up gets the turn', g.G.holder === '3' && g.view('3').role === 'holder');
  g.play('here', '5');
  check('later players are voters, the TV is a spectator',
    g.G.holder === '3' && g.view('5').role === 'voter' && g.view(null).role === 'spectator');
  check('a spectator cannot report in', g.play('here', null) === REJECT);
  check('a seat that does not exist cannot report in', g.play('here', '16') === REJECT);
}

// ---- Secrets ----
{
  const g = newGame();
  g.play('here', '0');
  const text = ['0', '1', null].map((id) => JSON.stringify(g.view(id)));
  const ans = QUESTIONS[g.G.q.qi][0];
  check('the deck and correct index are never sent',
    text.every((t) => !t.includes('"deck"') && !t.includes('"correct"')));
  check('nothing says which option is right before the team commits',
    ['0', '1', null].every((id) => g.view(id).result === null && !('answer' in g.view(id))));
  check('the options are shuffled across games',
    new Set(Array.from({ length: 40 }, () => newGame().G.q.correct)).size > 1);
  g.play('here', '1');
  g.play('choose', '0', g.wrong());
  const wrongView = JSON.stringify(g.view('1'));
  check('a wrong guess does not reveal the right answer',
    g.view('1').result.ok === false && g.view('1').options.filter((o) => o.out).length === 1 &&
    g.view('1').options.every((o) => !('correct' in o)) && typeof wrongView === 'string' && !!ans);
}

// ---- Voting ----
{
  const g = newGame();
  ['0', '1', '2', '3'].forEach((id) => g.play('here', id));
  check('the holder cannot vote', g.play('vote', '0', 1) === REJECT);
  check('a spectator cannot vote', g.play('vote', null, 1) === REJECT);
  check('bad votes are rejected', g.play('vote', '1', 4) === REJECT && g.play('vote', '1', '2') === REJECT && g.play('vote', '1', -1) === REJECT);
  g.play('vote', '1', 2);
  g.play('vote', '2', 2);
  g.play('vote', '3', 0);
  const v = g.view('0').votes;
  check('votes are tallied live for everyone', v.by[2].length === 2 && v.by[0].length === 1 && v.voted === 3 && v.needed === 3);
  check('everybody sees the same tally', JSON.stringify(g.view(null).votes.by) === JSON.stringify(v.by));
  check('a player sees their own vote', g.view('1').votes.mine === 2 && g.view('0').votes.mine === null);
  g.play('vote', '1', 3);
  check('votes can be changed', g.view('0').votes.by[3].length === 1 && g.view('0').votes.by[2].length === 1);
  check('a voter cannot make the call', g.play('choose', '1', 0) === REJECT);
  check('the holder cannot make a bad call', g.play('choose', '0', 7) === REJECT && g.G.phase === 'clue');
}

// ---- Going to the wrong place ----
{
  const g = newGame();
  ['0', '1', '2'].forEach((id) => g.play('here', id));
  g.play('vote', '1', 0);
  const start = g.G.at;
  const bad = g.wrong();
  g.play('choose', '0', bad);
  check('a wrong call shows a miss and stays put', g.G.phase === 'result' && g.G.result.ok === false && g.G.at === start);
  check('the view says where the team returns to', g.view(null).result.back.name === g.view(null).at.name);
  check('no one can change the result', g.play('choose', '0', g.right()) === REJECT && g.play('vote', '1', 1) === REJECT);
  check('moving on too early is rejected', g.play('next', '1', g.G.result.id) === REJECT);
  check('moving on with the wrong id is rejected', (g.wait(), g.play('next', '1', 99)) === REJECT);
  g.next('1');
  check('the same clue comes back with that place crossed out',
    g.G.phase === 'clue' && g.view(null).options[bad].out === true && g.G.tries === 1 && g.G.misses === 1);
  check('the turn passes to the next player and votes reset', g.G.holder === '1' && Object.keys(g.G.votes).length === 0);
  check('a crossed-out place cannot be chosen or voted for',
    g.play('choose', '1', bad) === REJECT && g.play('vote', '0', bad) === REJECT);
  check('a repeated "next" is ignored', g.play('next', '2', 1) === REJECT);
}

// ---- Going to the right place ----
{
  const g = newGame();
  ['0', '1'].forEach((id) => g.play('here', id));
  const qi = g.G.q.qi;
  const target = g.G.q.opts[g.right()];
  g.play('choose', '0', g.right());
  check('a correct first try counts', g.G.result.ok && g.G.result.first && g.G.firstTry === 1);
  check('the villain’s name is in the witness line', g.G.result.line.includes(VILLAINS[g.G.villain].name));
  g.next('0');
  check('the team moves to the new place', g.G.at === target && g.G.trail.length === 2);
  check('a fresh clue and a fresh set of options', g.G.q.qi !== qi && g.G.phase === 'clue' && g.G.out.length === 0 && g.G.tries === 0);
  check('the next answer is never where we already are', QUESTIONS[g.G.q.qi][0] !== g.G.at);
  check('the turn rotates', g.G.holder === '1');
}

// ---- Not first try: no point, but the chase goes on ----
{
  const g = newGame();
  g.play('here', '0');
  g.play('choose', '0', g.wrong());
  g.next('0');
  g.play('choose', '0', g.right());
  check('a correct answer after a miss does not count as first try', g.G.firstTry === 0 && g.G.result.first === false);
  g.next('0');
  check('but the team still moves on', g.G.stops === 1 && g.G.tries === 0);
}

// ---- Solo play ----
{
  const g = newGame();
  g.play('here', '7');
  check('one player can play alone', g.view('7').votes.needed === 0 && g.view('7').role === 'holder');
  check('a lone player cannot pass to nobody', g.play('pass', '7') === REJECT);
  g.play('choose', '7', g.right());
  g.next('7');
  check('a lone player keeps the turn', g.G.holder === '7' && g.G.phase === 'clue');
}

// ---- Players coming and going ----
{
  const g = newGame();
  g.play('here', '0');
  g.play('here', '1');
  g.play('here', '2');
  check('a voter cannot pass the turn', g.play('pass', '1') === REJECT);
  g.play('pass', '0');
  check('the holder can pass the turn', g.G.holder === '1');
  check('passing does not end the question', g.G.phase === 'clue');
  check('nobody can take over from a present holder', g.play('takeTurn', '2') === REJECT);
  g.G.seen['1'] = Date.now() - config.presenceMs - 1000; // seat 1 wanders off
  check('the TV notices who is away', g.view(null).holderAway === true && !g.view(null).present.includes('1'));
  check('the holder cannot take over from themselves', g.play('takeTurn', '1') === REJECT);
  g.G.seen['1'] = Date.now() - config.presenceMs - 1000; // (that call proved seat 1 alive, so wander off again)
  g.play('takeTurn', '2');
  check('someone takes over from an absent holder', g.G.holder === '2' || g.G.holder === '0');
  g.G.seen['1'] = Date.now(); // seat 1 comes back
  g.G.seen['0'] = Date.now() - config.presenceMs - 1000; // seat 0 leaves
  g.G.seen['2'] = Date.now();
  g.play('choose', g.G.holder, g.right());
  g.next(g.G.holder);
  check('an absent player is skipped in the rotation', g.G.holder !== '0');
  g.play('here', '9');
  check('someone can join in the middle of a game', g.view('9').role === 'voter' && g.view(null).present.includes('9'));
  g.play('vote', '9', 1);
  check('and vote straight away', g.view(null).votes.by.flat().includes('9'));
  g.G.seen['9'] = Date.now() - config.presenceMs - 1000;
  check('a player who left no longer counts in the tally', !g.view(null).votes.by.flat().includes('9'));
}

// ---- A whole game ----
{
  const g = newGame();
  ['0', '1', '2', '3'].forEach((id) => g.play('here', id));
  for (let i = 0; i < GOAL; i++) {
    check(`stop ${i + 1} is a normal stop`, !g.G.final);
    g.play('choose', g.G.holder, g.right());
    g.next(g.G.holder);
  }
  check('after 10 first-try stops the final chase starts', g.G.firstTry === GOAL && g.G.final === true);
  check('the TV is told it is the final chase', g.view(null).final === true);
  g.play('choose', g.G.holder, g.wrong());
  g.next(g.G.holder);
  check('missing during the final chase does not lose progress', g.G.firstTry === GOAL && g.G.final && g.G.phase === 'clue');
  g.play('choose', g.G.holder, g.right());
  check('the right place in the final chase catches the villain', g.G.result.catch === true && g.G.phase === 'result');
  check('the catch is not counted as a first-try stop', g.G.firstTry === GOAL);
  g.next(g.G.holder);
  check('the game is over and the villain is caught', g.G.phase === 'gameover' && g.over() && g.over().caught === true);
  check('stats are kept', g.over().misses === 1 && g.over().firstTry === GOAL);
}

// ---- Misses in the middle of the game still need 10 first tries ----
{
  const g = newGame();
  g.play('here', '0');
  for (let i = 0; i < 4; i++) {
    g.play('choose', '0', g.wrong());
    g.next('0');
    g.play('choose', '0', g.right());
    g.next('0');
  }
  check('four fumbled stops give no first-try progress', g.G.firstTry === 0 && g.G.misses === 4 && !g.G.final);
}

// ---- The deck never runs out ----
{
  const g = newGame();
  g.play('here', '0');
  let seenAll = new Set();
  for (let i = 0; i < QUESTIONS.length + 10; i++) {
    seenAll.add(g.G.q.qi);
    g.play('choose', '0', g.right());
    g.next('0');
    if (g.G.phase === 'gameover') break;
    g.G.firstTry = 0; // keep going past the end
    g.G.final = false;
  }
  check('the chase keeps finding new questions', seenAll.size > 50);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
