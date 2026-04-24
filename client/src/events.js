export const EVENTS = {
  // Client -> Server
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  REJOIN_ROOM: 'rejoin_room',
  LEAVE_ROOM: 'leave_room',
  START_GAME: 'start_game',
  SUBMIT_MOVE: 'submit_move',
  PASS_TURN: 'pass_turn',
  SWAP_TILES: 'swap_tiles',

  // Server -> Client
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  GAME_STARTED: 'game_started',
  ROOM_STATE: 'room_state',
  RACK_UPDATE: 'rack_update',
  MOVE_APPLIED: 'move_applied',
  MOVE_REJECTED: 'move_rejected',
  TURN_TIMER: 'turn_timer',
  TURN_TIMEOUT: 'turn_timeout',
  GAME_ENDED: 'game_ended',
  ERROR: 'error_event',
};

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
export const MAX_CONSECUTIVE_PASSES = 6;

// Phase 3 additions
export const TURN_DURATION_MS = 90_000;          // 90s per turn
export const RECONNECT_GRACE_MS = 2 * 60_000;    // 2 minutes to reconnect
export const ROOM_TTL_MS = 60 * 60_000;          // 1 hour for abandoned rooms
export const ROOM_SWEEP_INTERVAL_MS = 60_000;    // check every minute