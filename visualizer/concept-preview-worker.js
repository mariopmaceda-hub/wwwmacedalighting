// Paint with the exact deployed v1 server compositor; never regenerate geometry.
import { compositeRGBA } from '../supabase/functions/_shared/compositor.mjs';

let source, width, height, sourceId;
self.onmessage = ({ data }) => {
  if (data.type === 'photo') {
    ({ width, height, sourceId } = data);
    source = new Uint8Array(data.pixels);
    return;
  }
  try {
    if (!source || data.sourceId !== sourceId) throw Error('Photo is not ready.');
    const { pixels } = compositeRGBA(source, width, height, data.snapshot);
    self.postMessage({ id: data.id, sourceId, width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch {
    self.postMessage({ id: data.id, sourceId, error: true });
  }
};
