<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth';
	import Wordmark from '$lib/pixel/Wordmark.svelte';

	/** Sign in, or sign up, with a code sent to your email. */
	let email = $state('');
	let code = $state('');
	let step = $state<'email' | 'code'>('email');
	let busy = $state(false);
	let error = $state('');

	async function send(event?: SubmitEvent) {
		event?.preventDefault();
		error = '';
		busy = true;
		const { error: failed } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
		busy = false;
		if (failed) error = failed.message ?? "We couldn't send a code. Try again.";
		else step = 'code';
	}

	async function verify(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		busy = true;
		const { error: failed } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
		busy = false;
		if (failed) error = failed.message ?? "That code didn't work.";
		else await goto('/dashboard');
	}
</script>

<svelte:head>
	<title>Sign in · OpenTaxRate</title>
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<header class="border-b border-[var(--border)]">
		<div class="flex h-14 items-center px-4 sm:px-6">
			<a href="/" class="rounded" aria-label="OpenTaxRate home"><Wordmark /></a>
		</div>
	</header>

	<main class="grid flex-1 place-items-center px-5 py-16">
		<div class="w-full max-w-[400px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-7 shadow-[var(--shadow)]">
			{#if step === 'email'}
				<form onsubmit={send}>
					<h1 class="text-[24px] font-semibold tracking-tight">Sign in</h1>
					<p class="mt-1 mb-5 text-[14px] text-[var(--text-muted)]">
						We'll email you a six-digit code. New here? The same code creates your account.
					</p>
					<label class="mb-1.5 block text-[13px] text-[var(--text-2)]" for="email">Email</label>
					<input
						id="email"
						type="email"
						required
						autocomplete="email"
						bind:value={email}
						class="w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-[15px]"
					/>
					<button class="btn primary mt-4 w-full py-2.5 text-[14.5px]" disabled={busy}>
						{busy ? 'Sending…' : 'Email me a code'}
					</button>
				</form>
			{:else}
				<form onsubmit={verify}>
					<h1 class="text-[24px] font-semibold tracking-tight">Check your email</h1>
					<p class="mt-1 mb-5 text-[14px] text-[var(--text-muted)]">
						We sent a code to <b class="font-medium text-[var(--text-2)]">{email}</b>. It works for 5 minutes.
					</p>
					<label class="mb-1.5 block text-[13px] text-[var(--text-2)]" for="code">Code</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="code"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="6"
						required
						autofocus
						bind:value={code}
						class="font-num w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-center text-[20px] tracking-[0.5em]"
					/>
					<button class="btn primary mt-4 w-full py-2.5 text-[14.5px]" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
					<p class="mt-4 text-[12.5px] text-[var(--text-muted)]">
						<button type="button" class="underline underline-offset-3" onclick={() => ((step = 'email'), (code = ''))}>Use a different email</button>
						·
						<button type="button" class="underline underline-offset-3" onclick={() => send()} disabled={busy}>Send a new code</button>
					</p>
				</form>
			{/if}
			{#if error}<p class="mt-3 text-[13px] text-[var(--warn)]" role="alert">{error}</p>{/if}
		</div>
	</main>
</div>
