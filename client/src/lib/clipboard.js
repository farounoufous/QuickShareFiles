/** Copie un texte, même sur une page non sécurisée (http://192.168…) où l'API moderne est absente. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* on essaie la méthode de secours */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export const canReadClipboard = () => Boolean(navigator.clipboard?.readText) && window.isSecureContext;

/** Lit le presse-papiers (le navigateur demande l'autorisation). Renvoie '' si c'est refusé. */
export async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/** Renvoie l'adresse si le texte est un unique lien http(s), sinon ''. */
export function asLink(text) {
  const value = String(text ?? '').trim();
  if (!value || /\s/.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
