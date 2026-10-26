// 运行核心逻辑自测：node test-core.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('./core.js');

const errors = Core._selfTest();
if (errors.length === 0) {
  console.log('✅ 全部自测通过');
  process.exit(0);
} else {
  console.log('❌ 自测失败 ' + errors.length + ' 项：');
  errors.forEach(e => console.log('   - ' + e));
  process.exit(1);
}
