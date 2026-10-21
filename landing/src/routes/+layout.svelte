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
		content="Type a US address and see its sales tax rate, split into state, county, city and district, with the outlines and points that decided it. From the states' own files."
	/>
</svelte:head>

{@render children()}
