export const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export async function runTests() {
  let failed = false;

  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${item.name}`);
      console.error(error);
    }
  }

  if (failed) {
    process.exit(1);
  }
}
