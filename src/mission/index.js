import { MissionTelemetry } from './telemetry.js';
import { OBJECTS } from './dictionary.js';
import { nasaWaypointsProvider } from './nasaWaypoints.js';
import { lightTimeProvider } from './lightTime.js';
import { createHud } from './hud.js';

/** Registra los proveedores (como `openmct.telemetry.addProvider`) y monta el panel. */
export function startMission() {
  const telemetry = new MissionTelemetry();
  telemetry.addProvider(nasaWaypointsProvider);
  telemetry.addProvider(lightTimeProvider);
  const hud = createHud({ telemetry, objects: OBJECTS });
  window.__mission = hud; // depuración y `npm run check`
  return hud;
}
