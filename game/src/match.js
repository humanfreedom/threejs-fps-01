// The match: rounds, money, the buy menu's prices, and the spike objective.
// One place owns the score, the timers and the economy; main.js owns the
// shooting and asks this module who won and what the player can afford.
// First to 7 rounds takes the match.
import { WEAPONS, GRENADE } from './weapons.js';

export const FIRST_TO = 7;
const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const SPIKE_SECONDS = 35;
const ROUND_END_SECONDS = 4;
const ARMOR_PRICE = 650;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_BONUS = [1900, 2400, 2900, 3400];
const PLANT_REWARD = 300;

export function createMatch(hooks) {
  const state = {
    phase: 'buy',
    round: 1,
    score: { vanguard: 0, raven: 0 },
    money: 800,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    timer: BUY_SECONDS,
    roundEndLeft: 0,
    spikePlanted: false,
    spikeSite: null,
    spikeTimer: 0,
    spikeTickAt: 0,
    plantProgress: 0,
    plantAt: 0,
    defuseProgress: 0,
    defuseAt: 0,
    armor: false,
    winner: null,
    reason: '',
    targetSite: 'A',
  };

  function setTimer() {
    hooks.onTimer(Math.ceil(state.timer), state.phase);
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.spikePlanted = false;
    state.spikeSite = null;
    state.spikeTimer = 0;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    hooks.onBuyStart(state.round, state.money);
    hooks.onMoney(state.money);
    setTimer();
  }

  function startLive() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
    hooks.onRoundStart(state.round, state.targetSite);
    setTimer();
  }

  function awardRound(winner, reason) {
    state.phase = 'roundEnd';
    state.roundEndLeft = ROUND_END_SECONDS;
    state.winner = winner;
    state.reason = reason;
    if (winner === 'vanguard') {
      state.score.vanguard += 1;
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.score.raven += 1;
      state.money += LOSS_BONUS[Math.min(state.lossStreak, 3)];
      state.lossStreak += 1;
    }
    hooks.onScore(state.score.vanguard, state.score.raven);
    hooks.onMoney(state.money);
    hooks.onRoundEnd(winner, reason, state.score.vanguard, state.score.raven);
    if (winner === 'vanguard') hooks.onRoundWinSound();
    else hooks.onRoundLoseSound();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const winner = state.score.vanguard >= FIRST_TO ? 'vanguard' : 'raven';
    hooks.onMatchEnd(winner, state.score.vanguard, state.score.raven);
  }

  return {
    state,
    startMatch() {
      state.round = 1;
      state.score.vanguard = 0;
      state.score.raven = 0;
      state.money = 800;
      state.lossStreak = 0;
      state.kills = 0;
      state.deaths = 0;
      state.armor = false;
      startRound();
    },
    setTargetSite(site) {
      state.targetSite = site;
    },
    step(dt, now) {
      if (state.phase === 'buy') {
        state.timer -= dt;
        setTimer();
        if (state.timer <= 0) startLive();
      } else if (state.phase === 'live') {
        state.timer -= dt;
        if (state.spikePlanted) {
          state.spikeTimer -= dt;
          if (state.spikeTimer <= state.spikeTickAt) {
            state.spikeTickAt = state.spikeTimer - Math.max(0.25, state.spikeTimer / 8);
            hooks.onSpikeTick(state.spikeTimer);
          }
          if (state.spikeTimer <= 0) {
            hooks.onSpikeExploded(state.spikeSite);
            awardRound('vanguard', 'Spike detonated');
            return;
          }
        }
        if (now - state.plantAt > 0.5 && state.plantProgress > 0) {
          state.plantProgress = 0;
          hooks.onPlantProgress(0);
        }
        if (now - state.defuseAt > 0.5 && state.defuseProgress > 0) {
          state.defuseProgress = 0;
          hooks.onDefuseProgress(0);
        }
        setTimer();
        if (state.timer <= 0 && !state.spikePlanted) awardRound('raven', 'Time expired — site held');
      } else if (state.phase === 'roundEnd') {
        state.roundEndLeft -= dt;
        if (state.roundEndLeft <= 0) {
          if (state.score.vanguard >= FIRST_TO || state.score.raven >= FIRST_TO) endMatch();
          else {
            state.round += 1;
            state.timer = BUY_SECONDS;
            startRound();
          }
        }
      }
    },
    // Called by main.js when the round's end condition is met by elimination.
    checkElimination(vanguardAlive, ravenAlive) {
      if (state.phase !== 'live') return;
      if (state.spikePlanted) {
        if (!vanguardAlive) return; // spike still ticks; defenders must defuse
        if (!ravenAlive) return; // nobody left to defuse; spike decides
        return;
      }
      if (!ravenAlive) awardRound('vanguard', 'Enemy team eliminated');
      else if (!vanguardAlive) awardRound('raven', 'Your team was eliminated');
    },
    onKill(killerName, killerTeam, victimName, headshot, byPlayer) {
      if (byPlayer) {
        state.kills += 1;
        state.money += KILL_REWARD;
        hooks.onMoney(state.money);
      }
      hooks.onKillFeed(`${killerName} ▸ ${victimName}${headshot ? ' · headshot' : ''}`);
    },
    onPlayerDeath() {
      state.deaths += 1;
    },
    onPlantProgress(progress, now) {
      state.plantProgress = progress;
      state.plantAt = now;
      hooks.onPlantProgress(progress);
    },
    onPlanted(site, byPlayer) {
      state.spikePlanted = true;
      state.spikeSite = site;
      state.spikeTimer = SPIKE_SECONDS;
      state.spikeTickAt = SPIKE_SECONDS - 1;
      state.plantProgress = 0;
      hooks.onPlantProgress(0);
      hooks.onSpikePlanted(site);
      if (byPlayer) {
        state.money += PLANT_REWARD;
        hooks.onMoney(state.money);
      }
    },
    onDefuseProgress(progress, now) {
      state.defuseProgress = progress;
      state.defuseAt = now;
      hooks.onDefuseProgress(progress);
    },
    onDefused() {
      state.spikePlanted = false;
      state.defuseProgress = 0;
      hooks.onDefuseProgress(0);
      hooks.onSpikeDefused();
      awardRound('raven', 'Spike defused');
    },
    buyWeapon(id) {
      const def = WEAPONS[id];
      if (!def || state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
      if (state.money < def.price) return { ok: false, reason: 'Not enough money' };
      state.money -= def.price;
      hooks.onMoney(state.money);
      hooks.onBuySound();
      return { ok: true };
    },
    buyArmor() {
      if (state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
      if (state.armor) return { ok: false, reason: 'Already armored' };
      if (state.money < ARMOR_PRICE) return { ok: false, reason: 'Not enough money' };
      state.money -= ARMOR_PRICE;
      state.armor = true;
      hooks.onMoney(state.money);
      hooks.onBuySound();
      return { ok: true };
    },
    buyGrenade() {
      if (state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
      if (state.money < GRENADE.price) return { ok: false, reason: 'Not enough money' };
      state.money -= GRENADE.price;
      hooks.onMoney(state.money);
      hooks.onBuySound();
      return { ok: true };
    },
    resetArmor() {
      state.armor = false;
    },
  };
}
