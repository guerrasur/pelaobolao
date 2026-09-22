import { millis } from './game.js';

export const REVEAL_SEQUENCE_RULE_VERSION = 5;
export const REVEAL_SUSPENSE_MS = 840;
export const REVEAL_ACTION_MS = 760;

const stagedPhase = game => Boolean(game?.lastResult)
  && ['reveal', 'finished'].includes(game.phase)
  && Number(game.rules?.version ?? 0) >= REVEAL_SEQUENCE_RULE_VERSION;

export function revealStage(game, currentTime = Date.now()) {
  if (!stagedPhase(game)) return 'impact';
  const started = millis(game.phaseStartedAt);
  if (!Number.isFinite(started) || started <= 0) return 'impact';
  const elapsed = Math.max(0, currentTime - started);
  if (elapsed < REVEAL_SUSPENSE_MS) return 'suspense';
  if (elapsed < REVEAL_SUSPENSE_MS + REVEAL_ACTION_MS) return 'actions';
  return 'impact';
}

export function revealCountdown(game, currentTime = Date.now()) {
  if (revealStage(game, currentTime) !== 'suspense') return null;
  const started = millis(game.phaseStartedAt);
  const elapsed = Math.max(0, currentTime - started);
  const slice = REVEAL_SUSPENSE_MS / 3;
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
