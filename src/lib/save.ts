import { isIOS } from './install';

/**
 * Salva un file sul dispositivo.
 * - iPhone/iPad: usa il foglio di condivisione (→ "Salva su File"), più affidabile del download
 *   quando l'app è installata sulla schermata Home.
 * - Altri: download classico.
 */
export async function saveFile(content: string, filename: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const file = new File([blob], filename, { type });

  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // annullato dall'utente
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
