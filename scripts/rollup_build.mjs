import { rollup } from 'rollup';
import config from '../rollup.config.js';

async function run() {
  const configs = Array.isArray(config) ? config : [config];

  for (const entry of configs) {
    const startedAt = Date.now();
    const outputFile = Array.isArray(entry.output) ? entry.output[0]?.file : entry.output?.file;
    const outputLabel = outputFile ? ` → ${outputFile}` : '';
    console.log(`[rollup] ${entry.input}${outputLabel}`);

    const bundle = await rollup(entry);
    try {
      if (Array.isArray(entry.output)) {
        for (const out of entry.output) {
          await bundle.write(out);
        }
      } else if (entry.output) {
        await bundle.write(entry.output);
      }
    } finally {
      await bundle.close();
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[rollup] done in ${elapsed}ms`);
  }
}

run()
  .then(() => {
    // Workaround: rollup/plugin-typescript occasionally leaves open handles on some environments.
    // Force a clean exit so downstream scripts (e.g. build_spatial_nav.sh) can continue.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

