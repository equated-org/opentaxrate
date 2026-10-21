<script lang="ts">
	/** Three things that set the answers apart, in the README's words. */
	const ITEMS = [
		{
			title: 'Address-level, not ZIP',
			text: "A ZIP that crosses a city line isn't averaged or rounded down; the street decides."
		},
		{
			title: 'Dated back to 2020',
			text: "Ask for a sale's date and get the rate in force that day, back to 2020 for most states."
		},
		{
			title: 'Refuses instead of guessing',
			text: 'Near a city line, or when geocoders disagree, it returns the candidate rates. Missing data is never read as zero.'
		}
	];
</script>

<ul class="grid gap-8 sm:grid-cols-3 sm:gap-10">
	{#each ITEMS as item (item.title)}
		<li>
			<h2 class="text-[15px] font-semibold text-[var(--text)]">{item.title}</h2>
			<p class="mt-1.5 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{item.text}</p>
		</li>
	{/each}
</ul>
