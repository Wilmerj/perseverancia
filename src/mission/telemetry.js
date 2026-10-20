// Mini-versión del patrón de telemetría de Open MCT (src/api/telemetry/TelemetryAPI.js):
//   · un OBJETO DE DOMINIO describe cada dato: identificador, nombre y `telemetry.values`
//     (cada valor con key, nombre, unidad y hints domain/range);
//   · un PROVEEDOR entrega los números: supportsRequest/request para el historial y
//     supportsSubscribe/subscribe para lo que llega en vivo (subscribe devuelve unsubscribe);
//   · la API elige el proveedor que dice soportar el objeto; si hay dos, gana el último registrado.

export class MissionTelemetry {
  #providers = [];

  addProvider(provider) {
    this.#providers.unshift(provider);
  }

  #find(supports, domainObject) {
    return this.#providers.find((p) => p[supports]?.(domainObject));
  }

  /** Proveedor que atiende a este objeto (para mostrar su nombre y su estado). */
  providerFor(domainObject) {
    return this.#find('supportsRequest', domainObject) ?? this.#find('supportsSubscribe', domainObject);
  }

  getMetadata(domainObject) {
    const values = domainObject.telemetry?.values ?? [];
    return {
      values,
      valuesForHints: (hints) => values.filter((v) => hints.every((h) => v.hints?.[h] !== undefined)),
    };
  }

  /** Historial: Promise con un array de datums ordenados por el dominio (sol). */
  request(domainObject, options = {}) {
    const provider = this.#find('supportsRequest', domainObject);
    return provider ? provider.request(domainObject, options) : Promise.resolve([]);
  }

  /** En vivo: llama a callback(datum) con cada dato nuevo. Devuelve la función para dejar de escuchar. */
  subscribe(domainObject, callback, options = {}) {
    const provider = this.#find('supportsSubscribe', domainObject);
    return provider ? provider.subscribe(domainObject, callback, options) : () => {};
  }
}
