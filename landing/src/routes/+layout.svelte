<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';

	let { children } = $props();

	onMount(() => initTheme());
</script>

<svelte:head>
	<title>OpenTaxRate · Sales tax for any US address</title>
	<meta
		name="description"
		content="Look up sales tax for a US address, split into state, county, city and district. Rates based on public data from state tax agencies."
	/>
</svelte:head>

{@render children()}
