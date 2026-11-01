<script lang="ts">
	/**
	 * What was sold: a taxability code for the lookup's code=, or none for
	 * the general rate alone. A button opens a searchable list (an ARIA
	 * combobox over a grouped listbox): typing filters by short name, code or
	 * a few common words; a matching parent brings its subcodes along.
	 * Arrows, Home/End move, Enter picks, Escape closes; onchange fires only
	 * when a different code is picked.
	 */
	import { tick } from 'svelte';
	import { CODE_GROUPS, codeName, depth } from '$lib/codes';

	interface Props {
		value: string;
		onchange?: (code: string) => void;
		size?: 'md' | 'sm';
	}
	let { value = $bindable(), onchange, size = 'md' }: Props = $props();

	const ANYTHING = 'Anything (general rate)';
	/** Everyday words a buyer may type that the short name and code lack. */
	const WORDS: Record<string, string> = {
		'food.grocery': 'grocery supermarket',
		'food.uncooked': 'meal kit',
		'food.candy': 'sweets chocolate confectionery',
		'food.soft_drink': 'soda pop cola beverage',
		'food.prepared': 'restaurant takeout meal',
		'food.catering': 'event',
		'software.saas': 'cloud subscription software as a service',
		'software.prewritten': 'canned off the shelf download license',
		'service.professional.legal': 'lawyer attorney',
		'service.professional.accounting': 'bookkeeping cpa',
		'service.professional.it': 'computer tech support',
		'service.professional.engineering': 'architect',
		'service.professional.advertising': 'marketing',
		'service.professional.lobbying': 'lobbyist',
		'construction.real_property': 'contractor building',
		'construction.real_property.repair': 'maintenance',
		'delivery': 'shipping freight',
		'nontaxable': 'fee deposit exempt'
	};

	type Item = { code: string; name: string; group: string; indent: number };
	type Shown = { group: string; items: Item[] };

	const norm = (s: string) => s.toLowerCase().replace(/[._\-/(),]+/g, ' ').replace(/\s+/g, ' ').trim();

	/** The groups and codes for a query, Anything always first. */
	function filter(query: string): Shown[] {
		const words = norm(query).split(' ').filter(Boolean);
		const raw = query.trim().toLowerCase();
		const hit = (code: string, name: string) => {
			const hay = `${norm(name)} ${norm(code)} ${norm(WORDS[code] ?? '')}`;
			return code.startsWith(raw) || words.every((w) => hay.includes(w));
		};
		const out: Shown[] = [];
		for (const g of CODE_GROUPS) {
			const matched = new Set<string>();
			for (const [code, name] of g.codes) {
				// A code shows if it matches, or if a parent above it does.
				const parentHit = [...matched].some((m) => code.startsWith(m + '.'));
				if (!words.length || parentHit || hit(code, name)) matched.add(code);
			}
			const items = g.codes
				.filter(([code]) => matched.has(code))
				.map(([code, name]) => {
					// Indent under the parents that are shown, not those filtered out.
					const shownParents = [...matched].filter((m) => code.startsWith(m + '.')).length;
					return { code, name, group: g.group, indent: words.length ? Math.min(shownParents, depth(code)) : depth(code) };
				});
			if (items.length) out.push({ group: g.group, items });
		}
		return out;
	}

	const uid = $props.id();
	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let root: HTMLDivElement | undefined = $state();
	let trigger: HTMLButtonElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let list: HTMLDivElement | undefined = $state();

	const groups = $derived(filter(query));
	const flat = $derived<Item[]>([{ code: '', name: ANYTHING, group: '', indent: 0 }, ...groups.flatMap((g) => g.items)]);
	const indexOf = $derived(new Map(flat.map((it, i) => [it.code, i])));
	const label = $derived(value ? codeName(value) : ANYTHING);
	const optionId = (i: number) => `${uid}-opt-${i}`;
	const status = $derived(
		open && query.trim() ? (flat.length > 1 ? `${flat.length - 1} match${flat.length === 2 ? '' : 'es'}.` : 'No matching codes.') : ''
	);

	async function show() {
		query = '';
		open = true;
		active = Math.max(0, indexOf.get(value ?? '') ?? 0);
		await tick();
		input?.focus({ preventScroll: true });
		scrollActive('center');
		reveal();
	}

	/** Scrolls the page just enough to show the whole list, keeping the
	 *  button in view (the hero's picker sits low on short screens). */
	function reveal() {
		const pop = root?.querySelector<HTMLElement>('.pop');
		if (!pop || !trigger) return;
		const over = pop.getBoundingClientRect().bottom + 12 - window.innerHeight;
		const room = trigger.getBoundingClientRect().top - 80;
		const by = Math.min(over, room);
		if (by > 0) window.scrollBy({ top: by, behavior: 'smooth' });
	}

	function close(refocus: boolean) {
		open = false;
		query = '';
		if (refocus) trigger?.focus();
	}

	function pick(code: string) {
		const changed = code !== (value ?? '');
		value = code;
		close(true);
		if (changed) onchange?.(code);
	}

	/** Keeps the active option in view, scrolling the list only, not the page. */
	function scrollActive(block: 'nearest' | 'center' = 'nearest') {
		const el = list?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
		if (!list || !el) return;
		const top = el.offsetTop - list.offsetTop;
		const bottom = top + el.offsetHeight;
		if (block === 'center') list.scrollTop = top - (list.clientHeight - el.offsetHeight) / 2;
		else if (top < list.scrollTop + 6) list.scrollTop = top - 6;
		else if (bottom > list.scrollTop + list.clientHeight - 6) list.scrollTop = bottom - list.clientHeight + 6;
	}

	function move(to: number) {
		active = Math.max(0, Math.min(flat.length - 1, to));
		requestAnimationFrame(() => scrollActive());
	}

	function oninput() {
		// The first real match, not Anything, once something is typed.
		active = query.trim() && flat.length > 1 ? 1 : 0;
		if (list) list.scrollTop = 0;
	}

	function onkeydown(e: KeyboardEvent) {
		const page = 8;
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				move(active + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				move(active - 1);
				break;
			case 'PageDown':
				e.preventDefault();
				move(active + page);
				break;
			case 'PageUp':
				e.preventDefault();
				move(active - page);
				break;
			case 'Home':
				e.preventDefault();
				move(0);
				break;
			case 'End':
				e.preventDefault();
				move(flat.length - 1);
				break;
			case 'Enter':
				e.preventDefault();
				if (flat[active]) pick(flat[active].code);
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				close(true);
				break;
			case 'Tab':
				close(false);
				break;
		}
	}

	function ontriggerkey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			close(true);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			show();
		}
	}

	// Focus or a press anywhere outside the picker closes it.
	function onfocusout(e: FocusEvent) {
		if (open && !root?.contains(e.relatedTarget as Node | null)) close(false);
	}
	function onwindowdown(e: PointerEvent) {
		if (open && !root?.contains(e.target as Node)) close(false);
	}
</script>

<svelte:window onpointerdown={onwindowdown} />

<div class="picker {size}" bind:this={root} {onfocusout}>
	<span class="label" id="{uid}-label">What's sold</span>
	<div class="anchor">
		<button
			bind:this={trigger}
			type="button"
			class="trigger"
			class:open
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-controls="{uid}-list"
			aria-labelledby="{uid}-label {uid}-value"
			title={value ? `${label} (${value})` : label}
			onclick={() => (open ? close(true) : show())}
			onkeydown={ontriggerkey}
		>
			<span class="value" id="{uid}-value">{label}</span>
			<svg class="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
				><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg
			>
		</button>

		{#if open}
			<div class="pop" role="presentation">
				<div class="search">
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" class="glass"
						><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5" /><path
							d="m10.5 10.5 3 3"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/></svg
					>
					<input
						bind:this={input}
						bind:value={query}
						{oninput}
						{onkeydown}
						type="text"
						role="combobox"
						aria-label="Search what's sold, by name or code"
						aria-autocomplete="list"
						aria-expanded="true"
						aria-controls="{uid}-list"
						aria-activedescendant={flat[active] ? optionId(active) : undefined}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						placeholder="Search, e.g. soda or saas"
					/>
				</div>
				<!-- Keys are handled on the input, as the combobox pattern has it. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					bind:this={list}
					id="{uid}-list"
					role="listbox"
					aria-label="What's sold"
					class="list"
					tabindex="-1"
					onmousedown={(e) => e.preventDefault()}
				>
					{#snippet option(it: Item)}
						{@const i = indexOf.get(it.code) ?? 0}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={optionId(i)}
							role="option"
							tabindex="-1"
							aria-selected={it.code === (value ?? '')}
							class="opt"
							class:active={i === active}
							style:padding-left="{12 + it.indent * 14}px"
							onclick={() => pick(it.code)}
							onpointermove={() => (active = i)}
						>
							<span class="name">{it.name}</span>
							{#if it.code}<span class="code"><bdi>{it.code}</bdi></span>{/if}
							{#if it.code === (value ?? '')}
								<svg class="check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
									><path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg
								>
							{/if}
						</div>
					{/snippet}

					{@render option(flat[0])}
					{#each groups as g (g.group)}
						<div role="group" aria-labelledby="{uid}-g-{g.group}">
							<div class="heading" id="{uid}-g-{g.group}" role="presentation">{g.group}</div>
							{#each g.items as it (it.code)}{@render option(it)}{/each}
						</div>
					{/each}
					{#if groups.length === 0}
						<p class="empty">No code matches “{query.trim()}”. See <a href="/docs/taxability">the full list</a>.</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>
	<p class="sr-only" aria-live="polite">{status}</p>
</div>

<style>
	.picker {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text-muted);
	}
	.anchor {
		min-width: 0;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		padding: 6px 12px 6px 14px;
		max-width: 280px;
		cursor: pointer;
		transition:
			border-color 150ms,
			box-shadow 150ms;
	}
	.trigger:hover,
	.trigger.open {
		border-color: var(--text-muted);
	}
	.trigger.open {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chev {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 150ms;
	}
	.trigger.open .chev {
		transform: rotate(180deg);
	}
	.picker.sm {
		font-size: 13px;
	}
	.picker.sm .trigger {
		padding: 4px 10px 4px 12px;
		max-width: 200px;
	}

	.pop {
		position: absolute;
		top: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		width: min(380px, calc(100vw - 24px));
		display: flex;
		flex-direction: column;
		overflow: hidden;
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow);
		color: var(--text);
		font-size: 14px;
	}
	/* In the bar the picker sits at the right; open toward the page's middle. */
	.picker.sm .pop {
		left: auto;
		right: 0;
		transform: none;
		width: min(360px, calc(100vw - 24px));
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 14px;
		height: 44px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.glass {
		flex-shrink: 0;
		color: var(--text-muted);
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 100%;
		font: inherit;
		font-size: 15px;
		color: var(--text);
		background: transparent;
		border: 0;
		outline: none;
	}
	.search input::placeholder {
		color: var(--text-muted);
	}
	.list {
		max-height: min(360px, 55vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 6px;
		outline: none;
	}
	.heading {
		padding: 10px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.opt {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 7px 12px;
		border-radius: 10px;
		cursor: pointer;
		color: var(--text);
		line-height: 1.35;
	}
	/* --bg-muted equals --surface in dark, so tint with the text colour. */
	.opt.active {
		background: color-mix(in srgb, var(--text) 7%, transparent);
	}
	.opt[aria-selected='true'] .name {
		font-weight: 600;
	}
	.name {
		flex: 1 1 auto;
		min-width: 0;
	}
	/* A long code keeps its distinguishing end: …accounting.tax_return. */
	.code {
		flex: 0 1 auto;
		max-width: 52%;
		direction: rtl;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-muted);
	}
	.check {
		flex-shrink: 0;
		align-self: center;
		color: var(--accent);
	}
	.opt:not(:has(.code)) .check {
		margin-left: auto;
	}
	.empty {
		padding: 10px 12px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.empty a {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.empty a:hover {
		color: var(--text);
	}
</style>
