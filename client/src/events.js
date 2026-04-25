export const EVENTS = {
  // Client -> Server (gameplay)
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  REJOIN_ROOM: 'rejoin_room',
  SPECTATE_ROOM: 'spectate_room',
  LEAVE_ROOM: 'leave_room',
  START_GAME: 'start_game',
  SUBMIT_MOVE: 'submit_move',
  PASS_TURN: 'pass_turn',
  SWAP_TILES: 'swap_tiles',

  // Client -> Server (matchmaking + friends)
  QUEUE_JOIN: 'queue_join',
  QUEUE_LEAVE: 'queue_leave',
  FRIEND_INVITE_RESPOND: 'friend_invite_respond',
  GAME_INVITE_RESPOND: 'game_invite_respond',

  // Server -> Client
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  SPECTATOR_JOINED: 'spectator_joined',
  SPECTATOR_LEFT: 'spectator_left',
  GAME_STARTED: 'game_started',
  ROOM_STATE: 'room_state',
  RACK_UPDATE: 'rack_update',
  MOVE_APPLIED: 'move_applied',
  MOVE_REJECTED: 'move_rejected',
  TURN_TIMER: 'turn_timer',
  TURN_TIMEOUT: 'turn_timeout',
  GAME_ENDED: 'game_ended',
  ERROR: 'error_event',

  // Server -> Client (matchmaking + friends)
  QUEUE_STATE: 'queue_state',
  QUEUE_MATCHED: 'queue_matched',
  FRIENDS_UPDATE: 'friends_update',
  FRIEND_INVITE_RECEIVED: 'friend_invite_received',
  GAME_INVITE_RECEIVED: 'game_invite_received',
};

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const MAX_SPECTATORS = 20;
export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
export const MAX_CONSECUTIVE_PASSES = 6;

export const TURN_DURATION_MS = 90_000;
export const RECONNECT_GRACE_MS = 2 * 60_000;
export const ROOM_TTL_MS = 60 * 60_000;
export const ROOM_SWEEP_INTERVAL_MS = 60_000;

export const NAME_MAX_LEN = 20;
export const NAME_MIN_LEN = 1;
export const ROOM_CODE_LEN = 6;
export const MAX_PLACEMENTS_PER_MOVE = 7;

// Phase 7
export const QUEUE_TICK_MS = 3_000;            // matchmaker runs every 3s
export const QUEUE_RATING_INITIAL = 100;        // ±100 ELO at enqueue time
export const QUEUE_RATING_GROWTH = 50;          // widen by 50 ELO per tick
export const QUEUE_RATING_MAX = 800;            // hard cap
export const GAME_INVITE_TTL_MS = 5 * 60_000;