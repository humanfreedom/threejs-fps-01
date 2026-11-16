// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// alive counts, kill feed, minimap, buy menu, banners and the overlay panels.
// It never touches the simulation; main.js and match.js push numbers in and
// read the play and buy callbacks out. Every setter caches its last value so
// the DOM is only touched when something changes.
import { WEAPONS, GRENADE } from './weapons.js';

const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Yard 7. Five against five. Plant the spike at A or B, or wipe the Ravens out. First to 7 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your squad is still fighting. You return next round.',
    action: 'Keep watching',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

// Minimap walls, in map metres (x -24..24, z -20..20), drawn as rects.
const MAP_WALLS = [
  [-24.2, -20.2, 48.4, 0.4], [-24.2, 20.2, 48.4, 0.4],
  [-24.2, -20.2, 0.4, 40.4], [24.2, -20.2, 0.4, 40.4],
  [-24, -2.3, 16, 0.6], [8, -2.3, 16, 0.6],
  [-8.3, 0, 0.6, 12], [8.3, 0, 0.6, 12],
  [-21.8, -15.5, 0.6, 9], [-21.5, -15.8, 8, 0.6],
];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreV = $('score-v');
  const scoreR = $('score-r');
  const aliveV = $('alive-v');
  const aliveR = $('alive-r');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const spikeBar = $('spike-bar');
  const spikeLabel = $('spike-label');
  const spikeFill = $('spike-fill');
  const damage = $('damage');
  const crosshair = $('crosshair');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');
  const hitmarker = $('hitmarker');
  const roundLabel = $('round-label');
  const scope = $('scope');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyHandler = null;
  let playHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function mm(x, z) {
    return [(x + 24) / 48 * 168 + 4, (z + 20) / 40 * 140 + 4];
  }

  return {
    setHealth(hp, armor) {
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hp !== pct) {
        last.hp = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 25);
      }
      setText(healthValue, 'hpText', String(Math.ceil(pct)));
      setText(armorValue, 'armor', armor ? 'ARMOR' : '');
    },
    setAmmo(mag, reserve, grenades, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      setText(grenadeCount, 'nades', grenades > 0 ? `◉ ${grenades}` : '');
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setScore(v, r) {
      setText(scoreV, 'sv', String(v));
      setText(scoreR, 'sr', String(r));
    },
    setRound(n) {
      setText(roundLabel, 'round', `ROUND ${n}`);
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${Math.max(0, seconds)}` : phase === 'live' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('buy', phase === 'buy');
    },
    setAlive(v, r) {
      setText(aliveV, 'av', `${v} alive`);
      setText(aliveR, 'ar', `${r} alive`);
    },
    setCrosshair(spread) {
      const gap = 4 + Math.min(26, spread * 900);
      crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    setScope(scoped) {
      scope.hidden = !scoped;
      crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 140);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 6000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showBuy(money, owned, armor, grenades) {
      buyMenu.hidden = false;
      setText(buyMoney, 'buyMoney', `$${money}`);
      buyItems.innerHTML = '';
      const rows = [];
      for (const def of Object.values(WEAPONS)) {
        rows.push({ id: def.id, label: `${def.slot} · ${def.name}`, price: def.price, owned: owned.has(def.id) });
      }
      rows.push({ id: 'armor', label: `5 · Kevlar Armor`, price: 650, owned: armor });
      rows.push({ id: 'grenade', label: `6 · Frag Grenade ×${grenades}`, price: GRENADE.price, owned: false });
      for (const row of rows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = row.owned;
        button.innerHTML = `<span>${row.label}</span><b>${row.owned ? 'OWNED' : row.price === 0 ? 'FREE' : '$' + row.price}</b>`;
        button.addEventListener('click', () => { if (buyHandler) buyHandler(row.id); });
        buyItems.appendChild(button);
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    onBuyClose(handler) {
      $('buy-close').addEventListener('click', handler);
    },
    refreshBuy(money, owned, armor, grenades) {
      if (!buyMenu.hidden) this.showBuy(money, owned, armor, grenades);
    },
    onBuy(handler) { buyHandler = handler; },
    setPlantProgress(progress) {
      if (progress > 0 && progress < 1) {
        spikeBar.hidden = false;
        spikeLabel.textContent = 'PLANTING';
        spikeFill.style.width = `${Math.round(progress * 100)}%`;
      } else {
        spikeBar.hidden = true;
      }
    },
    setDefuseProgress(progress) {
      if (progress > 0 && progress < 1) {
        spikeBar.hidden = false;
        spikeLabel.textContent = 'DEFUSING';
        spikeFill.style.width = `${Math.round(progress * 100)}%`;
      } else {
        spikeBar.hidden = true;
      }
    },
    showSpike(site, seconds) {
      spikeBar.hidden = false;
      spikeLabel.textContent = `SPIKE AT ${site} — ${Math.ceil(seconds)}s`;
      spikeFill.style.width = '100%';
    },
    hideSpike() {
      spikeBar.hidden = true;
    },
    drawMinimap(playerPos, yaw, bots) {
      const ctx = mapCtx;
      ctx.clearRect(0, 0, 176, 148);
      ctx.fillStyle = '#1e2228';
      ctx.fillRect(0, 0, 176, 148);
      ctx.fillStyle = '#2c323a';
      for (const [x, z, w, d] of MAP_WALLS) {
        const [px, pz] = mm(x, z);
        ctx.fillRect(px, pz, Math.max(1, w / 48 * 168), Math.max(1, d / 40 * 140));
      }
      ctx.fillStyle = '#f0a830';
      ctx.font = 'bold 11px system-ui, sans-serif';
      const [ax, az] = mm(-17, -11);
      const [bx, bz] = mm(17, -11);
      ctx.fillText('A', ax - 4, az + 4);
      ctx.fillText('B', bx - 4, bz + 4);
      for (const bot of bots) {
        if (!bot.alive) continue;
        const [x, y] = mm(bot.position.x, bot.position.z);
        ctx.fillStyle = bot.team === 'vanguard' ? '#4aa3c7' : '#d96a4a';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const [px, py] = mm(playerPos.x, playerPos.z);
      ctx.fillStyle = '#e9e6df';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e9e6df';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.sin(yaw) * 10, py - Math.cos(yaw) * 10);
      ctx.stroke();
    },
    showOverlay(mode, detail = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundEnd' || mode === 'matchEnd' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playHandler = handler;
      play.addEventListener('click', () => playHandler && playHandler());
    },
  };
}
