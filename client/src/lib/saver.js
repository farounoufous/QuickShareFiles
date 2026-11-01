import { SINK_BATCH } from './protocol.js';

/**
 * Où écrire les fichiers reçus.
 *  - Disque (Chrome / Edge sur ordinateur, page sécurisée) : écriture en flux, aucune limite de taille.
 *  - Mémoire (autres navigateurs) : les blocs sont regroupés en Blob, que le navigateur peut
 *    déporter sur disque, puis le fichier est téléchargé à la fin.
 */

export const canSaveToDisk = typeof window !== 'undefined' && window.isSecureContext && 'showSaveFilePicker' in window;

/** Nom de fichier sûr : jamais de chemin, pas de caractères interdits sous Windows. */
export function safeName(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return base || 'fichier';
}

async function uniqueName(dir, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? name : `${stem} (${i})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch (error) {
      if (error?.name === 'NotFoundError') return candidate;
      throw error;
    }
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** Regroupe les petits blocs réseau en écritures de 1 Mo. */
function batched(write) {
  let parts = [];
  let size = 0;
  const flush = async () => {
    if (!size) return;
    const blob = new Blob(parts);
    parts = [];
    size = 0;
    await write(blob);
  };
  return {
    async push(chunk) {
      parts.push(chunk);
      size += chunk.byteLength;
      if (size >= SINK_BATCH) await flush();
    },
    flush,
  };
}

function diskSaver({ handle, dir }) {
  return {
    mode: 'disque',
    async open({ name }) {
      const fileHandle = handle ?? (await dir.getFileHandle(await uniqueName(dir, safeName(name)), { create: true }));
      const writable = await fileHandle.createWritable();
      const batch = batched((blob) => writable.write(blob));
      return {
        write: (chunk) => batch.push(chunk),
        async close() {
          await batch.flush();
          await writable.close();
        },
        async abort() {
          try {
            await writable.abort();
          } catch {
            /* déjà fermé */
          }
        },
      };
    },
  };
}

function memorySaver() {
  return {
    mode: 'mémoire',
    async open({ name }) {
      const blobs = []; // chaque Blob est géré par le navigateur, qui peut le stocker sur disque
      const batch = batched((blob) => blobs.push(blob));
      return {
        write: (chunk) => batch.push(chunk),
        async close() {
          await batch.flush();
          const url = URL.createObjectURL(new Blob(blobs));
          const link = document.createElement('a');
          link.href = url;
          link.download = safeName(name);
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 120_000);
        },
        async abort() {
          blobs.length = 0;
        },
      };
    },
  };
}

/**
 * À appeler directement depuis le clic « Accepter » : les sélecteurs de fichiers
 * du navigateur exigent un geste de l'utilisateur.
 * Lève une AbortError si l'utilisateur ferme le sélecteur.
 */
export async function createSaver(files) {
  if (canSaveToDisk) {
    try {
      if (files.length === 1) {
        return diskSaver({ handle: await window.showSaveFilePicker({ suggestedName: safeName(files[0].name) }) });
      }
      if ('showDirectoryPicker' in window) {
        return diskSaver({ dir: await window.showDirectoryPicker({ mode: 'readwrite' }) });
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Sélecteur indisponible ou refusé pour une autre raison : on se rabat sur la mémoire.
    }
  }
  return memorySaver();
}
