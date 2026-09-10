export function add(a: number, b: number): number {
  return a + b;
}

export function sum(arr: number[]): number {
  return arr.reduce((acc, cur) => acc + cur, 0);
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}

export function percentage(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return (a / b) * 100;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function average(a: number, b: number): number {
  return (a + b) / 2;
}
