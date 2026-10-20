import { CAMERAS } from './cameras.js';
import { createCatalog } from './catalog.js';
import { PICKS } from './picks.js';
import { createHotspots } from './hotspots.js';
import { createViewer } from './viewer.js';

/** Puntos brillantes sobre las 4 cámaras de Percy; un clic abre una foto real de esa cámara. */
export async function startPhotos({ camera, canvas, rover }) {
  try {
    await rover.loaded; // los puntos se colocan sobre las piezas del modelo 3D
    const catalog = createCatalog(PICKS);
    const viewer = createViewer({ catalog, rover });
    const hotspots = createHotspots({ camera, canvas, rover, cameras: CAMERAS, onOpen: viewer.open, blocked: viewer.isOpen });
    // Calienta en segundo plano la primera foto de cada cámara: si la API ya respondió, el clic es inmediato
    CAMERAS.forEach((c) => viewer.warm(c.id, 0));
    const api = {
      update: hotspots.update,
      open: viewer.open,
      close: viewer.close,
      dotScreen: hotspots.dotScreen,
      state: () => ({ ...viewer.state(), ...hotspots.state() }),
    };
    window.__photos = api; // depuración y `npm run check`
    window.__photosReady = true;
    return api;
  } catch (err) {
    console.error('[fotos] no arrancó:', err);
    window.__photosReady = 'error';
    return null;
  }
}
