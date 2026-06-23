declare module 'ws' {
  import type { WebSocketLikeConstructor } from '@supabase/realtime-js';

  const ws: WebSocketLikeConstructor;
  export default ws;
}
