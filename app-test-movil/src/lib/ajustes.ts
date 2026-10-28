import * as SecureStore from 'expo-secure-store';

/** La clave de la API de Claude queda en el llavero del iPhone, nunca en el código ni en git. */
const CLAVE = 'claude-api-key';
const IDIOMA = 'idioma-voz';

export async function leerClave(): Promise<string | null> {
  return SecureStore.getItemAsync(CLAVE);
}

export async function guardarClave(valor: string): Promise<void> {
  const v = valor.trim();
  if (v) await SecureStore.setItemAsync(CLAVE, v);
  else await SecureStore.deleteItemAsync(CLAVE);
}

export async function leerIdioma(): Promise<string> {
  return (await SecureStore.getItemAsync(IDIOMA)) ?? 'es-CO';
}

export async function guardarIdioma(valor: string): Promise<void> {
  await SecureStore.setItemAsync(IDIOMA, valor);
}
