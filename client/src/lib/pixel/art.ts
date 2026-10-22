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

/** Published rate sheet with a refresh arrow, for the landing benefits. */
export const RATE_UPDATE = [
	'#########....',
	'#ooooooo##...',
	'#ooooooo#o#..',
	'#ooooooo###..',
	'#ooooooooo#..',
	'#oo####ooo#..',
	'#ooooooooo#..',
	'#oo###oooo#..',
	'#oooooo###..#',
	'#ooooo#...#.#',
	'######....###',
	'.....#.......',
	'......#...#..',
	'.......###...'
];

/** Stepped shield with an uncertainty marker. */
export const UNCERTAINTY = [
	'......#......',
	'...###o###...',
	'###ooooooo###',
	'#ooooooooooo#',
	'#ooooo#ooooo#',
	'#ooooo#ooooo#',
	'#ooooo#ooooo#',
	'#ooooooooooo#',
	'.#oooo#oooo#.',
	'.#ooooooooo#.',
	'..#ooooooo#..',
	'...#ooooo#...',
	'....##o##....',
	'......#......'
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
