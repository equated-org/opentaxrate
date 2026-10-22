/**
 * Copies text. navigator.clipboard exists only on https and localhost, so a
 * dev server reached by IP or hostname falls back to a hidden textarea and
 * execCommand. Resolves false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// An open modal <dialog> makes the rest of the page inert, so the
		// textarea goes inside it to stay selectable.
		const host = document.querySelector('dialog[open]') ?? document.body;
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
		host.append(area);
		area.select();
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			area.remove();
		}
	}
}
