// Single source of truth for socket event names.
// Both client and server import from here (copied into each side to keep deploy simple).
export const EVENTS = {
  // Client -> Server
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  START_GAME: 'start_game',

  // Server -> Client
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  GAME_STARTED: 'game_started',
  ROOM_STATE: 'room_state',
  ERROR: 'error_event',
};

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;