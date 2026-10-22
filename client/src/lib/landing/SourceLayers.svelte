<script lang="ts">
	/**
	 * How a rate is built from layers of state data: address lists, map
	 * outlines, and extra map details that never change the rate, beside one
	 * pixel scene of the three stacked over a city block.
	 */
	const LAYERS = [
		{
			key: 'list',
			title: 'Address lists',
			body: 'Many states publish lists of street addresses: “even houses 2700 to 2798 on Airport Way S are in Seattle.” Finding an address is a table lookup, with no map needed.'
		},
		{
			key: 'outline',
			title: 'Outlines',
			body: 'Other states, like Texas and California, publish shapes on a map. We place the address on the map and check which shapes hold it.'
		},
		{
			key: 'details',
			title: 'Extra map details',
			body: 'Transit areas, city limits and similar zones from state maps. We report them alongside the rate; they never change it.'
		}
	] as const;
</script>

<section class="layers" aria-labelledby="layers">
	<h2 id="layers">A rate is built from layers</h2>
	<div class="split">
		<img class="scene" src="/sources/layers.webp" width="1254" height="1254" alt="Three map layers stacked over one city block: an address list at the bottom, colored district outlines with a map pin in the middle, and a see-through layer with a bus route on top" />
		<ol class="steps">
			{#each LAYERS as layer (layer.key)}
				<li>
					<p class="label">{layer.title}</p>
					<p>{layer.body}</p>
				</li>
			{/each}
		</ol>
	</div>
</section>

<style>
	.layers {
		margin-top: 2.5rem;
		padding-bottom: 2.5rem;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.4;
		margin-bottom: 1rem;
	}
	p {
		color: var(--text-2);
		font-size: 1rem;
		line-height: 1.75;
	}
	.label {
		color: var(--text);
		font-weight: 600;
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		gap: 1.5rem;
		align-items: center;
	}
	/* The scene is drawn on white: multiplied into the page's own background
	   in light mode, and set on a soft white card in dark. */
	.scene {
		display: block;
		width: 100%;
		height: auto;
		mix-blend-mode: multiply;
	}
	:global(.dark) .scene {
		mix-blend-mode: normal;
		border-radius: var(--radius-card);
	}
	.steps {
		display: grid;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.steps p + p {
		margin-top: 0.25rem;
	}
	@media (max-width: 640px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.scene {
			max-width: 22rem;
			justify-self: center;
		}
	}
</style>
