// Las 4 cámaras de Percy que toman fotos. `piece` es el nombre del nodo en el modelo 3D
// (los que lista la consola con «Piezas que son cámaras»); `id` es la clave en picks.js.
// `offset` (m, en el marco del rover: x izquierda, y arriba, z frente) mueve el punto del centro de la pieza.

export const CAMERAS = [
  {
    id: 'mastcam',
    piece: 'Mastcam_Z_cams',
    name: 'Mastcam-Z',
    side: 'izquierda',
    about: 'Los ojos con zoom del mástil: fotos a color de rocas y paisaje.',
    offset: [0.22, 0.25, 0], // comparte la cabeza del mástil con NavCam: se separan para poder distinguir y clicar cada punto
  },
  {
    id: 'navcam',
    piece: 'NavCams',
    name: 'NavCam',
    side: 'izquierda',
    about: 'Cámaras de navegación del mástil: miran el camino y el brazo.',
    offset: [-0.3, 0.25, 0],
  },
  {
    id: 'hazcam',
    piece: 'hazcams_front',
    name: 'HazCam frontal',
    side: 'izquierda',
    about: 'Vigilan el suelo justo delante: ruedas, brazo y rocas.',
  },
  {
    id: 'watson',
    piece: 'WATSON',
    name: 'WATSON',
    side: null,
    about: 'Cámara macro del brazo: ve la roca a pocos centímetros.',
  },
];

export const cameraLabel = (cam) => (cam.side ? `${cam.name} (${cam.side})` : cam.name);
