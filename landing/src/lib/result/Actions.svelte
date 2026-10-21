<script lang="ts">
	/** "Copy as curl" and "Raw JSON" for any response. */
	let { url, raw }: { url: string; raw: unknown } = $props();

	let copied = $state(false);
	let open = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const json = $derived(JSON.stringify(raw, null, 2));
	const curl = $derived(`curl '${url.replaceAll("'", "'\\''")}'`);

	async function copy() {
		try {
			await navigator.clipboard.writeText(curl);
		} catch {
			// Clipboard blocked (http or permissions): show the command instead.
			prompt('Copy this command', curl);
			return;
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1600);
	}
</script>

<div class="flex flex-wrap gap-2">
	<button type="button" class="btn" onclick={copy}>
		{copied ? 'Copied' : 'Copy as curl'}
	</button>
	{#if raw !== null && raw !== undefined}
		<button type="button" class="btn" aria-expanded={open} onclick={() => (open = !open)}>
			{open ? 'Hide JSON' : 'Raw JSON'}
		</button>
	{/if}
	<span class="sr-only" aria-live="polite">{copied ? 'Copied the curl command' : ''}</span>
</div>
{#if open}
	<pre
		class="mt-3 max-h-80 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--text-2)]">{json}</pre>
{/if}
