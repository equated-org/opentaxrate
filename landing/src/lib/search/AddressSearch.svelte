<script lang="ts">
	/**
	 * The address box: an ARIA combobox over the autocomplete. Typing asks
	 * suggest() after 250 ms and 4 characters, aborting the request before;
	 * arrows move, Enter picks, Escape closes. Enter with nothing picked
	 * submits the typed text (onsubmit) when it reads as an address, since the
	 * autocomplete often lacks the exact house. The API is never called per
	 * keystroke.
	 */
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { ENTER, MAGNIFIER } from '$lib/pixel/art';
	import { PARSE_HINT, parseAddress } from './parse';
	import { hasHouseNumber, matchesTyped, suggest, type Suggestion } from './suggest';

	interface Props {
		value?: string;
		onpick: (s: Suggestion) => void;
		/** Typed text that parses as an address, entered without a pick. */
		onsubmit: (text: string) => void;
		size?: 'lg' | 'sm';
		autofocus?: boolean;
	}

	let { value = $bindable(''), onpick, onsubmit, size = 'lg', autofocus = false }: Props = $props();

	const DEBOUNCE_MS = 250;
	const MIN_CHARS = 4;
	const id = `addr-${Math.random().toString(36).slice(2, 8)}`;

	let items = $state<Suggestion[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let loading = $state(false);
	let failed = $state(false);
	let searched = $state('');
	let hint = $state('');
	let input: HTMLInputElement | undefined = $state();

	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	$effect(() => {
		if (autofocus) input?.focus();
	});

	$effect(() => () => {
		clearTimeout(timer);
		controller?.abort();
	});

	function cancel() {
		clearTimeout(timer);
		controller?.abort();
		controller = undefined;
		loading = false;
	}

	function oninput() {
		cancel();
		failed = false;
		hint = '';
		const text = value.trim();
		if (text.length < MIN_CHARS) {
			items = [];
			open = false;
			return;
		}
		timer = setTimeout(() => run(text), DEBOUNCE_MS);
	}

	async function run(text: string) {
		controller?.abort();
		const c = new AbortController();
		controller = c;
		loading = true;
		try {
			const found = await suggest(text, c.signal);
			if (c.signal.aborted) return;
			items = found;
			searched = text;
			// Preselect only a house with the typed number, so Enter on a fully
			// typed address doesn't swap it for a neighbour.
			active = found.findIndex((s) => matchesTyped(text, s));
			open = true;
		} catch (error) {
			if (c.signal.aborted) return;
			console.warn('autocomplete failed', error);
			items = [];
			failed = true;
			open = true;
		} finally {
			if (controller === c) loading = false;
		}
	}

	function pick(s: Suggestion) {
		if (!hasHouseNumber(s)) return;
		cancel();
		value = s.label;
		open = false;
		items = [];
		hint = '';
		onpick(s);
	}

	function submit() {
		const chosen = open && active >= 0 ? items[active] : undefined;
		if (chosen && hasHouseNumber(chosen)) return pick(chosen);
		const parsed = parseAddress(value);
		if (!parsed.ok) {
			hint = value.trim() ? PARSE_HINT[parsed.reason] : '';
			// Close the list so the hint shows; arrows reopen it.
			if (hint) open = false;
			return;
		}
		cancel();
		open = false;
		items = [];
		hint = '';
		onsubmit(value.trim());
	}

	function move(step: number) {
		if (!open || items.length === 0) {
			if (items.length) open = true;
			return;
		}
		active = active < 0 ? (step > 0 ? 0 : items.length - 1) : (active + step + items.length) % items.length;
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				move(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				move(-1);
				break;
			case 'Enter':
				event.preventDefault();
				submit();
				break;
			case 'Escape':
				if (open) {
					event.preventDefault();
					open = false;
				} else if (value) {
					event.preventDefault();
					cancel();
					value = '';
					items = [];
				}
				break;
			case 'Tab':
				open = false;
				break;
		}
	}

	const optionId = (i: number) => `${id}-opt-${i}`;
	const showList = $derived(open && (items.length > 0 || failed || (!loading && searched !== '')));
	const status = $derived(
		!open ? '' : failed ? 'Suggestions are unavailable.' : `${items.length} suggestion${items.length === 1 ? '' : 's'}.`
	);
	const lg = $derived(size === 'lg');
</script>

<div class="relative w-full">
	<div
		class="flex items-center gap-3 border bg-[var(--bg)] transition-[box-shadow,border-color] duration-150
			{lg ? 'h-14 rounded-full px-5 shadow-[var(--shadow)]' : 'h-11 rounded-full px-4'}
			border-[var(--border-strong)] focus-within:border-[var(--text-muted)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
	>
		<Pixels rows={MAGNIFIER} cell={2} class="shrink-0 text-[var(--text-muted)]" />
		<input
			bind:this={input}
			bind:value
			{oninput}
			{onkeydown}
			onfocus={() => {
				if (items.length) open = true;
			}}
			onblur={() => (open = false)}
			type="text"
			role="combobox"
			aria-label="US street address"
			aria-autocomplete="list"
			aria-expanded={showList}
			aria-controls="{id}-list"
			aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder="Type a US street address"
			class="h-full min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none focus-visible:outline-none placeholder:text-[var(--text-muted)]
				{lg ? 'text-[17px]' : 'text-[15px]'}"
		/>
		{#if loading}
			<span class="loader shrink-0" aria-hidden="true"><i></i><i></i><i></i></span>
		{/if}
		<button
			type="button"
			onclick={submit}
			onmousedown={(e) => e.preventDefault()}
			aria-label="Look up this address"
			title="Look up (Enter)"
			class="grid shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text)]
				{lg ? '-mr-2 h-10 w-10' : '-mr-1.5 h-8 w-8'}"
		>
			<Pixels rows={ENTER} cell={2} />
		</button>
	</div>

	<ul
		id="{id}-list"
		role="listbox"
		aria-label="Address suggestions"
		class="absolute right-0 left-0 z-30 mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] py-1.5 shadow-[var(--shadow)]
			{showList ? '' : 'hidden'}"
	>
		{#each items as s, i (s.label + i)}
			{@const ok = hasHouseNumber(s)}
			<!-- Keys are handled on the input, as the combobox pattern has it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id={optionId(i)}
				role="option"
				aria-selected={i === active}
				aria-disabled={!ok}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => pick(s)}
				onmousemove={() => (active = i)}
				class="mx-1.5 flex cursor-pointer items-baseline justify-between gap-3 rounded-xl px-3 py-2.5 text-left
					{i === active ? 'bg-[var(--bg-muted)]' : ''}
					{ok ? 'text-[var(--text)]' : 'cursor-not-allowed text-[var(--text-muted)]'}"
			>
				<span class="truncate text-[15px]">{s.label}</span>
				{#if !ok}<span class="shrink-0 text-xs">add a house number</span>
				{:else if s.from === 'street'}<span class="shrink-0 text-xs text-[var(--text-muted)]">from the street</span>{/if}
			</li>
		{/each}
		{#if failed}
			<li class="px-4 py-2.5 text-sm text-[var(--text-muted)]" role="presentation">
				Suggestions are unavailable right now. Type the full address, like "1100 Congress Ave, Austin, TX 78701", and press Enter.
			</li>
		{:else if items.length === 0}
			<li class="px-4 py-2.5 text-sm text-[var(--text-muted)]" role="presentation">
				No suggestions. Type the full address, with city and state, and press Enter.
			</li>
		{/if}
	</ul>
	{#if hint}
		<p class="mt-2 px-5 text-sm text-[var(--warn)]" role="alert">{hint}</p>
	{/if}
	<p class="sr-only" aria-live="polite">{status}</p>
</div>

<style>
	.loader {
		display: inline-flex;
		gap: 2px;
	}
	.loader i {
		width: 4px;
		height: 4px;
		background: var(--text-muted);
		animation: blink 0.9s steps(1) infinite;
	}
	.loader i:nth-child(2) {
		animation-delay: 0.3s;
	}
	.loader i:nth-child(3) {
		animation-delay: 0.6s;
	}
	@keyframes blink {
		0% {
			opacity: 1;
		}
		33% {
			opacity: 0.25;
		}
	}
</style>
