import { Directory, File, Paths } from 'expo-file-system';
import type { Proyecto } from './tipos';

/**
 * Cada proyecto vive en Documentos/proyectos/<id>/ con su proyecto.json y sus archivos.
 * Se guardan nombres de archivo, no rutas completas: iOS cambia la ruta de Documentos
 * al actualizar la app.
 */
const raiz = () => new Directory(Paths.document, 'proyectos');

export const carpetaDe = (id: string) => new Directory(raiz(), id);

export const uriDe = (proyectoId: string, archivo: string) => new File(carpetaDe(proyectoId), archivo).uri;

let cola: Promise<void> = Promise.resolve();

/**
 * Guarda en un archivo temporal y luego lo pone encima del bueno, para que un cierre a mitad
 * de escritura no deje el proyecto ilegible. Los guardados van en fila para que no se crucen.
 */
export function guardarProyecto(p: Proyecto): Promise<void> {
  const texto = JSON.stringify(p);
  cola = cola
    .catch(() => {})
    .then(async () => {
      const carpeta = carpetaDe(p.id);
      carpeta.create({ intermediates: true, idempotent: true });
      const temporal = new File(carpeta, 'proyecto.json.tmp');
      if (!temporal.exists) temporal.create();
      await temporal.write(texto);
      await temporal.move(new File(carpeta, 'proyecto.json'), { overwrite: true });
    });
  return cola;
}

function leerJson(f: File): Proyecto | null {
  if (!f.exists) return null;
  try {
    return JSON.parse(f.textSync()) as Proyecto;
  } catch {
    return null;
  }
}

export function leerProyecto(id: string): Proyecto | null {
  const carpeta = carpetaDe(id);
  return leerJson(new File(carpeta, 'proyecto.json')) ?? leerJson(new File(carpeta, 'proyecto.json.tmp'));
}

export function listarProyectos(): Proyecto[] {
  const r = raiz();
  if (!r.exists) return [];
  const lista: Proyecto[] = [];
  for (const item of r.list()) {
    if (!(item instanceof Directory)) continue;
    const p = leerProyecto(item.name);
    if (p) lista.push(p);
  }
  return lista.sort((a, b) => b.editado - a.editado);
}

export function borrarProyecto(id: string): void {
  const c = carpetaDe(id);
  if (c.exists) c.delete();
}

/** Copia un archivo elegido (que iOS borra de la caché) a la carpeta del proyecto. */
export async function copiarAlProyecto(proyectoId: string, uriOrigen: string, nombre: string): Promise<void> {
  const carpeta = carpetaDe(proyectoId);
  carpeta.create({ intermediates: true, idempotent: true });
  await new File(uriOrigen).copy(new File(carpeta, nombre), { overwrite: true });
}
