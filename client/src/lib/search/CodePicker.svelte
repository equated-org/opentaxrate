<script lang="ts">
	/** What was sold: a taxability code for the lookup's code=, or none for
	 *  the general rate alone. Subcodes are indented under their parent. */
	import { CODE_GROUPS, depth } from '$lib/codes';

	interface Props {
		value: string;
		onchange?: (code: string) => void;
		size?: 'md' | 'sm';
	}
	let { value = $bindable(), onchange, size = 'md' }: Props = $props();
</script>

<label class="picker {size}">
	<span class="label">What's sold</span>
	<select
		bind:value
		onchange={() => onchange?.(value)}
		aria-label="What's sold: a taxability code, for whether this sale is taxed here"
	>
		<option value="">Anything (general rate)</option>
		{#each CODE_GROUPS as g (g.group)}
			<optgroup label={g.group}>
				{#each g.codes as [code, name] (code)}
					<option value={code}>{' '.repeat(depth(code))}{name}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
</label>

<style>
	.picker {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text-muted);
	}
	.picker select {
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		padding: 6px 30px 6px 14px;
		appearance: none;
		background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
		background-position: calc(100% - 16px) 55%, calc(100% - 11px) 55%;
		background-size: 5px 5px;
		background-repeat: no-repeat;
		max-width: 280px;
	}
	.picker.sm {
		font-size: 13px;
	}
	.picker.sm select {
		padding: 4px 26px 4px 12px;
		max-width: 200px;
	}
	.picker select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
