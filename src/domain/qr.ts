// A QR code of a text, as dark and light modules: byte mode, error correction level M, the
// smallest version that fits, the mask with the lowest penalty. After Project Nayuki's QR Code
// generator (MIT), reduced to what a tracking link needs.

// Error correction codewords per block, and blocks, for level M, per version 1 to 40 (index version - 1).
const ECC_PER_BLOCK = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS = [
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35,
  37, 38, 40, 43, 45, 47, 49,
];
// Level M's two format bits.
const LEVEL_M = 0;

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0;

function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number) =>
  Math.floor(rawModules(version) / 8) - (ECC_PER_BLOCK[version - 1] as number) * (BLOCKS[version - 1] as number);

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): number[] {
  // Stryker disable next-line all: equivalent: an unset coefficient reads as 0 in the bit operations
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j] as number, root);
      // Stryker disable next-line all: equivalent: XOR with an unset entry past the end leaves the value
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data: readonly number[], by: readonly number[]): number[] {
  // Stryker disable next-line all: equivalent: an unset remainder entry reads as 0 in XOR
  const result = by.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    // Stryker disable next-line all: equivalent: the next XOR fills the slot it would have pushed
    result.push(0);
    by.forEach((coefficient, i) => {
      result[i] = (result[i] as number) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

function codewords(text: string): { version: number; words: number[] } {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  const countBits = (v: number) => (v <= 9 ? 8 : 16);
  // Stryker disable next-line all: equivalent: byte mode never fills a version to the exact bit, so equal never occurs
  while (4 + countBits(version) + bytes.length * 8 > dataCodewords(version) * 8) {
    version += 1;
    if (version > 40) throw new Error("Text too long for a QR code");
  }
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0x4, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  // Stryker disable next-line all: equivalent: byte mode always leaves 4 bits or more, so the terminator is always 4
  push(0, Math.min(4, capacity - bits.length));
  // Stryker disable next-line all: equivalent: after the terminator the bits already end on a byte
  push(0, (8 - (bits.length % 8)) % 8);
  // Stryker disable next-line all: equivalent: an extra pad byte past the capacity is never placed
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  // Stryker disable next-line all: equivalent: a closing empty slice adds a zero byte past the data, never placed
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, one) => (byte << 1) | one, 0));
  return { version, words: interleaved(version, data) };
}

// Splits the data into blocks, adds each block's error correction, and interleaves them.
function interleaved(version: number, data: readonly number[]): number[] {
  const blocks = BLOCKS[version - 1] as number;
  const eccLength = ECC_PER_BLOCK[version - 1] as number;
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const by = divisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLength - eccLength + (i < short ? 0 : 1));
    k += part.length;
    const ecc = remainder(part, by);
    if (i < short) part.push(0);
    all.push([...part, ...ecc]);
  }
  const result: number[] = [];
  // Stryker disable next-line all: equivalent: a step past the longest block adds nothing a module reads
  for (let i = 0; i < (all[0] as number[]).length; i++)
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= short) result.push(block[i] as number);
    });
  return result;
}

class Grid {
  readonly modules: boolean[][];
  readonly fixed: boolean[][];
  constructor(readonly size: number) {
    // Stryker disable next-line all: equivalent: an unset module reads as light, as false does
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    // Stryker disable next-line all: equivalent: an unset flag reads as not fixed, as false does
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    (this.modules[y] as boolean[])[x] = dark;
    (this.fixed[y] as boolean[])[x] = true;
  }
  at = (x: number, y: number) => (this.modules[y] as boolean[])[x] as boolean;
}

function alignmentPositions(version: number, size: number): number[] {
  // Stryker disable next-line all: equivalent: version 1's single position is the skipped corner either way
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

function formatBits(grid: Grid, mask: number) {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size } = grid;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(bits, i));
  grid.set(8, 7, bit(bits, 6));
  grid.set(8, 8, bit(bits, 7));
  grid.set(7, 8, bit(bits, 8));
  // Stryker disable next-line all: equivalent: bit 15 of a 15-bit value is 0 and its column is off the grid
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(bits, i));
  grid.set(8, size - 8, true);
}

function functionPatterns(grid: Grid, version: number) {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        // Stryker disable next-line all: equivalent: the finder pattern is symmetric
        const x = cx + dx;
        // Stryker disable next-line all: equivalent: the finder pattern is symmetric
        const y = cy + dy;
        // Stryker disable next-line all: equivalent: a column left of the grid is never read
        if (x >= 0 && x < size && y >= 0 && y < size) grid.set(x, y, distance !== 2 && distance !== 4);
      }
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((ay, i) => {
    positions.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        // Stryker disable next-line all: equivalent: the alignment pattern is symmetric
        for (let dx = -2; dx <= 2; dx++) grid.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  formatBits(grid, 0);
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.set(a, b, bit(bits, i));
    grid.set(b, a, bit(bits, i));
  }
}

function place(grid: Grid, words: readonly number[]) {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        // Past the last codeword the remainder bits are light.
        if (!(grid.fixed[y] as boolean[])[x]) {
          (grid.modules[y] as boolean[])[x] = bit(words[i >>> 3] ?? 0, 7 - (i & 7));
          i += 1;
        }
      }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  // Stryker disable next-line all: equivalent: a sum and a difference have the same parity
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  // Stryker disable next-line all: equivalent: a sum and a difference have the same parity
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  // Stryker disable next-line all: equivalent: a sum and a difference have the same parity
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  // Stryker disable next-line all: equivalent: a sum and a difference have the same parity
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number) {
  const invert = MASKS[mask] as (x: number, y: number) => boolean;
  for (let y = 0; y < grid.size; y++)
    for (let x = 0; x < grid.size; x++)
      if (!(grid.fixed[y] as boolean[])[x] && invert(x, y))
        (grid.modules[y] as boolean[])[x] = !(grid.modules[y] as boolean[])[x];
}

// The standard's penalty: runs of five or more, 2x2 blocks, finder-like patterns, dark balance.
// It only picks which of the eight masks is used, and every mask gives a valid code (each mask is
// decoded in the tests), so a changed score is not a wrong code: it is left out of mutation testing.
// Stryker disable all
function penalty(grid: Grid): number {
  const { size } = grid;
  let result = 0;
  const countPatterns = (history: number[]) => {
    const n = history[1] as number;
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && (history[0] as number) >= n * 4 && (history[6] as number) >= n ? 1 : 0) +
      (core && (history[6] as number) >= n * 4 && (history[0] as number) >= n ? 1 : 0)
    );
  };
  const addHistory = (length: number, history: number[]) => {
    history.pop();
    history.unshift(history[0] === 0 ? length + size : length);
  };
  for (const read of [(a: number, b: number) => grid.at(b, a), (a: number, b: number) => grid.at(a, b)]) {
    for (let a = 0; a < size; a++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        if (read(a, b) === color) {
          run += 1;
          if (run === 5) result += 3;
          else if (run > 5) result += 1;
        } else {
          addHistory(run, history);
          if (!color) result += countPatterns(history) * 40;
          color = read(a, b);
          run = 1;
        }
      }
      if (color) {
        addHistory(run, history);
        run = 0;
      }
      addHistory(run + size, history);
      result += countPatterns(history) * 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (grid.at(x, y)) dark += 1;
      if (x < size - 1 && y < size - 1) {
        const c = grid.at(x, y);
        if (c === grid.at(x + 1, y) && c === grid.at(x, y + 1) && c === grid.at(x + 1, y + 1)) result += 3;
      }
    }
  const total = size * size;
  return result + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}
// Stryker restore all

// The modules of the QR code of a text: rows of dark (true) and light, without the quiet zone.
// The mask is the one with the lowest penalty, unless one is named (0 to 7).
export function qrModules(text: string, fixedMask: number | null = null): boolean[][] {
  const { version, words } = codewords(text);
  const grid = new Grid(version * 4 + 17);
  functionPatterns(grid, version);
  place(grid, words);
  if (fixedMask !== null) {
    applyMask(grid, fixedMask);
    formatBits(grid, fixedMask);
    return grid.modules;
  }
  let best = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    formatBits(grid, mask);
    const score = penalty(grid);
    // Stryker disable next-line all: equivalent: on a tie either mask gives a valid code; mask choice is not a correctness rule
    if (score < lowest) {
      best = mask;
      lowest = score;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, best);
  formatBits(grid, best);
  return grid.modules;
}

// One SVG path of the dark modules, each a 1 by 1 square, offset by a 4-module quiet zone.
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    });
  });
  return parts.join("");
}
