<script lang="ts">
	import releases from '$lib/data-releases.json';

	const size = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
</script>

<svelte:head>
	<title>Data releases · OpenTaxRate Docs</title>
	<meta name="description" content="Every published OpenTaxRate data release, with what changed in each and where to download it." />
</svelte:head>

<h1>Data releases</h1>
<p class="lead">Every published snapshot of the tax data, newest first, and what changed in it.</p>
<p>
	A release is a database dump of every state's rates, address ranges and outlines, built from the states' own files and checked
	against their own answers before it's published. The API serves one release at a time. Each download comes with its SHA-256.
</p>

{#each releases as release (release.tag)}
	<h2 id={release.tag}>{release.tag}</h2>
	<p>
		Published {release.published} ·
		<a class="link" href={release.url}>Release page</a> ·
		<a class="link" href={`${release.url.replace('/tag/', '/download/')}/${release.dump.name}`}>{release.dump.name}</a>
		({size(release.dump.bytes)})
	</p>
	<ul>
		{#each release.changes as change, i (i)}
			<li>{change}</li>
		{/each}
	</ul>
{/each}
