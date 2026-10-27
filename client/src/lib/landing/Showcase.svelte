<script lang="ts">
	/**
	 * Real answers under the hero, in two slides. First one address: its rate
	 * list (the real component, fed a saved answer) beside a saved image of
	 * its map. Then that address with two others mailed to the same "Aurora,
	 * CO 80015", each in a different tax area, drawn as a plain SVG. Both come
	 * from showcase-aurora.json (`pnpm showcase`), so the empty page loads no
	 * map. Each slide's "See it live" runs its lookups.
	 */
	import type { AddressRate, Trace } from '$lib/api';
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { MAGNIFIER } from '$lib/pixel/art';
	import PairSketch, { type Side } from '$lib/result/PairSketch.svelte';
	import RateList from '$lib/result/RateList.svelte';
	import { pct } from '$lib/result/format';
	import type { Suggestion } from '$lib/search/types';
	import saved from '$lib/showcase-aurora.json';
	import Contours from './Contours.svelte';

	interface Props {
		/** The same-ZIP addresses, in showcase-aurora.json's order. */
		addresses: Suggestion[];
		/** Which of them the first slide shows alone. */
		single: number;
		hrefs: { single: string; all: string };
		onopen: (which: 'single' | 'all') => void;
	}
	let { addresses, single, hrefs, onopen }: Props = $props();

	const TAGS = ['A', 'B', 'C'];
	const answers = saved.answers as unknown as Array<AddressRate & { trace: Trace }>;
	const sides: Side[] = answers.map((a, i) => ({ tag: TAGS[i], point: a.trace.point!, rate: a.rate, outlines: a.trace.outlines }));
	/** What sets each address apart: its city tax, else that it has none. */
	const local = answers.map((a) => {
		const city = a.parts.find((p) => p.kind === 'city');
		return city ? `City of ${city.name} ${pct(city.rate, true)}` : 'no city tax';
	});
	const { trace, ...rate } = $derived(answers[single]);

	const SLIDES = [
		{ id: 'single', tab: 'One address', title: 'One address, every part of its rate, and the line that decided it.' },
		{ id: 'all', tab: 'Same ZIP, three rates', title: 'Three addresses in Aurora, CO 80015. Three rates.' }
	] as const;
	let current = $state(0);
	const slide = $derived(SLIDES[current]);

	function open(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onopen(slide.id);
	}
</script>

<section class="panel relative overflow-hidden px-4 pt-8 sm:px-12 sm:pt-10 {current === 1 ? 'pb-10 sm:pb-14' : 'pb-0'}" aria-roledescription="carousel" aria-label="What a lookup shows">
	<span class="contours"><Contours /></span>

	<div class="relative mx-auto mb-5 flex max-w-[880px] flex-wrap gap-2" role="tablist" aria-label="Examples">
		{#each SLIDES as s, i (s.id)}
			<button
				type="button"
				role="tab"
				aria-selected={current === i}
				class="tab font-num"
				onclick={() => (current = i)}
				onkeydown={(e) => {
					if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') current = (current + 1) % SLIDES.length;
				}}
			>
				{i + 1} · {s.tab}
			</button>
		{/each}
	</div>

	<div class="relative mx-auto mb-6 flex max-w-[880px] items-end justify-between gap-4">
		<div>
			<p class="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-[var(--text)] sm:text-[22px]">{slide.title}</p>
			{#if current === 1}
				<p class="mt-1 text-[14.5px] text-[var(--text-2)]">
					The mail goes to Aurora, but only one is inside the City of Aurora. A ZIP-code lookup gives them all the same rate.
				</p>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if current === 0}
				<button type="button" class="hidden rounded-full border border-[var(--text)] px-4 py-2 text-sm sm:inline" onclick={() => (current = 1)}>
					Its neighbours →
				</button>
			{/if}
			<a
				href={current === 0 ? hrefs.single : hrefs.all}
				onclick={open}
				class="rounded-full bg-[var(--text)] px-4 py-2 text-sm whitespace-nowrap text-[var(--bg)] transition-transform hover:translate-x-0.5"
			>
				See it live →
			</a>
		</div>
	</div>

	{#if current === 0}
		<div class="frame top relative mx-auto max-w-[880px]" role="tabpanel" aria-label={SLIDES[0].tab}>
			<div class="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3" aria-hidden="true">
				<span class="flex gap-1.5"><i></i><i></i><i></i></span>
				<span class="mx-auto flex max-w-[360px] min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[13px] text-[var(--text-2)]">
					<Pixels rows={MAGNIFIER} cell={1.4} class="shrink-0 text-[var(--text-muted)]" />
					<span class="truncate">{addresses[single]?.label}</span>
				</span>
				<span class="w-[42px]"></span>
			</div>
			<div class="grid md:grid-cols-[minmax(0,330px)_minmax(0,1fr)]" aria-hidden="true">
				<div class="fade max-h-[440px] overflow-hidden p-5 md:max-h-[520px] sm:p-6 [&_.part-code]:hidden [&_.rate-big]:text-[46px]">
					<RateList {rate} {trace} url="" raw={null} preview />
				</div>
				<picture class="hidden md:block">
					<source srcset="/showcase-map-dark.webp" media="(prefers-color-scheme: dark)" />
					<img src="/showcase-map.webp" alt="" width="1032" height="1038" loading="lazy" decoding="async" class="h-full max-h-[520px] w-full object-cover object-center" />
				</picture>
			</div>
		</div>
	{:else}
		<div class="frame relative mx-auto grid max-w-[880px] gap-5 p-4 sm:p-6" role="tabpanel" aria-label={SLIDES[1].tab}>
			<PairSketch {sides} height={300} />
			<ul class="grid gap-3 sm:grid-cols-3">
				{#each answers as a, i (i)}
					<li class="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-3">
						<span class="flex items-baseline justify-between gap-2">
							<span class="font-num rounded-full bg-[var(--text)] px-2 text-[12px] font-semibold text-[var(--bg)]">{TAGS[i]}</span>
							<span class="font-num text-[26px] leading-none font-semibold tracking-tight">{pct(a.rate)}</span>
						</span>
						<span class="truncate text-[12.5px] text-[var(--text-muted)]">{addresses[i]?.street}</span>
						<span class="text-[13px] text-[var(--text-2)]">{local[i]}</span>
					</li>
				{/each}
			</ul>
			<p class="text-[12px] leading-relaxed text-[var(--text-muted)]">
				Each rate matches Colorado DOR’s own lookup. Rates and outlines from the API’s saved answers of {saved.asOf}.
			</p>
		</div>
	{/if}
</section>

<style>
	.panel {
		border-radius: var(--radius-panel);
		background: var(--clay);
		color: var(--text);
	}
	.contours {
		position: absolute;
		inset: 0;
		color: var(--clay-ink);
		opacity: 0.16;
	}
	:global(.dark) .contours {
		opacity: 0.12;
	}
	.tab {
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		font-size: 12.5px;
		color: var(--text-2);
		border: 1px solid color-mix(in srgb, var(--clay-ink) 30%, transparent);
	}
	.tab[aria-selected='true'] {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.frame {
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--clay-ink) 22%, transparent);
		border-radius: var(--radius-card);
		background: var(--surface);
	}
	.frame.top {
		border-bottom: 0;
		border-radius: var(--radius-card) var(--radius-card) 0 0;
	}
	/* The preview is cut off at the panel's edge; let it fade out there
	   rather than end mid-line. */
	.fade {
		mask-image: linear-gradient(to bottom, #000 78%, transparent);
	}
	.frame i {
		display: block;
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--border-strong);
	}
</style>
