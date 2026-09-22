import { millis } from './game.js';

export const REVEAL_SEQUENCE_RULE_VERSION = 5;
export const REVEAL_SUSPENSE_MS = 1500;
export const REVEAL_ACTION_MS = 1200;
export const REVEAL_IMPACT_MS = 1300;

export function revealDurations(game) {
  const total = Math.max(2400, Number(game?.rules?.revealMs) || 3200);
  const version = Number(game?.rules?.version ?? 0);
  if (version >= 6) {
    const suspense = Math.min(REVEAL_SUSPENSE_MS, Math.round(total * .4));
    const actions = Math.min(REVEAL_ACTION_MS, Math.round(total * .3));
    return { suspense, actions, impact: Math.max(500, total - suspense - actions) };
  }
  // v5 matches already in progress keep fitting inside their snapshotted 3.2 s reveal.
  const suspense = Math.min(1050, Math.round(total * .34));
  const actions = Math.min(1050, Math.round(total * .34));
  return { suspense, actions, impact: Math.max(400, total - suspense - actions) };
}

const stagedPhase = game => Boolean(game?.lastResult)
  && ['reveal', 'finished'].includes(game.phase)
  && Number(game.rules?.version ?? 0) >= REVEAL_SEQUENCE_RULE_VERSION;

export function revealStage(game, currentTime = Date.now()) {
  if (!stagedPhase(game)) return 'impact';
  const started = millis(game.phaseStartedAt);
  if (!Number.isFinite(started) || started <= 0) return 'impact';
  const elapsed = Math.max(0, currentTime - started);
  const durations = revealDurations(game);
  if (elapsed < durations.suspense) return 'suspense';
  if (elapsed < durations.suspense + durations.actions) return 'actions';
  return 'impact';
}

export function revealCountdown(game, currentTime = Date.now()) {
  if (revealStage(game, currentTime) !== 'suspense') return null;
  const started = millis(game.phaseStartedAt);
  const elapsed = Math.max(0, currentTime - started);
  const slice = revealDurations(game).suspense / 3;
  return Math.max(1, 3 - Math.floor(elapsed / slice));
}

export function revealViewGame(game, stage = revealStage(game)) {
  if (!game || stage === 'impact' || !game.lastResult) return game;

  const losses = game.lastResult.losses || {};
  const heals = game.lastResult.heals || {};
  const maxHair = Math.max(1, Number(game.rules?.maxHair || 4));
  const players = Object.fromEntries(Object.entries(game.players || {}).map(([uid, player]) => {
    const beforeHair = Number(player.hair || 0) + Number(losses[uid] || 0) - Number(heals[uid] || 0);
    return [uid, { ...player, hair: Math.max(0, Math.min(maxHair, beforeHair)) }];
  }));

  let centerItem = game.centerItem ?? null;
  const item = game.lastResult.item;
  if (!centerItem && item?.kind && ['claimed', 'contested', 'expired'].includes(item.outcome)) {
    centerItem = { kind: item.kind, spawnedTurn: item.spawnedTurn, source: 'reveal' };
  }
  return { ...game, players, centerItem };
}
