import ws from 'ws';

export const nodeWebSocketTransport = typeof window === 'undefined' ? ws : undefined;
