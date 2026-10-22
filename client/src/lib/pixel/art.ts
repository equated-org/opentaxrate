/** Hand-drawn sprites for Pixels.svelte. One character per pixel. */

/** The mark beside the wordmark: a 7×7 checker "rate grid". */
export const MARK = ['##...##', '##...##', '..###..', '..###..', '..###..', '##...##', '##...##'];

/** Magnifier for the search box. */
export const MAGNIFIER = [
	'..####...',
	'.#....#..',
	'#......#.',
	'#......#.',
	'#......#.',
	'#......#.',
	'.#....#..',
	'..#####..',
	'......##.',
	'.......##'
];

/** Map pin: `#` outline, `o` fill, `w` the hole. */
export const PIN = [
	'...#####...',
	'..#ooooo#..',
	'.#ooooooo#.',
	'#ooowwwooo#',
	'#oowwwwwoo#',
	'#oowwwwwoo#',
	'#ooowwwooo#',
	'.#ooooooo#.',
	'..#ooooo#..',
	'...#ooo#...',
	'....#o#....',
	'.....#.....'
];

/** Hourglass for "too many lookups". `s` is sand. */
export const HOURGLASS = [
	'#########',
	'.#.....#.',
	'.#sssss#.',
	'..#sss#..',
	'...#s#...',
	'....#....',
	'...#.#...',
	'..#.s.#..',
	'.#..s..#.',
	'.#sssss#.',
	'#########'
];

/** A small warning sign for a refusal. */
export const SIGN = [
	'....#....',
	'...###...',
	'...#w#...',
	'..##w##..',
	'..##w##..',
	'.###w###.',
	'.#######.',
	'####w####',
	'#########'
];

/** Return arrow hint in the search box. */
export const ENTER = ['......#', '......#', '..#...#', '.##...#', '#######', '.##....', '..#....'];
