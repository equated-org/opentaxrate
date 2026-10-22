<section class="lookup-pipeline" aria-label="From a street address to a sales tax rate">
	<div class="pipeline">
		<figure class="step address">
			<img class="scene" src="/benchmarks/address.webp" width="1254" height="1254" alt="A house and an address envelope on a tiled platform" />
			<figcaption>
				<p class="label">Address in</p>
				<p class="detail">90 W Broad St, Columbus, OH</p>
			</figcaption>
		</figure>

		<img class="connector" src="/benchmarks/plus.webp" width="1254" height="1254" alt="" aria-hidden="true" />

		<figure class="step lookup">
			<img class="scene" src="/benchmarks/lookup.webp" width="1448" height="1086" alt="A map pin, neighborhood boundaries, and calculator locate the address and calculate its tax rate" />
			<figcaption>
				<p class="label">Geocode → map → calculate</p>
			</figcaption>
		</figure>

		<img class="connector" src="/benchmarks/plus.webp" width="1254" height="1254" alt="" aria-hidden="true" />

		<figure class="step rate">
			<img class="scene" src="/benchmarks/rate.webp" width="1254" height="1254" alt="An example sales tax rate of 8.00% printed on a receipt" />
			<figcaption>
				<p class="label">Sales tax rate out</p>
			</figcaption>
		</figure>

		<div class="cost">
			<div class="bracket" aria-hidden="true"></div>
			<a href="#pricing">What does this lookup cost?</a>
			<p>Pricing below compares the work behind the rate.</p>
		</div>
	</div>
</section>

<style>
	.lookup-pipeline {
		margin-top: 1rem;
		margin-bottom: 3.5rem;
	}
	.pipeline {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 2rem minmax(0, 1.65fr) 2rem minmax(0, 1fr);
		column-gap: 0.65rem;
		align-items: start;
		text-align: center;
	}
	.step {
		min-width: 0;
		margin: 0;
	}
	.scene {
		display: block;
		width: 100%;
		height: clamp(11rem, 25vw, 16rem);
		object-fit: contain;
		object-position: center bottom;
	}
	figcaption {
		min-height: 3.5rem;
		padding-top: 0.75rem;
	}
	.label {
		font-size: 14px;
		font-weight: 600;
		line-height: 1.4;
	}
	.detail {
		margin-top: 0.25rem;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.connector {
		width: 3.25rem;
		max-width: none;
		height: 3.25rem;
		align-self: start;
		justify-self: center;
		margin-top: clamp(6rem, 14vw, 9rem);
	}
	.cost {
		grid-column: 3;
		font-size: 12px;
		line-height: 1.6;
	}
	.bracket {
		height: 7px;
		margin-bottom: 0.5rem;
		border: 1px solid var(--warn);
		border-bottom: 0;
	}
	.cost a {
		color: var(--warn);
		font-size: 13px;
		font-weight: 600;
		text-underline-offset: 3px;
	}
	.cost a:hover {
		text-decoration: underline;
	}
	.cost p {
		margin-top: 0.25rem;
		color: var(--text-muted);
	}
	@media (max-width: 560px) {
		.lookup-pipeline {
			margin-top: 1.5rem;
			margin-bottom: 3rem;
		}
		.pipeline {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.5rem;
		}
		.step {
			width: 100%;
			max-width: 20rem;
			justify-self: center;
		}
		.scene {
			height: 10rem;
		}
		.lookup .scene {
			height: 13rem;
		}
		figcaption {
			min-height: 0;
			padding-top: 0.5rem;
		}
		.connector {
			display: none;
		}
		.address { order: 0; }
		.lookup { order: 1; }
		.cost {
			order: 2;
			grid-column: 1;
			width: 100%;
			max-width: 20rem;
			justify-self: center;
			margin-top: -0.75rem;
		}
		.rate { order: 3; }
	}
</style>
