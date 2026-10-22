<script lang="ts">
	/**
	 * A picture of a real result under the hero: the Austin answer's rate
	 * list (the real component, fed a saved response) beside a saved image of
	 * its map, so the empty page shows what a lookup gives without loading
	 * MapLibre. The whole panel is a link that runs the Austin example.
	 */
	import type { AddressRate, Trace } from '$lib/api';
	import RateList from '$lib/result/RateList.svelte';
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { MAGNIFIER } from '$lib/pixel/art';
	import saved from '$lib/showcase-austin.json';
	import Contours from './Contours.svelte';

	let { label, href, onopen }: { label: string; href: string; onopen: () => void } = $props();

	const { trace, ...rate } = saved as unknown as AddressRate & { trace: Trace };
</script>

<a
	{href}
	onclick={(e) => {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onopen();
	}}
	class="panel group relative block overflow-hidden px-4 pt-10 pb-0 sm:px-12 sm:pt-14"
	aria-label="See it live: look up {label}"
>
	<span class="contours"><Contours /></span>

	<div class="relative mx-auto mb-6 flex max-w-[880px] items-center justify-between gap-4">
		<p class="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-[var(--text)] sm:text-[22px]">One address, every part of its rate, and the lines that decided it.</p>
		<span class="hidden shrink-0 rounded-full bg-[var(--text)] px-4 py-2 text-sm text-[var(--bg)] transition-transform group-hover:translate-x-0.5 sm:inline">
			See it live →
		</span>
	</div>

	<div class="frame relative mx-auto max-w-[880px]" aria-hidden="true">
		<div class="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
			<span class="flex gap-1.5"><i></i><i></i><i></i></span>
			<span class="mx-auto flex max-w-[360px] min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[13px] text-[var(--text-2)]">
				<Pixels rows={MAGNIFIER} cell={1.4} class="shrink-0 text-[var(--text-muted)]" />
				<span class="truncate">{label}</span>
			</span>
			<span class="w-[42px]"></span>
		</div>
		<div class="grid md:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
			<div class="fade max-h-[440px] overflow-hidden p-5 md:max-h-[520px] sm:p-6 [&_.part-code]:hidden [&_.rate-big]:text-[46px]">
				<RateList {rate} {trace} url="" raw={null} preview />
			</div>
			<picture class="hidden md:block">
				<source srcset="/showcase-map-dark.webp" media="(prefers-color-scheme: dark)" />
				<img src="/showcase-map.webp" alt="" width="848" height="788" loading="lazy" decoding="async" class="h-full max-h-[520px] w-full object-cover object-center" />
			</picture>
		</div>
	</div>
</a>

<style>
	.panel {
		border-radius: var(--radius-panel);
		background: var(--clay);
		color: var(--text);
		transition: transform 0.25s ease;
	}
	.panel:hover {
		transform: translateY(-2px);
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
	.frame {
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--clay-ink) 22%, transparent);
		border-bottom: 0;
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		background: var(--surface);
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
