/**
 * Copia um texto que ainda está sendo calculado (ex.: o link de uma sala que
 * o servidor está criando) sem perder o "gesto do usuário".
 *
 * Navegadores só liberam a área de transferência durante (ou logo após) um
 * clique. Se esperarmos o fetch terminar para chamar writeText, o Safari já
 * considera o gesto expirado. A saída é chamar clipboard.write() *dentro* do
 * clique, passando um ClipboardItem cujo conteúdo é uma Promise.
 *
 * Retorna true se copiou, false se o navegador bloqueou.
 */
export async function copyDeferredText(text: Promise<string>): Promise<boolean> {
  const clipboard = navigator.clipboard;

  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Cai para os próximos métodos.
    }
  }

  let value: string;
  try {
    value = await text;
  } catch {
    return false;
  }
  return copyText(value);
}

/** Copia um texto já conhecido. Retorna true se copiou. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Tenta o método antigo abaixo.
  }
  return legacyCopy(value);
}

function legacyCopy(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
